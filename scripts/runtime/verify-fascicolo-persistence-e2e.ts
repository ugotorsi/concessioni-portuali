import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createFascicoloAutomaticAnalysisHandler,
  FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT,
  type FascicoloAutomaticAnalysisDependencies,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  createFascicoloDocumentAnalysisService,
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
} from "@/server/ai/fascicoloDocumentAnalysis";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import { SELVARA_PILOT_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  getCurrentKnowledgeRevision,
  persistStructuredKnowledgeRevision,
  promotePreparedKnowledgeRevision,
  runInFascicoloKnowledgeTransaction,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeEvidenceCandidate,
  type KnowledgeSqlExecutor,
} from "@/server/fascicolo-knowledge";
import {
  buildStructuredFascicoloReport,
  listStructuredFascicoloReportSnapshots,
  persistDraftStructuredFascicoloReport,
  persistStructuredFascicoloReport,
  type StructuredReportRepositoryContext,
  type StructuredReportSqlExecutor,
} from "@/server/fascicolo-report";
import { getFascicoloAutomaticWorkflowReadModelForTenant } from "@/server/queries/fascicolo-automatic-workflow";
import {
  loadCurrentStructuredKnowledge,
  loadStructuredKnowledgeRevision,
} from "@/server/queries/fascicolo-knowledge";
import {
  selvaraOfflineCorpusMetadata,
  selvaraOfflinePages,
} from "../../tests/fixtures/selvara-offline-corpus";
import { buildSelvaraOfflineProviderOutput } from "../../tests/fixtures/selvara-offline-provider-output";

interface QueryMetric {
  stage: string;
  durationMs: number;
}

const args = process.argv.slice(2);
const execute = args.includes("--execute-isolated-e2e");
const runIdIndex = args.indexOf("--run-id");
const runId = runIdIndex >= 0 ? args[runIdIndex + 1] : undefined;
if (!execute || !runId || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(runId)) {
  throw new Error(
    "Run only with --execute-isolated-e2e --run-id <lowercase-isolated-id>.",
  );
}
if (process.env.PERSISTENCE_E2E_ALLOWED !== "true") {
  throw new Error("PERSISTENCE_E2E_ALLOWED must be exactly true.");
}
const forbiddenGates = [
  ["AI_REAL_DATA_ENABLED", process.env.AI_REAL_DATA_ENABLED],
  ["ASYNC_PROVIDER_EXECUTION_ENABLED", process.env.ASYNC_PROVIDER_EXECUTION_ENABLED],
  ["AUTOMATIC_RESEARCH_EXECUTION_ENABLED", process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED],
  [
    "AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED",
    process.env.AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED,
  ],
] as const;
const enabledGate = forbiddenGates.find(([, value]) => value === "true");
if (enabledGate) throw new Error(`Paid/provider gate must remain OFF: ${enabledGate[0]}`);
if (process.env.DOCUMENT_WORKER_ACTIVATION_MODE !== "DISABLED") {
  throw new Error("DOCUMENT_WORKER_ACTIVATION_MODE must be DISABLED.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const prefix = `noetra-e2e-${runId}`;
const tenantId = `${prefix}-tenant`;
const otherTenantId = `${prefix}-isolated-tenant`;
const procedimentoId = `${prefix}-procedure`;
const documentoId = `${prefix}-document`;
const documentFileVersionId = `${prefix}-version`;
const extractionAttemptId = `${prefix}-attempt`;
const corpusFingerprint = createHash("sha256")
  .update(`${prefix}:40-page-offline-corpus`, "utf8")
  .digest("hex");
const metrics: QueryMetric[] = [];
const timings: Record<string, number> = {};
let stage = "setup";

function metricExecutor(
  client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
): KnowledgeSqlExecutor & StructuredReportSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const started = performance.now();
      try {
        return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
      } finally {
        metrics.push({ stage, durationMs: performance.now() - started });
      }
    },
  };
}

const sharedContext: FascicoloKnowledgeRepositoryContext & StructuredReportRepositoryContext = {
  read: metricExecutor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry(
    (tx) => operation(metricExecutor(tx)),
    { timeoutMs: 30_000 },
  ),
};

async function measured<T>(name: string, operation: () => Promise<T>): Promise<T> {
  stage = name;
  const started = performance.now();
  try {
    return await operation();
  } finally {
    timings[name] = performance.now() - started;
  }
}

async function seedIsolatedCorpus(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ente.createMany({
      data: [{
        id: tenantId,
        nome: `NOETRA E2E synthetic ${runId}`,
        codice: tenantId,
      }, {
        id: otherTenantId,
        nome: `NOETRA E2E isolated tenant ${runId}`,
        codice: otherTenantId,
      }],
    });
    await tx.procedimento.create({
      data: {
        id: procedimentoId,
        enteId: tenantId,
        oggetto: `NOETRA E2E synthetic legal report ${runId}`,
        tipologia: "ALTRO",
        stato: "IN_CORSO",
        dataAvvio: new Date("2026-10-29T00:00:00.000Z"),
      },
    });
    await tx.documento.create({
      data: {
        id: documentoId,
        nome: `NOETRA E2E 40-page offline corpus ${runId}`,
        tipologia: "ALTRO",
        direzione: "INTERNO",
        enteId: tenantId,
        procedimentoId,
      },
    });
    await tx.documentFileVersion.create({
      data: {
        id: documentFileVersionId,
        documentId: documentoId,
        canonicalEnteId: tenantId,
        storageProvider: "NOETRA_E2E_OFFLINE",
        storageKey: `e2e/${runId}/offline-synthetic.pdf`,
        mimeType: "application/pdf",
        sizeBytes: selvaraOfflinePages.reduce(
          (total, page) => total + Buffer.byteLength(page.text, "utf8"),
          0,
        ),
        sha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
        createdByActorId: `${prefix}-offline-actor`,
        createdByRole: "SYSTEM_E2E",
      },
    });
    await tx.documento.update({
      where: { id: documentoId },
      data: { currentFileVersionId: documentFileVersionId },
    });
    await tx.documentExtractionAttempt.create({
      data: {
        id: extractionAttemptId,
        executionKey: `${prefix}-execution`,
        documentoId,
        documentFileVersionId,
        tenantId,
        procedimentoId,
        sourceSha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
        outcome: "SUCCEEDED",
        declaredMimeType: "application/pdf",
        detectedMimeType: "application/pdf",
        sourceSizeBytes: selvaraOfflinePages.reduce(
          (total, page) => total + page.text.length,
          0,
        ),
        policyVersion: "NOETRA_E2E_OFFLINE_V1",
        startedAt: new Date("2026-10-29T00:00:00.000Z"),
        completedAt: new Date("2026-10-29T00:00:01.000Z"),
        directExtractorName: "NOETRA_E2E_OFFLINE",
        directExtractorVersion: "1",
      },
    });
    await tx.documentExtractionPage.createMany({
      data: selvaraOfflinePages.map((page) => ({
        id: `${prefix}-page-${page.pageNumber}`,
        extractionAttemptId,
        pageNumber: page.pageNumber,
        extractionMethod: "DIRECT_TEXT" as const,
        text: page.text,
        normalizedText: page.text,
        textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
        normalizedCharacterCount: page.text.length,
      })),
    });
  }, { timeout: 30_000 });
}

await measured("setup", seedIsolatedCorpus);

const authority = {
  sourceKind: "DOCUMENT_CORPUS" as const,
  tenantId,
  procedimentoId,
  extractionAttemptId,
  artifactSha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
  corpusFingerprint,
  actorId: `${prefix}-offline-actor`,
  documents: [{
    neutralIntakeId: "",
    documentVersionId: extractionAttemptId,
    artifactSha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
    documentoId,
    documentFileVersionId,
    pages: selvaraOfflinePages.map((page) => ({
      pageNumber: page.pageNumber,
      normalizedText: page.text,
      sourceText: page.text,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      extractionMethod: "DIRECT_TEXT",
      ocrConfidence: null,
    })),
  }],
};
let providerCallCount = 0;
const analysisService = createFascicoloDocumentAnalysisService({
  provider: {
    async analyze() {
      providerCallCount += 1;
      return buildSelvaraOfflineProviderOutput(extractionAttemptId);
    },
  },
  maxInputBytes: 200_000,
  realDataActivation: createRealDataActivationPolicy({
    AI_REAL_DATA_ENABLED: "true",
    AI_REAL_DATA_APPROVAL_ID: `${prefix}-offline-only`,
    AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
  }),
});
let capturedKnowledge: unknown;
let capturedEvidence: ReadonlyMap<string, KnowledgeEvidenceCandidate> | undefined;
const dependencies: FascicoloAutomaticAnalysisDependencies = {
  loadAuthority: async () => authority,
  validateControlledV7Preflight: async () => undefined,
  getCurrentRevision: (input) => getCurrentKnowledgeRevision(input, sharedContext),
  findExistingReport: async () => null,
  analyze: (input) => measured("compile", () => analysisService.analyze(input)),
  async persistKnowledge(input) {
    capturedKnowledge = input.knowledge;
    capturedEvidence = input.evidenceByBasisRef;
    return measured("persistKnowledge", () => persistStructuredKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      knowledge: input.knowledge,
      evidenceByBasisRef: input.evidenceByBasisRef,
      sourceTextByBasisRef: input.sourceTextByBasisRef,
      revisionContractVersion: input.forceNewRevision
        ? FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT
        : undefined,
      deferPromotion: input.deferPromotion,
      preserveDraftOnQualityFailure: input.preserveDraftOnQualityFailure,
      compilation: input.compilation,
    }, sharedContext));
  },
  async prepareStructuredReport(input) {
    return measured("prepareReport", async () => {
      const knowledge = await loadStructuredKnowledgeRevision(
        input.tenantId,
        input.procedimentoId,
        input.knowledgeRevisionId,
        sharedContext.read,
      );
      return knowledge
        ? buildStructuredFascicoloReport({
            tenantId: input.tenantId,
            procedimentoId: input.procedimentoId,
            knowledge,
            missions: [],
          })
        : null;
    });
  },
  async finalizeControlledV7(input) {
    return measured("finalize", () => runInFascicoloKnowledgeTransaction(
      async (transactionContext) => {
        const revision = await promotePreparedKnowledgeRevision({
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          revisionId: input.knowledgeRevisionId,
          expectedCurrentRevisionId: input.expectedCurrentRevisionId,
        }, transactionContext);
        const saved = await persistStructuredFascicoloReport(input.report, {
          read: transactionContext.read,
          transaction: transactionContext.transaction,
        });
        return {
          revision,
          outcome: saved.outcome,
          snapshotId: saved.snapshot.id,
        };
      },
      sharedContext,
    ));
  },
  async persistDraftStructuredReport(input) {
    const saved = await persistDraftStructuredFascicoloReport(input.report, sharedContext);
    return { outcome: saved.outcome, snapshotId: saved.snapshot.id };
  },
  reconcileKnowledgeMissions: async () => [],
  resolveMissionAssignee: async () => authority.actorId,
  persistReport: async () => {
    throw new Error("Unexpected legacy report persistence.");
  },
  persistMission: async () => {
    throw new Error("Unexpected mission persistence.");
  },
  scheduleMission: async () => {
    throw new Error("Unexpected mission scheduling.");
  },
  listPriorReportIds: async () => [],
};
const handler = createFascicoloAutomaticAnalysisHandler(dependencies);
const reference = handler.parseInput({
  referenceType: "FASCICOLO_DOCUMENT_CORPUS",
  referenceId: corpusFingerprint,
  referenceVersion: "V1",
  metadata: {
    procedimentoId,
    corpusHash: corpusFingerprint,
    trialContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
    trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
    trialPreflightHash: "d".repeat(64),
  },
});
const execution = await measured("totalPipeline", () => handler.execute(reference, {
  jobId: `${prefix}-job`,
  correlationId: `${prefix}-correlation`,
  attempt: 1,
  isCancellationRequested: async () => false,
  heartbeat: async () => undefined,
}));

if (!capturedKnowledge || !capturedEvidence) {
  throw new Error("The controlled pipeline did not reach structured persistence.");
}
const persistedEvidence = capturedEvidence;
const current = await measured("rereadKnowledge", () => loadCurrentStructuredKnowledge(
  tenantId,
  procedimentoId,
  sharedContext.read,
));
const snapshots = await measured("rereadReport", () => listStructuredFascicoloReportSnapshots({
  tenantId,
  procedimentoId,
}, sharedContext));
const applicationModel = await measured("applicationReadModel", () => (
  getFascicoloAutomaticWorkflowReadModelForTenant({ tenantId, procedimentoId })
));
const isolatedSnapshots = await listStructuredFascicoloReportSnapshots({
  tenantId: otherTenantId,
  procedimentoId,
}, sharedContext);
if (!current || !applicationModel?.structuredReport || snapshots.length !== 1) {
  throw new Error("Persisted report was not readable through the application path.");
}
const structuredReport = applicationModel.structuredReport;
const idempotentReport = await measured("idempotentReport", () => (
  persistStructuredFascicoloReport(structuredReport, sharedContext)
));
const currentBeforeRollback = await getCurrentKnowledgeRevision(
  { tenantId, procedimentoId },
  sharedContext,
);
const invalidEvidence = new Map(persistedEvidence);
const firstEvidence = invalidEvidence.entries().next().value;
if (!firstEvidence) throw new Error("Synthetic fixture has no evidence.");
invalidEvidence.set(firstEvidence[0], {
  ...firstEvidence[1],
  textSha256: "0".repeat(64),
});
let rollbackError = "";
try {
  await measured("rollbackProbe", () => persistStructuredKnowledgeRevision({
    tenantId,
    procedimentoId,
    corpusFingerprint: createHash("sha256")
      .update(`${corpusFingerprint}:rollback-probe`, "utf8")
      .digest("hex"),
    knowledge: capturedKnowledge,
    evidenceByBasisRef: invalidEvidence,
    deferPromotion: true,
  }, sharedContext));
} catch (error) {
  rollbackError = error instanceof Error ? error.message : String(error);
}
const currentAfterRollback = await getCurrentKnowledgeRevision(
  { tenantId, procedimentoId },
  sharedContext,
);
const rollbackRevisionCount = await sharedContext.read.query<{ count: bigint }>(
  `SELECT COUNT(*)::bigint AS "count"
   FROM "FascicoloKnowledgeRevision"
   WHERE "tenantId" = $1
     AND "procedimentoId" = $2
     AND "corpusFingerprint" = $3`,
  [
    tenantId,
    procedimentoId,
    createHash("sha256").update(`${corpusFingerprint}:rollback-probe`, "utf8").digest("hex"),
  ],
);
if (
  providerCallCount !== 1
  || currentBeforeRollback?.id !== currentAfterRollback?.id
  || rollbackRevisionCount.rows[0]?.count !== BigInt(0)
  || !rollbackError.includes("EVIDENCE_SCOPE_MISMATCH")
  || isolatedSnapshots.length !== 0
  || idempotentReport.outcome !== "REUSED"
) {
  throw new Error("Rollback, idempotency, provider isolation, or tenant isolation invariant failed.");
}

const payload = structuredReport.payload;
const documentedItems = [
  ...payload.documentedFramework.partyRoles,
  ...(payload.documentedFramework.partyPositions ?? []),
  ...payload.documentedFramework.facts,
  ...payload.documentedFramework.timeline,
  ...payload.documentedFramework.legalActs,
  ...payload.documentedFramework.measures,
  ...payload.documentedFramework.contradictions,
  ...payload.gaps,
];
const stageMetrics = Object.fromEntries(
  [...new Set(metrics.map((metric) => metric.stage))].map((metricStage) => {
    const selected = metrics.filter((metric) => metric.stage === metricStage);
    return [metricStage, {
      queryCount: selected.length,
      cumulativeQueryDurationMs: Number(
        selected.reduce((total, metric) => total + metric.durationMs, 0).toFixed(2),
      ),
    }];
  }),
);
console.log(JSON.stringify({
  status: "SUCCEEDED",
  runId,
  isolation: {
    tenantId,
    procedimentoId,
    documentoId,
    documentFileVersionId,
    extractionAttemptId,
    pageCount: selvaraOfflinePages.length,
    otherTenantSnapshotCount: isolatedSnapshots.length,
  },
  safety: {
    providerNetworkCalls: 0,
    inMemoryProviderCalls: providerCallCount,
    aiRealDataGate: process.env.AI_REAL_DATA_ENABLED ?? null,
    asyncProviderGate: process.env.ASYNC_PROVIDER_EXECUTION_ENABLED ?? null,
    workerActivationMode: process.env.DOCUMENT_WORKER_ACTIVATION_MODE,
  },
  execution,
  timingsMs: Object.fromEntries(
    Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(2))]),
  ),
  queryMetrics: stageMetrics,
  persistence: {
    currentRevisionId: current.revision.id,
    currentStatus: "CURRENT",
    snapshotId: snapshots[0].id,
    snapshotStatus: snapshots[0].status,
    idempotentReportOutcome: idempotentReport.outcome,
    rollbackError,
    rollbackRevisionCount: rollbackRevisionCount.rows[0]?.count.toString() ?? null,
    currentPreservedAfterRollback: currentBeforeRollback?.id === currentAfterRollback?.id,
  },
  report: {
    fingerprint: snapshots[0].reportFingerprint,
    factCount: payload.documentedFramework.facts.length,
    chronologyCount: payload.documentedFramework.timeline.length,
    legalActCount: payload.documentedFramework.legalActs.length,
    legalIssueCount: payload.legalIssues.length,
    gapCount: payload.gaps.length,
    citationCount: documentedItems.reduce(
      (total, item) => total + item.evidence.length,
      0,
    ),
    applicationReadModelAvailable: true,
    applicationPath: `/procedimenti/${procedimentoId}?section=reports`,
  },
}, null, 2));
await prisma.$disconnect();

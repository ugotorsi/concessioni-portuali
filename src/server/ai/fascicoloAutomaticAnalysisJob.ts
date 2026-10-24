import { createHash } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  providerAnalysisPayloadV1Schema,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  createResearchMission,
  RESEARCH_BRIDGE_VERSION,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import { createResearchMissionRecord } from "@/server/legal-research/persistence";
import {
  ensureAutomaticResearchExecution,
  type AutomaticResearchAdmissionResult,
} from "@/server/legal-research/automatic-research-job";
import { FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloAutomaticContracts";
import {
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  FascicoloDocumentAnalysisError,
  type FascicoloDocumentAnalysisInput,
  type FascicoloDocumentExcerpt,
} from "@/server/ai/fascicoloDocumentAnalysis";
import { createOpenAiFascicoloDocumentRuntimeFromEnv } from "@/server/ai/openaiRuntime";
import { AiRealDataActivationError } from "@/server/ai/realDataActivation";
import { OpenAiRuntimeConfigurationError } from "@/server/ai/openaiRuntime";
import { withRuntimeCostGate } from "@/server/runtime/cost";
import { runtimeCostEstimate } from "@/server/runtime/costConfig";
import {
  AutomaticFascicoloReportRepositoryError,
  findAutomaticFascicoloReportByVersion,
  persistAutomaticFascicoloReport,
  type AutomaticFascicoloReportReference,
} from "@/server/ai/fascicoloAutomaticReportRepository";
import {
  admitDeferredKnowledgeResearchMissionWave,
  buildKnowledgeResearchMissionPlans,
  DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
  getCurrentKnowledgeRevision,
  isCanonicalIdentityRevision,
  isCanonicalIdentityV3Enabled,
  persistStructuredKnowledgeForConfiguredEngine,
  reconcileKnowledgeResearchMissions,
  type KnowledgeEvidenceCandidate,
  type KnowledgeMissionLifecycleResult,
  type KnowledgeReconciliationResult,
  type KnowledgeRevisionSnapshot,
} from "@/server/fascicolo-knowledge";
import { resolveResearchMissionAssignee } from "@/server/fascicolo-knowledge/researchMissionRecovery";
import {
  getFascicoloDocumentCorpusForAsyncJob,
  type FascicoloDocumentCorpus,
} from "@/server/queries/fascicolo-document-corpus";

export { FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloAutomaticContracts";

export const FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION = "FASCICOLO.AUTOMATIC_ANALYSIS_V1" as const;
export const FASCICOLO_AUTOMATIC_ANALYSIS_PURPOSE = "FASCICOLO_AUTOMATIC_ANALYSIS" as const;
const MAX_DOCUMENT_EXCERPT_CHARACTERS = 96_000;

const neutralIntakeReferenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_DOCUMENT_VERSION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    procedimentoId: z.string().trim().min(1).max(256),
    neutralIntakeId: z.string().trim().min(1).max(256),
    extractionAttemptId: z.string().trim().min(1).max(256),
  }).strict(),
}).strict();
const documentCorpusReferenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_DOCUMENT_CORPUS"),
  referenceId: z.string().regex(/^[0-9a-f]{64}$/),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    procedimentoId: z.string().trim().min(1).max(256),
    corpusHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
}).strict();
const automaticReferenceSchema = z.discriminatedUnion("referenceType", [
  neutralIntakeReferenceSchema,
  documentCorpusReferenceSchema,
]);

type AutomaticReference = z.output<typeof automaticReferenceSchema>;

export type AutomaticDocumentExcerpt = FascicoloDocumentExcerpt;
export type AutomaticFascicoloAnalysisInput = FascicoloDocumentAnalysisInput & {
  readonly jobId: string;
  readonly attempt: number;
};

export interface AutomaticFascicoloReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly documentVersionId: string;
  readonly artifactSha256: string;
  readonly corpusFingerprint: string;
  readonly documents: readonly {
    documentVersionId: string;
    artifactSha256: string;
  }[];
  readonly neutralIntakeId: string;
  readonly actorId: string;
  readonly analysis: ProviderAnalysisPayloadV1;
  readonly provenance: readonly Omit<AutomaticDocumentExcerpt, "text">[];
  readonly missions: readonly ResearchMission[];
  readonly supersedesReportIds: readonly string[];
}

interface AutomaticAuthority {
  readonly sourceKind?: "NEUTRAL_INTAKE" | "DOCUMENT_CORPUS";
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly neutralIntakeId?: string;
  readonly extractionAttemptId: string;
  readonly artifactSha256: string;
  readonly corpusFingerprint: string;
  readonly actorId: string;
  readonly documents: readonly {
    neutralIntakeId: string;
    documentVersionId: string;
    artifactSha256: string;
    documentoId?: string;
    documentFileVersionId?: string;
    pages: readonly {
      pageNumber: number;
      normalizedText: string;
      textSha256: string;
      extractionMethod: string;
      ocrConfidence: number | null;
    }[];
  }[];
}

export interface FascicoloAutomaticAnalysisDependencies {
  loadAuthority(input: { jobId: string; reference: AutomaticReference }): Promise<AutomaticAuthority | null>;
  getCurrentRevision?(input: {
    tenantId: string;
    procedimentoId: string;
  }): ReturnType<typeof getCurrentKnowledgeRevision>;
  findExistingReport(input: {
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
  }): Promise<AutomaticFascicoloReportReference | null>;
  analyze(input: AutomaticFascicoloAnalysisInput): Promise<unknown>;
  persistKnowledge?(input: {
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
    knowledge: unknown;
    evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
    sourceTextByBasisRef?: ReadonlyMap<string, string>;
  }): Promise<unknown>;
  reconcileKnowledgeMissions?(input: {
    tenantId: string;
    procedimentoId: string;
    knowledgeRevisionId: string;
    assignedActorId: string | null;
    plans: ReturnType<typeof buildKnowledgeResearchMissionPlans>;
  }): Promise<readonly KnowledgeMissionLifecycleResult[]>;
  resolveMissionAssignee?(input: {
    tenantId: string;
    candidateActorId: string;
  }): Promise<string | null>;
  researchExecutionWaveLimit?: number;
  persistReport(input: AutomaticFascicoloReport): Promise<{ outcome: "CREATED" | "REUSED"; reportId: string }>;
  persistMission(input: { mission: ResearchMission; actorId: string; tenantId: string }): Promise<unknown>;
  scheduleMission(input: {
    mission: ResearchMission;
    actorId: string;
    tenantId: string;
    correlationId: string;
  }): Promise<AutomaticResearchAdmissionResult>;
  listPriorReportIds(input: { tenantId: string; procedimentoId: string; exceptVersionId: string }): Promise<readonly string[]>;
}

export function fascicoloAutomaticAnalysisDiagnostic(error: unknown): Readonly<Record<string, unknown>> | null {
  if (error instanceof OpenAiRuntimeConfigurationError) {
    return {
      event: "fascicolo_automatic_analysis_configuration_error",
      envName: error.envName,
    };
  }
  if (error instanceof FascicoloDocumentAnalysisError && error.providerDiagnostics) {
    return {
      event: "fascicolo_automatic_analysis_provider_error",
      errorCode: error.code,
      httpStatus: error.providerDiagnostics.httpStatus,
      providerCode: error.providerDiagnostics.providerCode,
    };
  }
  return null;
}

function stableIdentity(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function boundedExcerpts(authority: AutomaticAuthority): readonly AutomaticDocumentExcerpt[] {
  if (authority.sourceKind === "DOCUMENT_CORPUS") {
    const perDocumentLimit = Math.max(1, Math.floor(MAX_DOCUMENT_EXCERPT_CHARACTERS / authority.documents.length));
    const pageTextLengths = authority.documents.map((document) => document.pages.reduce(
      (length, page) => length + page.normalizedText.length, 0,
    ));
    if (pageTextLengths.some((length) => length > perDocumentLimit)
      || pageTextLengths.reduce((sum, length) => sum + length, 0) > MAX_DOCUMENT_EXCERPT_CHARACTERS) {
      throw new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_CORPUS_EXCEEDS_ANALYSIS_LIMIT", false);
    }
  }
  let remaining = MAX_DOCUMENT_EXCERPT_CHARACTERS;
  const excerpts: AutomaticDocumentExcerpt[] = [];
  const perDocumentLimit = Math.max(1, Math.floor(MAX_DOCUMENT_EXCERPT_CHARACTERS / authority.documents.length));
  for (const [documentIndex, document] of authority.documents.entries()) {
    let documentRemaining = Math.min(perDocumentLimit, remaining);
    for (const page of [...document.pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
      if (documentRemaining <= 0 || remaining <= 0) break;
      const text = page.normalizedText.slice(0, documentRemaining);
      if (!text.trim()) continue;
      excerpts.push({
        reference: `DOCUMENT_${documentIndex + 1}.PAGE_${page.pageNumber}`,
        documentVersionId: document.documentVersionId,
        artifactSha256: document.artifactSha256,
        pageNumber: page.pageNumber,
        text,
        textSha256: page.textSha256,
        extractionMethod: page.extractionMethod,
        ocrConfidence: page.ocrConfidence,
      });
      documentRemaining -= text.length;
      remaining -= text.length;
    }
  }
  return excerpts;
}

function validateGrounding(analysis: ProviderAnalysisPayloadV1, excerpts: readonly AutomaticDocumentExcerpt[]): void {
  const allowed = new Set(excerpts.map((excerpt) => excerpt.reference));
  const grounded = [
    analysis.summary,
    ...analysis.timeline,
    ...analysis.recordedState,
    ...analysis.signals,
  ];
  const all = [
    ...grounded,
    ...analysis.investigativeQuestions,
    ...analysis.suggestedActivities,
    ...analysis.legalResearchQuestions,
  ];
  const missingGrounding = grounded.filter((statement) => statement.basisRefs.length === 0).length;
  const invalidReferences = [...new Set(
    all.flatMap((statement) => statement.basisRefs.filter((reference) => !allowed.has(reference))),
  )];
  if (missingGrounding > 0 || invalidReferences.length > 0) {
    console.error({
      event: "fascicolo_document_analysis_invalid_grounding",
      missingGrounding,
      invalidReferences,
      allowedReferences: [...allowed],
    });
    throw new AsyncJobExecutionError("ANALYSIS", "DOCUMENT_GROUNDING_INVALID", false);
  }
}

function resolveKnowledgeEvidence(
  authority: AutomaticAuthority,
  excerpts: readonly AutomaticDocumentExcerpt[],
): ReadonlyMap<string, KnowledgeEvidenceCandidate> {
  return new Map(excerpts.flatMap((excerpt) => {
    const document = authority.documents.find((candidate) => candidate.documentVersionId === excerpt.documentVersionId);
    if (!document?.documentoId || !document.documentFileVersionId) return [];
    const extractionProvenance = authority.sourceKind === "DOCUMENT_CORPUS"
      ? {
          provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
          documentExtractionAttemptId: document.documentVersionId,
        }
      : {
          provenanceType: "DOCUMENT_EXTRACTION" as const,
          extractionAttemptId: document.documentVersionId,
        };
    return [[excerpt.reference, {
      ...extractionProvenance,
      documentoId: document.documentoId,
      documentFileVersionId: document.documentFileVersionId,
      pageNumber: excerpt.pageNumber,
      textSha256: excerpt.textSha256,
      quoteSha256: null,
      basisRef: excerpt.reference,
    } satisfies KnowledgeEvidenceCandidate] as const];
  }));
}

function missionsFromAnalysis(input: {
  authority: AutomaticAuthority;
  analysis: ProviderAnalysisPayloadV1;
}): readonly ResearchMission[] {
  const referenceDate = input.analysis.timeline.find((item) => item.recordedAt !== null)?.recordedAt ?? null;
  if (!referenceDate) return [];
  return input.analysis.legalResearchQuestions.slice(0, DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT).map((question, index) => {
    const issueId = stableIdentity("legal-issue", {
      documentVersionId: input.authority.extractionAttemptId,
      corpusFingerprint: input.authority.corpusFingerprint,
      index,
      text: question.text,
    });
    return createResearchMission({
      kind: "RESEARCH_MISSION",
      version: RESEARCH_BRIDGE_VERSION,
      caseReference: {
        caseId: input.authority.procedimentoId,
        fascicoloReference: input.authority.procedimentoId,
      },
      legalIssueIds: [issueId],
      legalPropositionIds: [],
      referenceDate,
      mode: "DISCOVER_AUTHORITIES",
      researchQuestion: question.text,
      knownAuthorities: [],
      excludedAuthorities: [],
      preferredSourceFamilies: ["ITALIAN_LEGISLATION", "GIUSTIZIA_AMMINISTRATIVA"],
      missingSourceFamilies: [],
      knownCounterArguments: input.analysis.signals
        .filter((signal) => signal.type === "VERIFY")
        .map((signal) => signal.text),
      knownEvidenceGaps: input.analysis.investigativeQuestions.map((gap, gapIndex) => ({
        gapId: stableIdentity("research-gap", {
          documentVersionId: input.authority.extractionAttemptId,
          corpusFingerprint: input.authority.corpusFingerprint,
          gapIndex,
          text: gap.text,
        }),
        kind: "MISSING_FACT_EVIDENCE" as const,
      })),
      requiredOutput: {
        authorityCandidates: true,
        citationObservations: false,
        legalResearchSuggestions: false,
        evidenceGaps: true,
        fullTextRequired: false,
      },
      budget: {
        maxTotalResearchCalls: 6,
        maxMoonlitCalls: 2,
        maxSimpliciterCalls: 2,
        maxLegalDataHunterCalls: 2,
      },
      status: "PENDING",
      executionPlan: {
        requiredCapabilities: ["SEMANTIC_DISCOVERY"],
      },
    });
  });
}

export interface DeferredKnowledgeResearchWaveDependencies {
  admit(input: { tenantId: string; procedimentoId: string; limit: number }): Promise<readonly { mission: ResearchMission }[]>;
  schedule(input: { mission: ResearchMission; actorId: string; tenantId: string; correlationId: string }): Promise<AutomaticResearchAdmissionResult>;
}

export async function executeDeferredKnowledgeResearchWave(input: {
  tenantId: string;
  procedimentoId: string;
  actorId: string;
  correlationId: string;
  limit?: number;
}, overrides: Partial<DeferredKnowledgeResearchWaveDependencies> = {}): Promise<readonly AutomaticResearchAdmissionResult[]> {
  const dependencies: DeferredKnowledgeResearchWaveDependencies = {
    admit: (value) => admitDeferredKnowledgeResearchMissionWave(value),
    schedule: ensureAutomaticResearchExecution,
    ...overrides,
  };
  const admitted = await dependencies.admit({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    limit: input.limit ?? DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
  });
  return Promise.all(admitted.map(({ mission }) => dependencies.schedule({
    mission,
    actorId: input.actorId,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
  })));
}

const defaultHandlerDependencies: FascicoloAutomaticAnalysisDependencies = {
  async loadAuthority(input) {
    if (input.reference.referenceType === "FASCICOLO_DOCUMENT_CORPUS") {
      const metadata = input.reference.metadata;
      const job = await prisma.asyncJob.findUnique({
        where: { id: input.jobId },
        select: {
          operation: true,
          tenantId: true,
          procedimentoId: true,
          policyDecisionRef: true,
          admissionType: true,
          initiatingUserId: true,
          actorId: true,
        },
      });
      if (
        !job
        || job.operation !== FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION
        || !job.tenantId
        || job.procedimentoId !== metadata.procedimentoId
        || (job.admissionType === "AUTHENTICATED_USER" && !job.initiatingUserId)
        || (job.admissionType === "AUTHORIZED_SYSTEM" && !job.policyDecisionRef)
      ) {
        return null;
      }
      const corpus = await getFascicoloDocumentCorpusForAsyncJob({
        jobId: input.jobId,
        tenantId: job.tenantId,
        procedimentoId: metadata.procedimentoId,
        operation: job.operation,
        policyDecisionRef: job.policyDecisionRef,
        actorId: job.actorId,
      });
      if (
        !corpus
        || corpus.corpusFingerprint !== metadata.corpusHash
        || corpus.availability === "NOT_READY"
      ) {
        return null;
      }
      const trigger = corpus.documents.find((document) => (
        document.status === "AVAILABLE"
        && document.extractionAttemptId !== null
        && document.sourceSha256 !== null
      ));
      if (!trigger?.sourceSha256) return null;
      return documentCorpusAuthority({
        corpus,
        actorId: job.actorId,
        triggerExtractionAttemptId: trigger.extractionAttemptId!,
        triggerArtifactSha256: trigger.sourceSha256,
      });
    }
    const [job, attempt] = await Promise.all([
      prisma.asyncJob.findUnique({
        where: { id: input.jobId },
        select: { operation: true, tenantId: true, actorId: true },
      }),
      prisma.neutralIntakeExtractionAttempt.findUnique({
        where: { id: input.reference.metadata.extractionAttemptId },
        select: {
          id: true,
          neutralIntakeId: true,
          artifactSha256: true,
          outcome: true,
          neutralIntake: {
            select: {
              id: true,
              enteId: true,
              destination: { select: { procedimentoId: true } },
            },
          },
          pages: {
            orderBy: { pageNumber: "asc" },
            select: {
              pageNumber: true,
              normalizedText: true,
              textSha256: true,
              extractionMethod: true,
              ocrConfidence: true,
            },
          },
        },
      }),
    ]);
    const destination = attempt?.neutralIntake.destination;
    if (!job || !attempt || !destination
      || job.operation !== FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION
      || job.tenantId === null || job.tenantId !== attempt.neutralIntake.enteId
      || attempt.id !== input.reference.referenceId
      || attempt.id !== input.reference.metadata.extractionAttemptId
      || attempt.neutralIntakeId !== input.reference.metadata.neutralIntakeId
      || destination.procedimentoId !== input.reference.metadata.procedimentoId
      || attempt.outcome !== "SUCCEEDED") {
      return null;
    }
    const intakes = await prisma.neutralIntake.findMany({
      where: {
        enteId: job.tenantId,
        destination: { is: { procedimentoId: destination.procedimentoId } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        extractionAttempts: {
          where: { outcome: "SUCCEEDED" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            artifactSha256: true,
            pages: {
              orderBy: { pageNumber: "asc" },
              select: {
                pageNumber: true,
                normalizedText: true,
                textSha256: true,
                extractionMethod: true,
                ocrConfidence: true,
              },
            },
          },
        },
      },
    });
    const extractedDocuments = intakes.flatMap((intake) => intake.extractionAttempts.map((version) => ({
      neutralIntakeId: intake.id,
      documentVersionId: version.id,
      artifactSha256: version.artifactSha256,
      pages: version.pages,
    })));
    const routedDocuments = await prisma.documento.findMany({
      where: {
        enteId: job.tenantId,
        procedimentoId: destination.procedimentoId,
        sha256: { in: extractedDocuments.map((document) => document.artifactSha256) },
        currentFileVersionId: { not: null },
      },
      select: { id: true, sha256: true, currentFileVersionId: true },
    });
    const documents = extractedDocuments.map((document) => {
      const matches = routedDocuments.filter((candidate) => candidate.sha256 === document.artifactSha256);
      return {
        ...document,
        documentoId: matches.length === 1 ? matches[0].id : undefined,
        documentFileVersionId: matches.length === 1 ? matches[0].currentFileVersionId ?? undefined : undefined,
      };
    });
    if (!documents.some((document) => document.documentVersionId === attempt.id)) return null;
    const corpusFingerprint = createHash("sha256").update(JSON.stringify(documents.map((document) => ({
      neutralIntakeId: document.neutralIntakeId,
      documentVersionId: document.documentVersionId,
      artifactSha256: document.artifactSha256,
    }))), "utf8").digest("hex");
    return {
      sourceKind: "NEUTRAL_INTAKE",
      tenantId: job.tenantId,
      procedimentoId: destination.procedimentoId,
      neutralIntakeId: attempt.neutralIntake.id,
      extractionAttemptId: attempt.id,
      artifactSha256: attempt.artifactSha256,
      corpusFingerprint,
      actorId: job.actorId,
      documents,
    };
  },
  getCurrentRevision: (input) => getCurrentKnowledgeRevision(input),
  findExistingReport: findAutomaticFascicoloReportByVersion,
  async analyze(input) {
    try {
      const estimatedAmount = runtimeCostEstimate("ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR");
      return await withRuntimeCostGate({
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        jobId: input.jobId,
        provider: "OPENAI",
        operationType: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
        estimatedAmount,
        idempotencyKey:
          `${FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION}:${input.corpusFingerprint}:${input.attempt}`,
      }, async () => ({
        value: await createOpenAiFascicoloDocumentRuntimeFromEnv().analyze(input),
        actualAmount: estimatedAmount,
      }));
    } catch (error) {
      const diagnostic = fascicoloAutomaticAnalysisDiagnostic(error);
      if (diagnostic) console.error(diagnostic);
      if (error instanceof OpenAiRuntimeConfigurationError) {
        throw new AsyncJobExecutionError("CONFIGURATION", "AI_CONFIGURATION_ERROR", false);
      }
      if (error instanceof AiRealDataActivationError) {
        throw new AsyncJobExecutionError("CONFIGURATION", "AI_REAL_DATA_DISABLED", false);
      }
      if (error instanceof FascicoloDocumentAnalysisError) {
        const retryable = [
          "AI_PROVIDER_UNAVAILABLE",
          "AI_PROVIDER_TIMEOUT",
          "AI_PROVIDER_RATE_LIMITED",
        ].includes(error.code);
        throw new AsyncJobExecutionError("ANALYSIS", error.code, retryable);
      }
      throw error;
    }
  },
  async persistReport(report) {
    try {
      const persisted = await persistAutomaticFascicoloReport(report);
      return { outcome: persisted.outcome, reportId: persisted.report.reportId };
    } catch (error) {
      if (error instanceof AutomaticFascicoloReportRepositoryError) {
        throw new AsyncJobExecutionError("PERSISTENCE", `AUTOMATIC_REPORT_${error.code}`, false);
      }
      throw error;
    }
  },
  async persistKnowledge(input) {
    const current = await getCurrentKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    });
    if (current?.corpusFingerprint === input.corpusFingerprint) {
      const currentIsCanonical = isCanonicalIdentityRevision(current);
      if (!isCanonicalIdentityV3Enabled() || currentIsCanonical) {
        return { revision: current, classifications: [] };
      }
    }
    return persistStructuredKnowledgeForConfiguredEngine(input);
  },
  reconcileKnowledgeMissions: (input) => reconcileKnowledgeResearchMissions(input),
  resolveMissionAssignee: (input) => resolveResearchMissionAssignee(input),
  persistMission: ({ mission, actorId, tenantId }) => createResearchMissionRecord({
    mission,
    actor: { actorId, tenantId },
  }),
  scheduleMission: ensureAutomaticResearchExecution,
  async listPriorReportIds() {
    return [];
  },
};

export function createDefaultFascicoloAutomaticAnalysisDependencies(): FascicoloAutomaticAnalysisDependencies {
  return { ...defaultHandlerDependencies };
}

async function reconcileStructuredKnowledgeMissions(input: {
  authority: AutomaticAuthority;
  revision: KnowledgeRevisionSnapshot;
  dependencies: FascicoloAutomaticAnalysisDependencies;
}) {
  if (!input.dependencies.reconcileKnowledgeMissions) {
    throw new AsyncJobExecutionError(
      "PERSISTENCE",
      "RESEARCH_MISSION_RECONCILIATION_UNAVAILABLE",
      false,
    );
  }

  let plans: ReturnType<typeof buildKnowledgeResearchMissionPlans>;
  try {
    plans = buildKnowledgeResearchMissionPlans(input.revision, {
      maxQuestionsPerWave:
        input.dependencies.researchExecutionWaveLimit
        ?? DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
    });
  } catch {
    throw new AsyncJobExecutionError(
      "PERSISTENCE",
      "RESEARCH_MISSION_PLANNING_FAILED",
      false,
    );
  }

  let assignedActorId: string | null = input.authority.actorId;
  if (input.dependencies.resolveMissionAssignee) {
    try {
      assignedActorId = await input.dependencies.resolveMissionAssignee({
        tenantId: input.authority.tenantId,
        candidateActorId: input.authority.actorId,
      });
    } catch {
      throw new AsyncJobExecutionError(
        "PERSISTENCE",
        "RESEARCH_MISSION_ASSIGNEE_RESOLUTION_FAILED",
        false,
      );
    }
  }

  let lifecycle: readonly KnowledgeMissionLifecycleResult[];
  try {
    lifecycle = await input.dependencies.reconcileKnowledgeMissions({
      tenantId: input.authority.tenantId,
      procedimentoId: input.authority.procedimentoId,
      knowledgeRevisionId: input.revision.id,
      assignedActorId,
      plans,
    });
  } catch {
    throw new AsyncJobExecutionError(
      "PERSISTENCE",
      "RESEARCH_MISSION_RECONCILIATION_FAILED",
      false,
    );
  }

  return {
    plans,
    lifecycle,
    assignmentRequired: lifecycle.some(
      (mission) => mission.assignmentStatus === "REQUIRES_ASSIGNMENT",
    ),
  };
}

export function createFascicoloAutomaticAnalysisHandler(
  dependencies: FascicoloAutomaticAnalysisDependencies = defaultHandlerDependencies,
): AsyncJobHandler<AutomaticReference> {
  return {
    operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    parseInput: (input) => automaticReferenceSchema.parse(input),
    async execute(reference, context: AsyncJobHandlerContext) {
      const authority = await dependencies.loadAuthority({ jobId: context.jobId, reference });
      if (!authority) {
        throw new AsyncJobExecutionError("AUTHORIZATION", "FASCICOLO_ANALYSIS_AUTHORITY_MISMATCH", false);
      }
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const sourceKind = authority.sourceKind ?? "NEUTRAL_INTAKE";
      const currentRevision = dependencies.getCurrentRevision
        ? await dependencies.getCurrentRevision({
            tenantId: authority.tenantId,
            procedimentoId: authority.procedimentoId,
          })
        : null;
      if (currentRevision?.corpusFingerprint === authority.corpusFingerprint) {
        const recovered = await reconcileStructuredKnowledgeMissions({
          authority,
          revision: currentRevision,
          dependencies,
        });
        return {
          referenceType: "FASCICOLO_KNOWLEDGE_REVISION",
          referenceId: currentRevision.id,
          referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
          metadata: {
            procedimentoId: authority.procedimentoId,
            documentVersionId: authority.extractionAttemptId,
            corpusHash: authority.corpusFingerprint,
            persistenceCode: "REUSED",
            missionCount: recovered.lifecycle.length,
            researchJobCount: 0,
            researchRequirementCode: recovered.assignmentRequired
              ? "ASSIGNMENT_AND_EXPLICIT_AUTHORIZATION_REQUIRED"
              : "EXPLICIT_AUTHORIZATION_REQUIRED",
          },
        };
      }
      const existingReport = sourceKind === "NEUTRAL_INTAKE"
        ? await dependencies.findExistingReport({
            tenantId: authority.tenantId,
            procedimentoId: authority.procedimentoId,
            corpusFingerprint: authority.corpusFingerprint,
          })
        : null;
      if (existingReport) {
        return {
          referenceType: "FASCICOLO_AUTOMATIC_REPORT",
          referenceId: existingReport.reportId,
          referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
          metadata: {
            procedimentoId: authority.procedimentoId,
            documentVersionId: authority.extractionAttemptId,
            missionCount: existingReport.missionCount,
            supersededCount: existingReport.supersededCount,
            persistenceCode: "REUSED",
          },
        };
      }
      const excerpts = boundedExcerpts(authority);
      if (excerpts.length === 0) {
        throw new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_UNREADABLE", false);
      }
      await context.heartbeat();
      const output = await dependencies.analyze({
        jobId: context.jobId,
        attempt: context.attempt,
        contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        neutralIntakeId: authority.neutralIntakeId!,
        documentVersionId: authority.extractionAttemptId,
        artifactSha256: authority.artifactSha256,
        corpusFingerprint: authority.corpusFingerprint,
        documents: authority.documents.map((document) => ({
          documentVersionId: document.documentVersionId,
          artifactSha256: document.artifactSha256,
        })),
        documentsAreUntrustedData: true,
        externalToolsAllowed: false,
        excerpts,
      });
      const parsed = providerAnalysisPayloadV1Schema.safeParse(output);
      if (!parsed.success) {
        throw new AsyncJobExecutionError("ANALYSIS", "INVALID_PROVIDER_OUTPUT", false);
      }
      validateGrounding(parsed.data, excerpts);
      if (sourceKind === "DOCUMENT_CORPUS" && !parsed.data.structuredKnowledge) {
        throw new AsyncJobExecutionError("ANALYSIS", "NO_STRUCTURED_KNOWLEDGE", false);
      }
      let structuredMissions: readonly ResearchMission[] | null = null;
      let structuredMissionsToSchedule: readonly ResearchMission[] | null = null;
      let knowledgeRevisionId: string | null = null;
      let structuredMissionAssignmentRequired = false;
      if (parsed.data.structuredKnowledge) {
        const evidenceByBasisRef = resolveKnowledgeEvidence(authority, excerpts);
        if (evidenceByBasisRef.size !== excerpts.length || !dependencies.persistKnowledge) {
          throw new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_GROUNDING_INVALID", false);
        }
        let persisted;
        try {
          persisted = await dependencies.persistKnowledge({
            tenantId: authority.tenantId,
            procedimentoId: authority.procedimentoId,
            corpusFingerprint: authority.corpusFingerprint,
            knowledge: parsed.data.structuredKnowledge,
            evidenceByBasisRef,
            sourceTextByBasisRef: new Map(excerpts.map((excerpt) => [
              excerpt.reference,
              excerpt.text,
            ])),
          });
        } catch {
          throw new AsyncJobExecutionError("PERSISTENCE", "STRUCTURED_KNOWLEDGE_PERSISTENCE_FAILED", false);
        }
        const reconciliation = persisted as KnowledgeReconciliationResult;
        if (!reconciliation?.revision || reconciliation.revision.status !== "CURRENT") {
          throw new AsyncJobExecutionError(
            "PERSISTENCE",
            "STRUCTURED_KNOWLEDGE_NOT_CURRENT",
            false,
          );
        }
        knowledgeRevisionId = reconciliation.revision.id;
        const recovered = await reconcileStructuredKnowledgeMissions({
          authority,
          revision: reconciliation.revision,
          dependencies,
        });
        structuredMissionAssignmentRequired = recovered.assignmentRequired;
        structuredMissions = recovered.plans
          .filter((plan) => plan.mission !== null)
          .map((plan) => plan.mission!);
        const schedulableQuestionKeys = new Set(recovered.lifecycle
          .filter((result) => result.operationalStatus === "PENDING")
          .map((result) => result.questionSemanticKey));
        structuredMissionsToSchedule = recovered.plans
          .filter((plan) => plan.execution === "ADMITTED" && plan.mission !== null
            && schedulableQuestionKeys.has(plan.questionSemanticKey))
          .map((plan) => plan.mission!);
      }
      if (sourceKind === "DOCUMENT_CORPUS") {
        await context.heartbeat();
        return {
          referenceType: "FASCICOLO_KNOWLEDGE_REVISION",
          referenceId: knowledgeRevisionId!,
          referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
          metadata: {
            procedimentoId: authority.procedimentoId,
            documentVersionId: authority.extractionAttemptId,
            corpusHash: authority.corpusFingerprint,
            missionCount: structuredMissions?.length ?? 0,
            persistenceCode: "CREATED",
            researchJobCount: 0,
            researchRequirementCode: structuredMissionAssignmentRequired
              ? "ASSIGNMENT_AND_EXPLICIT_AUTHORIZATION_REQUIRED"
              : "EXPLICIT_AUTHORIZATION_REQUIRED",
          },
        };
      }
      const missions = structuredMissions ?? missionsFromAnalysis({ authority, analysis: parsed.data });
      const supersedesReportIds = await dependencies.listPriorReportIds({
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        exceptVersionId: authority.extractionAttemptId,
      });
      const reportId = stableIdentity("fascicolo-report", {
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        corpusFingerprint: authority.corpusFingerprint,
      });
      if (structuredMissions === null) {
        for (const mission of missions) {
          await dependencies.persistMission({
            mission,
            actorId: authority.actorId,
            tenantId: authority.tenantId,
          });
        }
      }
      const report = await dependencies.persistReport({
        reportId,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        neutralIntakeId: authority.neutralIntakeId!,
        documentVersionId: authority.extractionAttemptId,
        artifactSha256: authority.artifactSha256,
        corpusFingerprint: authority.corpusFingerprint,
        documents: authority.documents.map((document) => ({
          documentVersionId: document.documentVersionId,
          artifactSha256: document.artifactSha256,
        })),
        actorId: authority.actorId,
        analysis: parsed.data,
        provenance: excerpts.map(({ text: _text, ...provenance }) => provenance),
        missions,
        supersedesReportIds,
      });
      const scheduling = [];
      for (const mission of structuredMissionsToSchedule ?? missions) {
        scheduling.push(await dependencies.scheduleMission({
          mission,
          actorId: authority.actorId,
          tenantId: authority.tenantId,
          correlationId: context.correlationId,
        }));
      }
      await context.heartbeat();
      return {
        referenceType: "FASCICOLO_AUTOMATIC_REPORT",
        referenceId: report.reportId,
        referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
        metadata: {
          procedimentoId: authority.procedimentoId,
          documentVersionId: authority.extractionAttemptId,
          missionCount: missions.length,
          supersededCount: supersedesReportIds.length,
          persistenceCode: report.outcome,
          researchJobCount: scheduling.filter((item) => item.outcome === "ADMITTED").length,
          researchRequirementCode: scheduling.find((item) => item.requirementCode)?.requirementCode ?? null,
        },
      };
    },
  };
}

export interface FascicoloAutomaticAnalysisSource {
  readonly sourceJobId: string;
  readonly neutralIntakeId: string;
  readonly extractionAttemptId?: string;
}

export interface FascicoloDocumentCorpusUpdateSource {
  readonly sourceJobId: string;
  readonly documentoId: string;
  readonly documentFileVersionId: string;
  readonly extractionAttemptId: string;
}

function documentCorpusAuthority(input: {
  corpus: FascicoloDocumentCorpus;
  actorId: string;
  triggerExtractionAttemptId: string;
  triggerArtifactSha256: string;
}): AutomaticAuthority {
  return {
    sourceKind: "DOCUMENT_CORPUS",
    tenantId: input.corpus.tenantId,
    procedimentoId: input.corpus.procedimentoId,
    extractionAttemptId: input.triggerExtractionAttemptId,
    artifactSha256: input.triggerArtifactSha256,
    corpusFingerprint: input.corpus.corpusFingerprint,
    actorId: input.actorId,
    documents: input.corpus.documents.flatMap((document) => {
      if (
        document.status !== "AVAILABLE"
        || !document.documentFileVersionId
        || !document.extractionAttemptId
        || !document.sourceSha256
      ) {
        return [];
      }
      return [{
        neutralIntakeId: "",
        documentVersionId: document.extractionAttemptId,
        artifactSha256: document.sourceSha256,
        documentoId: document.documentoId,
        documentFileVersionId: document.documentFileVersionId,
        pages: input.corpus.excerpts
          .filter((excerpt) => excerpt.documentoId === document.documentoId)
          .map((excerpt) => ({
            pageNumber: excerpt.pageNumber,
            normalizedText: excerpt.text,
            textSha256: excerpt.textSha256,
            extractionMethod: excerpt.extractionMethod,
            ocrConfidence: excerpt.ocrConfidence,
          })),
      }];
    }),
  };
}

function logicalOperationId(input: {
  tenantId: string;
  procedimentoId: string;
  extractionAttemptId: string;
}): string {
  return createHash("sha256").update([
    FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    input.tenantId,
    input.procedimentoId,
    input.extractionAttemptId,
  ].join("\n"), "utf8").digest("hex");
}

function documentCorpusLogicalOperationId(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
}): string {
  return createHash("sha256").update([
    FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    "DOCUMENT_CORPUS",
    input.tenantId,
    input.procedimentoId,
    input.corpusFingerprint,
  ].join("\n"), "utf8").digest("hex");
}

export function buildFascicoloAutomaticAnalysisAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  neutralIntakeId: string;
  extractionAttemptId: string;
  correlationId: string;
  policyDecisionRef: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}): AsyncJobAdmissionInput {
  const admission = input.admissionType === "AUTHENTICATED_USER"
    ? {
        admissionType: "AUTHENTICATED_USER" as const,
        tenantId: input.tenantId,
        initiatingUserId: input.initiatingUserId!,
        actor: {
          actorId: input.initiatingUserId!,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      }
    : {
        admissionType: "AUTHORIZED_SYSTEM" as const,
        tenantId: input.tenantId,
        initiatingUserId: null,
        actor: {
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      };
  return {
    operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    logicalOperationId: logicalOperationId(input),
    purpose: FASCICOLO_AUTOMATIC_ANALYSIS_PURPOSE,
    correlationId: input.correlationId,
    procedimentoId: input.procedimentoId,
    priority: "NORMAL",
    policyDecisionRef: input.policyDecisionRef,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_VERSION",
      referenceId: input.extractionAttemptId,
      referenceVersion: "V1",
      metadata: {
        procedimentoId: input.procedimentoId,
        neutralIntakeId: input.neutralIntakeId,
        extractionAttemptId: input.extractionAttemptId,
      },
    },
    maxAttempts: 3,
    availableAt: new Date(0),
    admission,
  };
}

export function buildFascicoloDocumentCorpusUpdateAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  correlationId: string;
  policyDecisionRef: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}): AsyncJobAdmissionInput {
  const admission = input.admissionType === "AUTHENTICATED_USER"
    ? {
        admissionType: "AUTHENTICATED_USER" as const,
        tenantId: input.tenantId,
        initiatingUserId: input.initiatingUserId!,
        actor: {
          actorId: input.initiatingUserId!,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      }
    : {
        admissionType: "AUTHORIZED_SYSTEM" as const,
        tenantId: input.tenantId,
        initiatingUserId: null,
        actor: {
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      };
  return {
    operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    logicalOperationId: documentCorpusLogicalOperationId(input),
    purpose: FASCICOLO_AUTOMATIC_ANALYSIS_PURPOSE,
    correlationId: input.correlationId,
    procedimentoId: input.procedimentoId,
    priority: "NORMAL",
    policyDecisionRef: input.policyDecisionRef,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: input.corpusFingerprint,
      referenceVersion: "V1",
      metadata: {
        procedimentoId: input.procedimentoId,
        corpusHash: input.corpusFingerprint,
      },
    },
    maxAttempts: 3,
    availableAt: new Date(0),
    admission,
  };
}

export async function ensureFascicoloDocumentCorpusUpdateJob(
  input: FascicoloDocumentCorpusUpdateSource,
) {
  const sourceJob = await prisma.asyncJob.findUnique({
    where: { id: input.sourceJobId },
    select: {
      operation: true,
      tenantId: true,
      procedimentoId: true,
      correlationId: true,
      policyDecisionRef: true,
      admissionType: true,
      initiatingUserId: true,
      actorId: true,
      actorEmail: true,
      actorRole: true,
    },
  });
  if (
    !sourceJob
    || (
      sourceJob.operation !== "DOCUMENT_EXTRACTION_V1"
      && sourceJob.operation !== "DOCUMENT_OCR_PAGE_BATCH_V2"
    )
    || !sourceJob.tenantId
    || !sourceJob.procedimentoId
    || (sourceJob.admissionType === "AUTHENTICATED_USER" && !sourceJob.initiatingUserId)
    || (sourceJob.admissionType === "AUTHORIZED_SYSTEM" && !sourceJob.policyDecisionRef)
  ) {
    throw new Error("FASCICOLO_AUTOMATIC_ANALYSIS_AUTHORITY_MISMATCH");
  }
  const corpus = await getFascicoloDocumentCorpusForAsyncJob({
    jobId: input.sourceJobId,
    tenantId: sourceJob.tenantId,
    procedimentoId: sourceJob.procedimentoId,
    operation: sourceJob.operation,
    policyDecisionRef: sourceJob.policyDecisionRef,
    actorId: sourceJob.actorId,
  });
  const trigger = corpus?.documents.find((document) => (
    document.documentoId === input.documentoId
    && document.documentFileVersionId === input.documentFileVersionId
    && document.extractionAttemptId === input.extractionAttemptId
    && document.status === "AVAILABLE"
  ));
  if (!corpus || !trigger) {
    throw new Error("FASCICOLO_DOCUMENT_CORPUS_NOT_READY");
  }
  const current = await getCurrentKnowledgeRevision({
    tenantId: sourceJob.tenantId,
    procedimentoId: sourceJob.procedimentoId,
  });
  if (current?.corpusFingerprint === corpus.corpusFingerprint) {
    return { outcome: "UNCHANGED" as const, job: null };
  }
  const admission = await admitAsyncJob(buildFascicoloDocumentCorpusUpdateAdmission({
    tenantId: sourceJob.tenantId,
    procedimentoId: sourceJob.procedimentoId,
    corpusFingerprint: corpus.corpusFingerprint,
    correlationId: sourceJob.correlationId,
    policyDecisionRef: sourceJob.policyDecisionRef,
    admissionType: sourceJob.admissionType,
    initiatingUserId: sourceJob.initiatingUserId,
    actorId: sourceJob.actorId,
    actorEmail: sourceJob.actorEmail,
    actorRole: sourceJob.actorRole,
  }));
  await requestDocumentWorkerActivation(
    "DOCUMENT_ANALYSIS",
    sourceJob.procedimentoId,
  );
  return admission;
}

export async function ensureFascicoloAutomaticAnalysisJob(input: FascicoloAutomaticAnalysisSource) {
  const [sourceJob, intake] = await Promise.all([
    prisma.asyncJob.findUnique({
      where: { id: input.sourceJobId },
      select: {
        tenantId: true,
        correlationId: true,
        policyDecisionRef: true,
        admissionType: true,
        initiatingUserId: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
      },
    }),
    prisma.neutralIntake.findUnique({
      where: { id: input.neutralIntakeId },
      select: {
        id: true,
        enteId: true,
        destination: { select: { procedimentoId: true } },
        extractionAttempts: {
          where: input.extractionAttemptId ? { id: input.extractionAttemptId } : undefined,
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true },
        },
      },
    }),
  ]);
  const destination = intake?.destination;
  const attempt = intake?.extractionAttempts[0];
  if (
    !sourceJob
    || !intake
    || sourceJob.tenantId === null
    || sourceJob.tenantId !== intake.enteId
    || !destination
    || !attempt
    || (sourceJob.admissionType === "AUTHENTICATED_USER" && !sourceJob.initiatingUserId)
    || (sourceJob.admissionType === "AUTHORIZED_SYSTEM" && !sourceJob.policyDecisionRef)
  ) {
    throw new Error("FASCICOLO_AUTOMATIC_ANALYSIS_AUTHORITY_MISMATCH");
  }
  return admitAsyncJob(buildFascicoloAutomaticAnalysisAdmission({
    tenantId: sourceJob.tenantId,
    procedimentoId: destination.procedimentoId,
    neutralIntakeId: intake.id,
    extractionAttemptId: attempt.id,
    correlationId: sourceJob.correlationId,
    policyDecisionRef: sourceJob.policyDecisionRef,
    admissionType: sourceJob.admissionType,
    initiatingUserId: sourceJob.initiatingUserId,
    actorId: sourceJob.actorId,
    actorEmail: sourceJob.actorEmail,
    actorRole: sourceJob.actorRole,
  }));
}
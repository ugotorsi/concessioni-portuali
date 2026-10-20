import { createHash } from "node:crypto";
import { hostname } from "node:os";

import { z } from "zod";

import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCurrentTenantContext,
  requireTenantAccess,
  type CurrentTenantContext,
} from "@/lib/tenant-auth";
import {
  admitAsyncJob,
} from "@/server/async-jobs/persistence";
import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import type { AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import {
  AsyncJobExecutionError,
  drainAsyncJobById,
} from "@/server/async-jobs/worker";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import {
  providerAnalysisPayloadV1Schema,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  type FascicoloDocumentAnalysisInput,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  fascicoloAutomaticAnalysisDiagnostic,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  FascicoloDocumentAnalysisError,
} from "@/server/ai/fascicoloDocumentAnalysis";
import { createOpenAiFascicoloDocumentRuntimeFromEnv } from "@/server/ai/openaiRuntime";
import { AiRealDataActivationError } from "@/server/ai/realDataActivation";
import { OpenAiRuntimeConfigurationError } from "@/server/ai/openaiRuntime";
import {
  fascicoloStructuredKnowledgeSchema,
  projectStructuredKnowledge,
} from "@/server/fascicolo-knowledge";
import {
  buildFascicoloDocumentKnowledgeEvidence,
  getFascicoloDocumentCorpusForAsyncJob,
  getFascicoloDocumentCorpusForTenant,
  toFascicoloDocumentAnalysisCorpus,
  type FascicoloDocumentCorpus,
} from "@/server/queries/fascicolo-document-corpus";
import { withRuntimeCostGate } from "@/server/runtime/cost";

import {
  consumeFascicoloAnalysisEvaluationPermit,
  FascicoloAnalysisEvaluationPermitError,
  loadFascicoloAnalysisEvaluationPermit,
  persistFascicoloAnalysisEvaluationPermit,
  persistFascicoloAnalysisEvaluationArtifact,
  type FascicoloAnalysisEvaluationPermit,
  type FascicoloAnalysisEvaluationArtifactInput,
} from "./fascicoloAnalysisEvaluationRepository";

export const FASCICOLO_ANALYSIS_EVALUATION_OPERATION =
  "FASCICOLO.AUTOMATIC_ANALYSIS_EVALUATION_V1" as const;
export const FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE = "TEST-LEGAL-001" as const;
export const FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR = 0.5 as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const boundedId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

const evaluationReferenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_ANALYSIS_EVALUATION"),
  referenceId: boundedId,
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    tenantId: z.string().trim().min(1).max(256),
    procedimentoId: z.string().trim().min(1).max(256),
    corpusHash: sha256,
    evaluationPermitRef: z.string().trim().min(1).max(256),
    testCaseId: z.literal(FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE),
    expectedDocumentCount: z.literal(8),
    costLimitCode: z.literal("EUR_0_50"),
  }).strict(),
}).strict();

export type FascicoloAnalysisEvaluationReference = z.output<typeof evaluationReferenceSchema>;

interface EvaluationAuthority {
  tenantId: string;
  procedimentoId: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  authorizationRef: string;
  corpus: FascicoloDocumentCorpus;
}

export interface FascicoloAnalysisEvaluationComparison {
  passed: boolean;
  defenseItemLocalIds: readonly string[];
  sourceBasisRefs: readonly string[];
  checks: {
    twoDistinctPartyPositions: boolean;
    attributedToConcessionaire: boolean;
    citedToDefensePage: boolean;
    separatedFromFactsAndTechnicalFindings: boolean;
    consideredByLegalIssues: boolean;
  };
}

export interface FascicoloAnalysisEvaluationDependencies {
  loadAuthority(input: {
    jobId: string;
    reference: FascicoloAnalysisEvaluationReference;
  }): Promise<EvaluationAuthority | null>;
  analyze(input: FascicoloDocumentAnalysisInput & {
    jobId: string;
    evaluationId: string;
    maxCostAmount: number;
  }): Promise<unknown>;
  persistArtifact(input: FascicoloAnalysisEvaluationArtifactInput): Promise<{
    outcome: "CREATED" | "REUSED";
    evaluationId: string;
  }>;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function containsAll(value: string, terms: readonly string[]): boolean {
  const candidate = normalized(value);
  return terms.every((term) => candidate.includes(term));
}

export function compareTestLegal001Output(
  output: ProviderAnalysisPayloadV1,
  corpus: FascicoloDocumentCorpus,
): FascicoloAnalysisEvaluationComparison {
  const knowledge = fascicoloStructuredKnowledgeSchema.parse(output.structuredKnowledge);
  const subjects = new Map(knowledge.subjects.map((subject) => [subject.localId, subject]));
  const positions = knowledge.items.filter((item) => item.kind === "PARTY_POSITION");
  const first = positions.find((item) =>
    containsAll(item.payload.normalizedStatement, ["primo container", "manutenzion"]));
  const second = positions.find((item) =>
    containsAll(item.payload.normalizedStatement, ["secondo container", "material", "accessor"]));
  const defenses = [first, second].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const defensePageRefs = corpus.excerpts
    .filter((excerpt) => normalized(excerpt.text).includes("noetra-legal-acceptance-defenses")
      || normalized(excerpt.text).includes("titolo: controdeduzioni"))
    .map((excerpt) => excerpt.reference);
  const technicalPageRefs = corpus.excerpts
    .filter((excerpt) => normalized(excerpt.text).includes("noetra-legal-acceptance-technical")
      || normalized(excerpt.text).includes("titolo: relazione tecnica"))
    .map((excerpt) => excerpt.reference);
  const cited = defensePageRefs.length > 0 && defenses.length === 2 && defenses.every((item) =>
    item.basisRefs.length > 0
    && item.basisRefs.every((basisRef) => defensePageRefs.includes(basisRef))
    && item.basisRefs.every((basisRef) => !technicalPageRefs.includes(basisRef)));
  const attributed = defenses.length === 2 && defenses.every((item) => {
    const subject = subjects.get(item.payload.subjectLocalId);
    return Boolean(subject
      && subject.subjectType === "ORGANIZATION"
      && normalized(subject.canonicalName).includes("concession"));
  });
  const facts = knowledge.items.filter((item) => item.kind === "FACT");
  const separated = defenses.length === 2 && defenses.every((defense) => {
    const defenseStatement = normalized(defense.payload.normalizedStatement);
    return !facts.some((fact) => {
      const factStatement = normalized(fact.payload.normalizedStatement);
      return factStatement === defenseStatement
        || (fact.basisRefs.some((basisRef) => defensePageRefs.includes(basisRef))
          && ((containsAll(factStatement, ["primo container", "manutenzion"]))
            || containsAll(factStatement, ["secondo container", "material", "accessor"])));
    });
  });
  const considered = defenses.length === 2 && defenses.every((defense) =>
    knowledge.legalIssues.some((issue) => issue.originatingItemLocalIds.includes(defense.localId)));
  const checks = {
    twoDistinctPartyPositions:
      defenses.length === 2 && new Set(defenses.map((item) => item.localId)).size === 2,
    attributedToConcessionaire: attributed,
    citedToDefensePage: cited,
    separatedFromFactsAndTechnicalFindings: separated,
    consideredByLegalIssues: considered,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    defenseItemLocalIds: defenses.map((item) => item.localId),
    sourceBasisRefs: [...new Set(defenses.flatMap((item) => item.basisRefs))].sort(),
    checks,
  };
}

function validateStructuredGrounding(
  output: ProviderAnalysisPayloadV1,
  corpus: FascicoloDocumentCorpus,
): void {
  if (!output.structuredKnowledge) {
    throw new AsyncJobExecutionError("ANALYSIS", "NO_STRUCTURED_KNOWLEDGE", false);
  }
  const knowledge = fascicoloStructuredKnowledgeSchema.parse(output.structuredKnowledge);
  const evidence = buildFascicoloDocumentKnowledgeEvidence(corpus);
  const subjectIds = new Map(knowledge.subjects.map((subject) => [
    subject.localId,
    `evaluation-subject:${subject.localId}`,
  ]));
  const projection = projectStructuredKnowledge({
    knowledge,
    subjectIdsByLocalId: subjectIds,
    evidenceByBasisRef: evidence,
  });
  if (projection.warnings.length > 0) {
    throw new AsyncJobExecutionError("ANALYSIS", "DOCUMENT_GROUNDING_INVALID", false);
  }
}

function inputFingerprint(
  reference: FascicoloAnalysisEvaluationReference,
  corpus: FascicoloDocumentCorpus,
): string {
  return fingerprint({
    evaluationId: reference.referenceId,
    testCaseId: reference.metadata.testCaseId,
    contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
    corpusFingerprint: corpus.corpusFingerprint,
    documents: corpus.documents.map((document) => ({
      documentoId: document.documentoId,
      documentFileVersionId: document.documentFileVersionId,
      extractionAttemptId: document.extractionAttemptId,
      sourceSha256: document.sourceSha256,
    })),
    pages: corpus.excerpts.map((excerpt) => ({
      reference: excerpt.reference,
      documentoId: excerpt.documentoId,
      pageNumber: excerpt.pageNumber,
      textSha256: excerpt.textSha256,
    })),
  });
}

const defaultDependencies: FascicoloAnalysisEvaluationDependencies = {
  async loadAuthority({ jobId, reference }) {
    const [job, evaluationPermit] = await Promise.all([
      prisma.asyncJob.findUnique({
        where: { id: jobId },
        select: {
          operation: true,
          tenantId: true,
          procedimentoId: true,
          admissionType: true,
          policyDecisionRef: true,
          actorId: true,
          actorEmail: true,
          actorRole: true,
        },
      }),
      loadFascicoloAnalysisEvaluationPermit(reference.metadata.evaluationPermitRef),
    ]);
    if (!job || !evaluationPermit
      || job.operation !== FASCICOLO_ANALYSIS_EVALUATION_OPERATION
      || job.admissionType !== "AUTHORIZED_SYSTEM"
      || !job.policyDecisionRef
      || job.policyDecisionRef !== reference.metadata.evaluationPermitRef
      || job.tenantId !== reference.metadata.tenantId
      || job.procedimentoId !== reference.metadata.procedimentoId
      || evaluationPermit.evaluationId !== reference.referenceId
      || evaluationPermit.tenantId !== reference.metadata.tenantId
      || evaluationPermit.procedimentoId !== reference.metadata.procedimentoId
      || evaluationPermit.corpusFingerprint !== reference.metadata.corpusHash
      || evaluationPermit.operation !== FASCICOLO_ANALYSIS_EVALUATION_OPERATION
      || evaluationPermit.testCaseId !== FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE
      || evaluationPermit.maxCostAmount !== FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR
      || evaluationPermit.consumedByJobId !== jobId
      || !evaluationPermit.consumedAt
      || evaluationPermit.revokedAt
      || evaluationPermit.expiresAt <= new Date()) {
      return null;
    }
    const corpus = await getFascicoloDocumentCorpusForAsyncJob({
      jobId,
      tenantId: reference.metadata.tenantId,
      procedimentoId: reference.metadata.procedimentoId,
      operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
      policyDecisionRef: reference.metadata.evaluationPermitRef,
      actorId: job.actorId,
    });
    if (!corpus
      || corpus.availability !== "READY"
      || corpus.corpusFingerprint !== reference.metadata.corpusHash
      || corpus.documentCount !== reference.metadata.expectedDocumentCount
      || corpus.availableDocumentCount !== reference.metadata.expectedDocumentCount) {
      return null;
    }
    return {
      tenantId: reference.metadata.tenantId,
      procedimentoId: reference.metadata.procedimentoId,
      actorId: job.actorId,
      actorEmail: job.actorEmail,
      actorRole: job.actorRole,
      authorizationRef: reference.metadata.evaluationPermitRef,
      corpus,
    };
  },
  async analyze(input) {
    try {
      return await withRuntimeCostGate(fascicoloAnalysisEvaluationCostRequest(input), async () => ({
        value: await createOpenAiFascicoloDocumentRuntimeFromEnv().analyze(input),
        actualAmount: input.maxCostAmount,
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
        throw new AsyncJobExecutionError("ANALYSIS", error.code, false);
      }
      throw error;
    }
  },
  persistArtifact: persistFascicoloAnalysisEvaluationArtifact,
};

export function fascicoloAnalysisEvaluationCostRequest(input: {
  tenantId: string;
  procedimentoId: string;
  jobId: string;
  evaluationId: string;
  maxCostAmount: number;
}) {
  if (input.maxCostAmount !== FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR) {
    throw new AsyncJobExecutionError("BUDGET", "EVALUATION_COST_LIMIT_INVALID", false);
  }
  return {
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    jobId: input.jobId,
    provider: "OPENAI",
    operationType: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    estimatedAmount: input.maxCostAmount,
    idempotencyKey: `${FASCICOLO_ANALYSIS_EVALUATION_OPERATION}:${input.evaluationId}`,
  };
}

export function createFascicoloAnalysisEvaluationHandler(
  overrides: Partial<FascicoloAnalysisEvaluationDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return {
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    parseInput: (input: unknown) => evaluationReferenceSchema.parse(input),
    async execute(
      reference: FascicoloAnalysisEvaluationReference,
      context: AsyncJobHandlerContext,
    ) {
      const authority = await dependencies.loadAuthority({ jobId: context.jobId, reference });
      if (!authority) {
        throw new AsyncJobExecutionError("AUTHORIZATION", "EVALUATION_AUTHORITY_MISMATCH", false);
      }
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const analysisCorpus = toFascicoloDocumentAnalysisCorpus(authority.corpus);
      if (analysisCorpus.documents.length !== reference.metadata.expectedDocumentCount
        || analysisCorpus.excerpts.length !== authority.corpus.textPageCount) {
        throw new AsyncJobExecutionError("DOCUMENT", "EVALUATION_CORPUS_INCOMPLETE", false);
      }
      const trigger = authority.corpus.documents.find((document) =>
        document.status === "AVAILABLE"
        && document.documentFileVersionId
        && document.sourceSha256);
      if (!trigger?.documentFileVersionId || !trigger.sourceSha256) {
        throw new AsyncJobExecutionError("DOCUMENT", "EVALUATION_CORPUS_INCOMPLETE", false);
      }
      await context.heartbeat();
      const rawOutput = await dependencies.analyze({
        jobId: context.jobId,
        evaluationId: reference.referenceId,
        maxCostAmount: FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR,
        contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        neutralIntakeId: "EVALUATION_ONLY_DOCUMENT_CORPUS",
        documentVersionId: trigger.documentFileVersionId,
        artifactSha256: trigger.sourceSha256,
        corpusFingerprint: authority.corpus.corpusFingerprint,
        documents: analysisCorpus.documents,
        documentsAreUntrustedData: true,
        externalToolsAllowed: false,
        excerpts: analysisCorpus.excerpts,
      });
      const output = providerAnalysisPayloadV1Schema.parse(rawOutput);
      validateStructuredGrounding(output, authority.corpus);
      const comparison = compareTestLegal001Output(output, authority.corpus);
      const sourceFingerprint = inputFingerprint(reference, authority.corpus);
      const resultFingerprint = fingerprint(output);
      const persisted = await dependencies.persistArtifact({
        evaluationId: reference.referenceId,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        jobId: context.jobId,
        actorId: authority.actorId,
        actorEmail: authority.actorEmail,
        actorRole: authority.actorRole,
        authorizationRef: authority.authorizationRef,
        testCaseId: reference.metadata.testCaseId,
        corpusFingerprint: authority.corpus.corpusFingerprint,
        contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        inputFingerprint: sourceFingerprint,
        outputFingerprint: resultFingerprint,
        providerOutput: output,
        provenance: authority.corpus.excerpts.map((excerpt) => ({
          reference: excerpt.reference,
          documentoId: excerpt.documentoId,
          documentFileVersionId: excerpt.documentVersionId,
          extractionAttemptId: excerpt.extractionAttemptId,
          pageNumber: excerpt.pageNumber,
          textSha256: excerpt.textSha256,
        })),
        comparison,
        maxCostAmount: FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR,
      });
      return {
        referenceType: "FASCICOLO_ANALYSIS_EVALUATION",
        referenceId: persisted.evaluationId,
        referenceVersion: "V1",
        metadata: {
          procedimentoId: authority.procedimentoId,
          corpusHash: authority.corpus.corpusFingerprint,
          testCaseId: reference.metadata.testCaseId,
          artifactPersistenceCode: persisted.outcome,
          resultHash: resultFingerprint,
          comparisonCode: comparison.passed ? "PASSED" : "FAILED",
          documentCount: analysisCorpus.documents.length,
          pageCount: analysisCorpus.excerpts.length,
        },
      };
    },
  };
}

export class FascicoloAnalysisEvaluationAuthorizationError extends Error {
  constructor(readonly code:
    | "EVALUATION_AUTHENTICATION_REQUIRED"
    | "EVALUATION_ADMIN_REQUIRED"
    | "EVALUATION_AUTHORIZATION_SCOPE_INVALID"
    | "EVALUATION_AUTHORIZATION_EXPIRY_INVALID"
    | "EVALUATION_CORPUS_NOT_READY") {
    super(code);
    this.name = "FascicoloAnalysisEvaluationAuthorizationError";
  }
}

export interface FascicoloAnalysisEvaluationAuthorizationDependencies {
  getCurrentUser(): Promise<CurrentUser | null>;
  getCurrentTenantContext(): Promise<CurrentTenantContext | null>;
  loadCorpus(input: { tenantId: string; procedimentoId: string }): Promise<FascicoloDocumentCorpus | null>;
  persistPermit: typeof persistFascicoloAnalysisEvaluationPermit;
  now(): Date;
}

export async function authorizeFascicoloAnalysisEvaluation(input: {
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  expiresAt: Date;
}, overrides: Partial<FascicoloAnalysisEvaluationAuthorizationDependencies> = {}) {
  const dependencies: FascicoloAnalysisEvaluationAuthorizationDependencies = {
    getCurrentUser,
    getCurrentTenantContext,
    loadCorpus: getFascicoloDocumentCorpusForTenant,
    persistPermit: persistFascicoloAnalysisEvaluationPermit,
    now: () => new Date(),
    ...overrides,
  };
  const actor = await dependencies.getCurrentUser();
  if (!actor) {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_AUTHENTICATION_REQUIRED");
  }
  if (actor.role !== "ADMIN") {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_ADMIN_REQUIRED");
  }
  const tenantContext = await dependencies.getCurrentTenantContext();
  if (!tenantContext) {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_AUTHENTICATION_REQUIRED");
  }
  try {
    requireTenantAccess(tenantContext, input.tenantId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  } catch {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_AUTHORIZATION_SCOPE_INVALID");
  }
  const now = dependencies.now();
  const ttl = input.expiresAt.getTime() - now.getTime();
  if (ttl < 60_000 || ttl > 60 * 60 * 1_000) {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_AUTHORIZATION_EXPIRY_INVALID");
  }
  const corpus = await dependencies.loadCorpus({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  if (!corpus
    || corpus.availability !== "READY"
    || corpus.corpusFingerprint !== input.corpusFingerprint
    || corpus.documentCount !== 8
    || corpus.availableDocumentCount !== 8) {
    throw new FascicoloAnalysisEvaluationAuthorizationError("EVALUATION_CORPUS_NOT_READY");
  }
  const permitRef = fingerprint({
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    evaluationId: input.evaluationId,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    corpusFingerprint: input.corpusFingerprint,
    maxCostAmount: FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR,
    authorizedByUserId: actor.id,
    expiresAt: input.expiresAt.toISOString(),
  });
  return dependencies.persistPermit({
    permitRef,
    evaluationId: input.evaluationId,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    corpusFingerprint: input.corpusFingerprint,
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    testCaseId: FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE,
    maxCostAmount: FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR,
    authorizedByUserId: actor.id,
    expiresAt: input.expiresAt,
  });
}

export function buildFascicoloAnalysisEvaluationAdmission(input: {
  permit: FascicoloAnalysisEvaluationPermit;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}): AsyncJobAdmissionInput {
  const evaluationPermit = input.permit;
  const reference = evaluationReferenceSchema.parse({
    referenceType: "FASCICOLO_ANALYSIS_EVALUATION",
    referenceId: evaluationPermit.evaluationId,
    referenceVersion: "V1",
    metadata: {
      tenantId: evaluationPermit.tenantId,
      procedimentoId: evaluationPermit.procedimentoId,
      corpusHash: evaluationPermit.corpusFingerprint,
      evaluationPermitRef: evaluationPermit.permitRef,
      testCaseId: FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE,
      expectedDocumentCount: 8,
      costLimitCode: "EUR_0_50",
    },
  });
  const logicalOperationId = fingerprint({
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    tenantId: evaluationPermit.tenantId,
    procedimentoId: evaluationPermit.procedimentoId,
    corpusFingerprint: evaluationPermit.corpusFingerprint,
    evaluationId: evaluationPermit.evaluationId,
  });
  return {
    operation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    logicalOperationId,
    purpose: "FASCICOLO_ANALYSIS_EVALUATION_ONLY",
    correlationId: `fascicolo-evaluation:${evaluationPermit.evaluationId}`,
    procedimentoId: evaluationPermit.procedimentoId,
    priority: "LOW",
    policyDecisionRef: evaluationPermit.permitRef,
    inputReference: reference,
    maxAttempts: 1,
    availableAt: new Date(0),
    admission: {
      admissionType: "AUTHORIZED_SYSTEM",
      tenantId: evaluationPermit.tenantId,
      initiatingUserId: null,
      actor: {
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        actorRole: input.actorRole,
      },
    },
  };
}

export interface FascicoloAnalysisEvaluationAdmissionDependencies {
  loadPermit: typeof loadFascicoloAnalysisEvaluationPermit;
  admit: typeof admitAsyncJob;
  consumePermit: typeof consumeFascicoloAnalysisEvaluationPermit;
}

export async function admitFascicoloAnalysisEvaluation(input: {
  permitRef: string;
  evaluationId: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}, overrides: Partial<FascicoloAnalysisEvaluationAdmissionDependencies> = {}) {
  const dependencies: FascicoloAnalysisEvaluationAdmissionDependencies = {
    loadPermit: loadFascicoloAnalysisEvaluationPermit,
    admit: admitAsyncJob,
    consumePermit: consumeFascicoloAnalysisEvaluationPermit,
    ...overrides,
  };
  const evaluationPermit = await dependencies.loadPermit(input.permitRef);
  if (!evaluationPermit) {
    throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_NOT_FOUND");
  }
  if (evaluationPermit.evaluationId !== input.evaluationId
    || evaluationPermit.operation !== FASCICOLO_ANALYSIS_EVALUATION_OPERATION
    || evaluationPermit.testCaseId !== FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE
    || evaluationPermit.maxCostAmount !== FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR
    || evaluationPermit.revokedAt
    || evaluationPermit.expiresAt <= new Date()) {
    throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_INVALID");
  }
  const admitted = await dependencies.admit(buildFascicoloAnalysisEvaluationAdmission({
    permit: evaluationPermit,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
  }));
  await dependencies.consumePermit({
    permitRef: evaluationPermit.permitRef,
    evaluationId: evaluationPermit.evaluationId,
    jobId: admitted.job.id,
  });
  return admitted;
}

export async function runFascicoloAnalysisEvaluationJobById(input: {
  jobId: string;
  workerId?: string;
  dependencies?: Partial<FascicoloAnalysisEvaluationDependencies>;
}) {
  const registry = new AsyncJobHandlerRegistry([
    createFascicoloAnalysisEvaluationHandler(input.dependencies),
  ]);
  return drainAsyncJobById({
    jobId: input.jobId,
    expectedOperation: FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
    workerId: input.workerId ?? `${hostname()}:${process.pid}:fascicolo-evaluation`,
    leaseDurationMs: 15 * 60 * 1_000,
    retryDelayMs: 0,
    registry,
  });
}

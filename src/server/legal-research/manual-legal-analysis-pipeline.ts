import { prisma } from "@/lib/prisma";
import { requestExistingCorpusAnalysis } from "@/server/ai/fascicoloExistingCorpusAnalysis";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import { AsyncJobIdempotencyConflictError } from "@/server/async-jobs/persistence";
import { ensureDocumentExtractionJob } from "@/server/documents/documentExtractionAdmission";
import { getCurrentKnowledgeRevision } from "@/server/fascicolo-knowledge/repository";
import { recoverCurrentKnowledgeResearchMissions } from "@/server/fascicolo-knowledge/researchMissionRecovery";
import { getFascicoloDocumentCorpusForTenant } from "@/server/queries/fascicolo-document-corpus";

import { admitCurrentKnowledgeManualResearch } from "./automatic-research-job";
import { manualResearchPlanner } from "./manual-research-policy";
import { effectiveResearchPolicyEnvironment } from "./persisted-research-policy";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "./persistence";

const TERMINAL_JOB_STATUSES = new Set(["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"]);

export type ManualLegalAnalysisOutcome =
  | "DOCUMENT_EXTRACTION_STARTED"
  | "ANALYSIS_QUEUED"
  | "ANALYSIS_IN_PROGRESS"
  | "ANALYSIS_ALREADY_COMPLETED"
  | "ANALYSIS_NOT_ADMITTED"
  | "RESEARCH_STARTED"
  | "NO_RESEARCH_TO_RUN";

export type ManualLegalAnalysisResult = Readonly<{
  outcome: ManualLegalAnalysisOutcome;
  executionId: string;
  analysisJobId: string | null;
  analysisJobStatus: string | null;
  analysisAdmissionOutcome: "CREATED" | "REUSED" | null;
  documentExtractionAdmissions: number;
  researchAdmissions: number;
  researchNotAuthorized: readonly string[];
  queuedResearchJobs: number;
  workerActivationOutcome: string;
}>;

interface ManualLegalAnalysisDependencies {
  loadCorpus: typeof getFascicoloDocumentCorpusForTenant;
  admitExtraction: typeof ensureDocumentExtractionJob;
  requestAnalysis: typeof requestExistingCorpusAnalysis;
  loadCurrentRevision: typeof getCurrentKnowledgeRevision;
  recoverMissions: typeof recoverCurrentKnowledgeResearchMissions;
  admitResearch: typeof admitCurrentKnowledgeManualResearch;
  countQueuedResearchJobs(input: Readonly<{ tenantId: string; procedimentoId: string }>): Promise<number>;
  activateWorker: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: ManualLegalAnalysisDependencies = {
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  admitExtraction: ensureDocumentExtractionJob,
  requestAnalysis: requestExistingCorpusAnalysis,
  loadCurrentRevision: getCurrentKnowledgeRevision,
  recoverMissions: recoverCurrentKnowledgeResearchMissions,
  admitResearch: admitCurrentKnowledgeManualResearch,
  countQueuedResearchJobs: ({ tenantId, procedimentoId }) => prisma.asyncJob.count({
    where: {
      tenantId,
      procedimentoId,
      operation: RESEARCH_MISSION_EXECUTION_OPERATION,
      status: { in: ["QUEUED", "RETRY_WAIT"] },
    },
  }),
  activateWorker: requestDocumentWorkerActivation,
};

/**
 * One-click manual pipeline: local direct-text extraction of documents never extracted (no
 * provider, no cost), then AI analysis of the current corpus, then autonomous legal research
 * and report versioning on the authorized worker. It does not depend on the automation switch.
 */
export async function runManualLegalAnalysisPipeline(input: Readonly<{
  tenantId: string;
  procedimentoId: string;
  executionId: string;
  actor: Readonly<{ id: string; email: string; role: "ADMIN" }>;
}>, overrides: Partial<ManualLegalAnalysisDependencies> = {}): Promise<ManualLegalAnalysisResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  // Documents that were acquired but never extracted must be extracted before any analysis,
  // otherwise research would run on a revision that ignores them. Failed extractions are not
  // retried here: they require an explicit retry permit.
  const corpus = await dependencies.loadCorpus({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  const pendingExtraction = corpus?.documents.filter(
    (document): document is typeof document & { documentFileVersionId: string } =>
      document.status === "NOT_EXTRACTED" && document.documentFileVersionId !== null,
  ) ?? [];
  if (pendingExtraction.length > 0) {
    let alreadyAdmitted = 0;
    for (const document of pendingExtraction) {
      // The idempotency key identifies document version and policy; a conflicting fingerprint means
      // the same extraction was already admitted (at upload or by another request) and only needs
      // the worker to drain it.
      await dependencies.admitExtraction({
        documentoId: document.documentoId,
        documentFileVersionId: document.documentFileVersionId,
        procedimentoId: input.procedimentoId,
        correlationId: `manual-legal-analysis:${input.procedimentoId}:${input.executionId}:extraction`,
        authority: {
          admissionType: "AUTHENTICATED_USER",
          tenantId: input.tenantId,
          initiatingUserId: input.actor.id,
          actorId: input.actor.id,
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          policyDecisionRef: null,
        },
      }).catch((error: unknown) => {
        if (error instanceof AsyncJobIdempotencyConflictError) {
          alreadyAdmitted += 1;
          return null;
        }
        throw error;
      });
    }
    const activation = await dependencies.activateWorker({
      kind: "DOCUMENT_EXTRACTION",
      procedimentoId: input.procedimentoId,
    });
    return {
      outcome: "DOCUMENT_EXTRACTION_STARTED",
      executionId: input.executionId,
      analysisJobId: null,
      analysisJobStatus: null,
      analysisAdmissionOutcome: null,
      documentExtractionAdmissions: pendingExtraction.length - alreadyAdmitted,
      researchAdmissions: 0,
      researchNotAuthorized: [],
      queuedResearchJobs: 0,
      workerActivationOutcome: activation.outcome,
    };
  }
  const runCurrentRevisionResearch = async (analysisJobId: string | null) => {
    const researchEnvironment = await effectiveResearchPolicyEnvironment({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    });
    await dependencies.recoverMissions({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      candidateActorId: input.actor.id,
      requireValidCandidate: true,
      autonomousResearch: manualResearchPlanner(input.tenantId, researchEnvironment),
    });
    const admissions = await dependencies.admitResearch({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      actorId: input.actor.id,
      correlationId: `manual-legal-analysis:${input.procedimentoId}:${input.executionId}`,
    });
    const queuedResearchJobs = await dependencies.countQueuedResearchJobs(input);
    const activation = queuedResearchJobs > 0
      ? await dependencies.activateWorker({ kind: "LEGAL_RESEARCH", procedimentoId: input.procedimentoId })
      : { outcome: "NOT_REQUIRED" as const };
    return {
      outcome: queuedResearchJobs > 0 ? "RESEARCH_STARTED" as const : "NO_RESEARCH_TO_RUN" as const,
      executionId: input.executionId,
      analysisJobId,
      analysisJobStatus: null,
      analysisAdmissionOutcome: null,
      documentExtractionAdmissions: 0,
      researchAdmissions: admissions.filter((entry) => entry.outcome === "ADMITTED").length,
      researchNotAuthorized: [...new Set(admissions
        .filter((entry) => entry.outcome === "NOT_AUTHORIZED")
        .map((entry) => entry.requirementCode ?? "AUTOMATIC_RESEARCH_NOT_AUTHORIZED"))],
      queuedResearchJobs,
      workerActivationOutcome: activation.outcome,
    };
  };

  let analysis: Awaited<ReturnType<typeof requestExistingCorpusAnalysis>>;
  try {
    analysis = await dependencies.requestAnalysis({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      executionId: input.executionId,
      actor: input.actor,
      withLegalResearch: true,
    });
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error
      ? error.code
      : null;
    if (code !== "CORPUS_NOT_READY") throw error;
    const currentRevision = await dependencies.loadCurrentRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    });
    if (!currentRevision || currentRevision.status !== "CURRENT") throw error;
    return runCurrentRevisionResearch(null);
  }
  if (!TERMINAL_JOB_STATUSES.has(analysis.admission.job.status)) {
    return {
      outcome: analysis.admission.outcome === "CREATED" ? "ANALYSIS_QUEUED" : "ANALYSIS_IN_PROGRESS",
      executionId: input.executionId,
      analysisJobId: analysis.admission.job.id,
      analysisJobStatus: analysis.admission.job.status,
      analysisAdmissionOutcome: analysis.admission.outcome,
      documentExtractionAdmissions: 0,
      researchAdmissions: 0,
      researchNotAuthorized: [],
      queuedResearchJobs: 0,
      workerActivationOutcome: analysis.activation.outcome,
    };
  }
  return {
    outcome: analysis.admission.job.status === "SUCCEEDED"
      ? "ANALYSIS_ALREADY_COMPLETED"
      : "ANALYSIS_NOT_ADMITTED",
    executionId: input.executionId,
    analysisJobId: analysis.admission.job.id,
    analysisJobStatus: analysis.admission.job.status,
    analysisAdmissionOutcome: analysis.admission.outcome,
    documentExtractionAdmissions: 0,
    researchAdmissions: 0,
    researchNotAuthorized: [],
    queuedResearchJobs: 0,
    workerActivationOutcome: analysis.activation.outcome,
  };
}

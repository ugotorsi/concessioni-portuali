import { prisma } from "@/lib/prisma";
import { requestExistingCorpusAnalysis } from "@/server/ai/fascicoloExistingCorpusAnalysis";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import { getCurrentKnowledgeRevision } from "@/server/fascicolo-knowledge/repository";
import { recoverCurrentKnowledgeResearchMissions } from "@/server/fascicolo-knowledge/researchMissionRecovery";

import { admitCurrentKnowledgeManualResearch } from "./automatic-research-job";
import { manualResearchPlanner } from "./manual-research-policy";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "./persistence";

const TERMINAL_JOB_STATUSES = new Set(["SUCCEEDED", "TERMINAL_FAILED", "CANCELLED"]);

export type ManualLegalAnalysisOutcome =
  | "ANALYSIS_AND_RESEARCH_STARTED"
  | "ANALYSIS_IN_PROGRESS"
  | "RESEARCH_STARTED"
  | "NO_RESEARCH_TO_RUN";

export type ManualLegalAnalysisResult = Readonly<{
  outcome: ManualLegalAnalysisOutcome;
  analysisJobId: string | null;
  researchAdmissions: number;
  researchNotAuthorized: readonly string[];
  queuedResearchJobs: number;
  workerActivationOutcome: string;
}>;

interface ManualLegalAnalysisDependencies {
  requestAnalysis: typeof requestExistingCorpusAnalysis;
  loadCurrentRevision: typeof getCurrentKnowledgeRevision;
  recoverMissions: typeof recoverCurrentKnowledgeResearchMissions;
  admitResearch: typeof admitCurrentKnowledgeManualResearch;
  countQueuedResearchJobs(input: Readonly<{ tenantId: string; procedimentoId: string }>): Promise<number>;
  activateWorker: typeof requestDocumentWorkerActivation;
}

const defaultDependencies: ManualLegalAnalysisDependencies = {
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
 * One-click manual pipeline: AI analysis of the current corpus, then autonomous legal research
 * and report versioning on the authorized worker. It does not depend on the automation switch.
 */
export async function runManualLegalAnalysisPipeline(input: Readonly<{
  tenantId: string;
  procedimentoId: string;
  actor: Readonly<{ id: string; email: string; role: "ADMIN" }>;
}>, overrides: Partial<ManualLegalAnalysisDependencies> = {}): Promise<ManualLegalAnalysisResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const runCurrentRevisionResearch = async (analysisJobId: string | null) => {
    await dependencies.recoverMissions({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      candidateActorId: input.actor.id,
      requireValidCandidate: true,
      autonomousResearch: manualResearchPlanner(input.tenantId),
    });
    const admissions = await dependencies.admitResearch({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      actorId: input.actor.id,
      correlationId: `manual-legal-analysis:${input.procedimentoId}:${input.actor.id}`,
    });
    const queuedResearchJobs = await dependencies.countQueuedResearchJobs(input);
    const activation = queuedResearchJobs > 0
      ? await dependencies.activateWorker({ kind: "LEGAL_RESEARCH", procedimentoId: input.procedimentoId })
      : { outcome: "NOT_REQUIRED" as const };
    return {
      outcome: queuedResearchJobs > 0 ? "RESEARCH_STARTED" as const : "NO_RESEARCH_TO_RUN" as const,
      analysisJobId,
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
    // A new or running analysis drains its research missions in the same worker run.
    return {
      outcome: analysis.admission.outcome === "CREATED" ? "ANALYSIS_AND_RESEARCH_STARTED" : "ANALYSIS_IN_PROGRESS",
      analysisJobId: analysis.admission.job.id,
      researchAdmissions: 0,
      researchNotAuthorized: [],
      queuedResearchJobs: 0,
      workerActivationOutcome: analysis.activation.outcome,
    };
  }
  return runCurrentRevisionResearch(analysis.admission.job.id);
}

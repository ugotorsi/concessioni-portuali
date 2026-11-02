import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/ai/fascicoloExistingCorpusAnalysis", () => ({ requestExistingCorpusAnalysis: vi.fn() }));
vi.mock("@/server/async-jobs/documentWorkerActivation", () => ({ requestDocumentWorkerActivation: vi.fn() }));
vi.mock("@/server/fascicolo-knowledge/researchMissionRecovery", () => ({
  recoverCurrentKnowledgeResearchMissions: vi.fn(),
}));
vi.mock("@/server/legal-research/automatic-research-job", () => ({
  admitCurrentKnowledgeManualResearch: vi.fn(),
}));
vi.mock("@/server/legal-research/manual-research-policy", () => ({
  manualResearchPlanner: vi.fn(() => vi.fn()),
}));
vi.mock("@/server/legal-research/persistence", () => ({
  RESEARCH_MISSION_EXECUTION_OPERATION: "LEGAL_RESEARCH.EXECUTE_V1",
}));

import { runManualLegalAnalysisPipeline } from "@/server/legal-research/manual-legal-analysis-pipeline";

const input = {
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
  actor: { id: "admin-1", email: "admin@example.test", role: "ADMIN" as const },
};

function analysis(outcome: "CREATED" | "REUSED", status: string) {
  return vi.fn(async () => ({
    admission: { outcome, job: { id: "analysis-job-1", status } },
    activation: { outcome: outcome === "CREATED" ? "REQUESTED" : "NOT_REQUIRED" },
  })) as never;
}

describe("manual legal analysis pipeline", () => {
  it("starts analysis with chained research when the corpus needs a new analysis", async () => {
    const requestAnalysis = analysis("CREATED", "QUEUED");
    const admitResearch = vi.fn();
    const activateWorker = vi.fn();
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis, admitResearch, activateWorker,
    })).resolves.toMatchObject({
      outcome: "ANALYSIS_AND_RESEARCH_STARTED",
      analysisJobId: "analysis-job-1",
      workerActivationOutcome: "REQUESTED",
    });
    expect(requestAnalysis).toHaveBeenCalledWith(expect.objectContaining({ withLegalResearch: true }));
    expect(admitResearch).not.toHaveBeenCalled();
    expect(activateWorker).not.toHaveBeenCalled();
  });

  it("runs only the pending autonomous research when the analysis is already current", async () => {
    const recoverMissions = vi.fn(async () => ({}) as never);
    const admitResearch = vi.fn(async () => [
      { outcome: "ADMITTED" },
      { outcome: "NOT_AUTHORIZED", requirementCode: "AUTOMATIC_RESEARCH_PROVIDER_NOT_CONFIGURED" },
    ]) as never;
    const activateWorker = vi.fn(async () => ({ outcome: "REQUESTED", renderJobId: "job-1" })) as never;
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis: analysis("REUSED", "SUCCEEDED"),
      recoverMissions,
      admitResearch,
      countQueuedResearchJobs: vi.fn(async () => 1),
      activateWorker,
    })).resolves.toEqual({
      outcome: "RESEARCH_STARTED",
      analysisJobId: "analysis-job-1",
      researchAdmissions: 1,
      researchNotAuthorized: ["AUTOMATIC_RESEARCH_PROVIDER_NOT_CONFIGURED"],
      queuedResearchJobs: 1,
      workerActivationOutcome: "REQUESTED",
    });
    expect(recoverMissions).toHaveBeenCalledWith(expect.objectContaining({ candidateActorId: "admin-1" }));
    expect(admitResearch).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-1" }));
    expect(activateWorker).toHaveBeenCalledWith({ kind: "LEGAL_RESEARCH", procedimentoId: "procedure-1" });
  });

  it("does not start a worker when no research is queued", async () => {
    const activateWorker = vi.fn();
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis: analysis("REUSED", "SUCCEEDED"),
      recoverMissions: vi.fn(async () => ({}) as never),
      admitResearch: vi.fn(async () => []) as never,
      countQueuedResearchJobs: vi.fn(async () => 0),
      activateWorker,
    })).resolves.toMatchObject({ outcome: "NO_RESEARCH_TO_RUN", workerActivationOutcome: "NOT_REQUIRED" });
    expect(activateWorker).not.toHaveBeenCalled();
  });

  it("runs research from a current revision when the historical corpus cannot be re-analysed", async () => {
    const error = Object.assign(new Error("CORPUS_NOT_READY"), { code: "CORPUS_NOT_READY" });
    const recoverMissions = vi.fn(async () => ({}) as never);
    const activateWorker = vi.fn(async () => ({ outcome: "REQUESTED", renderJobId: "job-1" })) as never;
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis: vi.fn(async () => {
        throw error;
      }) as never,
      loadCurrentRevision: vi.fn(async () => ({ status: "CURRENT" })) as never,
      recoverMissions,
      admitResearch: vi.fn(async () => [{ outcome: "ADMITTED" }]) as never,
      countQueuedResearchJobs: vi.fn(async () => 1),
      activateWorker,
    })).resolves.toMatchObject({
      outcome: "RESEARCH_STARTED",
      analysisJobId: null,
      researchAdmissions: 1,
      queuedResearchJobs: 1,
    });
    expect(recoverMissions).toHaveBeenCalledWith(expect.objectContaining({
      candidateActorId: "admin-1",
      requireValidCandidate: true,
    }));
    expect(activateWorker).toHaveBeenCalledWith({ kind: "LEGAL_RESEARCH", procedimentoId: "procedure-1" });
  });

  it("does not bypass corpus readiness without a current knowledge revision", async () => {
    const error = Object.assign(new Error("CORPUS_NOT_READY"), { code: "CORPUS_NOT_READY" });
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis: vi.fn(async () => {
        throw error;
      }) as never,
      loadCurrentRevision: vi.fn(async () => null) as never,
    })).rejects.toBe(error);
  });
});

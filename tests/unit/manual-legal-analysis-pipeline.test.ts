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
vi.mock("@/server/legal-research/persisted-research-policy", () => ({
  effectiveResearchPolicyEnvironment: vi.fn(async () => ({
    MANUAL_RESEARCH_EXECUTION_ENABLED: "true",
  })),
}));
vi.mock("@/server/async-jobs/persistence", () => ({
  AsyncJobIdempotencyConflictError: class AsyncJobIdempotencyConflictError extends Error {
    readonly code = "ASYNC_JOB_IDEMPOTENCY_CONFLICT";
  },
}));
vi.mock("@/server/documents/documentExtractionAdmission", () => ({ ensureDocumentExtractionJob: vi.fn() }));
vi.mock("@/server/queries/fascicolo-document-corpus", () => ({
  getFascicoloDocumentCorpusForTenant: vi.fn(async () => null),
}));
vi.mock("@/server/legal-research/persistence", () => ({
  RESEARCH_MISSION_EXECUTION_OPERATION: "LEGAL_RESEARCH.EXECUTE_V1",
}));

import { AsyncJobIdempotencyConflictError } from "@/server/async-jobs/persistence";
import { runManualLegalAnalysisPipeline } from "@/server/legal-research/manual-legal-analysis-pipeline";

const input = {
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
  executionId: "11111111-1111-4111-8111-111111111111",
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
      outcome: "ANALYSIS_QUEUED",
      executionId: input.executionId,
      analysisJobId: "analysis-job-1",
      analysisJobStatus: "QUEUED",
      analysisAdmissionOutcome: "CREATED",
      workerActivationOutcome: "REQUESTED",
    });
    expect(requestAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      executionId: input.executionId,
      withLegalResearch: true,
    }));
    expect(admitResearch).not.toHaveBeenCalled();
    expect(activateWorker).not.toHaveBeenCalled();
  });

  it("reports the same execution as already completed without starting research again", async () => {
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
      outcome: "ANALYSIS_ALREADY_COMPLETED",
      executionId: input.executionId,
      analysisJobId: "analysis-job-1",
      analysisJobStatus: "SUCCEEDED",
      analysisAdmissionOutcome: "REUSED",
      documentExtractionAdmissions: 0,
      researchAdmissions: 0,
      researchNotAuthorized: [],
      queuedResearchJobs: 0,
      workerActivationOutcome: "NOT_REQUIRED",
    });
    expect(recoverMissions).not.toHaveBeenCalled();
    expect(admitResearch).not.toHaveBeenCalled();
    expect(activateWorker).not.toHaveBeenCalled();
  });

  it("reports a cancelled execution as not admitted without masking it as empty research", async () => {
    const activateWorker = vi.fn();
    await expect(runManualLegalAnalysisPipeline(input, {
      requestAnalysis: analysis("REUSED", "CANCELLED"),
      recoverMissions: vi.fn(async () => ({}) as never),
      admitResearch: vi.fn(async () => []) as never,
      countQueuedResearchJobs: vi.fn(async () => 0),
      activateWorker,
    })).resolves.toMatchObject({
      outcome: "ANALYSIS_NOT_ADMITTED",
      executionId: input.executionId,
      analysisJobStatus: "CANCELLED",
      analysisAdmissionOutcome: "REUSED",
      workerActivationOutcome: "NOT_REQUIRED",
    });
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
      executionId: input.executionId,
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

  it("extracts documents never extracted before any analysis or research, without AI providers", async () => {
    const requestAnalysis = vi.fn();
    const admitResearch = vi.fn();
    const admitExtraction = vi.fn(async () => ({ outcome: "CREATED" })) as never;
    const activateWorker = vi.fn(async () => ({ outcome: "REQUESTED", renderJobId: "job-1" })) as never;
    const loadCorpus = vi.fn(async () => ({
      documents: [
        { documentoId: "doc-1", documentFileVersionId: "version-1", status: "NOT_EXTRACTED" },
        { documentoId: "doc-2", documentFileVersionId: "version-2", status: "AVAILABLE" },
        { documentoId: "doc-3", documentFileVersionId: "version-3", status: "EXTRACTION_FAILED" },
        { documentoId: "doc-4", documentFileVersionId: null, status: "NOT_EXTRACTED" },
      ],
    })) as never;
    await expect(runManualLegalAnalysisPipeline(input, {
      loadCorpus, admitExtraction, requestAnalysis, admitResearch, activateWorker,
    })).resolves.toEqual({
      outcome: "DOCUMENT_EXTRACTION_STARTED",
      executionId: input.executionId,
      analysisJobId: null,
      analysisJobStatus: null,
      analysisAdmissionOutcome: null,
      documentExtractionAdmissions: 1,
      researchAdmissions: 0,
      researchNotAuthorized: [],
      queuedResearchJobs: 0,
      workerActivationOutcome: "REQUESTED",
    });
    expect(admitExtraction).toHaveBeenCalledTimes(1);
    expect(admitExtraction).toHaveBeenCalledWith(expect.objectContaining({
      documentoId: "doc-1",
      documentFileVersionId: "version-1",
      procedimentoId: "procedure-1",
      authority: expect.objectContaining({
        admissionType: "AUTHENTICATED_USER",
        tenantId: "tenant-1",
        initiatingUserId: "admin-1",
      }),
    }));
    expect(activateWorker).toHaveBeenCalledWith({ kind: "DOCUMENT_EXTRACTION", procedimentoId: "procedure-1" });
    expect(requestAnalysis).not.toHaveBeenCalled();
    expect(admitResearch).not.toHaveBeenCalled();
  });

  it("drains an extraction already admitted for the same document version instead of failing", async () => {
    const activateWorker = vi.fn(async () => ({ outcome: "REQUESTED", renderJobId: "job-1" })) as never;
    await expect(runManualLegalAnalysisPipeline(input, {
      loadCorpus: vi.fn(async () => ({
        documents: [{ documentoId: "doc-1", documentFileVersionId: "version-1", status: "NOT_EXTRACTED" }],
      })) as never,
      admitExtraction: vi.fn(async () => {
        throw new AsyncJobIdempotencyConflictError();
      }) as never,
      activateWorker,
    })).resolves.toMatchObject({
      outcome: "DOCUMENT_EXTRACTION_STARTED",
      documentExtractionAdmissions: 0,
      workerActivationOutcome: "REQUESTED",
    });
    expect(activateWorker).toHaveBeenCalledWith({ kind: "DOCUMENT_EXTRACTION", procedimentoId: "procedure-1" });
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

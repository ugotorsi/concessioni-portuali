import { describe, expect, it, vi } from "vitest";

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  buildFascicoloDocumentCorpusUpdateAdmission,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  buildFascicoloExistingCorpusAnalysisAdmission,
  ExistingCorpusAnalysisRequestError,
  isExistingCorpusAnalysisRequestEnabled,
  requestExistingCorpusAnalysis,
} from "@/server/ai/fascicoloExistingCorpusAnalysis";

const enabledEnvironment = {
  DOCUMENT_WORKER_ACTIVATION_MODE: "RENDER_ONE_OFF",
  RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-previewv3",
  RENDER_WORKER_API_KEY: "protected-render-key",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "SELVARA-MANUAL-ANALYSIS",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
};

const corpus = {
  tenantId: "tenant-a",
  procedimentoId: "procedure-a",
  corpusFingerprint: "c".repeat(64),
  availability: "READY" as const,
  documentCount: 1,
  availableDocumentCount: 1,
  textPageCount: 40,
  documents: [],
  excerpts: [],
};

function dependencies() {
  return {
    loadCorpus: vi.fn().mockResolvedValue(corpus),
    loadCurrentRevision: vi.fn().mockResolvedValue(null),
    loadGlobalAiControl: vi.fn().mockResolvedValue({ effectiveEnabled: true }),
    admitJob: vi.fn().mockResolvedValue({
      outcome: "CREATED",
      job: { id: "analysis-job-a" },
    }),
    activateWorker: vi.fn().mockResolvedValue({
      outcome: "REQUESTED",
      renderJobId: "job-render-a",
    }),
  };
}

const request = {
  tenantId: "tenant-a",
  procedimentoId: "procedure-a",
  actor: {
    id: "admin-a",
    email: "admin-a@example.test",
    role: "ADMIN" as const,
  },
  environment: enabledEnvironment,
};

describe("existing fascicolo corpus analysis", () => {
  it("requires the activation and real-data gates before admission", async () => {
    expect(isExistingCorpusAnalysisRequestEnabled({
      ...enabledEnvironment,
      DOCUMENT_WORKER_ACTIVATION_MODE: "DISABLED",
    })).toBe(false);
    expect(isExistingCorpusAnalysisRequestEnabled(enabledEnvironment)).toBe(true);

    const deps = dependencies();
    await expect(requestExistingCorpusAnalysis({
      ...request,
      environment: {
        ...enabledEnvironment,
        DOCUMENT_WORKER_ACTIVATION_MODE: "DISABLED",
      },
    }, deps)).rejects.toEqual(
      new ExistingCorpusAnalysisRequestError("ANALYSIS_ACTIVATION_DISABLED"),
    );
    expect(deps.admitJob).not.toHaveBeenCalled();
    expect(deps.activateWorker).not.toHaveBeenCalled();
  });

  it("reuses the acquired corpus and activates the exact admitted job", async () => {
    const deps = dependencies();
    await expect(requestExistingCorpusAnalysis(request, deps)).resolves.toMatchObject({
      admission: { outcome: "CREATED", job: { id: "analysis-job-a" } },
      activation: { outcome: "REQUESTED", renderJobId: "job-render-a" },
    });

    expect(deps.loadCorpus).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
    });
    expect(deps.admitJob).toHaveBeenCalledWith(expect.objectContaining({
      operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      purpose: "FASCICOLO_EXISTING_CORPUS_ANALYSIS",
      procedimentoId: "procedure-a",
      inputReference: {
        referenceType: "FASCICOLO_DOCUMENT_CORPUS",
        referenceId: "c".repeat(64),
        referenceVersion: "V1",
        metadata: {
          procedimentoId: "procedure-a",
          corpusHash: "c".repeat(64),
        },
      },
    }));
    expect(deps.activateWorker).toHaveBeenCalledWith({
      kind: "DOCUMENT_ANALYSIS",
      applicationJobId: "analysis-job-a",
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
    });
  });

  it("does not admit a job when a knowledge revision already exists", async () => {
    const deps = dependencies();
    deps.loadCurrentRevision.mockResolvedValue({ id: "revision-a" });

    await expect(requestExistingCorpusAnalysis(request, deps)).rejects.toEqual(
      new ExistingCorpusAnalysisRequestError("KNOWLEDGE_REVISION_ALREADY_EXISTS"),
    );
    expect(deps.admitJob).not.toHaveBeenCalled();
  });

  it("uses a stable key distinct from the exhausted automatic corpus job", () => {
    const input = {
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint: "c".repeat(64),
    };
    const manualOne = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        initiatingUserId: "admin-a",
        actorEmail: "admin-a@example.test",
      }),
    );
    const manualTwo = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        initiatingUserId: "admin-a",
        actorEmail: "admin-a@example.test",
      }),
    );
    const automatic = normalizeAsyncJobAdmission(
      buildFascicoloDocumentCorpusUpdateAdmission({
        ...input,
        correlationId: "source-correlation",
        policyDecisionRef: null,
        admissionType: "AUTHENTICATED_USER",
        initiatingUserId: "admin-a",
        actorId: "admin-a",
        actorEmail: "admin-a@example.test",
        actorRole: "ADMIN",
      }),
    );

    expect(manualOne.idempotencyKey).toBe(manualTwo.idempotencyKey);
    expect(manualOne.requestFingerprint).toBe(manualTwo.requestFingerprint);
    expect(manualOne.idempotencyKey).not.toBe(automatic.idempotencyKey);
  });
});

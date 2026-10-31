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
import { SELVARA_PILOT_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";

const enabledEnvironment = {
  DOCUMENT_WORKER_ACTIVATION_MODE: "RENDER_ONE_OFF",
  RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-previewv3",
  RENDER_WORKER_API_KEY: "protected-render-key",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: SELVARA_PILOT_AUTHORIZATION.approvalId,
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
  AI_V7_PREFLIGHT_APPROVAL_ID: SELVARA_PILOT_AUTHORIZATION.approvalId,
  AI_V7_APPROVED_MAX_OUTPUT_TOKENS: "64000",
  AI_V7_APPROVED_MAX_COST_EUR: "1.00",
  AI_OPENAI_MAX_INPUT_TOKENS: "100000",
  AI_OPENAI_MAX_OUTPUT_TOKENS: "64000",
  AI_MAX_INPUT_BYTES: "1000000",
  AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "1000000",
  AI_OPENAI_TIMEOUT_MS: "90000",
  AI_OPENAI_USD_TO_EUR_RATE: "0.90",
  AI_OPENAI_USD_TO_EUR_RATE_DATE: "2026-10-26",
  AI_OPENAI_USD_TO_EUR_RATE_SOURCE: "ECB reference rate",
  ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "1.00",
};

const corpus = {
  tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
  procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
  corpusFingerprint: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
  availability: "READY" as const,
  documentCount: 1,
  availableDocumentCount: 1,
  textPageCount: 40,
  documents: [{
    documentoId: "document-1",
    documentFileVersionId: "version-1",
    extractionAttemptId: "attempt-1",
    sourceSha256: "a".repeat(64),
    status: "AVAILABLE" as const,
  }],
  excerpts: [{
    reference: "DOCUMENT_1.PAGE_1",
    documentoId: "document-1",
    documentFileVersionId: "version-1",
    pageNumber: 1,
    text: "Testo documentale.",
    sourceText: "Testo documentale.",
    textSha256: "b".repeat(64),
    extractionMethod: "PDFJS",
    ocrConfidence: null,
  }],
};

function dependencies() {
  return {
    loadCorpus: vi.fn().mockResolvedValue(corpus),
    loadGlobalAiControl: vi.fn().mockResolvedValue({ effectiveEnabled: true }),
    inspectBudgetCompatibility: vi.fn().mockResolvedValue({
      compatible: true,
      scopes: [],
    }),
    createPreflight: vi.fn().mockReturnValue({
      preflightFingerprint: "p".repeat(64),
    }),
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
  tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
  procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
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
      tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
      procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
    });
    expect(deps.admitJob).toHaveBeenCalledWith(expect.objectContaining({
      operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      purpose: "FASCICOLO_EXISTING_CORPUS_ANALYSIS_V7_CONTROLLED",
      maxAttempts: 1,
      procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
      inputReference: {
        referenceType: "FASCICOLO_DOCUMENT_CORPUS",
        referenceId: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
        referenceVersion: "V1",
        metadata: {
          procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
          corpusHash: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
          trialContractVersion: "FASCICOLO_DOCUMENT_ANALYSIS_V7",
          trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
          trialPreflightHash: "p".repeat(64),
        },
      },
    }));
    expect(deps.activateWorker).toHaveBeenCalledWith({
      kind: "DOCUMENT_ANALYSIS",
      applicationJobId: "analysis-job-a",
      tenantId: SELVARA_PILOT_AUTHORIZATION.tenantId,
      procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
    });
  });

  it.each([
    ["approval", {
      environment: {
        ...enabledEnvironment,
        AI_REAL_DATA_APPROVAL_ID: "OTHER-APPROVAL",
      },
    }],
    ["tenant", { tenantId: "tenant-other" }],
    ["procedimento", { procedimentoId: "procedure-other" }],
  ])("rejects a mismatched %s before admission", async (_field, override) => {
    const deps = dependencies();
    await expect(requestExistingCorpusAnalysis({
      ...request,
      ...override,
    }, deps)).rejects.toBeInstanceOf(ExistingCorpusAnalysisRequestError);
    expect(deps.admitJob).not.toHaveBeenCalled();
    expect(deps.activateWorker).not.toHaveBeenCalled();
  });

  it("rejects a corpus fingerprint mismatch before admission", async () => {
    const deps = dependencies();
    deps.loadCorpus.mockResolvedValue({
      ...corpus,
      corpusFingerprint: "f".repeat(64),
    });

    await expect(requestExistingCorpusAnalysis(request, deps)).rejects.toEqual(
      new ExistingCorpusAnalysisRequestError("SELVARA_PILOT_AUTHORIZATION_MISMATCH"),
    );
    expect(deps.admitJob).not.toHaveBeenCalled();
    expect(deps.activateWorker).not.toHaveBeenCalled();
  });

  it("does not admit a job when the economic preflight fails", async () => {
    const deps = dependencies();
    deps.createPreflight.mockImplementation(() => {
      throw new Error("PREFLIGHT_FAILED");
    });

    await expect(requestExistingCorpusAnalysis(request, deps)).rejects.toThrow("PREFLIGHT_FAILED");
    expect(deps.admitJob).not.toHaveBeenCalled();
  });

  it("uses a stable key distinct from the exhausted automatic corpus job", () => {
    const input = {
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint: "c".repeat(64),
      preflightFingerprint: "p".repeat(64),
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
    const changedPreflight = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        preflightFingerprint: "q".repeat(64),
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
    expect(manualOne.maxAttempts).toBe(1);
    expect(changedPreflight.idempotencyKey).toBe(manualOne.idempotencyKey);
    expect(changedPreflight.requestFingerprint).not.toBe(manualOne.requestFingerprint);
    expect(manualOne.idempotencyKey).not.toBe(automatic.idempotencyKey);
  });
});

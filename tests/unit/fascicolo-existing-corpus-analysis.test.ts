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
  ASYNC_PROVIDER_EXECUTION_ENABLED: "true",
  AI_OPENAI_API_KEY: "protected-openai-key",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: SELVARA_PILOT_AUTHORIZATION.approvalId,
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
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
const executionId = "11111111-1111-4111-8111-111111111111";

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
    admitJob: vi.fn().mockResolvedValue({
      outcome: "CREATED",
      job: { id: "analysis-job-a", status: "QUEUED" },
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
  executionId,
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
      ASYNC_PROVIDER_EXECUTION_ENABLED: "false",
    })).toBe(false);
    expect(isExistingCorpusAnalysisRequestEnabled(enabledEnvironment)).toBe(true);

    const deps = dependencies();
    await expect(requestExistingCorpusAnalysis({
      ...request,
      environment: {
        ...enabledEnvironment,
        ASYNC_PROVIDER_EXECUTION_ENABLED: "false",
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
      purpose: "FASCICOLO_MANUAL_ANALYSIS",
      maxAttempts: 1,
      procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
      inputReference: {
        referenceType: "FASCICOLO_DOCUMENT_CORPUS",
        referenceId: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
        referenceVersion: "V1",
        metadata: {
          procedimentoId: SELVARA_PILOT_AUTHORIZATION.procedimentoId,
          corpusHash: SELVARA_PILOT_AUTHORIZATION.corpusFingerprint,
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

  it("does not reactivate a terminal job reused by the same execution", async () => {
    const deps = dependencies();
    deps.admitJob.mockResolvedValue({
      outcome: "REUSED",
      job: { id: "analysis-job-cancelled", status: "CANCELLED" },
    });

    await expect(requestExistingCorpusAnalysis(request, deps)).resolves.toMatchObject({
      admission: {
        outcome: "REUSED",
        job: { id: "analysis-job-cancelled", status: "CANCELLED" },
      },
      activation: { outcome: "NOT_REQUIRED" },
    });
    expect(deps.activateWorker).not.toHaveBeenCalled();
  });

  it("does not hard-code a single pilot tenant or fascicolo", async () => {
    const deps = dependencies();
    deps.loadCorpus.mockResolvedValue({
      ...corpus,
      tenantId: "tenant-other",
      procedimentoId: "procedure-other",
    });
    await expect(requestExistingCorpusAnalysis({
      ...request,
      tenantId: "tenant-other",
      procedimentoId: "procedure-other",
    }, deps)).resolves.toMatchObject({
      admission: { outcome: "CREATED" },
    });
    expect(deps.admitJob).toHaveBeenCalledWith(expect.objectContaining({
      admission: expect.objectContaining({ tenantId: "tenant-other" }),
      procedimentoId: "procedure-other",
    }));
  });

  it("does not admit a job when the economic preflight fails", async () => {
    const deps = dependencies();
    deps.inspectBudgetCompatibility.mockResolvedValue({
      compatible: false,
      scopes: [],
    });

    await expect(requestExistingCorpusAnalysis(request, deps)).rejects.toEqual(
      new ExistingCorpusAnalysisRequestError("ECONOMIC_PREFLIGHT_FAILED"),
    );
    expect(deps.admitJob).not.toHaveBeenCalled();
  });

  it("separates corpus identity from the authorized execution identity", () => {
    const input = {
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint: "c".repeat(64),
    };
    const manualOne = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        executionId,
        initiatingUserId: "admin-a",
        actorEmail: "admin-a@example.test",
      }),
    );
    const manualTwo = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        executionId,
        initiatingUserId: "admin-a",
        actorEmail: "admin-a@example.test",
      }),
    );
    const changedPreflight = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        corpusFingerprint: "q".repeat(64),
        executionId,
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
    const newlyAuthorized = normalizeAsyncJobAdmission(
      buildFascicoloExistingCorpusAnalysisAdmission({
        ...input,
        executionId: "22222222-2222-4222-8222-222222222222",
        initiatingUserId: "admin-a",
        actorEmail: "admin-a@example.test",
      }),
    );

    expect(manualOne.idempotencyKey).toBe(manualTwo.idempotencyKey);
    expect(manualOne.requestFingerprint).toBe(manualTwo.requestFingerprint);
    expect(manualOne.maxAttempts).toBe(1);
    expect(newlyAuthorized.inputReference.referenceId).toBe(input.corpusFingerprint);
    expect(newlyAuthorized.idempotencyKey).not.toBe(manualOne.idempotencyKey);
    expect(newlyAuthorized.requestFingerprint).not.toBe(manualOne.requestFingerprint);
    expect(changedPreflight.idempotencyKey).not.toBe(manualOne.idempotencyKey);
    expect(changedPreflight.requestFingerprint).not.toBe(manualOne.requestFingerprint);
    expect(manualOne.idempotencyKey).not.toBe(automatic.idempotencyKey);
  });

  it("deduplicates simultaneous submissions for one execution", async () => {
    const normalizedAdmissions = new Map<string, {
      id: string;
      status: string;
      requestFingerprint: string;
    }>();
    const deps = dependencies();
    deps.admitJob.mockImplementation(async (rawAdmission) => {
      const admission = normalizeAsyncJobAdmission(rawAdmission);
      const existing = normalizedAdmissions.get(admission.idempotencyKey);
      if (existing) {
        expect(existing.requestFingerprint).toBe(admission.requestFingerprint);
        return { outcome: "REUSED", job: existing };
      }
      const job = {
        id: "analysis-job-concurrent",
        status: "QUEUED",
        requestFingerprint: admission.requestFingerprint,
      };
      normalizedAdmissions.set(admission.idempotencyKey, job);
      return { outcome: "CREATED", job };
    });

    const [first, second] = await Promise.all([
      requestExistingCorpusAnalysis(request, deps),
      requestExistingCorpusAnalysis(request, deps),
    ]);

    expect(new Set([first.admission.job.id, second.admission.job.id])).toEqual(
      new Set(["analysis-job-concurrent"]),
    );
    expect(normalizedAdmissions).toHaveLength(1);
  });
});

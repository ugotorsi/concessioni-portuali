import { beforeEach, describe, expect, it, vi } from "vitest";

const admissionMocks = vi.hoisted(() => ({
  issueAuthorization: vi.fn(),
  verifyAuthorization: vi.fn(),
  admitAsyncJob: vi.fn(),
  retryTerminalAsyncJob: vi.fn(),
  requestActivation: vi.fn(),
}));
const runtimeActionMocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
}));
const recoveryDb = vi.hoisted(() => ({
  findMany: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    asyncJob: { findMany: recoveryDb.findMany },
    $disconnect: recoveryDb.disconnect,
  },
}));
vi.mock("@/server/documents/documentOcrAuthorization", () => ({
  issueDocumentOcrAuthorization: admissionMocks.issueAuthorization,
  verifyDocumentOcrAuthorization: admissionMocks.verifyAuthorization,
}));
vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJob: admissionMocks.admitAsyncJob,
  retryTerminalAsyncJob: admissionMocks.retryTerminalAsyncJob,
}));
vi.mock("@/lib/auth", () => ({
  requireRole: runtimeActionMocks.requireRole,
  getCurrentUser: runtimeActionMocks.getCurrentUser,
}));
vi.mock("next/cache", () => ({
  revalidatePath: runtimeActionMocks.revalidatePath,
}));
vi.mock("@/server/async-jobs/documentWorkerActivation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/async-jobs/documentWorkerActivation")>(),
  requestDocumentWorkerActivation: admissionMocks.requestActivation,
}));

import {
  activateDocumentWorker,
  documentWorkerKindForOperation,
  type DocumentWorkerActivationRequest,
} from "@/server/async-jobs/documentWorkerActivation";
import { runDocumentWorkerRecoveryProcess } from "@/server/async-jobs/documentWorkerRecoveryProcess";
import { ensureAuthorizedDocumentOcrExtractionJob } from "@/server/documents/documentOcrJobAdmission";
import { retryRuntimeJob } from "@/app/admin/runtime/actions";

const environment = {
  DOCUMENT_WORKER_ACTIVATION_MODE: "RENDER_ONE_OFF",
  DOCUMENT_WORKER_ACTIVATION_TIMEOUT_MS: "1000",
  RENDER_APPLICATION_WORKER_SERVICE_ID: "srv-application123",
  RENDER_DOCUMENT_OCR_WORKER_SERVICE_ID: "crn-ocr123",
  RENDER_WORKER_API_KEY: "test-render-key",
};

describe("document worker activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admissionMocks.issueAuthorization.mockResolvedValue({
      authorizationRef: "authorization-1",
      failedAttemptId: "attempt-failed",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      createdAt: new Date("2026-10-16T06:00:00.000Z"),
      actor: {
        userId: "user-1",
        userEmail: "user@example.test",
        userRole: "TECNICO",
      },
    });
    admissionMocks.admitAsyncJob.mockResolvedValue({
      outcome: "CREATED",
      job: { id: "ocr-job-1" },
    });
    admissionMocks.requestActivation.mockResolvedValue({
      outcome: "REQUESTED",
      renderJobId: "job-render-ocr",
    });
    runtimeActionMocks.requireRole.mockResolvedValue(undefined);
    runtimeActionMocks.getCurrentUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    recoveryDb.findMany.mockResolvedValue([]);
    recoveryDb.disconnect.mockResolvedValue(undefined);
  });

  it("maps only document pipeline operations to worker kinds", () => {
    expect(documentWorkerKindForOperation("DOCUMENT_EXTRACTION_V1")).toBe("DOCUMENT_EXTRACTION");
    expect(documentWorkerKindForOperation("DOCUMENT_OCR_COORDINATOR_V2")).toBe("DOCUMENT_OCR");
    expect(documentWorkerKindForOperation("DOCUMENT_OCR_PAGE_BATCH_V2")).toBe("DOCUMENT_OCR");
    expect(documentWorkerKindForOperation("FASCICOLO.AUTOMATIC_ANALYSIS_V1")).toBe("DOCUMENT_ANALYSIS");
    expect(documentWorkerKindForOperation("LEGAL_RESEARCH.EXECUTE_V1")).toBeNull();
  });

  it("requests scoped document analysis after an audited terminal retry", async () => {
    admissionMocks.retryTerminalAsyncJob.mockResolvedValueOnce({
      outcome: "REQUEUED",
      jobId: "canary-job-1",
      operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    });
    const formData = new FormData();
    formData.set("jobId", "canary-job-1");

    await retryRuntimeJob(formData);

    expect(admissionMocks.requestActivation).toHaveBeenCalledWith(
      {
        kind: "DOCUMENT_ANALYSIS",
        applicationJobId: "canary-job-1",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
      },
    );
    expect(runtimeActionMocks.revalidatePath).toHaveBeenCalledWith("/admin/runtime");
  });

  it("does not activate legal research after an audited terminal retry", async () => {
    admissionMocks.retryTerminalAsyncJob.mockResolvedValueOnce({
      outcome: "REQUEUED",
      operation: "LEGAL_RESEARCH.EXECUTE_V1",
      procedimentoId: "procedure-1",
    });
    const formData = new FormData();
    formData.set("jobId", "legal-job-1");

    await retryRuntimeJob(formData);

    expect(admissionMocks.requestActivation).not.toHaveBeenCalled();
    expect(runtimeActionMocks.revalidatePath).toHaveBeenCalledWith("/admin/runtime");
  });

  it.each([
    [
      "DOCUMENT_EXTRACTION",
      "srv-application123",
      "ASYNC_WORKER_OPERATION_ALLOWLIST=DOCUMENT_EXTRACTION_V1",
      "npm run worker:document-extraction",
    ],
    [
      "DOCUMENT_OCR",
      "crn-ocr123",
      "ASYNC_WORKER_OPERATION_ALLOWLIST=DOCUMENT_OCR_COORDINATOR_V2,DOCUMENT_OCR_PAGE_BATCH_V2",
      "npm run worker:document-ocr",
    ],
    [
      "DOCUMENT_ANALYSIS",
      "srv-application123",
      "ASYNC_WORKER_OPERATION_ALLOWLIST=FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      "npm run worker:async",
    ],
  ] as const)("creates a scoped %s one-off command", async (kind, serviceId, operation, command) => {
    const fetch = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(
        JSON.stringify({ id: "job-render123" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ));

    const request: DocumentWorkerActivationRequest = kind === "DOCUMENT_ANALYSIS"
      ? {
          kind,
          applicationJobId: "analysis-job-1",
          tenantId: "tenant-1",
          procedimentoId: "procedure-1",
        }
      : { kind, procedimentoId: "procedure-1" };
    const completeAnalysisActivation = vi.fn(async () => ({
      state: "CONFIRMED" as const,
      activationAttemptId: "a".repeat(32),
      renderJobId: "job-render123",
      failureCode: null,
    }));

    await expect(activateDocumentWorker(request, {
      environment,
      fetch,
      beginAnalysisActivation: vi.fn(async () => ({
        outcome: "RESERVED" as const,
        snapshot: {
          state: "REQUESTING" as const,
          activationAttemptId: "a".repeat(32),
          renderJobId: null,
          failureCode: null,
        },
      })),
      completeAnalysisActivation,
    })).resolves.toEqual({ outcome: "REQUESTED", renderJobId: "job-render123" });

    const [url, init] = fetch.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as { startCommand: string };
    expect(url).toBe(`https://api.render.com/v1/services/${serviceId}/jobs`);
    expect(body.startCommand).toContain(operation);
    expect(body.startCommand).toContain("ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST=procedure-1");
    expect(body.startCommand).toContain("ASYNC_WORKER_EXIT_ON_IDLE=true");
    expect(body.startCommand).toContain(command);
    expect(body.startCommand).not.toContain("LEGAL_RESEARCH.EXECUTE_V1");
    if (kind === "DOCUMENT_ANALYSIS") {
      expect(body.startCommand).toContain("ASYNC_WORKER_MAX_PROCESSED_JOBS=1");
      expect(body.startCommand).toContain("ASYNC_WORKER_TARGET_JOB_ID=analysis-job-1");
      expect(body.startCommand).toContain("ASYNC_WORKER_TARGET_TENANT_ID=tenant-1");
      expect(completeAnalysisActivation).toHaveBeenCalledWith(expect.objectContaining({
        state: "CONFIRMED",
        renderJobId: "job-render123",
      }));
    }
  });

  it("defers a rejected request without exposing credentials", async () => {
    const { requestDocumentWorkerActivation } = await vi.importActual<
      typeof import("@/server/async-jobs/documentWorkerActivation")
    >("@/server/async-jobs/documentWorkerActivation");
    const report = vi.fn();
    await expect(requestDocumentWorkerActivation({
      kind: "DOCUMENT_OCR",
      procedimentoId: "procedure-1",
    }, {
      environment,
      fetch: vi.fn(async () => new Response(null, { status: 409 })),
      report,
    })).resolves.toEqual({ outcome: "DEFERRED", errorCode: "REQUEST_REJECTED" });
    expect(JSON.stringify(report.mock.calls)).not.toContain("test-render-key");
  });

  it("allows at most one external activation for simultaneous requests of the same job", async () => {
    let snapshot:
      | {
          state: "REQUESTING" | "CONFIRMED";
          activationAttemptId: string;
          renderJobId: string | null;
          failureCode: null;
        }
      | null = null;
    const beginAnalysisActivation = vi.fn(async () => {
      if (snapshot) return { outcome: "EXISTING" as const, snapshot: { ...snapshot } };
      const reserved = {
        state: "REQUESTING" as const,
        activationAttemptId: "a".repeat(32),
        renderJobId: null as null,
        failureCode: null as null,
      };
      snapshot = reserved;
      return { outcome: "RESERVED" as const, snapshot: reserved };
    });
    const completeAnalysisActivation = vi.fn(async () => {
      snapshot = {
        state: "CONFIRMED",
        activationAttemptId: "a".repeat(32),
        renderJobId: "job-render123",
        failureCode: null,
      };
      return {
        state: "CONFIRMED" as const,
        activationAttemptId: "a".repeat(32),
        renderJobId: "job-render123",
        failureCode: null,
      };
    });
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ id: "job-render123" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ));
    const request = {
      kind: "DOCUMENT_ANALYSIS" as const,
      applicationJobId: "analysis-job-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    };

    const outcomes = await Promise.all([
      activateDocumentWorker(request, {
        environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
      }),
      activateDocumentWorker(request, {
        environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
      }),
    ]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(outcomes.map((outcome) => outcome.outcome).sort())
      .toEqual(["ALREADY_REQUESTED", "REQUESTED"]);
  });

  it("persists a verified Render rejection and does not retry it automatically", async () => {
    const { requestDocumentWorkerActivation: actualRequest } = await vi.importActual<
      typeof import("@/server/async-jobs/documentWorkerActivation")
    >("@/server/async-jobs/documentWorkerActivation");
    let state = "NOT_REQUESTED";
    const beginAnalysisActivation = vi.fn(async () => state === "NOT_REQUESTED"
      ? {
          outcome: "RESERVED" as const,
          snapshot: {
            state: "REQUESTING" as const,
            activationAttemptId: "a".repeat(32),
            renderJobId: null,
            failureCode: null,
          },
        }
      : {
          outcome: "EXISTING" as const,
          snapshot: {
            state: "FAILED_VERIFIED" as const,
            activationAttemptId: "a".repeat(32),
            renderJobId: null,
            failureCode: "RENDER_HTTP_409",
          },
        });
    const completeAnalysisActivation = vi.fn(async () => {
      state = "FAILED_VERIFIED";
      return {
        state: "FAILED_VERIFIED" as const,
        activationAttemptId: "a".repeat(32),
        renderJobId: null,
        failureCode: "RENDER_HTTP_409",
      };
    });
    const fetch = vi.fn(async () => new Response(null, { status: 409 }));
    const request = {
      kind: "DOCUMENT_ANALYSIS" as const,
      applicationJobId: "analysis-job-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    };

    await expect(actualRequest(request, {
      environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
      report: vi.fn(),
    })).resolves.toMatchObject({ outcome: "DEFERRED", errorCode: "REQUEST_REJECTED" });
    await expect(activateDocumentWorker(request, {
      environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
    })).resolves.toMatchObject({
      outcome: "ALREADY_REQUESTED",
      activationState: "FAILED_VERIFIED",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("persists an uncertain remote outcome and never retries it automatically", async () => {
    const { requestDocumentWorkerActivation: actualRequest } = await vi.importActual<
      typeof import("@/server/async-jobs/documentWorkerActivation")
    >("@/server/async-jobs/documentWorkerActivation");
    let state = "NOT_REQUESTED";
    const beginAnalysisActivation = vi.fn(async () => state === "NOT_REQUESTED"
      ? {
          outcome: "RESERVED" as const,
          snapshot: {
            state: "REQUESTING" as const,
            activationAttemptId: "a".repeat(32),
            renderJobId: null,
            failureCode: null,
          },
        }
      : {
          outcome: "EXISTING" as const,
          snapshot: {
            state: "REMOTE_UNKNOWN" as const,
            activationAttemptId: "a".repeat(32),
            renderJobId: null,
            failureCode: "REQUEST_FAILED",
          },
        });
    const completeAnalysisActivation = vi.fn(async () => {
      state = "REMOTE_UNKNOWN";
      return {
        state: "REMOTE_UNKNOWN" as const,
        activationAttemptId: "a".repeat(32),
        renderJobId: null,
        failureCode: "REQUEST_FAILED",
      };
    });
    const fetch = vi.fn(async () => {
      throw new TypeError("connection reset");
    });
    const request = {
      kind: "DOCUMENT_ANALYSIS" as const,
      applicationJobId: "analysis-job-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    };

    await expect(actualRequest(request, {
      environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
      report: vi.fn(),
    })).resolves.toMatchObject({ outcome: "DEFERRED", errorCode: "REQUEST_FAILED" });
    await expect(activateDocumentWorker(request, {
      environment, fetch, beginAnalysisActivation, completeAnalysisActivation,
    })).resolves.toMatchObject({
      outcome: "ALREADY_REQUESTED",
      activationState: "REMOTE_UNKNOWN",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("persists a timed-out Render request as remote-unknown", async () => {
    vi.useFakeTimers();
    try {
      const { requestDocumentWorkerActivation: actualRequest } = await vi.importActual<
        typeof import("@/server/async-jobs/documentWorkerActivation")
      >("@/server/async-jobs/documentWorkerActivation");
      const completeAnalysisActivation = vi.fn(async (input) => ({
        state: input.state,
        activationAttemptId: input.activationAttemptId,
        renderJobId: null,
        failureCode: input.failureCode ?? null,
      }));
      const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
      ));
      const pending = actualRequest({
        kind: "DOCUMENT_ANALYSIS",
        applicationJobId: "analysis-job-timeout",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
      }, {
        environment,
        fetch,
        beginAnalysisActivation: vi.fn(async () => ({
          outcome: "RESERVED" as const,
          snapshot: {
            state: "REQUESTING" as const,
            activationAttemptId: "a".repeat(32),
            renderJobId: null,
            failureCode: null,
          },
        })),
        completeAnalysisActivation,
        report: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toMatchObject({
        outcome: "DEFERRED",
        errorCode: "REQUEST_TIMEOUT",
      });
      expect(completeAnalysisActivation).toHaveBeenCalledWith(expect.objectContaining({
        state: "REMOTE_UNKNOWN",
        failureCode: "REQUEST_TIMEOUT",
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("activates OCR only after its authorized V2 coordinator job is persisted", async () => {
    const order: string[] = [];
    admissionMocks.admitAsyncJob.mockImplementationOnce(async () => {
      order.push("admit");
      return { outcome: "CREATED", job: { id: "ocr-job-1" } };
    });
    admissionMocks.requestActivation.mockImplementationOnce(async () => {
      order.push("activate");
      return { outcome: "REQUESTED", renderJobId: "job-render-ocr" };
    });

    await ensureAuthorizedDocumentOcrExtractionJob("attempt-failed");

    expect(order).toEqual(["admit", "activate"]);
    expect(admissionMocks.admitAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      operation: "DOCUMENT_OCR_COORDINATOR_V2",
      procedimentoId: "procedure-1",
    }));
    expect(admissionMocks.requestActivation).toHaveBeenCalledWith(
      {
        kind: "DOCUMENT_OCR",
        procedimentoId: "procedure-1",
      },
    );
  });

  it("does not create recovery one-offs when the scoped queue has no due or stale jobs", async () => {
    const activate = vi.fn();
    const report = vi.fn();
    await runDocumentWorkerRecoveryProcess({
      environment: { DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1" },
      listRecoverableJobs: vi.fn(async () => []),
      activate,
      disconnect: vi.fn(async () => undefined),
      report,
    });

    expect(activate).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith({ event: "DOCUMENT_WORKER_RECOVERY_IDLE" });
  });

  it("queries only due queued, retry-wait, and expired lease states in the recovery scope", async () => {
    await runDocumentWorkerRecoveryProcess({
      environment: { DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1" },
      activate: vi.fn(),
      report: vi.fn(),
    });

    expect(recoveryDb.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        procedimentoId: { in: ["procedure-1"] },
        OR: [
          {
            status: { in: ["QUEUED", "RETRY_WAIT"] },
            availableAt: { lte: expect.any(Date) },
          },
          {
            status: { in: ["RUNNING", "CANCELLATION_REQUESTED"] },
            leaseExpiresAt: { lte: expect.any(Date) },
          },
        ],
      }),
      select: { id: true, operation: true, tenantId: true, procedimentoId: true },
    });
    expect(recoveryDb.disconnect).toHaveBeenCalledOnce();
  });

  it("coalesces due OCR operations and recovers analysis under the same procedimento scope", async () => {
    const activate = vi.fn(async () => ({
      outcome: "REQUESTED" as const,
      renderJobId: "job-render123",
    }));
    await runDocumentWorkerRecoveryProcess({
      environment: {
        ...environment,
        DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1",
      },
      listRecoverableJobs: vi.fn(async () => [
        {
          id: "ocr-coordinator-1", operation: "DOCUMENT_OCR_COORDINATOR_V2",
          tenantId: "tenant-1", procedimentoId: "procedure-1",
        },
        {
          id: "ocr-page-1", operation: "DOCUMENT_OCR_PAGE_BATCH_V2",
          tenantId: "tenant-1", procedimentoId: "procedure-1",
        },
        {
          id: "analysis-job-1", operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
          tenantId: "tenant-1", procedimentoId: "procedure-1",
        },
      ]),
      activate,
      disconnect: vi.fn(async () => undefined),
      report: vi.fn(),
    });

    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledWith(
      {
        kind: "DOCUMENT_OCR",
        procedimentoId: "procedure-1",
      },
      expect.any(Object),
    );
    expect(activate).toHaveBeenCalledWith(
      {
        kind: "DOCUMENT_ANALYSIS",
        applicationJobId: "analysis-job-1",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
      },
      expect.any(Object),
    );
  });

  it("continues recovering other scopes after one activation fails", async () => {
    const activate = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ outcome: "REQUESTED", renderJobId: "job-render-analysis" });
    const markFailure = vi.fn();
    await runDocumentWorkerRecoveryProcess({
      environment: {
        ...environment,
        DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1",
      },
      listRecoverableJobs: vi.fn(async () => [
        {
          id: "ocr-job-1", operation: "DOCUMENT_OCR_COORDINATOR_V2",
          tenantId: "tenant-1", procedimentoId: "procedure-1",
        },
        {
          id: "analysis-job-1", operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
          tenantId: "tenant-1", procedimentoId: "procedure-1",
        },
      ]),
      activate,
      disconnect: vi.fn(async () => undefined),
      report: vi.fn(),
      markFailure,
    });

    expect(activate).toHaveBeenCalledTimes(2);
    expect(markFailure).toHaveBeenCalledOnce();
  });
});

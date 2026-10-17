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
      jobId: "job-render-ocr",
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
      operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      procedimentoId: "procedure-1",
    });
    const formData = new FormData();
    formData.set("jobId", "canary-job-1");

    await retryRuntimeJob(formData);

    expect(admissionMocks.requestActivation).toHaveBeenCalledWith(
      "DOCUMENT_ANALYSIS",
      "procedure-1",
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

    await expect(activateDocumentWorker(kind, "procedure-1", {
      environment,
      fetch,
    })).resolves.toEqual({ outcome: "REQUESTED", jobId: "job-render123" });

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
    }
  });

  it("defers a rejected request without exposing credentials", async () => {
    const { requestDocumentWorkerActivation } = await vi.importActual<
      typeof import("@/server/async-jobs/documentWorkerActivation")
    >("@/server/async-jobs/documentWorkerActivation");
    const report = vi.fn();
    await expect(requestDocumentWorkerActivation("DOCUMENT_OCR", "procedure-1", {
      environment,
      fetch: vi.fn(async () => new Response(null, { status: 409 })),
      report,
    })).resolves.toEqual({ outcome: "DEFERRED", errorCode: "REQUEST_REJECTED" });
    expect(JSON.stringify(report.mock.calls)).not.toContain("test-render-key");
  });

  it("activates OCR only after its authorized V2 coordinator job is persisted", async () => {
    const order: string[] = [];
    admissionMocks.admitAsyncJob.mockImplementationOnce(async () => {
      order.push("admit");
      return { outcome: "CREATED", job: { id: "ocr-job-1" } };
    });
    admissionMocks.requestActivation.mockImplementationOnce(async () => {
      order.push("activate");
      return { outcome: "REQUESTED", jobId: "job-render-ocr" };
    });

    await ensureAuthorizedDocumentOcrExtractionJob("attempt-failed");

    expect(order).toEqual(["admit", "activate"]);
    expect(admissionMocks.admitAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      operation: "DOCUMENT_OCR_COORDINATOR_V2",
      procedimentoId: "procedure-1",
    }));
    expect(admissionMocks.requestActivation).toHaveBeenCalledWith(
      "DOCUMENT_OCR",
      "procedure-1",
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
      select: { operation: true, procedimentoId: true },
      distinct: ["operation", "procedimentoId"],
    });
    expect(recoveryDb.disconnect).toHaveBeenCalledOnce();
  });

  it("coalesces due OCR operations and recovers analysis under the same procedimento scope", async () => {
    const activate = vi.fn(async () => ({ outcome: "REQUESTED" as const, jobId: "job-render123" }));
    await runDocumentWorkerRecoveryProcess({
      environment: {
        ...environment,
        DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1",
      },
      listRecoverableJobs: vi.fn(async () => [
        { operation: "DOCUMENT_OCR_COORDINATOR_V2", procedimentoId: "procedure-1" },
        { operation: "DOCUMENT_OCR_PAGE_BATCH_V2", procedimentoId: "procedure-1" },
        { operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1", procedimentoId: "procedure-1" },
      ]),
      activate,
      disconnect: vi.fn(async () => undefined),
      report: vi.fn(),
    });

    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledWith(
      "DOCUMENT_OCR",
      "procedure-1",
      expect.any(Object),
    );
    expect(activate).toHaveBeenCalledWith(
      "DOCUMENT_ANALYSIS",
      "procedure-1",
      expect.any(Object),
    );
  });

  it("continues recovering other scopes after one activation fails", async () => {
    const activate = vi.fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ outcome: "REQUESTED", jobId: "job-render-analysis" });
    const markFailure = vi.fn();
    await runDocumentWorkerRecoveryProcess({
      environment: {
        ...environment,
        DOCUMENT_WORKER_RECOVERY_PROCEDIMENTO_ALLOWLIST: "procedure-1",
      },
      listRecoverableJobs: vi.fn(async () => [
        { operation: "DOCUMENT_OCR_COORDINATOR_V2", procedimentoId: "procedure-1" },
        { operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1", procedimentoId: "procedure-1" },
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

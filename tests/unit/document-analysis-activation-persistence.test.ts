import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    activityLog: { findMany: vi.fn() },
    asyncJob: { findUnique: vi.fn(), findMany: vi.fn() },
  },
  createAuditLogInTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn((callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx)) },
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: harness.createAuditLogInTransaction,
}));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn(
    (callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx),
  ),
}));

import {
  beginDocumentAnalysisActivation,
  completeDocumentAnalysisActivation,
  DocumentAnalysisActivationTargetError,
  reconcileDocumentAnalysisActivation,
  recoverSelvaraFailedDocumentAnalysisActivation,
  SelvaraActivationRecoveryVerificationError,
  SELVARA_FAILED_ACTIVATION_RECOVERY,
} from "@/server/async-jobs/documentAnalysisActivationPersistence";
import { SELVARA_V3_RECOVERY_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";

const target = {
  applicationJobId: "analysis-job-1",
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
};

function eligibleJob(overrides: Record<string, unknown> = {}) {
  return {
    id: target.applicationJobId,
    operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
    tenantId: target.tenantId,
    procedimentoId: target.procedimentoId,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: "corpus-1",
      metadata: { procedimentoId: target.procedimentoId },
    },
    admissionType: "AUTHENTICATED_USER",
    initiatingUserId: "user-1",
    actorId: "user-1",
    actorEmail: "user@example.test",
    actorRole: "TECNICO",
    policyDecisionRef: null,
    status: "QUEUED",
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: new Date(0),
    dependsOnJobId: null,
    databaseNow: new Date("2026-10-25T08:00:00.000Z"),
    ...overrides,
  };
}

function activationLog(
  state: "NOT_REQUESTED" | "REQUESTING" | "CONFIRMED" | "REMOTE_UNKNOWN" | "FAILED_VERIFIED",
  overrides: Record<string, unknown> = {},
) {
  return {
    azione: `DOCUMENT_ANALYSIS_ACTIVATION_${state}`,
    metadata: {
      activationSequence: 1,
      activationAttemptId: "a".repeat(32),
      renderJobId: state === "CONFIRMED" ? "job-render123" : null,
      failureCode: null,
      ...overrides,
    },
  };
}

function selvaraJob(overrides: Record<string, unknown> = {}) {
  return eligibleJob({
    id: SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId,
    tenantId: SELVARA_V3_RECOVERY_AUTHORIZATION.tenantId,
    procedimentoId: SELVARA_V3_RECOVERY_AUTHORIZATION.procedimentoId,
    purpose: SELVARA_V3_RECOVERY_AUTHORIZATION.purpose,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint,
      metadata: {
        procedimentoId: SELVARA_V3_RECOVERY_AUTHORIZATION.procedimentoId,
        corpusHash: SELVARA_V3_RECOVERY_AUTHORIZATION.corpusFingerprint,
      },
    },
    startedAt: null,
    completedAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    failureCategory: null,
    failureCode: null,
    blockedReason: null,
    resultReference: null,
    ...overrides,
  });
}

function recoveryInput() {
  return {
    actor: {
      userId: "admin-recovery-1",
      userEmail: "admin-recovery@example.test",
      userRole: "ADMIN" as const,
    },
  };
}

function renderJob(overrides: Record<string, unknown> = {}) {
  return {
    id: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
    serviceId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId,
    startCommand: SELVARA_FAILED_ACTIVATION_RECOVERY.renderStartCommand,
    status: "failed",
    createdAt: "2026-10-25T11:36:55.003319Z",
    startedAt: "2026-10-25T11:36:55.000Z",
    finishedAt: "2026-10-25T11:37:33.000Z",
    ...overrides,
  };
}

function renderLog(
  id: string,
  timestamp: string,
  message: string,
) {
  return {
    id,
    timestamp,
    message,
    labels: [{ name: "resource", value: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId }],
  };
}

interface RenderFetchOptions {
  readonly service?: Record<string, unknown>;
  readonly job?: Record<string, unknown>;
  readonly additionalJobs?: readonly Record<string, unknown>[];
  readonly firstLogPage?: Record<string, unknown>;
  readonly secondLogPage?: Record<string, unknown>;
  readonly failPath?: string;
}

function installRenderFetch(options: RenderFetchOptions = {}) {
  const exactJob = renderJob(options.job);
  const firstLogPage = options.firstLogPage ?? {
    hasMore: true,
    nextStartTime: "2026-10-25T11:37:27.000Z",
    nextEndTime: "2026-10-25T11:38:33.000Z",
    logs: [
      renderLog(
        "log-command",
        "2026-10-25T11:37:24.947090372Z",
        `==> Running '${SELVARA_FAILED_ACTIVATION_RECOVERY.renderStartCommand}'`,
      ),
      renderLog(
        "log-npm",
        "2026-10-25T11:37:25.443242773Z",
        "> concessioni-portuali@0.1.0 worker:async",
      ),
      renderLog(
        "log-process",
        "2026-10-25T11:37:25.443248853Z",
        "> tsx src/server/async-jobs/applicationWorkerProcess.ts",
      ),
    ],
  };
  const secondLogPage = options.secondLogPage ?? {
    hasMore: false,
    nextStartTime: "2026-10-25T11:37:27.000Z",
    nextEndTime: "2026-10-25T11:38:33.000Z",
    logs: [
      renderLog(
        "log-fatal",
        "2026-10-25T11:37:27.720728303Z",
        JSON.stringify({
          event: SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent,
          errorName: "ApplicationAsyncWorkerConfigurationError",
          errorCode: "INVALID_CONFIGURATION",
          timestamp: "2026-10-25T11:37:27.720Z",
        }),
      ),
    ],
  };
  const fetchMock = vi.fn(async (request: string | URL | Request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url,
    );
    if (options.failPath && url.pathname === options.failPath) {
      return new Response(JSON.stringify({ message: "failure" }), { status: 503 });
    }
    if (url.pathname === `/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}`) {
      return Response.json({
        id: SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId,
        ownerId: "tea-selvarapreview",
        suspended: "suspended",
        ...options.service,
      });
    }
    if (
      url.pathname
      === `/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}`
        + `/jobs/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId}`
    ) {
      return Response.json(exactJob);
    }
    if (
      url.pathname
      === `/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}/jobs`
    ) {
      if (url.searchParams.has("cursor")) return Response.json([]);
      return Response.json([
        { job: exactJob, cursor: "cursor-final" },
        ...(options.additionalJobs ?? []).map((job, index) => ({
          job,
          cursor: `cursor-additional-${index}`,
        })),
      ]);
    }
    if (url.pathname === "/v1/logs") {
      return Response.json(
        url.searchParams.get("startTime") === "2026-10-25T11:37:27.000Z"
          ? secondLogPage
          : firstLogPage,
      );
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("document analysis activation persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "RENDER_APPLICATION_WORKER_SERVICE_ID",
      SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId,
    );
    vi.stubEnv("RENDER_WORKER_API_KEY", "render-test-key");
    vi.stubEnv("DOCUMENT_WORKER_ACTIVATION_MODE", "DISABLED");
    vi.stubEnv("AI_REAL_DATA_ENABLED", "false");
    vi.stubEnv("ASYNC_PROVIDER_EXECUTION_ENABLED", "false");
    vi.stubEnv("AUTOMATIC_RESEARCH_EXECUTION_ENABLED", "false");
    vi.stubEnv("AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED", "false");
    installRenderFetch();
    harness.tx.$queryRaw.mockResolvedValue([eligibleJob()]);
    harness.tx.activityLog.findMany.mockResolvedValue([]);
    harness.tx.asyncJob.findMany.mockResolvedValue([]);
    harness.createAuditLogInTransaction.mockResolvedValue({ id: "audit-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("atomically reserves an eligible exact job under a row lock", async () => {
    await expect(beginDocumentAnalysisActivation(target)).resolves.toMatchObject({
      outcome: "RESERVED",
      snapshot: { state: "REQUESTING" },
    });

    const query = harness.tx.$queryRaw.mock.calls[0]?.[0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain('WHERE "id" =');
    expect(query.strings.join(" ")).toContain("FOR UPDATE");
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_ANALYSIS_ACTIVATION_REQUESTING",
        entitaId: target.applicationJobId,
      }),
    );
  });

  it("returns an existing persistent reservation without creating another", async () => {
    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REQUESTING")]);

    await expect(beginDocumentAnalysisActivation(target)).resolves.toEqual({
      outcome: "EXISTING",
      snapshot: {
        state: "REQUESTING",
        activationAttemptId: "a".repeat(32),
        renderJobId: null,
        failureCode: null,
      },
    });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it.each(["RUNNING", "SUCCEEDED", "TERMINAL_FAILED"] as const)(
    "does not reserve a %s job",
    async (status) => {
      harness.tx.$queryRaw.mockResolvedValue([eligibleJob({ status })]);
      await expect(beginDocumentAnalysisActivation(target)).rejects.toMatchObject({
        code: "TARGET_NOT_ELIGIBLE",
      });
      expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects operation, procedimento, tenant, and authority mismatches", async () => {
    for (const overrides of [
      { operation: "DOCUMENT_EXTRACTION_V1" },
      { procedimentoId: "procedure-other" },
      { tenantId: "tenant-other" },
      { actorId: "user-other" },
    ]) {
      vi.clearAllMocks();
      harness.tx.$queryRaw.mockResolvedValue([eligibleJob(overrides)]);
      harness.tx.activityLog.findMany.mockResolvedValue([]);
      await expect(beginDocumentAnalysisActivation(target))
        .rejects.toBeInstanceOf(DocumentAnalysisActivationTargetError);
      expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
    }
  });

  it("records confirmed, remote-unknown, and controlled reconciliation states", async () => {
    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REQUESTING")]);
    await expect(completeDocumentAnalysisActivation({
      target,
      activationAttemptId: "a".repeat(32),
      state: "CONFIRMED",
      renderJobId: "job-render123",
    })).resolves.toMatchObject({ state: "CONFIRMED", renderJobId: "job-render123" });

    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("REMOTE_UNKNOWN")]);
    await expect(reconcileDocumentAnalysisActivation({
      target,
      state: "FAILED_VERIFIED",
      failureCode: "RECONCILED_NO_REMOTE_JOB",
    })).resolves.toMatchObject({ state: "FAILED_VERIFIED" });

    expect(harness.createAuditLogInTransaction).toHaveBeenNthCalledWith(
      1,
      harness.tx,
      expect.objectContaining({ azione: "DOCUMENT_ANALYSIS_ACTIVATION_CONFIRMED" }),
    );
    expect(harness.createAuditLogInTransaction).toHaveBeenNthCalledWith(
      2,
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_ANALYSIS_ACTIVATION_FAILED_VERIFIED",
        metadata: expect.objectContaining({ reconciled: true }),
      }),
    );
  });

  it("does not allow the generic reconciler to recover a confirmed activation", async () => {
    harness.tx.activityLog.findMany.mockResolvedValue([activationLog("CONFIRMED")]);
    await expect(reconcileDocumentAnalysisActivation({
      target,
      state: "NOT_REQUESTED",
      failureCode: "RENDER_ONE_OFF_FAILED_BEFORE_WORKER_START",
    })).rejects.toMatchObject({ code: "ACTIVATION_STATE_CONFLICT" });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("recovers only the exact unclaimed Selvara job and appends verifiable evidence", async () => {
    const job = selvaraJob();
    harness.tx.$queryRaw.mockResolvedValue([job]);
    harness.tx.activityLog.findMany.mockResolvedValue([
      activationLog("CONFIRMED", {
        activationSequence: 2,
        renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
      }),
    ]);
    harness.tx.asyncJob.findMany.mockResolvedValue([job]);

    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .resolves.toMatchObject({
        state: "NOT_REQUESTED",
        renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
        failureCode: SELVARA_FAILED_ACTIVATION_RECOVERY.failureCode,
      });
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_ANALYSIS_ACTIVATION_NOT_REQUESTED",
        entitaId: SELVARA_FAILED_ACTIVATION_RECOVERY.applicationJobId,
        actor: recoveryInput().actor,
        metadata: expect.objectContaining({
          reconciled: true,
          renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
          failureCode: SELVARA_FAILED_ACTIVATION_RECOVERY.failureCode,
          recoveryEvidence: expect.objectContaining({
            approvalId: SELVARA_V3_RECOVERY_AUTHORIZATION.approvalId,
            renderServiceId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId,
            renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
            renderStatus: "failed",
            failureEvent: SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent,
            inspectedRenderJobCount: 1,
            inspectedLogEntryCount: 4,
            reason: "RENDER_CONFIGURATION_FAILURE_BEFORE_RUNTIME_CREATION",
          }),
        }),
      }),
    );
    const requestedUrls = vi.mocked(fetch).mock.calls.map(([request]) => String(request));
    expect(requestedUrls.filter((url) => url.includes("/jobs?"))).toHaveLength(2);
    expect(requestedUrls.filter((url) => url.includes("/v1/logs?"))).toHaveLength(2);
  });

  it.each([
    ["claimed application job", { attemptCount: 1, status: "RUNNING" }],
    ["wrong tenant", { tenantId: "tenant-other" }],
    ["V7 purpose", { purpose: "FASCICOLO_EXISTING_CORPUS_ANALYSIS_V7_CONTROLLED" }],
  ])("rejects recovery with %s", async (_label, jobOverrides) => {
    harness.tx.$queryRaw.mockResolvedValue([selvaraJob(jobOverrides)]);
    harness.tx.activityLog.findMany.mockResolvedValue([
      activationLog("CONFIRMED", {
        activationSequence: 2,
        renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
      }),
    ]);
    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toBeTruthy();
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["non-terminal job", { job: { status: "running", finishedAt: null } }],
    ["different job identity", { job: { id: "job-aaaaaaaaaaaaaaaaaaaa" } }],
    ["different start command", { job: { startCommand: "npm run worker:async" } }],
    ["service not suspended", { service: { suspended: "not_suspended" } }],
    [
      "Render API error",
      {
        failPath:
          `/v1/services/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderServiceId}`
          + `/jobs/${SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId}`,
      },
    ],
  ])("blocks before persistence for %s", async (_label, options) => {
    installRenderFetch(options);
    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toBeInstanceOf(SelvaraActivationRecoveryVerificationError);
    expect(harness.tx.$queryRaw).not.toHaveBeenCalled();
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("rejects another Render one-off targeting the same application job", async () => {
    installRenderFetch({
      additionalJobs: [renderJob({
        id: "job-bbbbbbbbbbbbbbbbbbbb",
        status: "running",
        finishedAt: null,
      })],
    });
    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toBeInstanceOf(SelvaraActivationRecoveryVerificationError);
    expect(harness.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    [
      "incomplete pagination",
      {
        firstLogPage: {
          hasMore: true,
          nextStartTime: "2026-10-25T11:37:27.000Z",
          nextEndTime: "2026-10-25T11:38:33.000Z",
          logs: [],
        },
      },
    ],
    [
      "missing fatal configuration event",
      {
        secondLogPage: {
          hasMore: false,
          nextStartTime: "2026-10-25T11:37:27.000Z",
          nextEndTime: "2026-10-25T11:38:33.000Z",
          logs: [],
        },
      },
    ],
    [
      "runtime start contradicting parser failure",
      {
        secondLogPage: {
          hasMore: false,
          nextStartTime: "2026-10-25T11:37:27.000Z",
          nextEndTime: "2026-10-25T11:38:33.000Z",
          logs: [
            renderLog(
              "log-fatal",
              "2026-10-25T11:37:27.720728303Z",
              JSON.stringify({
                event: SELVARA_FAILED_ACTIVATION_RECOVERY.failureEvent,
                errorName: "ApplicationAsyncWorkerConfigurationError",
                errorCode: "INVALID_CONFIGURATION",
                timestamp: "2026-10-25T11:37:27.720Z",
              }),
            ),
            renderLog(
              "log-started",
              "2026-10-25T11:37:28.000Z",
              JSON.stringify({ event: "ASYNC_WORKER_STARTED" }),
            ),
          ],
        },
      },
    ],
  ])("rejects logs with %s", async (_label, options) => {
    installRenderFetch(options);
    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toBeInstanceOf(SelvaraActivationRecoveryVerificationError);
    expect(harness.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects recovery unless the ledger is confirmed for the exact failed one-off", async () => {
    harness.tx.$queryRaw.mockResolvedValue([selvaraJob()]);
    harness.tx.activityLog.findMany.mockResolvedValue([
      activationLog("REMOTE_UNKNOWN", {
        activationSequence: 2,
        renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
      }),
    ]);

    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toMatchObject({ code: "ACTIVATION_STATE_CONFLICT" });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("rejects a competing active application job for the same Selvara corpus", async () => {
    const job = selvaraJob();
    harness.tx.$queryRaw.mockResolvedValue([job]);
    harness.tx.activityLog.findMany.mockResolvedValue([
      activationLog("CONFIRMED", {
        activationSequence: 2,
        renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
      }),
    ]);
    harness.tx.asyncJob.findMany.mockResolvedValue([
      job,
      { ...job, id: "competing-selvara-job" },
    ]);

    await expect(recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()))
      .rejects.toMatchObject({ code: "RECOVERY_COMPETING_WORK" });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("allows only one of two concurrent recovery attempts", async () => {
    const job = selvaraJob();
    harness.tx.$queryRaw.mockResolvedValue([job]);
    harness.tx.asyncJob.findMany.mockResolvedValue([job]);
    harness.tx.activityLog.findMany
      .mockResolvedValueOnce([
        activationLog("CONFIRMED", {
          activationSequence: 2,
          renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
        }),
      ])
      .mockResolvedValueOnce([
        activationLog("NOT_REQUESTED", {
          activationSequence: 3,
          renderJobId: SELVARA_FAILED_ACTIVATION_RECOVERY.renderJobId,
          failureCode: SELVARA_FAILED_ACTIVATION_RECOVERY.failureCode,
        }),
      ]);

    const results = await Promise.allSettled([
      recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()),
      recoverSelvaraFailedDocumentAnalysisActivation(recoveryInput()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledOnce();
  });
});

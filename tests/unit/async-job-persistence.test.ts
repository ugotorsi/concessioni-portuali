import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const harness = vi.hoisted(() => ({
  prisma: {
    asyncJob: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
  tx: {
    asyncJob: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: harness.prisma }));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: vi.fn() }));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn((callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx)),
}));

import {
  AsyncJobIdempotencyConflictError,
  AsyncJobLeaseConflictError,
  admitAsyncJob,
  admitAsyncJobInTransaction,
  claimNextAsyncJob,
  failAsyncJob,
  heartbeatAsyncJob,
  reconcileAsyncJobCancellationAfterLeaseConflict,
  requestAsyncJobCancellation,
  succeedAsyncJob,
} from "@/server/async-jobs/persistence";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";

const now = new Date("2026-09-13T10:00:00.000Z");

function admission() {
  return {
    operation: "GENERIC.TEST",
    logicalOperationId: "logical-1",
    purpose: "TEST",
    correlationId: "correlation-1",
    policyDecisionRef: "authorization-decision-1",
    inputReference: { referenceType: "FIXTURE", referenceId: "fixture-1" },
    maxAttempts: 3,
    availableAt: now,
    admission: {
      admissionType: "AUTHORIZED_SYSTEM" as const,
      tenantId: null,
      initiatingUserId: null,
      actor: { actorId: "test-system", actorEmail: null, actorRole: "SYSTEM" },
    },
  };
}

function running(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    idempotencyKey: "a".repeat(64),
    requestFingerprint: "b".repeat(64),
    operation: "GENERIC.TEST",
    correlationId: "correlation-1",
    status: "RUNNING",
    stateVersion: 2,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: "worker-1",
    leaseToken: "c".repeat(64),
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    inputReference: { referenceType: "FIXTURE", referenceId: "fixture-1" },
    ...overrides,
  };
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "AsyncJob", target: ["idempotencyKey"] },
  });
}

describe("B2C9 generic async job persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates once and reuses only an identical admission", async () => {
    harness.tx.asyncJob.findUnique.mockResolvedValueOnce(null);
    harness.tx.asyncJob.create.mockImplementationOnce(({ data }) => ({ id: "job-1", ...data }));
    const created = await admitAsyncJobInTransaction(harness.tx as never, admission());
    expect(created.outcome).toBe("CREATED");
    harness.tx.asyncJob.findUnique.mockResolvedValueOnce(created.job);
    expect((await admitAsyncJobInTransaction(harness.tx as never, admission())).outcome).toBe("REUSED");
    harness.tx.asyncJob.findUnique.mockResolvedValueOnce({ ...created.job, requestFingerprint: "f".repeat(64) });
    await expect(admitAsyncJobInTransaction(harness.tx as never, admission()))
      .rejects.toBeInstanceOf(AsyncJobIdempotencyConflictError);
  });

  it("reconciles an exact concurrent admission race through a fresh client", async () => {
    const normalized = normalizeAsyncJobAdmission(admission());
    harness.tx.asyncJob.findUnique.mockResolvedValueOnce(null);
    harness.tx.asyncJob.create.mockRejectedValueOnce(p2002());
    harness.prisma.asyncJob.findUnique.mockResolvedValueOnce({
      id: "winner-job",
      requestFingerprint: normalized.requestFingerprint,
    });
    await expect(admitAsyncJob(admission())).resolves.toMatchObject({ outcome: "REUSED" });
  });

  it("fails closed when a concurrent admission winner has different immutable input", async () => {
    harness.tx.asyncJob.findUnique.mockResolvedValueOnce(null);
    harness.tx.asyncJob.create.mockRejectedValueOnce(p2002());
    harness.prisma.asyncJob.findUnique.mockResolvedValueOnce({
      id: "conflicting-winner",
      requestFingerprint: "f".repeat(64),
    });
    await expect(admitAsyncJob(admission())).rejects.toBeInstanceOf(AsyncJobIdempotencyConflictError);
  });

  it("claims atomically after recovering expired cancellation and exhausted leases", async () => {
    const job = running();
    harness.tx.$executeRaw.mockResolvedValue(1);
    harness.tx.$queryRaw.mockResolvedValue([job]);
    await expect(claimNextAsyncJob({ workerId: "worker-1", leaseDurationMs: 60_000 })).resolves.toBe(job);
    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(harness.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not make a queued job claimable before availableAt", async () => {
    harness.tx.$executeRaw.mockResolvedValue(0);
    harness.tx.$queryRaw.mockResolvedValue([]);

    await expect(claimNextAsyncJob({ workerId: "worker-1", leaseDurationMs: 60_000 }))
      .resolves.toBeNull();

    const claimQuery = harness.tx.$queryRaw.mock.calls.at(-1)?.[0] as { strings: readonly string[] };
    expect(claimQuery.strings.join(" ")).toContain(
      `"status" IN ('QUEUED', 'RETRY_WAIT') AND "availableAt" <= CURRENT_TIMESTAMP`,
    );
  });

  it("rejects stale lease tokens for heartbeat and success", async () => {
    harness.prisma.$executeRaw.mockResolvedValue(0);
    const lease = { jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64) };
    await expect(heartbeatAsyncJob({ ...lease, leaseDurationMs: 60_000 })).rejects.toBeInstanceOf(AsyncJobLeaseConflictError);
    await expect(succeedAsyncJob({
      ...lease,
      resultReference: { referenceType: "RESULT", referenceId: "result-1" },
    }))
      .rejects.toBeInstanceOf(AsyncJobLeaseConflictError);
  });

  it("schedules retry with sanitized failure metadata before exhaustion", async () => {
    const hook = vi.fn();
    harness.tx.$queryRaw.mockResolvedValue([{ attemptCount: 1, maxAttempts: 3 }]);
    harness.tx.$executeRaw.mockResolvedValue(1);
    const result = await failAsyncJob({
      jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64),
      failure: { retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" },
      retryDelayMs: 5_000,
      beforeTerminalFailureInTransaction: hook,
    });
    expect(result.outcome).toBe("RETRY_SCHEDULED");
    expect(harness.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(harness.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(hook).not.toHaveBeenCalled();
  });

  it("terminally fails when retry attempts are exhausted", async () => {
    harness.tx.$queryRaw.mockResolvedValue([{ attemptCount: 3, maxAttempts: 3 }]);
    harness.tx.$executeRaw.mockResolvedValue(1);
    const result = await failAsyncJob({
      jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64),
      failure: { retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" },
      retryDelayMs: 5_000,
    });
    expect(result.outcome).toBe("TERMINAL_FAILED");
  });

  it("runs an optional terminal hook in the failure transaction", async () => {
    const job = running({ attemptCount: 2, maxAttempts: 2 });
    const hook = vi.fn(async (tx) => {
      expect(tx).toBe(harness.tx);
      return { outcome: "TERMINAL_FAILED" as const };
    });
    harness.tx.$queryRaw.mockResolvedValue([job]);
    harness.tx.$executeRaw.mockResolvedValue(1);
    await expect(failAsyncJob({
      jobId: job.id,
      workerId: "worker-1",
      leaseToken: job.leaseToken,
      failure: { retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" },
      retryDelayMs: 5_000,
      beforeTerminalFailureInTransaction: hook,
    })).resolves.toEqual({ outcome: "TERMINAL_FAILED" });
    expect(hook).toHaveBeenCalledOnce();
  });

  it("does not write terminal state when the terminal hook fails", async () => {
    const job = running({ attemptCount: 2, maxAttempts: 2 });
    const hookFailure = new Error("DOMAIN_TERMINALIZATION_UNAVAILABLE");
    harness.tx.$queryRaw.mockResolvedValue([job]);
    await expect(failAsyncJob({
      jobId: job.id,
      workerId: "worker-1",
      leaseToken: job.leaseToken,
      failure: { retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" },
      retryDelayMs: 5_000,
      beforeTerminalFailureInTransaction: vi.fn(async () => { throw hookFailure; }),
    })).rejects.toBe(hookFailure);
    expect(harness.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("recovers an already-persisted domain success instead of terminal failure", async () => {
    const job = running({ attemptCount: 2, maxAttempts: 2 });
    harness.tx.$queryRaw.mockResolvedValue([job]);
    harness.tx.$executeRaw.mockResolvedValue(1);
    await expect(failAsyncJob({
      jobId: job.id,
      workerId: "worker-1",
      leaseToken: job.leaseToken,
      failure: { retryable: true, category: "TRANSIENT", code: "DEPENDENCY_TIMEOUT" },
      retryDelayMs: 5_000,
      beforeTerminalFailureInTransaction: vi.fn(async () => ({
        outcome: "SUCCEEDED" as const,
        resultReference: {
          referenceType: "FIXTURE_RESULT",
          referenceId: "result-1",
          metadata: { outcomeCode: "DONE" },
        },
      })),
    })).resolves.toEqual({ outcome: "SUCCEEDED" });
  });

  it("rolls back guarded expired-lease terminalization and continues claiming", async () => {
    const expired = running({ operation: "GUARDED.TEST", attemptCount: 2, maxAttempts: 2 });
    const next = running({ id: "job-2", operation: "GENERIC.TEST" });
    const hook = vi.fn(async () => { throw new Error("DOMAIN_HOOK_UNAVAILABLE"); });
    harness.prisma.$queryRaw.mockResolvedValue([{ id: expired.id, operation: expired.operation }]);
    harness.tx.$queryRaw
      .mockResolvedValueOnce([expired])
      .mockResolvedValueOnce([expired])
      .mockResolvedValueOnce([next]);
    harness.tx.$executeRaw.mockResolvedValue(1);
    await expect(claimNextAsyncJob({
      workerId: "worker-1",
      leaseDurationMs: 60_000,
      resolveTerminalFailureHook: (operation) => operation === expired.operation ? hook : undefined,
    })).resolves.toBe(next);
    expect(hook).toHaveBeenCalledOnce();
    expect(harness.tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it.each([
    ["QUEUED", "CANCELLED"],
    ["RETRY_WAIT", "CANCELLED"],
    ["RUNNING", "REQUESTED"],
  ])("applies cancellation semantics from %s", async (status, outcome) => {
    harness.tx.asyncJob.findUnique.mockResolvedValue(running({ status }));
    harness.tx.$executeRaw.mockResolvedValue(1);
    harness.tx.asyncJob.findUniqueOrThrow.mockResolvedValue(running({ status: outcome }));
    await expect(requestAsyncJobCancellation("job-1")).resolves.toMatchObject({ outcome });
  });

  it.each([
    [{ status: "CANCELLATION_REQUESTED", stateVersion: 3, leaseOwnerMatches: true, leaseTokenMatches: true, leaseIsValid: true }, "CURRENT_LEASE_CANCELLATION_REQUESTED"],
    [{ status: "RUNNING", stateVersion: 3, leaseOwnerMatches: false, leaseTokenMatches: false, leaseIsValid: true }, "LEASE_AUTHORITY_LOST"],
    [{ status: "CANCELLATION_REQUESTED", stateVersion: 3, leaseOwnerMatches: true, leaseTokenMatches: true, leaseIsValid: false }, "LEASE_AUTHORITY_LOST"],
    [{ status: "RUNNING", stateVersion: 2, leaseOwnerMatches: true, leaseTokenMatches: true, leaseIsValid: true }, "NOT_RECONCILABLE"],
    [{ status: "TERMINAL_FAILED", stateVersion: 3, leaseOwnerMatches: false, leaseTokenMatches: false, leaseIsValid: false }, "LEASE_AUTHORITY_LOST"],
  ])("classifies cancellation reconciliation without granting stale authority", async (row, outcome) => {
    harness.prisma.$queryRaw.mockResolvedValue([row]);
    await expect(reconcileAsyncJobCancellationAfterLeaseConflict({
      jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64),
    })).resolves.toBe(outcome);
    const query = harness.prisma.$queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).toContain('"leaseExpiresAt" > CURRENT_TIMESTAMP');
  });

  it.each([
    ["expiry cleanup at N+2", 4],
    ["another legitimate terminal cancellation", 17],
  ])("observes terminal cancellation after %s without inferring lease authority", async (_source, stateVersion) => {
    harness.prisma.$queryRaw.mockResolvedValue([{
      status: "CANCELLED",
      stateVersion,
      leaseOwnerMatches: false,
      leaseTokenMatches: false,
      leaseIsValid: false,
    }]);
    await expect(reconcileAsyncJobCancellationAfterLeaseConflict({
      jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64),
    })).resolves.toBe("TERMINAL_CANCELLED_OBSERVED");
    const query = harness.prisma.$queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(query.strings.join(" ")).not.toContain('"stateVersion"');
    expect(harness.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("treats a missing job as lost lease authority", async () => {
    harness.prisma.$queryRaw.mockResolvedValue([]);
    await expect(reconcileAsyncJobCancellationAfterLeaseConflict({
      jobId: "job-1", workerId: "worker-1", leaseToken: "c".repeat(64),
    })).resolves.toBe("LEASE_AUTHORITY_LOST");
  });
});
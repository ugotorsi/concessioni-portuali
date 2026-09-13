import { beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => {
  class MockLeaseConflictError extends Error {}
  return {
    AsyncJobLeaseConflictError: MockLeaseConflictError,
    claimNextAsyncJob: vi.fn(),
    failAsyncJob: vi.fn(),
    finalizeAsyncJobCancellation: vi.fn(),
    heartbeatAsyncJob: vi.fn(),
    isAsyncJobCancellationRequested: vi.fn(),
    reconcileAsyncJobCancellationAfterLeaseConflict: vi.fn(),
    succeedAsyncJob: vi.fn(),
  };
});

vi.mock("@/server/async-jobs/persistence", () => persistence);

import { AsyncJobHandlerRegistry } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError, drainOneAsyncJob } from "@/server/async-jobs/worker";

const claimed = {
  id: "job-1",
  operation: "GENERIC.TEST",
  correlationId: "correlation-1",
  attemptCount: 1,
  stateVersion: 2,
  leaseToken: "c".repeat(64),
  inputReference: { referenceType: "FIXTURE", referenceId: "fixture-1", referenceVersion: null, metadata: {} },
};

describe("B2C9 generic async job worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistence.claimNextAsyncJob.mockResolvedValue(claimed);
    persistence.isAsyncJobCancellationRequested.mockResolvedValue(false);
    persistence.failAsyncJob.mockResolvedValue({ outcome: "TERMINAL_FAILED" });
  });

  it("fails closed for unknown operations without invoking a workload", async () => {
    const result = await drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000,
      registry: new AsyncJobHandlerRegistry(),
    });
    expect(result.outcome).toBe("TERMINAL_FAILED");
    expect(persistence.failAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      failure: { retryable: false, category: "DISPATCH", code: "UNKNOWN_OPERATION" },
    }));
  });

  it("validates persisted input at the operation boundary", async () => {
    const execute = vi.fn();
    const registry = new AsyncJobHandlerRegistry([{ operation: "GENERIC.TEST", parseInput: () => { throw new Error(); }, execute }]);
    await drainOneAsyncJob({ workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry });
    expect(execute).not.toHaveBeenCalled();
    expect(persistence.failAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      failure: { retryable: false, category: "VALIDATION", code: "INVALID_HANDLER_INPUT" },
    }));
  });

  it("lets cancellation win a race with unknown-operation failure", async () => {
    persistence.isAsyncJobCancellationRequested.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    persistence.failAsyncJob.mockRejectedValueOnce(new persistence.AsyncJobLeaseConflictError());
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000,
      registry: new AsyncJobHandlerRegistry(),
    })).resolves.toEqual({ outcome: "CANCELLED", jobId: "job-1" });
    expect(persistence.finalizeAsyncJobCancellation).toHaveBeenCalledOnce();
  });

  it("executes an allowlisted handler and persists only bounded result metadata", async () => {
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value): { referenceId: string } => value as { referenceId: string },
      execute: async (value: { referenceId: string }, context) => ({
        referenceType: "FIXTURE_RESULT",
        referenceId: value.referenceId,
        metadata: { attemptCount: context.attempt },
      }),
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "SUCCEEDED", jobId: "job-1" });
    expect(persistence.succeedAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      resultReference: { referenceType: "FIXTURE_RESULT", referenceId: "fixture-1", metadata: { attemptCount: 1 } },
    }));
  });

  it("leaves a successful workload recoverable when success persistence fails", async () => {
    const persistenceFailure = new Error("SUCCESS_PERSISTENCE_UNAVAILABLE");
    persistence.succeedAsyncJob.mockRejectedValueOnce(persistenceFailure);
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value) => value,
      execute: async () => ({ referenceType: "FIXTURE_RESULT", referenceId: "result-1" }),
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).rejects.toBe(persistenceFailure);
    expect(persistence.failAsyncJob).not.toHaveBeenCalled();
  });

  it("forwards an operation terminal hook only to terminal failure persistence", async () => {
    const hook = vi.fn();
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("DEPENDENCY", "FAILURE", false); },
      beforeTerminalFailureInTransaction: hook,
    }]);
    await drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    });
    expect(persistence.failAsyncJob).toHaveBeenCalledWith(expect.objectContaining({
      beforeTerminalFailureInTransaction: hook,
    }));
  });

  it("maps explicit retryable handler failures without persisting exception text", async () => {
    persistence.failAsyncJob.mockResolvedValue({ outcome: "RETRY_SCHEDULED" });
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("DEPENDENCY", "TIMEOUT", true); },
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "RETRY_SCHEDULED", jobId: "job-1" });
  });

  it("cooperatively finalizes cancellation observed after execution", async () => {
    persistence.isAsyncJobCancellationRequested.mockResolvedValue(true);
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value) => value,
      execute: async () => ({ referenceType: "FIXTURE_RESULT", referenceId: "ignored" }),
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "CANCELLED", jobId: "job-1" });
    expect(persistence.finalizeAsyncJobCancellation).toHaveBeenCalledOnce();
    expect(persistence.succeedAsyncJob).not.toHaveBeenCalled();
  });

  it.each([
    [true, "RETRY_SCHEDULED"],
    [false, "TERMINAL_FAILED"],
  ])("lets current-lease cancellation win a %s handler-failure race", async (retryable) => {
    persistence.isAsyncJobCancellationRequested.mockResolvedValue(false);
    persistence.failAsyncJob.mockRejectedValueOnce(new persistence.AsyncJobLeaseConflictError());
    persistence.reconcileAsyncJobCancellationAfterLeaseConflict
      .mockResolvedValueOnce("CURRENT_LEASE_CANCELLATION_REQUESTED");
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST",
      parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("DEPENDENCY", "FAILURE", retryable); },
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "CANCELLED", jobId: "job-1" });
    expect(persistence.finalizeAsyncJobCancellation).toHaveBeenCalledOnce();
    expect(persistence.succeedAsyncJob).not.toHaveBeenCalled();
  });

  it.each([
    "expiry cleanup at N+2",
    "another legitimate worker or action",
  ])("observes terminal cancellation from %s without another mutation", async () => {
    persistence.failAsyncJob.mockRejectedValueOnce(new persistence.AsyncJobLeaseConflictError());
    persistence.reconcileAsyncJobCancellationAfterLeaseConflict.mockResolvedValueOnce("TERMINAL_CANCELLED_OBSERVED");
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST", parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("INTERNAL", "FAILURE", false); },
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "CANCELLED", jobId: "job-1" });
    expect(persistence.finalizeAsyncJobCancellation).not.toHaveBeenCalled();
    expect(persistence.succeedAsyncJob).not.toHaveBeenCalled();
    expect(persistence.failAsyncJob).toHaveBeenCalledOnce();
  });

  it.each(["LEASE_AUTHORITY_LOST", "NOT_RECONCILABLE"])(
    "fails closed when handler-failure reconciliation returns %s",
    async (reconciliation) => {
      const conflict = new persistence.AsyncJobLeaseConflictError();
      persistence.failAsyncJob.mockRejectedValueOnce(conflict);
      persistence.reconcileAsyncJobCancellationAfterLeaseConflict.mockResolvedValueOnce(reconciliation);
      const registry = new AsyncJobHandlerRegistry([{
        operation: "GENERIC.TEST", parseInput: (value) => value,
        execute: async () => { throw new AsyncJobExecutionError("INTERNAL", "FAILURE", false); },
      }]);
      await expect(drainOneAsyncJob({
        workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
      })).rejects.toBe(conflict);
      expect(persistence.finalizeAsyncJobCancellation).not.toHaveBeenCalled();
    },
  );

  it("reconciles cancellation finalized concurrently after current-lease proof", async () => {
    persistence.failAsyncJob.mockRejectedValueOnce(new persistence.AsyncJobLeaseConflictError());
    persistence.finalizeAsyncJobCancellation.mockRejectedValueOnce(new persistence.AsyncJobLeaseConflictError());
    persistence.reconcileAsyncJobCancellationAfterLeaseConflict
      .mockResolvedValueOnce("CURRENT_LEASE_CANCELLATION_REQUESTED")
      .mockResolvedValueOnce("TERMINAL_CANCELLED_OBSERVED");
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST", parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("INTERNAL", "FAILURE", false); },
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).resolves.toEqual({ outcome: "CANCELLED", jobId: "job-1" });
  });

  it("does not reinterpret a non-lease persistence error as cancellation", async () => {
    const persistenceError = new Error("PERSISTENCE_UNAVAILABLE");
    persistence.failAsyncJob.mockRejectedValueOnce(persistenceError);
    const registry = new AsyncJobHandlerRegistry([{
      operation: "GENERIC.TEST", parseInput: (value) => value,
      execute: async () => { throw new AsyncJobExecutionError("INTERNAL", "FAILURE", false); },
    }]);
    await expect(drainOneAsyncJob({
      workerId: "worker-1", leaseDurationMs: 60_000, retryDelayMs: 1_000, registry,
    })).rejects.toBe(persistenceError);
    expect(persistence.reconcileAsyncJobCancellationAfterLeaseConflict).not.toHaveBeenCalled();
    expect(persistence.finalizeAsyncJobCancellation).not.toHaveBeenCalled();
  });

  it("rejects duplicate operation registrations", () => {
    const handler = { operation: "GENERIC.TEST", parseInput: (value: unknown) => value, execute: async () => ({}) };
    expect(() => new AsyncJobHandlerRegistry([handler, handler])).toThrow("DUPLICATE_ASYNC_JOB_HANDLER");
  });
});
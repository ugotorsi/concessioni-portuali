import {
  AsyncJobLeaseConflictError,
  claimNextAsyncJob,
  failAsyncJob,
  finalizeAsyncJobCancellation,
  heartbeatAsyncJob,
  isAsyncJobCancellationRequested,
  reconcileAsyncJobCancellationAfterLeaseConflict,
  succeedAsyncJob,
} from "./persistence";
import { asyncJobHandlerRegistry, type AsyncJobHandlerRegistry } from "./registry";

export class AsyncJobExecutionError extends Error {
  constructor(
    readonly category: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AsyncJobExecutionError";
  }
}

export interface DrainOneAsyncJobInput {
  workerId: string;
  leaseDurationMs: number;
  retryDelayMs: number;
  registry?: AsyncJobHandlerRegistry;
}

export type DrainOneAsyncJobOutcome =
  | { outcome: "IDLE" }
  | { outcome: "SUCCEEDED" | "RETRY_SCHEDULED" | "TERMINAL_FAILED" | "CANCELLED"; jobId: string };

export async function drainOneAsyncJob(input: DrainOneAsyncJobInput): Promise<DrainOneAsyncJobOutcome> {
  const registry = input.registry ?? asyncJobHandlerRegistry;
  const claimed = await claimNextAsyncJob({
    workerId: input.workerId,
    leaseDurationMs: input.leaseDurationMs,
    resolveTerminalFailureHook: registry.hasTerminalFailureHooks()
      ? (operation) => registry.resolve(operation)?.beforeTerminalFailureInTransaction
      : undefined,
  });
  if (!claimed) return { outcome: "IDLE" };
  const lease = () => ({
    jobId: claimed.id,
    workerId: input.workerId,
    leaseToken: claimed.leaseToken!,
  });
  const failDispatch = async (
    category: string,
    code: string,
    beforeTerminalFailureInTransaction = registry.resolve(claimed.operation)?.beforeTerminalFailureInTransaction,
  ): Promise<DrainOneAsyncJobOutcome> => {
    try {
      if (await isAsyncJobCancellationRequested(lease())) {
        await finalizeAsyncJobCancellation(lease());
        return { outcome: "CANCELLED", jobId: claimed.id };
      }
      const failed = await failAsyncJob({
        ...lease(),
        failure: { retryable: false, category, code },
        retryDelayMs: input.retryDelayMs,
        beforeTerminalFailureInTransaction,
      });
      return { outcome: failed.outcome, jobId: claimed.id };
    } catch (error) {
      if (
        error instanceof AsyncJobLeaseConflictError
        && await isAsyncJobCancellationRequested(lease())
      ) {
        await finalizeAsyncJobCancellation(lease());
        return { outcome: "CANCELLED", jobId: claimed.id };
      }
      throw error;
    }
  };
  const handler = registry.resolve(claimed.operation);
  if (!handler) {
    return failDispatch("DISPATCH", "UNKNOWN_OPERATION");
  }
  let parsedInput: unknown;
  try {
    parsedInput = handler.parseInput(claimed.inputReference);
  } catch {
    return failDispatch("VALIDATION", "INVALID_HANDLER_INPUT");
  }
  let result: unknown;
  try {
    result = await handler.execute(parsedInput, {
      jobId: claimed.id,
      correlationId: claimed.correlationId,
      attempt: claimed.attemptCount,
      isCancellationRequested: () => isAsyncJobCancellationRequested(lease()),
      heartbeat: () => heartbeatAsyncJob({ ...lease(), leaseDurationMs: input.leaseDurationMs }),
    });
  } catch (error) {
    if (await isAsyncJobCancellationRequested(lease())) {
      await finalizeAsyncJobCancellation(lease());
      return { outcome: "CANCELLED", jobId: claimed.id };
    }
    const failure = error instanceof AsyncJobExecutionError
      ? error
      : new AsyncJobExecutionError("INTERNAL", "UNHANDLED_ERROR", false);
    try {
      const failed = await failAsyncJob({
        ...lease(),
        failure: { retryable: failure.retryable, category: failure.category, code: failure.code },
        retryDelayMs: input.retryDelayMs,
        beforeTerminalFailureInTransaction: handler.beforeTerminalFailureInTransaction,
      });
      return { outcome: failed.outcome, jobId: claimed.id };
    } catch (failurePersistenceError) {
      if (!(failurePersistenceError instanceof AsyncJobLeaseConflictError)) {
        throw failurePersistenceError;
      }
      const reconcile = () => reconcileAsyncJobCancellationAfterLeaseConflict(lease());
      const reconciliation = await reconcile();
      if (reconciliation === "TERMINAL_CANCELLED_OBSERVED") {
        return { outcome: "CANCELLED", jobId: claimed.id };
      }
      if (reconciliation !== "CURRENT_LEASE_CANCELLATION_REQUESTED") {
        throw failurePersistenceError;
      }
      try {
        await finalizeAsyncJobCancellation(lease());
      } catch (finalizationError) {
        if (
          !(finalizationError instanceof AsyncJobLeaseConflictError)
          || await reconcile() !== "TERMINAL_CANCELLED_OBSERVED"
        ) {
          throw finalizationError;
        }
      }
      return { outcome: "CANCELLED", jobId: claimed.id };
    }
  }
  if (await isAsyncJobCancellationRequested(lease())) {
    await finalizeAsyncJobCancellation(lease());
    return { outcome: "CANCELLED", jobId: claimed.id };
  }
  await succeedAsyncJob({ ...lease(), resultReference: result ?? {} });
  return { outcome: "SUCCEEDED", jobId: claimed.id };
}
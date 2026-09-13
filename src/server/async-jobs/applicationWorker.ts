import { AsyncJobHandlerRegistry } from "./registry";
import { drainOneAsyncJob } from "./worker";
import { createNeutralIntakeClassificationHandler } from "../intake/neutralIntakeClassificationJob";
import { createNeutralIntakeExtractionHandler } from "../intake/neutralIntakeExtractionJob";

const APPLICATION_ASYNC_JOB_LEASE_MS = 5 * 60 * 1_000;

export const applicationAsyncJobRegistry = new AsyncJobHandlerRegistry([
  createNeutralIntakeExtractionHandler(),
  createNeutralIntakeClassificationHandler(),
]);

export function drainOneApplicationAsyncJob(input: {
  workerId: string;
  retryDelayMs: number;
}) {
  return drainOneAsyncJob({
    ...input,
    leaseDurationMs: APPLICATION_ASYNC_JOB_LEASE_MS,
    registry: applicationAsyncJobRegistry,
  });
}
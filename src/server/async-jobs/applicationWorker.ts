import { AsyncJobHandlerRegistry } from "./registry";
import { drainOneAsyncJob } from "./worker";
import { createNeutralIntakeClassificationHandler } from "../intake/neutralIntakeClassificationJob";
import { createNeutralIntakeExtractionHandler } from "../intake/neutralIntakeExtractionJob";
import { createLegalReferenceDiscoveryHandler } from "../intake/neutralIntakeLegalReferenceDiscoveryJob";
import { createLegalReferenceMatchingHandler } from "../intake/neutralIntakeLegalReferenceMatchingJob";
import { createLegalReferenceOfficialLookupHandler } from "../intake/neutralIntakeLegalReferenceOfficialLookupJob";
import { createLegalReferenceOfficialReconciliationHandler } from "../intake/neutralIntakeLegalReferenceOfficialReconciliationJob";
import { createFascicoloReevaluationHandler } from "../fascicolo-lifecycle/fascicoloReevaluationJob";
import { createConcessioneTimeWatchHandler } from "../fascicolo-lifecycle/concessioneTimeWatchJob";

const APPLICATION_ASYNC_JOB_LEASE_MS = 5 * 60 * 1_000;

export const applicationAsyncJobRegistry = new AsyncJobHandlerRegistry([
  createNeutralIntakeExtractionHandler(),
  createNeutralIntakeClassificationHandler(),
  createLegalReferenceDiscoveryHandler(),
  createLegalReferenceMatchingHandler(),
  createLegalReferenceOfficialLookupHandler(),
  createLegalReferenceOfficialReconciliationHandler(),
  createFascicoloReevaluationHandler(),
  createConcessioneTimeWatchHandler(),
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
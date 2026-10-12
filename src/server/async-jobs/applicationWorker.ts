import { AsyncJobHandlerRegistry } from "./registry";
import { drainOneAsyncJob } from "./worker";
import { createNeutralIntakeClassificationHandler } from "../intake/neutralIntakeClassificationJob";
import { createNeutralIntakeExtractionHandler } from "../intake/neutralIntakeExtractionJob";
import {
  createFascicoloAutomaticAnalysisHandler,
  type FascicoloAutomaticAnalysisDependencies,
} from "../ai/fascicoloAutomaticAnalysisJob";
import { createLegalReferenceDiscoveryHandler } from "../intake/neutralIntakeLegalReferenceDiscoveryJob";
import { createLegalReferenceMatchingHandler } from "../intake/neutralIntakeLegalReferenceMatchingJob";
import { createLegalReferenceOfficialLookupHandler } from "../intake/neutralIntakeLegalReferenceOfficialLookupJob";
import { createLegalReferenceOfficialReconciliationHandler } from "../intake/neutralIntakeLegalReferenceOfficialReconciliationJob";
import { createFascicoloReevaluationHandler } from "../fascicolo-lifecycle/fascicoloReevaluationJob";
import {
  createConcessioneTimeWatchHandler,
  createConcessioneTimeWatchV2Handler,
} from "../fascicolo-lifecycle/concessioneTimeWatchJob";
import {
  createAutomaticResearchExecutionHandler,
  reconcilePendingAutomaticResearchExecutions,
  type AutomaticResearchExecutionDependencies,
} from "../legal-research/automatic-research-job";
import { createDocumentExtractionHandler } from "../documents/documentExtractionJob";

const APPLICATION_ASYNC_JOB_LEASE_MS = 5 * 60 * 1_000;
const PROVIDER_BACKED_OPERATIONS = [
  "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
  "LEGAL_RESEARCH.EXECUTE_V1",
] as const;
const AUTOMATIC_RESEARCH_OPERATION = "LEGAL_RESEARCH.EXECUTE_V1";

export function createApplicationAsyncJobRegistry(input: {
  automaticAnalysisDependencies?: FascicoloAutomaticAnalysisDependencies;
  automaticResearchDependencies?: Partial<AutomaticResearchExecutionDependencies>;
} = {}) {
  return new AsyncJobHandlerRegistry([
    createDocumentExtractionHandler(),
    createNeutralIntakeExtractionHandler(),
    createFascicoloAutomaticAnalysisHandler(input.automaticAnalysisDependencies),
    createAutomaticResearchExecutionHandler(input.automaticResearchDependencies),
    createNeutralIntakeClassificationHandler(),
    createLegalReferenceDiscoveryHandler(),
    createLegalReferenceMatchingHandler(),
    createLegalReferenceOfficialLookupHandler(),
    createLegalReferenceOfficialReconciliationHandler(),
    createFascicoloReevaluationHandler(),
    createConcessioneTimeWatchHandler(),
    createConcessioneTimeWatchV2Handler(),
  ]);
}

export const applicationAsyncJobRegistry = createApplicationAsyncJobRegistry();

export async function drainOneApplicationAsyncJob(input: {
  workerId: string;
  retryDelayMs: number;
  operationAllowlist?: readonly string[];
  procedimentoAllowlist?: readonly string[];
  providerExecutionEnabled?: boolean;
}) {
  if (
    !input.operationAllowlist?.length
    || input.operationAllowlist.includes(AUTOMATIC_RESEARCH_OPERATION)
  ) {
    await reconcilePendingAutomaticResearchExecutions();
  }
  return drainOneAsyncJob({
    ...input,
    operationBlocklist: input.providerExecutionEnabled === false ? PROVIDER_BACKED_OPERATIONS : undefined,
    leaseDurationMs: APPLICATION_ASYNC_JOB_LEASE_MS,
    registry: applicationAsyncJobRegistry,
  });
}
import {
  ApplicationAsyncWorkerConfigurationError,
  type ApplicationAsyncWorkerConfig,
} from "./applicationWorkerRuntime";
import { AsyncJobHandlerRegistry } from "./registry";
import { drainOneAsyncJob, type DrainOneAsyncJobOutcome } from "./worker";
import {
  createDocumentExtractionHandler,
  DOCUMENT_EXTRACTION_OPERATION,
} from "../documents/documentExtractionJob";

const DOCUMENT_EXTRACTION_WORKER_LEASE_MS = 5 * 60 * 1_000;

export const documentExtractionAsyncJobRegistry = new AsyncJobHandlerRegistry([
  createDocumentExtractionHandler(),
]);

const DOCUMENT_EXTRACTION_OPERATIONS = new Set<string>([
  DOCUMENT_EXTRACTION_OPERATION,
]);

function hasDocumentExtractionOnlyAllowlist(operationAllowlist: readonly string[]): boolean {
  return operationAllowlist.length > 0
    && operationAllowlist.every((operation) => DOCUMENT_EXTRACTION_OPERATIONS.has(operation));
}

export function assertDocumentExtractionWorkerConfig(
  config: ApplicationAsyncWorkerConfig,
): void {
  if (
    !config.dedicatedMode
    || !hasDocumentExtractionOnlyAllowlist(config.operationAllowlist)
    || config.procedimentoAllowlist.length === 0
    || config.providerExecutionEnabled !== false
  ) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
}

export async function drainOneDocumentExtractionAsyncJob(input: {
  workerId: string;
  retryDelayMs: number;
  operationAllowlist: readonly string[];
  procedimentoAllowlist: readonly string[];
  providerExecutionEnabled?: boolean;
}): Promise<DrainOneAsyncJobOutcome> {
  if (
    !hasDocumentExtractionOnlyAllowlist(input.operationAllowlist)
    || input.procedimentoAllowlist.length === 0
    || input.providerExecutionEnabled !== false
  ) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return drainOneAsyncJob({
    workerId: input.workerId,
    retryDelayMs: input.retryDelayMs,
    leaseDurationMs: DOCUMENT_EXTRACTION_WORKER_LEASE_MS,
    operationAllowlist: input.operationAllowlist,
    procedimentoAllowlist: input.procedimentoAllowlist,
    registry: documentExtractionAsyncJobRegistry,
  });
}

import {
  ApplicationAsyncWorkerConfigurationError,
  type ApplicationAsyncWorkerConfig,
} from "./applicationWorkerRuntime";
import { AsyncJobHandlerRegistry } from "./registry";
import { drainOneAsyncJob, type DrainOneAsyncJobOutcome } from "./worker";
import {
  createDocumentOcrCoordinatorHandler,
  createDocumentOcrPageBatchHandler,
  DOCUMENT_OCR_COORDINATOR_OPERATION,
  DOCUMENT_OCR_PAGE_BATCH_OPERATION,
} from "../documents/documentOcrExtractionJob";

const DOCUMENT_OCR_WORKER_LEASE_MS = 5 * 60 * 1_000;
const DOCUMENT_OCR_OPERATIONS = new Set<string>([
  DOCUMENT_OCR_COORDINATOR_OPERATION,
  DOCUMENT_OCR_PAGE_BATCH_OPERATION,
]);

export const documentOcrAsyncJobRegistry = new AsyncJobHandlerRegistry([
  createDocumentOcrCoordinatorHandler(),
  createDocumentOcrPageBatchHandler(),
]);

function hasOcrOnlyAllowlist(operationAllowlist: readonly string[]): boolean {
  return operationAllowlist.length > 0
    && operationAllowlist.every((operation) => DOCUMENT_OCR_OPERATIONS.has(operation));
}

export function assertDocumentOcrWorkerConfig(
  config: ApplicationAsyncWorkerConfig,
): void {
  if (
    !config.dedicatedMode
    || config.concurrency !== 1
    || !hasOcrOnlyAllowlist(config.operationAllowlist)
    || config.procedimentoAllowlist.length === 0
    || config.providerExecutionEnabled !== false
  ) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
}

export async function drainOneDocumentOcrAsyncJob(input: {
  workerId: string;
  retryDelayMs: number;
  operationAllowlist: readonly string[];
  procedimentoAllowlist: readonly string[];
  providerExecutionEnabled?: boolean;
}): Promise<DrainOneAsyncJobOutcome> {
  if (
    !hasOcrOnlyAllowlist(input.operationAllowlist)
    || input.procedimentoAllowlist.length === 0
    || input.providerExecutionEnabled !== false
  ) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return drainOneAsyncJob({
    workerId: input.workerId,
    retryDelayMs: input.retryDelayMs,
    leaseDurationMs: DOCUMENT_OCR_WORKER_LEASE_MS,
    operationAllowlist: input.operationAllowlist,
    procedimentoAllowlist: input.procedimentoAllowlist,
    registry: documentOcrAsyncJobRegistry,
  });
}

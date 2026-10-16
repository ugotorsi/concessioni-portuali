import { z } from "zod";

export const DOCUMENT_WORKER_OPERATIONS = Object.freeze({
  documentExtraction: "DOCUMENT_EXTRACTION_V1",
  documentOcrCoordinator: "DOCUMENT_OCR_COORDINATOR_V2",
  documentOcrPageBatch: "DOCUMENT_OCR_PAGE_BATCH_V2",
  documentAnalysis: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
});

export type DocumentWorkerKind =
  | "DOCUMENT_EXTRACTION"
  | "DOCUMENT_OCR"
  | "DOCUMENT_ANALYSIS";

export function documentWorkerKindForOperation(operation: string): DocumentWorkerKind | null {
  if (operation === DOCUMENT_WORKER_OPERATIONS.documentExtraction) return "DOCUMENT_EXTRACTION";
  if (
    operation === DOCUMENT_WORKER_OPERATIONS.documentOcrCoordinator
    || operation === DOCUMENT_WORKER_OPERATIONS.documentOcrPageBatch
  ) return "DOCUMENT_OCR";
  if (operation === DOCUMENT_WORKER_OPERATIONS.documentAnalysis) return "DOCUMENT_ANALYSIS";
  return null;
}

const procedimentoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const serviceIdSchema = z.string().regex(/^(?:srv|crn)-[a-z0-9]+$/);
const jobIdSchema = z.string().regex(/^job-[a-z0-9]+$/);

export class DocumentWorkerActivationError extends Error {
  constructor(
    readonly code:
      | "INVALID_CONFIGURATION"
      | "REQUEST_FAILED"
      | "REQUEST_TIMEOUT"
      | "REQUEST_REJECTED"
      | "INVALID_RESPONSE",
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = "DocumentWorkerActivationError";
  }
}

export type DocumentWorkerActivationOutcome =
  | { readonly outcome: "DISABLED" }
  | { readonly outcome: "REQUESTED"; readonly jobId: string }
  | { readonly outcome: "DEFERRED"; readonly errorCode: string };

interface ActivationDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly report?: (event: Readonly<Record<string, unknown>>) => void;
}

function boundedTimeout(value: string | undefined): number {
  if (value === undefined) return 10_000;
  if (!/^\d+$/.test(value)) throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  return parsed;
}

function activationSpec(kind: DocumentWorkerKind, procedimentoId: string) {
  const scopedProcedimentoId = procedimentoIdSchema.parse(procedimentoId);
  const common = [
    "ASYNC_WORKER_CONCURRENCY=1",
    "ASYNC_WORKER_DEDICATED_MODE=true",
    "ASYNC_WORKER_EXIT_ON_IDLE=true",
    `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST=${scopedProcedimentoId}`,
  ];
  if (kind === "DOCUMENT_OCR") {
    return {
      serviceVariable: "RENDER_DOCUMENT_OCR_WORKER_SERVICE_ID",
      startCommand: [
        ...common,
        `ASYNC_WORKER_OPERATION_ALLOWLIST=${DOCUMENT_WORKER_OPERATIONS.documentOcrCoordinator},${DOCUMENT_WORKER_OPERATIONS.documentOcrPageBatch}`,
        "ASYNC_PROVIDER_EXECUTION_ENABLED=false",
        "npm run worker:document-ocr",
      ].join(" "),
    };
  }
  if (kind === "DOCUMENT_EXTRACTION") {
    return {
      serviceVariable: "RENDER_APPLICATION_WORKER_SERVICE_ID",
      startCommand: [
        ...common,
        `ASYNC_WORKER_OPERATION_ALLOWLIST=${DOCUMENT_WORKER_OPERATIONS.documentExtraction}`,
        "ASYNC_PROVIDER_EXECUTION_ENABLED=false",
        "npm run worker:document-extraction",
      ].join(" "),
    };
  }
  return {
    serviceVariable: "RENDER_APPLICATION_WORKER_SERVICE_ID",
    startCommand: [
      ...common,
      "ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES=false",
      `ASYNC_WORKER_OPERATION_ALLOWLIST=${DOCUMENT_WORKER_OPERATIONS.documentAnalysis}`,
      "ASYNC_PROVIDER_EXECUTION_ENABLED=true",
      "npm run worker:async",
    ].join(" "),
  };
}

export async function activateDocumentWorker(
  kind: DocumentWorkerKind,
  procedimentoId: string,
  dependencies: ActivationDependencies = {},
): Promise<Exclude<DocumentWorkerActivationOutcome, { outcome: "DEFERRED" }>> {
  const environment = dependencies.environment ?? process.env;
  const mode = environment.DOCUMENT_WORKER_ACTIVATION_MODE ?? "DISABLED";
  if (mode === "DISABLED") return { outcome: "DISABLED" };
  if (mode !== "RENDER_ONE_OFF") {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  const spec = activationSpec(kind, procedimentoId);
  const serviceId = serviceIdSchema.safeParse(environment[spec.serviceVariable]?.trim());
  const apiKey = environment.RENDER_WORKER_API_KEY?.trim();
  if (!serviceId.success || !apiKey) {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(
    environment.DOCUMENT_WORKER_ACTIVATION_TIMEOUT_MS,
  ));
  try {
    let response: Response;
    try {
      response = await (dependencies.fetch ?? fetch)(
        `https://api.render.com/v1/services/${serviceId.data}/jobs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ startCommand: spec.startCommand }),
          signal: controller.signal,
        },
      );
    } catch {
      throw new DocumentWorkerActivationError(
        controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_FAILED",
      );
    }
    if (response.status !== 201) {
      throw new DocumentWorkerActivationError("REQUEST_REJECTED", response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new DocumentWorkerActivationError("INVALID_RESPONSE", response.status);
    }
    const parsed = z.object({ id: jobIdSchema }).passthrough().safeParse(body);
    if (!parsed.success) {
      throw new DocumentWorkerActivationError("INVALID_RESPONSE", response.status);
    }
    return { outcome: "REQUESTED", jobId: parsed.data.id };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDocumentWorkerActivation(
  kind: DocumentWorkerKind,
  procedimentoId: string,
  dependencies: ActivationDependencies = {},
): Promise<DocumentWorkerActivationOutcome> {
  try {
    return await activateDocumentWorker(kind, procedimentoId, dependencies);
  } catch (error) {
    const activationError = error instanceof DocumentWorkerActivationError
      ? error
      : new DocumentWorkerActivationError("INVALID_CONFIGURATION");
    (dependencies.report ?? ((event) => console.error(JSON.stringify(event))))({
      event: "DOCUMENT_WORKER_ACTIVATION_DEFERRED",
      kind,
      procedimentoId,
      errorCode: activationError.code,
      status: activationError.status,
      timestamp: new Date().toISOString(),
    });
    return { outcome: "DEFERRED", errorCode: activationError.code };
  }
}

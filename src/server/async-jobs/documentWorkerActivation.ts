import { z } from "zod";

import {
  beginDocumentAnalysisActivation,
  completeDocumentAnalysisActivation,
  documentAnalysisActivationTargetSchema,
  DocumentAnalysisActivationTargetError,
  type DocumentAnalysisActivationState,
} from "./documentAnalysisActivationPersistence";

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
const applicationJobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const tenantIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const serviceIdSchema = z.string().regex(/^(?:srv|crn)-[a-z0-9]+$/);
const jobIdSchema = z.string().regex(/^job-[a-z0-9]+$/);

export type DocumentWorkerActivationRequest =
  | {
      readonly kind: "DOCUMENT_ANALYSIS";
      readonly applicationJobId: string;
      readonly tenantId: string;
      readonly procedimentoId: string;
    }
  | {
      readonly kind: "DOCUMENT_EXTRACTION" | "DOCUMENT_OCR";
      readonly procedimentoId: string;
    };

export class DocumentWorkerActivationError extends Error {
  constructor(
    readonly code:
      | "INVALID_CONFIGURATION"
      | "TARGET_REJECTED"
      | "ACTIVATION_PERSISTENCE_FAILED"
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
  | { readonly outcome: "REQUESTED"; readonly renderJobId: string }
  | {
      readonly outcome: "ALREADY_REQUESTED";
      readonly activationState: Exclude<DocumentAnalysisActivationState, "NOT_REQUESTED">;
      readonly renderJobId: string | null;
    }
  | {
      readonly outcome: "DEFERRED";
      readonly errorCode: string;
      readonly activationState?: DocumentAnalysisActivationState;
    };

interface ActivationDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly report?: (event: Readonly<Record<string, unknown>>) => void;
  readonly beginAnalysisActivation?: typeof beginDocumentAnalysisActivation;
  readonly completeAnalysisActivation?: typeof completeDocumentAnalysisActivation;
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

function activationSpec(request: DocumentWorkerActivationRequest) {
  const scopedProcedimentoId = procedimentoIdSchema.parse(request.procedimentoId);
  const common = [
    "ASYNC_WORKER_CONCURRENCY=1",
    "ASYNC_WORKER_DEDICATED_MODE=true",
    "ASYNC_WORKER_EXIT_ON_IDLE=true",
    `ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST=${scopedProcedimentoId}`,
  ];
  if (request.kind === "DOCUMENT_OCR") {
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
  if (request.kind === "DOCUMENT_EXTRACTION") {
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
  if (request.kind !== "DOCUMENT_ANALYSIS") {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  const applicationJobId = applicationJobIdSchema.parse(request.applicationJobId);
  const tenantId = tenantIdSchema.parse(request.tenantId);
  return {
    serviceVariable: "RENDER_APPLICATION_WORKER_SERVICE_ID",
    startCommand: [
      ...common,
      "ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES=false",
      "ASYNC_WORKER_MAX_PROCESSED_JOBS=1",
      `ASYNC_WORKER_TARGET_JOB_ID=${applicationJobId}`,
      `ASYNC_WORKER_TARGET_TENANT_ID=${tenantId}`,
      `ASYNC_WORKER_OPERATION_ALLOWLIST=${DOCUMENT_WORKER_OPERATIONS.documentAnalysis}`,
      "ASYNC_PROVIDER_EXECUTION_ENABLED=true",
      "npm run worker:async",
    ].join(" "),
  };
}

export async function activateDocumentWorker(
  request: DocumentWorkerActivationRequest,
  dependencies: ActivationDependencies = {},
): Promise<Exclude<DocumentWorkerActivationOutcome, { outcome: "DEFERRED" }>> {
  const environment = dependencies.environment ?? process.env;
  const mode = environment.DOCUMENT_WORKER_ACTIVATION_MODE ?? "DISABLED";
  if (mode === "DISABLED") return { outcome: "DISABLED" };
  if (mode !== "RENDER_ONE_OFF") {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  const spec = activationSpec(request);
  const serviceId = serviceIdSchema.safeParse(environment[spec.serviceVariable]?.trim());
  const apiKey = environment.RENDER_WORKER_API_KEY?.trim();
  if (!serviceId.success || !apiKey) {
    throw new DocumentWorkerActivationError("INVALID_CONFIGURATION");
  }
  let analysisReservation:
    | { target: z.output<typeof documentAnalysisActivationTargetSchema>; activationAttemptId: string }
    | undefined;
  if (request.kind === "DOCUMENT_ANALYSIS") {
    const target = documentAnalysisActivationTargetSchema.parse({
      applicationJobId: request.applicationJobId,
      tenantId: request.tenantId,
      procedimentoId: request.procedimentoId,
    });
    let reservation: Awaited<ReturnType<typeof beginDocumentAnalysisActivation>>;
    try {
      reservation = await (
        dependencies.beginAnalysisActivation ?? beginDocumentAnalysisActivation
      )(target);
    } catch (error) {
      if (error instanceof DocumentAnalysisActivationTargetError) {
        throw new DocumentWorkerActivationError("TARGET_REJECTED");
      }
      throw new DocumentWorkerActivationError("ACTIVATION_PERSISTENCE_FAILED");
    }
    if (reservation.outcome === "EXISTING") {
      if (reservation.snapshot.state === "NOT_REQUESTED") {
        throw new DocumentWorkerActivationError("ACTIVATION_PERSISTENCE_FAILED");
      }
      return {
        outcome: "ALREADY_REQUESTED",
        activationState: reservation.snapshot.state,
        renderJobId: reservation.snapshot.renderJobId,
      };
    }
    analysisReservation = {
      target,
      activationAttemptId: reservation.snapshot.activationAttemptId!,
    };
  }
  const completeAnalysis = async (
    state: "CONFIRMED" | "REMOTE_UNKNOWN" | "FAILED_VERIFIED",
    input: { renderJobId?: string | null; failureCode?: string | null } = {},
  ) => {
    if (!analysisReservation) return;
    try {
      await (
        dependencies.completeAnalysisActivation ?? completeDocumentAnalysisActivation
      )({
        target: analysisReservation.target,
        activationAttemptId: analysisReservation.activationAttemptId,
        state,
        ...input,
      });
    } catch {
      throw new DocumentWorkerActivationError("ACTIVATION_PERSISTENCE_FAILED");
    }
  };
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
      await completeAnalysis("REMOTE_UNKNOWN", {
        failureCode: controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_FAILED",
      });
      throw new DocumentWorkerActivationError(
        controller.signal.aborted ? "REQUEST_TIMEOUT" : "REQUEST_FAILED",
      );
    }
    if (response.status !== 201) {
      const verifiedFailure = response.status >= 400
        && response.status < 500
        && response.status !== 408
        && response.status !== 429;
      await completeAnalysis(
        verifiedFailure ? "FAILED_VERIFIED" : "REMOTE_UNKNOWN",
        { failureCode: `RENDER_HTTP_${response.status}` },
      );
      throw new DocumentWorkerActivationError("REQUEST_REJECTED", response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      await completeAnalysis("REMOTE_UNKNOWN", { failureCode: "INVALID_RESPONSE" });
      throw new DocumentWorkerActivationError("INVALID_RESPONSE", response.status);
    }
    const parsed = z.object({ id: jobIdSchema }).passthrough().safeParse(body);
    if (!parsed.success) {
      await completeAnalysis("REMOTE_UNKNOWN", { failureCode: "INVALID_RESPONSE" });
      throw new DocumentWorkerActivationError("INVALID_RESPONSE", response.status);
    }
    await completeAnalysis("CONFIRMED", { renderJobId: parsed.data.id });
    return { outcome: "REQUESTED", renderJobId: parsed.data.id };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDocumentWorkerActivation(
  request: DocumentWorkerActivationRequest,
  dependencies: ActivationDependencies = {},
): Promise<DocumentWorkerActivationOutcome> {
  try {
    return await activateDocumentWorker(request, dependencies);
  } catch (error) {
    const activationError = error instanceof DocumentWorkerActivationError
      ? error
      : new DocumentWorkerActivationError("INVALID_CONFIGURATION");
    (dependencies.report ?? ((event) => console.error(JSON.stringify(event))))({
      event: "DOCUMENT_WORKER_ACTIVATION_DEFERRED",
      kind: request.kind,
      procedimentoId: request.procedimentoId,
      ...("applicationJobId" in request
        ? { applicationJobId: request.applicationJobId }
        : {}),
      errorCode: activationError.code,
      status: activationError.status,
      timestamp: new Date().toISOString(),
    });
    return { outcome: "DEFERRED", errorCode: activationError.code };
  }
}

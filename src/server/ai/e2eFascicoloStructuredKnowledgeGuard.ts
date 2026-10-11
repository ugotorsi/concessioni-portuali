import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_RESPONSES_ENDPOINTS,
  type OpenAiFetch,
  type OpenAiRegion,
} from "@/server/ai/providers/openai";
import {
  reserveRuntimeCost,
  RuntimeCostReservationConflictError,
  settleRuntimeCost,
} from "@/server/runtime/cost";

const MAX_REQUEST_BYTES = 120_000;
const MAX_OUTPUT_TOKENS = 40_000;
const INPUT_USD_PER_MILLION_TOKENS = 2.5;
const OUTPUT_USD_PER_MILLION_TOKENS = 12;
const USD_TO_EUR_WITH_SAFETY_MARGIN = 1.5;
export const E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR = 1.17;

type ReserveRuntimeCost = typeof reserveRuntimeCost;
type SettleRuntimeCost = typeof settleRuntimeCost;

export class E2EFascicoloStructuredKnowledgeGuardError extends Error {
  constructor(
    readonly code:
      | "INVALID_PROVIDER_REQUEST"
      | "PROVIDER_REQUEST_TOO_LARGE"
      | "PROVIDER_OUTPUT_LIMIT_TOO_LARGE"
      | "PROVIDER_COST_LIMIT_EXCEEDED",
  ) {
    super(code);
    this.name = "E2EFascicoloStructuredKnowledgeGuardError";
  }
}

function requestBody(init: RequestInit | undefined): {
  serialized: string;
  parsed: Record<string, unknown>;
} {
  if (typeof init?.body !== "string") {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
  try {
    const parsed = JSON.parse(init.body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid body");
    }
    return { serialized: init.body, parsed: parsed as Record<string, unknown> };
  } catch {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
}

export function calculateE2EStructuredAnalysisMaximumCost(input: {
  requestBytes: number;
  maxOutputTokens: number;
}): number {
  const inputCost = input.requestBytes * INPUT_USD_PER_MILLION_TOKENS / 1_000_000;
  const outputCost =
    input.maxOutputTokens * OUTPUT_USD_PER_MILLION_TOKENS / 1_000_000;
  return (inputCost + outputCost) * USD_TO_EUR_WITH_SAFETY_MARGIN;
}

export function createE2EFascicoloStructuredKnowledgeTransport(input: {
  tenantId: string;
  procedimentoId: string;
  projectId?: string;
  region?: string;
}, dependencies: {
  transport?: OpenAiFetch;
  reserveCost?: ReserveRuntimeCost;
  settleCost?: SettleRuntimeCost;
} = {}): OpenAiFetch {
  const projectId = input.projectId?.trim();
  if (!projectId || (input.region !== "GLOBAL" && input.region !== "EU")) {
    throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
  }
  const region: OpenAiRegion = input.region;
  const transport = dependencies.transport ?? globalThis.fetch.bind(globalThis);
  const reserveCost = dependencies.reserveCost ?? reserveRuntimeCost;
  const settleCost = dependencies.settleCost ?? settleRuntimeCost;
  let attempted = false;

  return async (url, init) => {
    if (attempted || url.toString() !== OPENAI_RESPONSES_ENDPOINTS[region]) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
    }
    attempted = true;

    const body = requestBody(init);
    const requestBytes = Buffer.byteLength(body.serialized, "utf8");
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("PROVIDER_REQUEST_TOO_LARGE");
    }
    if (body.parsed.model !== OPENAI_ANALYSIS_MODEL) {
      throw new E2EFascicoloStructuredKnowledgeGuardError("INVALID_PROVIDER_REQUEST");
    }
    const maxOutputTokens = body.parsed.max_output_tokens;
    if (
      typeof maxOutputTokens !== "number"
      || !Number.isSafeInteger(maxOutputTokens)
      || maxOutputTokens <= 0
      || maxOutputTokens > MAX_OUTPUT_TOKENS
    ) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "PROVIDER_OUTPUT_LIMIT_TOO_LARGE",
      );
    }

    const maximumCostEur = calculateE2EStructuredAnalysisMaximumCost({
      requestBytes,
      maxOutputTokens,
    });
    if (maximumCostEur > E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR) {
      throw new E2EFascicoloStructuredKnowledgeGuardError(
        "PROVIDER_COST_LIMIT_EXCEEDED",
      );
    }

    const reservation = await reserveCost({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      jobId: null,
      provider: "OPENAI",
      operationType: "E2E_FASCICOLO_STRUCTURED_ANALYSIS_ONCE",
      currency: "EUR",
      estimatedAmount: E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR,
      reservationTtlSeconds: 31_536_000,
      idempotencyKey:
        `E2E_FASCICOLO_STRUCTURED_ANALYSIS_ONCE:${input.tenantId}:${input.procedimentoId}`,
    });
    if (reservation.outcome === "REUSED") {
      throw new RuntimeCostReservationConflictError();
    }

    // Settle the conservative maximum before transmission so errors and timeouts cannot enable a retry.
    await settleCost({
      reservationId: reservation.reservationId,
      actualAmount: E2E_STRUCTURED_ANALYSIS_MAX_COST_EUR,
    });

    const headers = new Headers(init?.headers);
    headers.set("OpenAI-Project", projectId);
    return transport(url, { ...init, headers });
  };
}

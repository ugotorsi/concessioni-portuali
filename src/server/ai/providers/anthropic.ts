import type {
  AiAnalysisProvider,
  AiAnalysisProviderRequestV1,
  AiOutboundAnalysisProvider,
  AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import type {
  FascicoloDocumentAnalysisProvider,
  FascicoloDocumentProviderRequestV1,
} from "@/server/ai/fascicoloDocumentAnalysis";
import type { AiBillableUsage } from "@/server/ai/providerAccounting";
import { AiProviderAdapterError } from "@/server/ai/providerErrors";
import {
  buildAiProviderInput,
  buildAiProviderInstructions,
  aiProviderOutputSchema,
  type AiAnalysisProviderRequest,
  type SyntheticQualificationProvider,
  type SyntheticQualificationProviderRequestV1,
} from "@/server/ai/providers/providerRequest";
import {
  mapProviderHttpError,
  readBoundedProviderJson,
  sanitizedProviderRequestId,
  type AiProviderFetch,
} from "@/server/ai/providers/http";

export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicProviderTelemetry {
  onRequestSent?(): void;
  onUsage?(usage: AiBillableUsage): void;
  onResponseMetadata?(metadata: { readonly stopReason: string | null }): void;
}

const ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
]);

export function toAnthropicOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toAnthropicOutputSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => (
        !ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS.has(key)
        && (key !== "minItems" || item === 0 || item === 1)
      ))
      .map(([key, item]) => [key, toAnthropicOutputSchema(item)]),
  );
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function sanitizedStopReason(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    ? value
    : null;
}

function parseUsage(body: Record<string, unknown>): AiBillableUsage | null {
  const usage = body.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const record = usage as Record<string, unknown>;
  const inputTokens = record.input_tokens;
  const outputTokens = record.output_tokens;
  const cachedInputTokens = record.cache_read_input_tokens ?? 0;
  const cacheWriteInputTokens = record.cache_creation_input_tokens ?? 0;
  if (![inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens].every(
    (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  )) return null;
  const totalInputTokens = (inputTokens as number)
    + (cachedInputTokens as number)
    + (cacheWriteInputTokens as number);
  if (!Number.isSafeInteger(totalInputTokens)) return null;
  return {
    inputTokens: totalInputTokens,
    cachedInputTokens: cachedInputTokens as number,
    cacheWriteInputTokens: cacheWriteInputTokens as number,
    outputTokens: outputTokens as number,
    reasoningOutputTokens: 0,
  };
}

type AnthropicResponseFailureCode =
  | "OUTPUT_TRUNCATED"
  | "JSON_PARSE_ERROR"
  | "MODEL_MISMATCH"
  | "UNEXPECTED_STOP_REASON"
  | "PROVIDER_RESPONSE_INVALID";

function responseFailure(
  code: AnthropicResponseFailureCode,
  response: Response,
): AiProviderAdapterError {
  return new AiProviderAdapterError("INVALID_RESPONSE", {
    httpStatus: response.status,
    providerCode: code,
    providerRequestId: sanitizedProviderRequestId(response.headers),
  });
}

function responseRecord(body: unknown, response: Response): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw responseFailure("PROVIDER_RESPONSE_INVALID", response);
  }
  return body as Record<string, unknown>;
}

function extractPayload(
  record: Record<string, unknown>,
  model: string,
  response: Response,
): unknown {
  if (record.model !== model) {
    throw responseFailure("MODEL_MISMATCH", response);
  }
  if (record.stop_reason === "max_tokens") {
    throw responseFailure("OUTPUT_TRUNCATED", response);
  }
  if (record.stop_reason !== "end_turn") {
    throw responseFailure("UNEXPECTED_STOP_REASON", response);
  }
  if (!Array.isArray(record.content) || record.content.length !== 1) {
    throw responseFailure("PROVIDER_RESPONSE_INVALID", response);
  }
  const content = record.content[0];
  if (!content || typeof content !== "object" || Array.isArray(content)
    || (content as Record<string, unknown>).type !== "text"
    || typeof (content as Record<string, unknown>).text !== "string") {
    throw responseFailure("PROVIDER_RESPONSE_INVALID", response);
  }
  try {
    return JSON.parse((content as Record<string, unknown>).text as string);
  } catch {
    throw responseFailure("JSON_PARSE_ERROR", response);
  }
}

export function createAnthropicAnalysisProvider(config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  transport?: AiProviderFetch;
  telemetry?: AnthropicProviderTelemetry;
  authorizeRequest?: () => Promise<void>;
}): AiAnalysisProvider & AiOutboundAnalysisProvider & FascicoloDocumentAnalysisProvider
  & SyntheticQualificationProvider {
  if (!config.apiKey.trim() || !config.model.trim()
    || !positiveInteger(config.timeoutMs)
    || !positiveInteger(config.maxRawResponseBytes)
    || !positiveInteger(config.maxOutputTokens)) {
    throw new AiProviderAdapterError("CONFIGURATION");
  }
  const transport = config.transport ?? globalThis.fetch.bind(globalThis);

  function analyze(request: AiAnalysisProviderRequestV1): Promise<unknown>;
  function analyze(request: AiOutboundAnalysisProviderRequestV1): Promise<unknown>;
  function analyze(request: FascicoloDocumentProviderRequestV1): Promise<unknown>;
  function analyze(request: SyntheticQualificationProviderRequestV1): Promise<unknown>;
  async function analyze(request: AiAnalysisProviderRequest): Promise<unknown> {
    await config.authorizeRequest?.();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      let response: Response;
      try {
        config.telemetry?.onRequestSent?.();
        response = await transport(ANTHROPIC_MESSAGES_ENDPOINT, {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: config.maxOutputTokens,
            system: buildAiProviderInstructions(request),
            messages: [{ role: "user", content: buildAiProviderInput(request) }],
            output_config: {
              format: {
                type: "json_schema",
                schema: toAnthropicOutputSchema(aiProviderOutputSchema(request)),
              },
            },
          }),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (error) {
        if (controller.signal.aborted) throw new AiProviderAdapterError("TIMEOUT");
        if (error instanceof TypeError) throw new AiProviderAdapterError("UNAVAILABLE");
        throw error;
      }
      let body: unknown;
      try {
        body = await readBoundedProviderJson(response, config.maxRawResponseBytes);
      } catch (error) {
        if (controller.signal.aborted) throw new AiProviderAdapterError("TIMEOUT");
        throw error;
      }
      if (controller.signal.aborted) throw new AiProviderAdapterError("TIMEOUT");
      if (!response.ok) {
        throw mapProviderHttpError(response.status, body, response.headers);
      }
      const record = responseRecord(body, response);
      const usage = parseUsage(record);
      config.telemetry?.onResponseMetadata?.({
        stopReason: sanitizedStopReason(record.stop_reason),
      });
      if (config.telemetry?.onUsage) {
        if (!usage) throw new AiProviderAdapterError("CONFIGURATION", {
          httpStatus: response.status,
          providerCode: "usage_missing_or_invalid",
          providerRequestId: sanitizedProviderRequestId(response.headers),
        });
        config.telemetry.onUsage(usage);
      }
      return extractPayload(record, config.model, response);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { analyze } as AiAnalysisProvider & AiOutboundAnalysisProvider
    & FascicoloDocumentAnalysisProvider & SyntheticQualificationProvider;
}

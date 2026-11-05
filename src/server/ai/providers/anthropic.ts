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
} from "@/server/ai/providers/providerRequest";
import {
  mapProviderHttpError,
  readBoundedProviderJson,
  type AiProviderFetch,
} from "@/server/ai/providers/http";

export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicProviderTelemetry {
  onRequestSent?(): void;
  onUsage?(usage: AiBillableUsage): void;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
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
  return {
    inputTokens: inputTokens as number,
    cachedInputTokens: cachedInputTokens as number,
    cacheWriteInputTokens: cacheWriteInputTokens as number,
    outputTokens: outputTokens as number,
    reasoningOutputTokens: 0,
  };
}

function extractPayload(body: unknown, model: string): {
  payload: unknown;
  usage: AiBillableUsage | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { payload: null, usage: null };
  }
  const record = body as Record<string, unknown>;
  if (record.model !== model || record.stop_reason !== "end_turn"
    || !Array.isArray(record.content) || record.content.length !== 1) {
    return { payload: null, usage: parseUsage(record) };
  }
  const content = record.content[0];
  if (!content || typeof content !== "object" || Array.isArray(content)
    || (content as Record<string, unknown>).type !== "text"
    || typeof (content as Record<string, unknown>).text !== "string") {
    return { payload: null, usage: parseUsage(record) };
  }
  try {
    return {
      payload: JSON.parse((content as Record<string, unknown>).text as string),
      usage: parseUsage(record),
    };
  } catch {
    return { payload: null, usage: parseUsage(record) };
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
}): AiAnalysisProvider & AiOutboundAnalysisProvider & FascicoloDocumentAnalysisProvider {
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
                schema: aiProviderOutputSchema(request),
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
      if (!response.ok) throw mapProviderHttpError(response.status, body);
      const result = extractPayload(body, config.model);
      if (config.telemetry?.onUsage) {
        if (!result.usage) throw new AiProviderAdapterError("CONFIGURATION", {
          httpStatus: response.status,
          providerCode: "usage_missing_or_invalid",
        });
        config.telemetry.onUsage(result.usage);
      }
      return result.payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { analyze } as AiAnalysisProvider & AiOutboundAnalysisProvider & FascicoloDocumentAnalysisProvider;
}

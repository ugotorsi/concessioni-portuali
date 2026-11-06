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
  type AiProviderFetch,
} from "@/server/ai/providers/http";

export const DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT =
  "https://api.deepseek.com/chat/completions";

export interface DeepSeekProviderTelemetry {
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
  const inputTokens = record.prompt_tokens;
  const outputTokens = record.completion_tokens;
  const cachedInputTokens = record.prompt_cache_hit_tokens ?? 0;
  if (![inputTokens, outputTokens, cachedInputTokens].every(
    (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  )) return null;
  return {
    inputTokens: inputTokens as number,
    cachedInputTokens: cachedInputTokens as number,
    cacheWriteInputTokens: 0,
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
  const usage = parseUsage(record);
  if (record.model !== model || !Array.isArray(record.choices) || record.choices.length !== 1) {
    return { payload: null, usage };
  }
  const choice = record.choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)
    || (choice as Record<string, unknown>).finish_reason !== "stop") {
    return { payload: null, usage };
  }
  const message = (choice as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)
    || (message as Record<string, unknown>).role !== "assistant"
    || typeof (message as Record<string, unknown>).content !== "string") {
    return { payload: null, usage };
  }
  try {
    return {
      payload: JSON.parse((message as Record<string, unknown>).content as string),
      usage,
    };
  } catch {
    return { payload: null, usage };
  }
}

export function createDeepSeekAnalysisProvider(config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  transport?: AiProviderFetch;
  telemetry?: DeepSeekProviderTelemetry;
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
        response = await transport(DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: "system",
                content: [
                  buildAiProviderInstructions(request),
                  "Return JSON matching this schema exactly:",
                  JSON.stringify(aiProviderOutputSchema(request)),
                ].join("\n"),
              },
              { role: "user", content: buildAiProviderInput(request) },
            ],
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            max_tokens: config.maxOutputTokens,
            stream: false,
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

  return { analyze } as AiAnalysisProvider & AiOutboundAnalysisProvider
    & FascicoloDocumentAnalysisProvider & SyntheticQualificationProvider;
}

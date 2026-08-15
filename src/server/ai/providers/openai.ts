import type { AiAnalysisProvider, AiAnalysisProviderRequestV1 } from "@/server/ai/fascicoloAnalysis";
import { AiProviderAdapterError } from "@/server/ai/fascicoloLiveAnalysis";

export const OPENAI_ANALYSIS_MODEL = "gpt-5.6-terra" as const;
export const OPENAI_RESPONSES_ENDPOINTS = {
  GLOBAL: "https://api.openai.com/v1/responses",
  EU: "https://eu.api.openai.com/v1/responses",
} as const;

export type OpenAiRegion = keyof typeof OPENAI_RESPONSES_ENDPOINTS;
export type OpenAiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const basisRefSchema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^(?:[A-Za-z][A-Za-z0-9_-]*)(?:\\.(?:[A-Za-z][A-Za-z0-9_-]*|\\d+))*$",
} as const;

const requiredBasisRefsSchema = {
  type: "array",
  items: basisRefSchema,
  minItems: 1,
  maxItems: 32,
} as const;

const optionalBasisRefsSchema = {
  type: "array",
  items: basisRefSchema,
  maxItems: 32,
} as const;

const groundedStatementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "basisRefs"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 8000 },
    basisRefs: requiredBasisRefsSchema,
  },
} as const;

const optionalGroundingStatementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "basisRefs"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 8000 },
    basisRefs: optionalBasisRefsSchema,
  },
} as const;

export const OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "timeline",
    "recordedState",
    "signals",
    "investigativeQuestions",
    "suggestedActivities",
    "legalResearchQuestions",
  ],
  properties: {
    summary: groundedStatementSchema,
    timeline: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recordedAt", "text", "basisRefs"],
        properties: {
          recordedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
          text: { type: "string", minLength: 1, maxLength: 8000 },
          basisRefs: requiredBasisRefsSchema,
        },
      },
    },
    recordedState: { type: "array", maxItems: 100, items: groundedStatementSchema },
    signals: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "basisRefs"],
        properties: {
          type: { type: "string", enum: ["INFO", "VERIFY"] },
          text: { type: "string", minLength: 1, maxLength: 8000 },
          basisRefs: requiredBasisRefsSchema,
        },
      },
    },
    investigativeQuestions: { type: "array", maxItems: 100, items: optionalGroundingStatementSchema },
    suggestedActivities: { type: "array", maxItems: 100, items: optionalGroundingStatementSchema },
    legalResearchQuestions: { type: "array", maxItems: 100, items: optionalGroundingStatementSchema },
  },
} as const;

class OpenAiProtocolError extends Error {
  constructor() {
    super("OPENAI_PROTOCOL_ERROR");
    this.name = "OpenAiProtocolError";
  }
}

function configurationError(): AiProviderAdapterError {
  return new AiProviderAdapterError("CONFIGURATION");
}

function assertPositiveSafeInteger(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw configurationError();
  }
}

function assertConfig(config: {
  apiKey: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  region: OpenAiRegion;
}): void {
  if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
    throw configurationError();
  }
  assertPositiveSafeInteger(config.timeoutMs);
  assertPositiveSafeInteger(config.maxRawResponseBytes);
  assertPositiveSafeInteger(config.maxOutputTokens);
  if (config.region !== "GLOBAL" && config.region !== "EU") {
    throw configurationError();
  }
}

function buildInstructions(request: AiAnalysisProviderRequestV1): string {
  return JSON.stringify({
    systemPolicy: request.systemPolicy,
    requestedOutputContract: request.requestedOutputContract,
  });
}

function buildSnapshotInput(request: AiAnalysisProviderRequestV1): string {
  return [
    "BEGIN_UNTRUSTED_SNAPSHOT_DATA",
    JSON.stringify(request.snapshotData),
    "END_UNTRUSTED_SNAPSHOT_DATA",
  ].join("\n");
}

function buildRequestBody(request: AiAnalysisProviderRequestV1, maxOutputTokens: number) {
  return {
    model: OPENAI_ANALYSIS_MODEL,
    store: false,
    background: false,
    tools: [],
    tool_choice: "none",
    truncation: "disabled",
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: "low" },
    instructions: buildInstructions(request),
    input: [{
      role: "user",
      content: [{ type: "input_text", text: buildSnapshotInput(request) }],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "fascicolo_analysis_v1",
        schema: OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
        strict: true,
      },
    },
  };
}

async function cancelReaderBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cleanup failure must not replace an already determined outcome.
  }
}

function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    return Promise.reject(new AiProviderAdapterError("TIMEOUT"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new AiProviderAdapterError("TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  isTimedOut: () => boolean,
): Promise<Uint8Array | null> {
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readChunkWithAbort(reader, signal);
      } catch {
        if (isTimedOut()) {
          await cancelReaderBestEffort(reader);
          throw new AiProviderAdapterError("TIMEOUT");
        }
        throw new OpenAiProtocolError();
      }
      const { done, value } = result;
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await cancelReaderBestEffort(reader);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock release is best-effort cleanup and carries no business outcome.
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJsonBytes(bytes: Uint8Array | null): unknown {
  if (bytes === null) {
    return null;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function extractStructuredPayload(responseBody: unknown): unknown {
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    return null;
  }
  const response = responseBody as Record<string, unknown>;
  if (response.status !== "completed" || !Array.isArray(response.output)) {
    return null;
  }

  const outputTexts: string[] = [];
  for (const outputItem of response.output) {
    if (!outputItem || typeof outputItem !== "object" || Array.isArray(outputItem)) {
      return null;
    }
    const message = outputItem as Record<string, unknown>;
    if (message.type !== "message" || message.role !== "assistant" || !Array.isArray(message.content)) {
      return null;
    }
    for (const contentItem of message.content) {
      if (!contentItem || typeof contentItem !== "object" || Array.isArray(contentItem)) {
        return null;
      }
      const content = contentItem as Record<string, unknown>;
      if (content.type !== "output_text" || typeof content.text !== "string") {
        return null;
      }
      outputTexts.push(content.text);
    }
  }
  if (outputTexts.length !== 1) {
    return null;
  }
  try {
    return JSON.parse(outputTexts[0]);
  } catch {
    return null;
  }
}

function mapHttpError(status: number): Error {
  if (status === 429) {
    return new AiProviderAdapterError("RATE_LIMITED");
  }
  if (status === 408) {
    return new AiProviderAdapterError("TIMEOUT");
  }
  if (status === 401 || status === 403) {
    return new AiProviderAdapterError("CONFIGURATION");
  }
  if (status >= 500 && status <= 599) {
    return new AiProviderAdapterError("UNAVAILABLE");
  }
  return new OpenAiProtocolError();
}

export function createOpenAiAnalysisProvider(config: {
  apiKey: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  region: OpenAiRegion;
  transport?: OpenAiFetch;
}): AiAnalysisProvider {
  assertConfig(config);
  const endpoint = OPENAI_RESPONSES_ENDPOINTS[config.region];
  const transport = config.transport ?? globalThis.fetch.bind(globalThis);

  return {
    async analyze(request) {
      const controller = new AbortController();
      let timedOut = false;
      const assertNotTimedOut = () => {
        if (timedOut) {
          throw new AiProviderAdapterError("TIMEOUT");
        }
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      try {
        let response: Response;
        try {
          response = await transport(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(buildRequestBody(request, config.maxOutputTokens)),
            signal: controller.signal,
            redirect: "error",
          });
        } catch (error) {
          if (timedOut) {
            throw new AiProviderAdapterError("TIMEOUT");
          }
          if (error instanceof TypeError) {
            throw new AiProviderAdapterError("UNAVAILABLE");
          }
          throw new OpenAiProtocolError();
        }
        assertNotTimedOut();

        if (!response.ok) {
          throw mapHttpError(response.status);
        }
        const body = await readBoundedBody(
          response,
          config.maxRawResponseBytes,
          controller.signal,
          () => timedOut,
        );
        assertNotTimedOut();
        const payload = extractStructuredPayload(parseJsonBytes(body));
        assertNotTimedOut();
        return payload;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

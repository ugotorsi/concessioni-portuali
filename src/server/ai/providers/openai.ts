import type {
  AiAnalysisProvider,
  AiAnalysisProviderRequestV1,
  AiOutboundAnalysisProvider,
  AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import { AiProviderAdapterError } from "@/server/ai/providerErrors";
import type {
  FascicoloDocumentAnalysisProvider,
  FascicoloDocumentProviderRequestV1,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  OpenAiUsageAccountingError,
  parseOpenAiBillableUsage,
  type OpenAiBillableUsage,
} from "@/server/ai/openaiAccounting";
import { fascicoloDocumentKnowledgeCandidateProposalSchema } from "@/server/fascicolo-knowledge/structuredContracts";
import { getEncoding } from "js-tiktoken";
import { z } from "zod";

export const OPENAI_ANALYSIS_MODEL = "gpt-5.6-terra" as const;
export const OPENAI_DEFAULT_REGION = "GLOBAL" as const;
export const OPENAI_RESPONSES_ENDPOINTS = {
  GLOBAL: "https://api.openai.com/v1/responses",
} as const;
export const OPENAI_INPUT_TOKEN_ACCOUNTING_OVERHEAD = 1_024;

export type OpenAiRegion = keyof typeof OPENAI_RESPONSES_ENDPOINTS;
export type OpenAiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type OpenAiTokenCounter = (serializedRequest: string) => number;

export interface OpenAiProviderTelemetry {
  onRequestSent?(): void;
  onUsage?(usage: OpenAiBillableUsage): void;
}

const openAiTokenizer = getEncoding("o200k_base");

function defaultTokenCounter(serializedRequest: string): number {
  return openAiTokenizer.encode(serializedRequest).length;
}

type OpenAiAnalysisProviderRequest =
  | AiAnalysisProviderRequestV1
  | AiOutboundAnalysisProviderRequestV1
  | FascicoloDocumentProviderRequestV1;

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

function stripGeneratedSchemaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripGeneratedSchemaMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema" && key !== "default")
      .map(([key, item]) => [
        key,
        key === "confidence"
          ? { anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }] }
          : stripGeneratedSchemaMetadata(item),
      ]),
  );
}

function makeOpenAiStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(makeOpenAiStrictSchema);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).map(([key, item]) => [
    key,
    makeOpenAiStrictSchema(item),
  ]);
  const schema = Object.fromEntries(entries) as Record<string, unknown>;
  if (Array.isArray(schema.oneOf)) {
    schema.anyOf = schema.oneOf;
    delete schema.oneOf;
  }
  if (schema.type === "object" && schema.properties
    && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    schema.additionalProperties = false;
    schema.required = Object.keys(schema.properties);
  }
  return schema;
}

export const OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA = makeOpenAiStrictSchema({
  ...OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
  required: [
    ...OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA.required,
    "structuredKnowledge",
  ],
  properties: {
    ...OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA.properties,
    structuredKnowledge: stripGeneratedSchemaMetadata(
      z.toJSONSchema(fascicoloDocumentKnowledgeCandidateProposalSchema, { unrepresentable: "any" }),
    ),
  },
});

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
  maxInputTokens: number;
  region: OpenAiRegion;
}): void {
  if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
    throw configurationError();
  }
  assertPositiveSafeInteger(config.timeoutMs);
  assertPositiveSafeInteger(config.maxRawResponseBytes);
  assertPositiveSafeInteger(config.maxOutputTokens);
  assertPositiveSafeInteger(config.maxInputTokens);
  if (config.region !== OPENAI_DEFAULT_REGION) {
    throw configurationError();
  }
}

function buildInstructions(request: OpenAiAnalysisProviderRequest): string {
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

function buildOutboundInput(request: AiOutboundAnalysisProviderRequestV1): string {
  return [
    "BEGIN_UNTRUSTED_OUTBOUND_DATA",
    JSON.stringify(request.outboundData),
    "END_UNTRUSTED_OUTBOUND_DATA",
  ].join("\n");
}

function buildDocumentInput(request: FascicoloDocumentProviderRequestV1): string {
  const providerDocumentData = {
    ...request.documentData,
    content: {
      ...request.documentData.content,
      evidenceSpans: request.documentData.content.evidenceSpans.map((span) => ({
        id: span.id,
        basisRef: span.basisRef,
        text: span.text,
      })),
    },
  };
  return [
    "BEGIN_UNTRUSTED_DOCUMENT_DATA",
    JSON.stringify(providerDocumentData),
    "END_UNTRUSTED_DOCUMENT_DATA",
  ].join("\n");
}

function buildProviderInput(request: OpenAiAnalysisProviderRequest): string {
  if (typeof request !== "object" || request === null) {
    throw configurationError();
  }
  const hasSnapshotData = "snapshotData" in request;
  const hasOutboundData = "outboundData" in request;
  const hasDocumentData = "documentData" in request;
  if ([hasSnapshotData, hasOutboundData, hasDocumentData].filter(Boolean).length !== 1) {
    throw configurationError();
  }
  if (hasSnapshotData) return buildSnapshotInput(request);
  if (hasOutboundData) return buildOutboundInput(request);
  return buildDocumentInput(request);
}

function buildRequestBody(request: OpenAiAnalysisProviderRequest, maxOutputTokens: number) {
  const documentAnalysis = "documentData" in request;
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
      content: [{ type: "input_text", text: buildProviderInput(request) }],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "fascicolo_analysis_v1",
        schema: documentAnalysis
          ? OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA
          : OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
        strict: true,
      },
    },
  };
}

export function estimateOpenAiAnalysisRequest(
  request: OpenAiAnalysisProviderRequest,
  maxOutputTokens: number,
  tokenCounter: OpenAiTokenCounter = defaultTokenCounter,
) {
  assertPositiveSafeInteger(maxOutputTokens);
  const serializedRequest = JSON.stringify(buildRequestBody(request, maxOutputTokens));
  const rawInputTokens = tokenCounter(serializedRequest);
  const inputTokens = rawInputTokens + OPENAI_INPUT_TOKEN_ACCOUNTING_OVERHEAD;
  if (!Number.isSafeInteger(rawInputTokens) || rawInputTokens < 0
    || !Number.isSafeInteger(inputTokens)) {
    throw configurationError();
  }
  return Object.freeze({
    requestBytes: Buffer.byteLength(serializedRequest, "utf8"),
    rawInputTokens,
    inputTokens,
    accountingOverheadTokens: OPENAI_INPUT_TOKEN_ACCOUNTING_OVERHEAD,
  });
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
    if (message.type === "reasoning") {
      continue;
    }
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

function mapHttpError(status: number, providerCode: string | null): Error {
  const diagnostics = { httpStatus: status, providerCode };
  if (status === 429) {
    return new AiProviderAdapterError("RATE_LIMITED", diagnostics);
  }
  if (status === 408) {
    return new AiProviderAdapterError("TIMEOUT", diagnostics);
  }
  if (status === 401 || status === 403) {
    return new AiProviderAdapterError("CONFIGURATION", diagnostics);
  }
  if (status >= 500 && status <= 599) {
    return new AiProviderAdapterError("UNAVAILABLE", diagnostics);
  }
  return new OpenAiProtocolError();
}

function providerErrorCode(responseBody: unknown): string | null {
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    return null;
  }
  const error = (responseBody as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(code)
    ? code
    : null;
}

export function createOpenAiAnalysisProvider(config: {
  apiKey: string;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  region: OpenAiRegion;
  transport?: OpenAiFetch;
  tokenCounter?: OpenAiTokenCounter;
  telemetry?: OpenAiProviderTelemetry;
  authorizeRequest?: () => Promise<void>;
}): AiAnalysisProvider & AiOutboundAnalysisProvider & FascicoloDocumentAnalysisProvider {
  assertConfig(config);
  const endpoint = OPENAI_RESPONSES_ENDPOINTS[config.region];
  const transport = config.transport ?? globalThis.fetch.bind(globalThis);
  const tokenCounter = config.tokenCounter ?? defaultTokenCounter;

  function analyze(request: AiAnalysisProviderRequestV1): Promise<unknown>;
  function analyze(request: AiOutboundAnalysisProviderRequestV1): Promise<unknown>;
  function analyze(request: FascicoloDocumentProviderRequestV1): Promise<unknown>;
  async function analyze(request: OpenAiAnalysisProviderRequest): Promise<unknown> {
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
      await config.authorizeRequest?.();
      const requestBody = buildRequestBody(request, config.maxOutputTokens);
      const serializedRequest = JSON.stringify(requestBody);
      const inputTokenCount = estimateOpenAiAnalysisRequest(
        request,
        config.maxOutputTokens,
        tokenCounter,
      ).inputTokens;
      if (!Number.isSafeInteger(inputTokenCount)
        || inputTokenCount < 0
        || inputTokenCount > config.maxInputTokens) {
        throw new AiProviderAdapterError("CONFIGURATION", {
          httpStatus: 0,
          providerCode: "input_token_limit_exceeded",
        });
      }
      let response: Response;
      try {
        config.telemetry?.onRequestSent?.();
        response = await transport(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: serializedRequest,
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
        const errorBody = await readBoundedBody(
          response,
          config.maxRawResponseBytes,
          controller.signal,
          () => timedOut,
        );
        assertNotTimedOut();
        throw mapHttpError(
          response.status,
          providerErrorCode(parseJsonBytes(errorBody)),
        );
      }
      const body = await readBoundedBody(
        response,
        config.maxRawResponseBytes,
        controller.signal,
        () => timedOut,
      );
      assertNotTimedOut();
      const responseBody = parseJsonBytes(body);
      if (config.telemetry?.onUsage) {
        if (!responseBody || typeof responseBody !== "object"
          || Array.isArray(responseBody)
          || (responseBody as Record<string, unknown>).model !== OPENAI_ANALYSIS_MODEL) {
          throw new OpenAiUsageAccountingError("OPENAI_MODEL_MISMATCH");
        }
        config.telemetry.onUsage(parseOpenAiBillableUsage(responseBody));
      }
      const payload = extractStructuredPayload(responseBody);
      assertNotTimedOut();
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { analyze } as AiAnalysisProvider & AiOutboundAnalysisProvider & FascicoloDocumentAnalysisProvider;
}

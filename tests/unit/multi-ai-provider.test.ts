import { describe, expect, it, vi } from "vitest";

import {
  createFascicoloDocumentAnalysisService,
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  type FascicoloDocumentAnalysisInput,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  AI_MODEL_CATALOG,
  aiModelSelectionCode,
  DEFAULT_AI_MODEL_SELECTION,
  resolveAiModelSelectionCode,
} from "@/server/ai/providerCatalog";
import {
  type AiBillableUsage,
  AiUsageAccountingError,
  assertAiMaximumCost,
  calculateAiTokenCost,
} from "@/server/ai/providerAccounting";
import {
  createAnthropicAnalysisProvider,
  toAnthropicOutputSchema,
} from "@/server/ai/providers/anthropic";
import { createDeepSeekAnalysisProvider } from "@/server/ai/providers/deepseek";
import { mapProviderHttpError } from "@/server/ai/providers/http";
import {
  OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
} from "@/server/ai/providers/openai";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";

const analysisInput: FascicoloDocumentAnalysisInput = {
  contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  tenantId: "tenant-synthetic",
  procedimentoId: "procedure-synthetic",
  neutralIntakeId: "intake-synthetic",
  documentVersionId: "version-synthetic",
  artifactSha256: "a".repeat(64),
  corpusFingerprint: "c".repeat(64),
  documents: [{
    documentVersionId: "version-synthetic",
    artifactSha256: "a".repeat(64),
  }],
  documentsAreUntrustedData: true,
  externalToolsAllowed: false,
  excerpts: [{
    reference: "DOCUMENT_1.PAGE_1",
    pageNumber: 1,
    documentVersionId: "version-synthetic",
    artifactSha256: "a".repeat(64),
    text: "Documento sintetico privo di dati reali.",
    textSha256: "b".repeat(64),
    extractionMethod: "SYNTHETIC",
    ocrConfidence: null,
  }],
};

const activation = createRealDataActivationPolicy({
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "SYNTHETIC-TEST-ONLY",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
});

function schemaKeywordValues(value: unknown, keyword: string): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => schemaKeywordValues(item, keyword));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === keyword ? [item] : []),
    ...schemaKeywordValues(item, keyword),
  ]);
}

function anthropicResponse(payload: unknown, status = 200): Response {
  return Response.json({
    id: "msg_synthetic_anthropic",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    },
  }, { status });
}

function deepSeekResponse(payload: unknown, status = 200): Response {
  return Response.json({
    model: "deepseek-v4-pro",
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(payload) },
    }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_cache_hit_tokens: 20,
    },
  }, { status });
}

describe("multi-AI provider catalog and accounting", () => {
  it("keeps OpenAI as the only real-data default while registering alternatives", () => {
    expect(aiModelSelectionCode(DEFAULT_AI_MODEL_SELECTION))
      .toBe("OPENAI:gpt-5.6-terra");
    expect(AI_MODEL_CATALOG.map((entry) => entry.selection.provider))
      .toEqual(["OPENAI", "ANTHROPIC", "DEEPSEEK"]);
    expect(AI_MODEL_CATALOG.map((entry) => entry.capabilities.realDataApproved))
      .toEqual([true, false, false]);
    expect(resolveAiModelSelectionCode("ANTHROPIC:claude-sonnet-5"))
      .toEqual(AI_MODEL_CATALOG[1].selection);
    expect(() => resolveAiModelSelectionCode("ANTHROPIC:unknown"))
      .toThrow("INVALID_AI_MODEL_SELECTION");
  });

  it("accounts each provider with explicit pricing and fails closed without it", () => {
    const pricing = {
      version: "SYNTHETIC_PRICING_V1",
      effectiveDate: "2026-11-05",
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      cacheWriteUsdPerMillion: 2.5,
      outputUsdPerMillion: 12,
    };
    expect(calculateAiTokenCost({
      usage: {
        inputTokens: 1_000,
        cachedInputTokens: 100,
        cacheWriteInputTokens: 100,
        outputTokens: 200,
        reasoningOutputTokens: 0,
      },
      pricing,
      usdToEurRate: 0.9,
    })).toMatchObject({
      pricingVersion: "SYNTHETIC_PRICING_V1",
      accountedEur: 0.003843,
    });
    expect(() => calculateAiTokenCost({
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 1,
        reasoningOutputTokens: 0,
      },
      pricing: null,
      usdToEurRate: 0.9,
    })).toThrow(new AiUsageAccountingError("AI_PRICING_MISSING_OR_INVALID"));
    expect(() => assertAiMaximumCost({
      maxInputTokens: 100_000,
      maxOutputTokens: 10_000,
      pricing,
      usdToEurRate: 0.9,
      maxCostEur: 0.01,
    })).toThrow(new AiUsageAccountingError("AI_COST_LIMIT_EXCEEDED"));
  });
});

describe("simulated Anthropic and DeepSeek adapters", () => {
  it("removes only Anthropic-unsupported constraints from the wire schema", () => {
    const transformed = toAnthropicOutputSchema(
      OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
    );
    for (const keyword of [
      "minimum",
      "maximum",
      "multipleOf",
      "minLength",
      "maxLength",
      "maxItems",
      "uniqueItems",
    ]) {
      expect(schemaKeywordValues(transformed, keyword), keyword).toEqual([]);
    }
    expect(schemaKeywordValues(transformed, "minItems")).toEqual(
      expect.arrayContaining([1]),
    );
    expect(schemaKeywordValues(transformed, "pattern").length).toBeGreaterThan(0);
    expect(schemaKeywordValues(transformed, "format")).toContain("date-time");
    expect(schemaKeywordValues(transformed, "additionalProperties"))
      .toEqual(expect.arrayContaining([false]));

    expect(schemaKeywordValues(
      OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
      "maxItems",
    ).length).toBeGreaterThan(0);
    expect(schemaKeywordValues(
      OPENAI_PROVIDER_DOCUMENT_ANALYSIS_JSON_SCHEMA,
      "minLength",
    ).length).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "Anthropic",
      create: (transport: typeof fetch, onUsage: (usage: AiBillableUsage) => void) =>
        createAnthropicAnalysisProvider({
          apiKey: "synthetic-anthropic-key",
          model: "claude-sonnet-5",
          timeoutMs: 1_000,
          maxRawResponseBytes: 64_000,
          maxOutputTokens: 2_000,
          transport,
          telemetry: { onUsage },
        }),
      response: () => anthropicResponse({ invalid: true }),
      endpoint: "https://api.anthropic.com/v1/messages",
    },
    {
      name: "DeepSeek",
      create: (transport: typeof fetch, onUsage: (usage: AiBillableUsage) => void) =>
        createDeepSeekAnalysisProvider({
          apiKey: "synthetic-deepseek-key",
          model: "deepseek-v4-pro",
          timeoutMs: 1_000,
          maxRawResponseBytes: 64_000,
          maxOutputTokens: 2_000,
          transport,
          telemetry: { onUsage },
        }),
      response: () => deepSeekResponse({ invalid: true }),
      endpoint: "https://api.deepseek.com/chat/completions",
    },
  ])("$name uses only the injected transport and remains subject to NOETRA validation", async ({
    create,
    response,
    endpoint,
  }) => {
    const onUsage = vi.fn();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    const provider = create(transport, onUsage);
    expect(transport).not.toHaveBeenCalled();

    const service = createFascicoloDocumentAnalysisService({
      provider,
      maxInputBytes: 64_000,
      realDataActivation: activation,
    });
    await expect(service.analyze(analysisInput)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_OUTPUT",
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toBe(endpoint);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      outputTokens: 30,
      cachedInputTokens: 20,
    }));
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: endpoint.includes("anthropic") ? 150 : 120,
    }));
    const request = JSON.parse(String(transport.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(JSON.stringify(request)).toContain("BEGIN_UNTRUSTED_DOCUMENT_DATA");
    expect(JSON.stringify(request)).toContain("structuredKnowledge");
    if (endpoint.includes("anthropic")) {
      const wireSchema = (
        (request.output_config as { format: { schema: unknown } }).format.schema
      );
      expect(schemaKeywordValues(wireSchema, "minLength")).toEqual([]);
      expect(schemaKeywordValues(wireSchema, "maxLength")).toEqual([]);
      expect(schemaKeywordValues(wireSchema, "maxItems")).toEqual([]);
      expect(schemaKeywordValues(wireSchema, "minimum")).toEqual([]);
      expect(schemaKeywordValues(wireSchema, "maximum")).toEqual([]);
    }
  });

  it("reports sanitized Anthropic response block metadata", async () => {
    const onUsage = vi.fn();
    const onResponseMetadata = vi.fn();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "msg_synthetic_thinking",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [
          { type: "thinking", thinking: "", signature: "signature_synthetic" },
          { type: "text", text: JSON.stringify({ invalid: true }) },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
          output_tokens_details: { thinking_tokens: 12 },
        },
      }),
    );
    const provider = createAnthropicAnalysisProvider({
      apiKey: "synthetic-anthropic-key",
      model: "claude-sonnet-5",
      timeoutMs: 1_000,
      maxRawResponseBytes: 64_000,
      maxOutputTokens: 2_000,
      transport,
      telemetry: { onUsage, onResponseMetadata },
    });
    const service = createFascicoloDocumentAnalysisService({
      provider,
      maxInputBytes: 64_000,
      realDataActivation: activation,
    });

    await expect(service.analyze(analysisInput)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_OUTPUT",
    });
    expect(onResponseMetadata).toHaveBeenCalledWith({
      stopReason: "end_turn",
      contentBlockTypes: ["thinking", "text"],
    });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      outputTokens: 30,
      reasoningOutputTokens: 12,
    }));
    const request = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "claude-sonnet-5",
      thinking: { type: "disabled" },
    });
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({
      "anthropic-version": "2026-10-21",
    });
  });

  it.each([
    [400, "REQUEST_REJECTED"],
    [402, "REQUEST_REJECTED"],
    [404, "REQUEST_REJECTED"],
    [408, "TIMEOUT"],
    [429, "RATE_LIMITED"],
    [500, "UNAVAILABLE"],
    [529, "UNAVAILABLE"],
  ] as const)("classifies HTTP %s as %s without retaining response content", (status, category) => {
    const error = mapProviderHttpError(
      status,
      {
        error: {
          type: "invalid_request_error",
          message: "sensitive provider response",
        },
      },
      new Headers({ "request-id": "req_01H_safe" }),
    );
    expect(error.category).toBe(category);
    expect(error.diagnostics).toEqual({
      httpStatus: status,
      providerCode: "invalid_request_error",
      providerRequestId: "req_01H_safe",
    });
    expect(JSON.stringify(error.diagnostics)).not.toContain("sensitive provider response");
  });

  it("rejects unsafe provider diagnostic identifiers", () => {
    expect(mapProviderHttpError(
      400,
      { error: { type: "invalid request", message: "sensitive" } },
      new Headers({ "request-id": "../../secret value" }),
    ).diagnostics).toEqual({
      httpStatus: 400,
      providerCode: null,
      providerRequestId: null,
    });
  });

  it("maps provider errors without calling a second provider", async () => {
    const anthropicTransport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { type: "overloaded_error" } },
        { status: 529, headers: { "request-id": "req_01H_overload" } },
      ),
    );
    const deepSeekTransport = vi.fn<typeof fetch>().mockResolvedValue(
      deepSeekResponse({ invalid: true }),
    );
    const anthropic = createAnthropicAnalysisProvider({
      apiKey: "synthetic-anthropic-key",
      model: "claude-sonnet-5",
      timeoutMs: 1_000,
      maxRawResponseBytes: 64_000,
      maxOutputTokens: 2_000,
      transport: anthropicTransport,
    });
    createDeepSeekAnalysisProvider({
      apiKey: "synthetic-deepseek-key",
      model: "deepseek-v4-pro",
      timeoutMs: 1_000,
      maxRawResponseBytes: 64_000,
      maxOutputTokens: 2_000,
      transport: deepSeekTransport,
    });

    const service = createFascicoloDocumentAnalysisService({
      provider: anthropic,
      maxInputBytes: 64_000,
      realDataActivation: activation,
    });
    await expect(service.analyze(analysisInput)).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      providerDiagnostics: {
        httpStatus: 529,
        providerCode: "overloaded_error",
        providerRequestId: "req_01H_overload",
      },
    });
    expect(anthropicTransport).toHaveBeenCalledOnce();
    expect(deepSeekTransport).not.toHaveBeenCalled();
  });

  it("fails a timed-out request without retry or fallback", async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      })
    ));
    const provider = createAnthropicAnalysisProvider({
      apiKey: "synthetic-anthropic-key",
      model: "claude-sonnet-5",
      timeoutMs: 1,
      maxRawResponseBytes: 64_000,
      maxOutputTokens: 2_000,
      transport,
    });
    const service = createFascicoloDocumentAnalysisService({
      provider,
      maxInputBytes: 64_000,
      realDataActivation: activation,
    });

    await expect(service.analyze(analysisInput)).rejects.toMatchObject({
      code: "AI_PROVIDER_TIMEOUT",
    });
    expect(transport).toHaveBeenCalledOnce();
  });
});

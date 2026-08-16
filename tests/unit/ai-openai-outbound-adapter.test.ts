import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY,
  AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY,
  type AiAnalysisProvider,
  type AiAnalysisProviderRequestV1,
  type AiOutboundAnalysisProvider,
  type AiOutboundAnalysisProviderRequestV1,
} from "@/server/ai/fascicoloAnalysis";
import { AiProviderAdapterError } from "@/server/ai/providerErrors";
import {
  OPENAI_ANALYSIS_MODEL,
  OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA,
  createOpenAiAnalysisProvider,
  type OpenAiFetch,
} from "@/server/ai/providers/openai";

const SOURCE_SNAPSHOT_HASH_SENTINEL = "SOURCE_SNAPSHOT_HASH_SENTINEL";
const LOCAL_ALIAS_MAPPING_SENTINEL = "LOCAL_ALIAS_MAPPING_SENTINEL";
const TRUSTED_HASH_CONTEXT_SENTINEL = "TRUSTED_HASH_CONTEXT_SENTINEL";
const OUTBOUND_HASH_SENTINEL = "OUTBOUND_HASH_SENTINEL";
const LEGACY_CONTENT_SENTINEL = "LEGACY_CONTENT_SENTINEL";
const OUTBOUND_ALIAS_SENTINEL = "DOC_1";
const MAX_OUTPUT_TOKENS = 321;

const VALID_PROVIDER_PAYLOAD = {
  summary: {
    text: "Synthetic summary",
    basisRefs: ["DOC_1.dataDocumento"],
  },
  timeline: [],
  recordedState: [],
  signals: [],
  investigativeQuestions: [],
  suggestedActivities: [],
  legalResearchQuestions: [],
};

interface CapturedOpenAiBody {
  readonly model: string;
  readonly store: boolean;
  readonly background: boolean;
  readonly tools: readonly unknown[];
  readonly tool_choice: string;
  readonly truncation: string;
  readonly max_output_tokens: number;
  readonly reasoning: { readonly effort: string };
  readonly instructions: string;
  readonly input: readonly {
    readonly role: string;
    readonly content: readonly { readonly type: string; readonly text: string }[];
  }[];
  readonly text: {
    readonly format: {
      readonly type: string;
      readonly name: string;
      readonly schema: unknown;
      readonly strict: boolean;
    };
  };
}

function requestedOutputContract(
  basisRefsMeaning: "TECHNICAL_SNAPSHOT_GROUNDING_ONLY" | "PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY",
): AiAnalysisProviderRequestV1["requestedOutputContract"]
  | AiOutboundAnalysisProviderRequestV1["requestedOutputContract"] {
  return {
    schemaVersion: "ai-fascicolo-analysis/v1",
    outputMode: "STRUCTURED_PAYLOAD_ONLY",
    allowedSections: [
      "summary",
      "timeline",
      "recordedState",
      "signals",
      "investigativeQuestions",
      "suggestedActivities",
      "legalResearchQuestions",
    ],
    signalTypes: ["INFO", "VERIFY"],
    basisRefsMeaning,
  };
}

function legacyRequestFixture(): AiAnalysisProviderRequestV1 {
  return {
    systemPolicy: AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY,
    snapshotData: {
      schemaVersion: "ai-fascicolo-snapshot/v1",
      contentHash: "a".repeat(64),
      content: {
        legacyContent: LEGACY_CONTENT_SENTINEL,
      } as unknown as AiAnalysisProviderRequestV1["snapshotData"]["content"],
    },
    requestedOutputContract: requestedOutputContract(
      "TECHNICAL_SNAPSHOT_GROUNDING_ONLY",
    ) as AiAnalysisProviderRequestV1["requestedOutputContract"],
  };
}

function outboundRequestFixture(): AiOutboundAnalysisProviderRequestV1 {
  return {
    systemPolicy: AI_FASCICOLO_OUTBOUND_ANALYSIS_V1_SYSTEM_POLICY,
    outboundData: {
      schemaVersion: "ai-fascicolo-outbound/v1",
      outboundProjectionHash: OUTBOUND_HASH_SENTINEL,
      outboundProjectionHashAlgorithm: "sha256",
      content: {
        documents: [{ alias: OUTBOUND_ALIAS_SENTINEL, dataDocumento: null }],
        criticita: { coverage: "SELECTED", items: [] },
      } as unknown as AiOutboundAnalysisProviderRequestV1["outboundData"]["content"],
    },
    requestedOutputContract: requestedOutputContract(
      "PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY",
    ) as AiOutboundAnalysisProviderRequestV1["requestedOutputContract"],
  };
}

function openAiResponse(payload: unknown = VALID_PROVIDER_PAYLOAD): Response {
  return new Response(JSON.stringify({
    status: "completed",
    output: [{
      type: "message",
      role: "assistant",
      content: [{
        type: "output_text",
        text: JSON.stringify(payload),
      }],
    }],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function parseCapturedBody(init: RequestInit | undefined): CapturedOpenAiBody {
  if (typeof init?.body !== "string") {
    throw new Error("Expected a serialized request body");
  }
  return JSON.parse(init.body) as CapturedOpenAiBody;
}

function assertLockedSettings(body: CapturedOpenAiBody): void {
  expect(body.model).toBe(OPENAI_ANALYSIS_MODEL);
  expect(body.store).toBe(false);
  expect(body.background).toBe(false);
  expect(body.tools).toEqual([]);
  expect(body.tool_choice).toBe("none");
  expect(body.truncation).toBe("disabled");
  expect(body.max_output_tokens).toBe(MAX_OUTPUT_TOKENS);
  expect(body.reasoning).toEqual({ effort: "low" });
  expect(body.text.format).toMatchObject({
    type: "json_schema",
    name: "fascicolo_analysis_v1",
    strict: true,
  });
  expect(body.text.format.schema).toEqual(OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA);
  expect(body.input).toHaveLength(1);
  expect(body.input[0].role).toBe("user");
  expect(body.input[0].content).toHaveLength(1);
  expect(body.input[0].content[0].type).toBe("input_text");
  expect(body).not.toHaveProperty("previous_response_id");
  expect(body).not.toHaveProperty("conversation");
}

function createConfig(transport: OpenAiFetch, maxRawResponseBytes = 64_000) {
  return {
    apiKey: "synthetic-api-key",
    timeoutMs: 1_000,
    maxRawResponseBytes,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    region: "GLOBAL" as const,
    transport,
  };
}

async function expectAdapterError(operation: () => Promise<unknown>, category: string): Promise<void> {
  try {
    await operation();
    throw new Error("Expected adapter failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AiProviderAdapterError);
    expect((error as AiProviderAdapterError).category).toBe(category);
    expect((error as Error).message).toBe(category);
    expect((error as Error).message).not.toContain(OUTBOUND_HASH_SENTINEL);
    expect((error as Error).message).not.toContain(LEGACY_CONTENT_SENTINEL);
  }
}

describe("AI-01C2B2B1 OpenAI outbound serialization", () => {
  it("returns one provider that is assignable to both narrow interfaces without a cast", () => {
    const provider = createOpenAiAnalysisProvider(createConfig(async () => openAiResponse()));
    const legacyProvider: AiAnalysisProvider = provider;
    const outboundProvider: AiOutboundAnalysisProvider = provider;

    expect(legacyProvider).toBe(provider);
    expect(outboundProvider).toBe(provider);
    expectTypeOf(provider).toMatchTypeOf<AiAnalysisProvider>();
    expectTypeOf(provider).toMatchTypeOf<AiOutboundAnalysisProvider>();
  });

  it("preserves legacy snapshot serialization and locked request settings", async () => {
    let calls = 0;
    let capturedInit: RequestInit | undefined;
    const provider = createOpenAiAnalysisProvider(createConfig(async (_input, init) => {
      calls += 1;
      capturedInit = init;
      return openAiResponse();
    }));

    const result = await provider.analyze(legacyRequestFixture());
    const body = parseCapturedBody(capturedInit);
    const userText = body.input[0].content[0].text;

    expect(calls).toBe(1);
    expect(result).toEqual(VALID_PROVIDER_PAYLOAD);
    expect(userText).toContain("BEGIN_UNTRUSTED_SNAPSHOT_DATA");
    expect(userText).toContain("END_UNTRUSTED_SNAPSHOT_DATA");
    expect(userText).toContain(LEGACY_CONTENT_SENTINEL);
    expect(userText).not.toContain("BEGIN_UNTRUSTED_OUTBOUND_DATA");
    expect(userText).not.toContain("END_UNTRUSTED_OUTBOUND_DATA");
    expect(JSON.parse(body.instructions)).toEqual({
      systemPolicy: AI_FASCICOLO_ANALYSIS_V1_SYSTEM_POLICY,
      requestedOutputContract: legacyRequestFixture().requestedOutputContract,
    });
    assertLockedSettings(body);
  });

  it("serializes only outboundData with outbound markers and passes policy semantics through", async () => {
    let calls = 0;
    let capturedInit: RequestInit | undefined;
    const request = outboundRequestFixture();
    const provider = createOpenAiAnalysisProvider(createConfig(async (_input, init) => {
      calls += 1;
      capturedInit = init;
      return openAiResponse();
    }));

    const result = await provider.analyze(request);
    const body = parseCapturedBody(capturedInit);
    const userText = body.input[0].content[0].text;
    const instructions = JSON.parse(body.instructions) as {
      systemPolicy: unknown;
      requestedOutputContract: unknown;
    };

    expect(calls).toBe(1);
    expect(result).toEqual(VALID_PROVIDER_PAYLOAD);
    expect(userText).toContain("BEGIN_UNTRUSTED_OUTBOUND_DATA");
    expect(userText).toContain("END_UNTRUSTED_OUTBOUND_DATA");
    expect(userText).not.toContain("BEGIN_UNTRUSTED_SNAPSHOT_DATA");
    expect(userText).not.toContain("END_UNTRUSTED_SNAPSHOT_DATA");
    expect(userText.toLowerCase()).not.toContain("snapshot");
    expect(userText).toContain(OUTBOUND_HASH_SENTINEL);
    expect(userText).toContain("sha256");
    expect(userText).toContain(OUTBOUND_ALIAS_SENTINEL);
    expect(instructions.systemPolicy).toEqual(request.systemPolicy);
    expect(instructions.requestedOutputContract).toEqual(request.requestedOutputContract);
    expect(body.instructions).toContain("proiezione outbound minimizzata");
    expect(body.instructions).toContain("PROVIDER_VISIBLE_OUTBOUND_ALIAS_OR_PATH_ONLY");
    expect(request).not.toHaveProperty("sourceSnapshotContentHash");
    expect(request).not.toHaveProperty("localAliasMapping");
    expect(request).not.toHaveProperty("localOnly");
    expect(request).not.toHaveProperty("trustedHashContext");
    for (const forbidden of [
      SOURCE_SNAPSHOT_HASH_SENTINEL,
      LOCAL_ALIAS_MAPPING_SENTINEL,
      TRUSTED_HASH_CONTEXT_SENTINEL,
    ]) {
      expect(JSON.stringify(body)).not.toContain(forbidden);
    }
    assertLockedSettings(body);
  });

  it("uses the exact same Structured Output schema for legacy and outbound requests", async () => {
    const capturedBodies: CapturedOpenAiBody[] = [];
    const provider = createOpenAiAnalysisProvider(createConfig(async (_input, init) => {
      capturedBodies.push(parseCapturedBody(init));
      return openAiResponse();
    }));

    await provider.analyze(legacyRequestFixture());
    await provider.analyze(outboundRequestFixture());

    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[1].text).toEqual(capturedBodies[0].text);
    expect(capturedBodies[1].text.format.schema).toEqual(OPENAI_PROVIDER_ANALYSIS_JSON_SCHEMA);
  });

  it("rejects requests with both discriminators before transport", async () => {
    let calls = 0;
    const provider = createOpenAiAnalysisProvider(createConfig(async () => {
      calls += 1;
      return openAiResponse();
    }));
    const malformed = {
      ...legacyRequestFixture(),
      outboundData: outboundRequestFixture().outboundData,
    } as unknown as AiAnalysisProviderRequestV1;

    await expectAdapterError(() => provider.analyze(malformed), "CONFIGURATION");
    expect(calls).toBe(0);
  });

  it("rejects requests with neither discriminator before transport", async () => {
    let calls = 0;
    const provider = createOpenAiAnalysisProvider(createConfig(async () => {
      calls += 1;
      return openAiResponse();
    }));
    const outbound = outboundRequestFixture();
    const malformed = {
      systemPolicy: outbound.systemPolicy,
      requestedOutputContract: outbound.requestedOutputContract,
    } as unknown as AiOutboundAnalysisProviderRequestV1;

    await expectAdapterError(() => provider.analyze(malformed), "CONFIGURATION");
    expect(calls).toBe(0);
  });

  it.each([
    [429, "RATE_LIMITED"],
    [408, "TIMEOUT"],
    [403, "CONFIGURATION"],
    [503, "UNAVAILABLE"],
  ] as const)("preserves outbound HTTP %s mapping as %s without retry", async (status, category) => {
    let calls = 0;
    const provider = createOpenAiAnalysisProvider(createConfig(async () => {
      calls += 1;
      return new Response(null, { status });
    }));

    await expectAdapterError(() => provider.analyze(outboundRequestFixture()), category);
    expect(calls).toBe(1);
  });

  it("applies the existing raw response byte bound to outbound responses", async () => {
    let calls = 0;
    const oversizedRawBody = "RAW_RESPONSE_SENTINEL".repeat(20);
    const provider = createOpenAiAnalysisProvider(createConfig(async () => {
      calls += 1;
      return new Response(oversizedRawBody, { status: 200 });
    }, 16));

    const result = await provider.analyze(outboundRequestFixture());

    expect(calls).toBe(1);
    expect(result).toBeNull();
    expect(JSON.stringify(result)).not.toContain("RAW_RESPONSE_SENTINEL");
  });
});

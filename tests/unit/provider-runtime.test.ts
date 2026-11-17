import { beforeEach, describe, expect, it, vi } from "vitest";

const createOpenAiRuntime = vi.hoisted(() => vi.fn());
const analyze = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/openaiRuntime", () => ({
  createOpenAiFascicoloDocumentRuntimeFromEnv: createOpenAiRuntime,
}));

import {
  AI_MODEL_CATALOG,
  DEFAULT_AI_MODEL_SELECTION,
} from "@/server/ai/providerCatalog";
import {
  AiProviderRuntimeConfigurationError,
  resolveAiDocumentRuntimeFromEnv,
} from "@/server/ai/providerRuntime";

const environment = {
  AI_OPENAI_API_KEY: "synthetic-openai-key",
  AI_OPENAI_REGION: "GLOBAL",
  AI_OPENAI_TIMEOUT_MS: "45000",
  AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "262144",
  AI_OPENAI_MAX_OUTPUT_TOKENS: "8192",
  AI_OPENAI_MAX_INPUT_TOKENS: "100000",
  AI_MAX_INPUT_BYTES: "262144",
  AI_REAL_DATA_ENABLED: "true",
  AI_REAL_DATA_APPROVAL_ID: "SYNTHETIC-APPROVAL",
  AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
  AI_OPENAI_USD_TO_EUR_RATE: "0.9",
  ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR: "1.25",
};

describe("provider-neutral runtime resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOpenAiRuntime.mockReturnValue({ analyze });
  });

  it("wraps the existing OpenAI runtime without changing its construction contract", () => {
    const resolved = resolveAiDocumentRuntimeFromEnv({
      selection: DEFAULT_AI_MODEL_SELECTION,
      environment,
    });

    expect(createOpenAiRuntime).toHaveBeenCalledOnce();
    expect(createOpenAiRuntime).toHaveBeenCalledWith(
      environment,
      {
        telemetry: {
          onRequestSent: expect.any(Function),
          onUsage: expect.any(Function),
        },
      },
      undefined,
    );
    expect(resolved.runtime).toEqual({ analyze });
    expect(resolved.selection).toEqual(DEFAULT_AI_MODEL_SELECTION);
    expect(resolved.estimatedAmountEur).toBe(1.25);
    expect(resolved.authorizationRef).toBe("SYNTHETIC-APPROVAL");
    expect(resolved.requestWasSent()).toBe(false);
    expect(resolved.actualAmountEur()).toBeNull();

    const telemetry = createOpenAiRuntime.mock.calls[0]?.[1].telemetry;
    telemetry.onRequestSent();
    telemetry.onUsage({
      inputTokens: 1_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 100,
      reasoningOutputTokens: 20,
    });
    expect(resolved.requestWasSent()).toBe(true);
    expect(resolved.actualAmountEur()).toBe(0.00288);
  });

  it.each([AI_MODEL_CATALOG[1].selection, AI_MODEL_CATALOG[2].selection])(
    "blocks $provider before constructing a real-data runtime",
    (selection) => {
      expect(() => resolveAiDocumentRuntimeFromEnv({
        selection,
        environment,
      })).toThrow(new AiProviderRuntimeConfigurationError(
        "AI_PROVIDER_REAL_DATA_NOT_APPROVED",
      ));
      expect(createOpenAiRuntime).not.toHaveBeenCalled();
    },
  );
});

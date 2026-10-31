import { describe, expect, it } from "vitest";

import {
  assertGpt56TerraMaximumCost,
  calculateGpt56TerraCost,
  OpenAiUsageAccountingError,
  parseOpenAiBillableUsage,
} from "@/server/ai/openaiAccounting";

describe("OpenAI GPT-5.6 Terra accounting", () => {
  it("parses input, cached input, cache writes, output, and reasoning separately", () => {
    expect(parseOpenAiBillableUsage({
      usage: {
        input_tokens: 100_000,
        input_tokens_details: {
          cached_tokens: 20_000,
          cache_write_tokens: 10_000,
        },
        output_tokens: 8_192,
        output_tokens_details: { reasoning_tokens: 2_000 },
        total_tokens: 108_192,
      },
    })).toEqual({
      inputTokens: 100_000,
      cachedInputTokens: 20_000,
      cacheWriteInputTokens: 10_000,
      outputTokens: 8_192,
      reasoningOutputTokens: 2_000,
    });
  });

  it("calculates billable USD and rounds accounted EUR upward to six decimals", () => {
    expect(calculateGpt56TerraCost({
      usage: {
        inputTokens: 100_000,
        cachedInputTokens: 20_000,
        cacheWriteInputTokens: 10_000,
        outputTokens: 8_192,
        reasoningOutputTokens: 2_000,
      },
      usdToEurRate: 0.92,
    })).toMatchObject({
      billableUsd: 0.267304,
      accountedEur: 0.24592,
      usdToEurRate: 0.92,
      pricingEffectiveDate: "2026-10-21",
    });
  });

  it("applies long-context input and output multipliers to the whole request", () => {
    expect(calculateGpt56TerraCost({
      usage: {
        inputTokens: 300_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 10_000,
        reasoningOutputTokens: 10_000,
      },
      usdToEurRate: 1,
    }).billableUsd).toBeCloseTo(1.38, 12);
  });

  it("uses cache-write pricing for the conservative preflight ceiling", () => {
    expect(assertGpt56TerraMaximumCost({
      maxInputTokens: 100_000,
      maxOutputTokens: 8_192,
      usdToEurRate: 1,
      maxCostEur: 0.5,
    }).accountedEur).toBe(0.348304);
    expect(() => assertGpt56TerraMaximumCost({
      maxInputTokens: 200_000,
      maxOutputTokens: 8_192,
      usdToEurRate: 1,
      maxCostEur: 0.5,
    })).toThrowError(expect.objectContaining({
      code: "OPENAI_COST_LIMIT_EXCEEDED",
    }));
  });

  it.each([
    {
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 },
        output_tokens: 1,
      },
    },
    {
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 2 },
      },
    },
    {
      usage: {
        input_tokens: 10,
        output_tokens: 1,
        total_tokens: 99,
      },
    },
  ])("rejects inconsistent provider usage: %o", (response) => {
    expect(() => parseOpenAiBillableUsage(response))
      .toThrowError(OpenAiUsageAccountingError);
  });
});

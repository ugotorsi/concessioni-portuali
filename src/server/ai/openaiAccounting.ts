import { z } from "zod";

export const GPT_5_6_TERRA_PRICING = Object.freeze({
  model: "gpt-5.6-terra",
  effectiveDate: "2026-10-21",
  source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
  inputUsdPerMillion: 2,
  cachedInputUsdPerMillion: 0.2,
  cacheWriteUsdPerMillion: 2.5,
  outputUsdPerMillion: 12,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
} as const);

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({
    cached_tokens: z.number().int().nonnegative().optional().default(0),
    cache_write_tokens: z.number().int().nonnegative().optional().default(0),
  }).passthrough().optional().default({ cached_tokens: 0, cache_write_tokens: 0 }),
  output_tokens: z.number().int().nonnegative(),
  output_tokens_details: z.object({
    reasoning_tokens: z.number().int().nonnegative().optional().default(0),
  }).passthrough().optional().default({ reasoning_tokens: 0 }),
  total_tokens: z.number().int().nonnegative().optional(),
}).passthrough();

export interface OpenAiBillableUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface OpenAiCostAccounting {
  usage: OpenAiBillableUsage;
  billableUsd: number;
  accountedEur: number;
  usdToEurRate: number;
  pricingEffectiveDate: string;
}

export class OpenAiUsageAccountingError extends Error {
  constructor(readonly code:
    | "OPENAI_USAGE_MISSING_OR_INVALID"
    | "OPENAI_USAGE_INCONSISTENT"
    | "OPENAI_MODEL_MISMATCH"
    | "OPENAI_ACCOUNTING_RATE_INVALID"
    | "OPENAI_COST_LIMIT_EXCEEDED") {
    super(code);
    this.name = "OpenAiUsageAccountingError";
  }
}

function roundUpToSixDecimals(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function parseOpenAiBillableUsage(responseBody: unknown): OpenAiBillableUsage {
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    throw new OpenAiUsageAccountingError("OPENAI_USAGE_MISSING_OR_INVALID");
  }
  const parsed = usageSchema.safeParse((responseBody as Record<string, unknown>).usage);
  if (!parsed.success) {
    throw new OpenAiUsageAccountingError("OPENAI_USAGE_MISSING_OR_INVALID");
  }
  const cachedInputTokens = parsed.data.input_tokens_details.cached_tokens;
  const cacheWriteInputTokens = parsed.data.input_tokens_details.cache_write_tokens;
  const reasoningOutputTokens = parsed.data.output_tokens_details.reasoning_tokens;
  if (cachedInputTokens + cacheWriteInputTokens > parsed.data.input_tokens
    || reasoningOutputTokens > parsed.data.output_tokens
    || (parsed.data.total_tokens !== undefined
      && parsed.data.total_tokens !== parsed.data.input_tokens + parsed.data.output_tokens)) {
    throw new OpenAiUsageAccountingError("OPENAI_USAGE_INCONSISTENT");
  }
  return {
    inputTokens: parsed.data.input_tokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens: parsed.data.output_tokens,
    reasoningOutputTokens,
  };
}

export function calculateGpt56TerraCost(input: {
  usage: OpenAiBillableUsage;
  usdToEurRate: number;
}): OpenAiCostAccounting {
  if (!Number.isFinite(input.usdToEurRate) || input.usdToEurRate <= 0) {
    throw new OpenAiUsageAccountingError("OPENAI_ACCOUNTING_RATE_INVALID");
  }
  const uncachedInputTokens = input.usage.inputTokens
    - input.usage.cachedInputTokens
    - input.usage.cacheWriteInputTokens;
  if (uncachedInputTokens < 0
    || input.usage.reasoningOutputTokens > input.usage.outputTokens) {
    throw new OpenAiUsageAccountingError("OPENAI_USAGE_INCONSISTENT");
  }
  const longContext = input.usage.inputTokens
    > GPT_5_6_TERRA_PRICING.longContextThresholdTokens;
  const inputMultiplier = longContext
    ? GPT_5_6_TERRA_PRICING.longContextInputMultiplier
    : 1;
  const outputMultiplier = longContext
    ? GPT_5_6_TERRA_PRICING.longContextOutputMultiplier
    : 1;
  const billableUsd = inputMultiplier * (
    uncachedInputTokens * GPT_5_6_TERRA_PRICING.inputUsdPerMillion
    + input.usage.cachedInputTokens * GPT_5_6_TERRA_PRICING.cachedInputUsdPerMillion
    + input.usage.cacheWriteInputTokens * GPT_5_6_TERRA_PRICING.cacheWriteUsdPerMillion
  ) / 1_000_000
    + outputMultiplier * input.usage.outputTokens
      * GPT_5_6_TERRA_PRICING.outputUsdPerMillion / 1_000_000;
  return {
    usage: input.usage,
    billableUsd,
    accountedEur: roundUpToSixDecimals(billableUsd * input.usdToEurRate),
    usdToEurRate: input.usdToEurRate,
    pricingEffectiveDate: GPT_5_6_TERRA_PRICING.effectiveDate,
  };
}

export function assertGpt56TerraMaximumCost(input: {
  maxInputTokens: number;
  maxOutputTokens: number;
  usdToEurRate: number;
  maxCostEur: number;
}): OpenAiCostAccounting {
  const accounting = calculateGpt56TerraCost({
    usage: {
      inputTokens: input.maxInputTokens,
      cachedInputTokens: 0,
      cacheWriteInputTokens: input.maxInputTokens,
      outputTokens: input.maxOutputTokens,
      reasoningOutputTokens: input.maxOutputTokens,
    },
    usdToEurRate: input.usdToEurRate,
  });
  if (accounting.accountedEur > input.maxCostEur) {
    throw new OpenAiUsageAccountingError("OPENAI_COST_LIMIT_EXCEEDED");
  }
  return accounting;
}

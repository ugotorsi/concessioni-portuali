import { z } from "zod";

export const aiBillableUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens + usage.cacheWriteInputTokens > usage.inputTokens) {
    context.addIssue({ code: "custom", message: "AI_USAGE_INPUT_INCONSISTENT" });
  }
  if (usage.reasoningOutputTokens > usage.outputTokens) {
    context.addIssue({ code: "custom", message: "AI_USAGE_OUTPUT_INCONSISTENT" });
  }
});

export type AiBillableUsage = z.infer<typeof aiBillableUsageSchema>;

export interface AiTokenPricing {
  readonly version: string;
  readonly effectiveDate: string;
  readonly inputUsdPerMillion: number;
  readonly cachedInputUsdPerMillion: number;
  readonly cacheWriteUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}

export interface AiCostAccounting {
  readonly usage: AiBillableUsage;
  readonly billableUsd: number;
  readonly accountedEur: number;
  readonly usdToEurRate: number;
  readonly pricingVersion: string;
  readonly pricingEffectiveDate: string;
}

export class AiUsageAccountingError extends Error {
  constructor(readonly code:
    | "AI_USAGE_MISSING_OR_INVALID"
    | "AI_USAGE_INCONSISTENT"
    | "AI_PRICING_MISSING_OR_INVALID"
    | "AI_ACCOUNTING_RATE_INVALID"
    | "AI_COST_LIMIT_EXCEEDED") {
    super(code);
    this.name = "AiUsageAccountingError";
  }
}

function positivePrice(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function roundUpToSixDecimals(value: number): number {
  return Math.ceil((value - Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function calculateAiTokenCost(input: {
  usage: AiBillableUsage;
  pricing: AiTokenPricing | null;
  usdToEurRate: number;
}): AiCostAccounting {
  const usage = aiBillableUsageSchema.safeParse(input.usage);
  if (!usage.success) {
    throw new AiUsageAccountingError("AI_USAGE_INCONSISTENT");
  }
  if (!input.pricing
    || !input.pricing.version.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.pricing.effectiveDate)
    || !positivePrice(input.pricing.inputUsdPerMillion)
    || !positivePrice(input.pricing.cachedInputUsdPerMillion)
    || !positivePrice(input.pricing.cacheWriteUsdPerMillion)
    || !positivePrice(input.pricing.outputUsdPerMillion)) {
    throw new AiUsageAccountingError("AI_PRICING_MISSING_OR_INVALID");
  }
  if (!Number.isFinite(input.usdToEurRate) || input.usdToEurRate <= 0) {
    throw new AiUsageAccountingError("AI_ACCOUNTING_RATE_INVALID");
  }
  const uncachedInputTokens = usage.data.inputTokens
    - usage.data.cachedInputTokens
    - usage.data.cacheWriteInputTokens;
  const billableUsd = (
    uncachedInputTokens * input.pricing.inputUsdPerMillion
    + usage.data.cachedInputTokens * input.pricing.cachedInputUsdPerMillion
    + usage.data.cacheWriteInputTokens * input.pricing.cacheWriteUsdPerMillion
    + usage.data.outputTokens * input.pricing.outputUsdPerMillion
  ) / 1_000_000;
  return {
    usage: usage.data,
    billableUsd,
    accountedEur: roundUpToSixDecimals(billableUsd * input.usdToEurRate),
    usdToEurRate: input.usdToEurRate,
    pricingVersion: input.pricing.version,
    pricingEffectiveDate: input.pricing.effectiveDate,
  };
}

export function assertAiMaximumCost(input: {
  maxInputTokens: number;
  maxOutputTokens: number;
  pricing: AiTokenPricing | null;
  usdToEurRate: number;
  maxCostEur: number;
}): AiCostAccounting {
  if (!Number.isSafeInteger(input.maxInputTokens) || input.maxInputTokens <= 0
    || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0
    || !Number.isFinite(input.maxCostEur) || input.maxCostEur <= 0) {
    throw new AiUsageAccountingError("AI_PRICING_MISSING_OR_INVALID");
  }
  const accounting = calculateAiTokenCost({
    usage: {
      inputTokens: input.maxInputTokens,
      cachedInputTokens: 0,
      cacheWriteInputTokens: input.maxInputTokens,
      outputTokens: input.maxOutputTokens,
      reasoningOutputTokens: input.maxOutputTokens,
    },
    pricing: input.pricing,
    usdToEurRate: input.usdToEurRate,
  });
  if (accounting.accountedEur > input.maxCostEur) {
    throw new AiUsageAccountingError("AI_COST_LIMIT_EXCEEDED");
  }
  return accounting;
}

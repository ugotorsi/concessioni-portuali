import type { AiProviderId } from "@/server/ai/providerCatalog";
import type { AiTokenPricing } from "@/server/ai/providerAccounting";

export const MULTI_AI_PRICING_REFERENCE_CATALOG_VERSION =
  "MULTI_AI_PRICING_REFERENCE_2026_11_05" as const;

const referenceMetadata = {
  currency: "USD",
  unitTokens: 1_000_000,
  accessedOn: "2026-11-05",
  approvalStatus: "REFERENCE_ONLY_UNAPPROVED",
  usdToEurRate: null,
} as const;

export const UNAPPROVED_MULTI_AI_PRICING_REFERENCES = {
  ANTHROPIC: {
    ...referenceMetadata,
    provider: "ANTHROPIC",
    model: "claude-sonnet-5",
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    rates: {
      input: 2,
      output: 10,
      cacheHit: 0.2,
      cacheWrite5Minutes: 2.5,
      cacheWrite1Hour: 4,
    },
    conservativeQualificationRate: {
      inputUsdPerMillion: 2,
      cachedInputUsdPerMillion: 0.2,
      cacheWriteUsdPerMillion: 4,
      outputUsdPerMillion: 10,
      basis: "Uses the higher documented one-hour cache-write rate.",
    },
  },
  DEEPSEEK: {
    ...referenceMetadata,
    provider: "DEEPSEEK",
    model: "deepseek-v4-pro",
    sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
    rates: {
      offPeak: {
        inputCacheMiss: 0.66,
        inputCacheHit: 0.022,
        output: 1.98,
      },
      peak: {
        inputCacheMiss: 1.32,
        inputCacheHit: 0.044,
        output: 3.96,
      },
    },
    peakSchedule: {
      timeZone: "UTC",
      windows: ["01:00-04:00", "06:00-10:00"],
      applicability: "Weekdays excluding Chinese public holidays.",
      qualificationRule: "Always estimate with peak rates.",
    },
    conservativeQualificationRate: {
      inputUsdPerMillion: 1.32,
      cachedInputUsdPerMillion: 0.044,
      cacheWriteUsdPerMillion: 1.32,
      outputUsdPerMillion: 3.96,
      basis: "Uses documented peak rates; cache writes are costed as cache-miss input.",
    },
  },
} as const satisfies Record<Exclude<AiProviderId, "OPENAI">, {
  readonly provider: Exclude<AiProviderId, "OPENAI">;
  readonly model: string;
  readonly sourceUrl: string;
  readonly currency: "USD";
  readonly unitTokens: 1_000_000;
  readonly accessedOn: string;
  readonly approvalStatus: "REFERENCE_ONLY_UNAPPROVED";
  readonly usdToEurRate: null;
  readonly conservativeQualificationRate: Omit<AiTokenPricing, "version" | "effectiveDate"> & {
    readonly basis: string;
  };
} & Record<string, unknown>>;

export function syntheticQualificationPricing(
  provider: Exclude<AiProviderId, "OPENAI">,
): AiTokenPricing {
  const reference = UNAPPROVED_MULTI_AI_PRICING_REFERENCES[provider];
  return {
    version: `${MULTI_AI_PRICING_REFERENCE_CATALOG_VERSION}_${provider}_UNAPPROVED`,
    effectiveDate: reference.accessedOn,
    inputUsdPerMillion: reference.conservativeQualificationRate.inputUsdPerMillion,
    cachedInputUsdPerMillion:
      reference.conservativeQualificationRate.cachedInputUsdPerMillion,
    cacheWriteUsdPerMillion:
      reference.conservativeQualificationRate.cacheWriteUsdPerMillion,
    outputUsdPerMillion: reference.conservativeQualificationRate.outputUsdPerMillion,
  };
}

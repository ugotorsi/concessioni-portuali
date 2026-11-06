import { createHmac } from "node:crypto";

import type { AiProviderId } from "@/server/ai/providerCatalog";
import { ANTHROPIC_API_VERSION } from "@/server/ai/providers/anthropicProtocol";

export const AI_PROVIDER_ENVIRONMENT = {
  OPENAI: {
    credentialName: "AI_OPENAI_API_KEY",
    estimateName: "ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR",
    modelsUrl: "https://api.openai.com/v1/models",
    headers: (apiKey: string) => ({
      Authorization: "Bearer " + apiKey,
    }),
  },
  ANTHROPIC: {
    credentialName: "AI_ANTHROPIC_API_KEY",
    estimateName: "ASYNC_COST_ANTHROPIC_ANALYSIS_ESTIMATE_EUR",
    modelsUrl: "https://api.anthropic.com/v1/models",
    headers: (apiKey: string) => ({
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    }),
  },
  DEEPSEEK: {
    credentialName: "AI_DEEPSEEK_API_KEY",
    estimateName: "ASYNC_COST_DEEPSEEK_ANALYSIS_ESTIMATE_EUR",
    modelsUrl: "https://api.deepseek.com/models",
    headers: (apiKey: string) => ({
      Authorization: "Bearer " + apiKey,
    }),
  },
} as const satisfies Record<AiProviderId, {
  credentialName: string;
  estimateName: string;
  modelsUrl: string;
  headers(apiKey: string): Record<string, string>;
}>;

export function aiProviderConfigurationFingerprint(input: {
  readonly provider: AiProviderId;
  readonly model: string;
  readonly apiKey: string;
  readonly fingerprintSecret: string;
}): string {
  return createHmac("sha256", input.fingerprintSecret)
    .update([
      "AI_PROVIDER_CONFIGURATION_V1",
      input.provider,
      input.model,
      input.apiKey,
    ].join("\n"), "utf8")
    .digest("hex");
}

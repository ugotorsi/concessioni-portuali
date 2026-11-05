import { z } from "zod";

import { OPENAI_ANALYSIS_MODEL } from "@/server/ai/providers/openai";

export const AI_MODEL_SELECTION_VERSION = "AI_MODEL_SELECTION_V1" as const;
export const AI_PROVIDER_AUTHORIZATION_VERSION = "AI_PROVIDER_AUTHORIZATION_V1" as const;
export const AI_PROVIDER_DATA_POLICY_VERSION = "AI_PROVIDER_DATA_POLICY_V1" as const;

export const aiProviderIdSchema = z.enum(["OPENAI", "ANTHROPIC", "DEEPSEEK"]);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const aiModelSelectionSchema = z.object({
  provider: aiProviderIdSchema,
  model: z.string().trim().min(1).max(128),
  selectionVersion: z.literal(AI_MODEL_SELECTION_VERSION),
}).strict();
export type AiModelSelection = z.infer<typeof aiModelSelectionSchema>;

export interface AiModelCapabilities {
  readonly strictJsonSchema: boolean;
  readonly jsonObject: boolean;
  readonly usageReporting: boolean;
  readonly promptCaching: boolean;
  readonly realDataApproved: boolean;
  readonly automaticExecutionApproved: boolean;
}

export interface AiModelCatalogEntry {
  readonly selection: AiModelSelection;
  readonly label: string;
  readonly capabilities: AiModelCapabilities;
  readonly pricingVersion: string | null;
  readonly dataPolicyVersion: typeof AI_PROVIDER_DATA_POLICY_VERSION;
}

const entries = [
  {
    selection: {
      provider: "OPENAI",
      model: OPENAI_ANALYSIS_MODEL,
      selectionVersion: AI_MODEL_SELECTION_VERSION,
    },
    label: `OpenAI · ${OPENAI_ANALYSIS_MODEL}`,
    capabilities: {
      strictJsonSchema: true,
      jsonObject: true,
      usageReporting: true,
      promptCaching: true,
      realDataApproved: true,
      automaticExecutionApproved: true,
    },
    pricingVersion: "OPENAI_GPT_5_6_TERRA_2026_10_21",
    dataPolicyVersion: AI_PROVIDER_DATA_POLICY_VERSION,
  },
  {
    selection: {
      provider: "ANTHROPIC",
      model: "claude-sonnet-5",
      selectionVersion: AI_MODEL_SELECTION_VERSION,
    },
    label: "Anthropic · Claude Sonnet 5",
    capabilities: {
      strictJsonSchema: true,
      jsonObject: true,
      usageReporting: true,
      promptCaching: true,
      realDataApproved: false,
      automaticExecutionApproved: false,
    },
    pricingVersion: null,
    dataPolicyVersion: AI_PROVIDER_DATA_POLICY_VERSION,
  },
  {
    selection: {
      provider: "DEEPSEEK",
      model: "deepseek-v4-pro",
      selectionVersion: AI_MODEL_SELECTION_VERSION,
    },
    label: "DeepSeek · V4 Pro",
    capabilities: {
      strictJsonSchema: false,
      jsonObject: true,
      usageReporting: true,
      promptCaching: true,
      realDataApproved: false,
      automaticExecutionApproved: false,
    },
    pricingVersion: null,
    dataPolicyVersion: AI_PROVIDER_DATA_POLICY_VERSION,
  },
] as const satisfies readonly AiModelCatalogEntry[];

export const AI_MODEL_CATALOG: readonly AiModelCatalogEntry[] = entries;
export const DEFAULT_AI_MODEL_SELECTION: AiModelSelection = entries[0].selection;

export function aiModelSelectionCode(selection: AiModelSelection): string {
  return `${selection.provider}:${selection.model}`;
}

export function resolveAiModelSelectionCode(value: unknown): AiModelSelection {
  if (typeof value !== "string") {
    throw new Error("INVALID_AI_MODEL_SELECTION");
  }
  const entry = AI_MODEL_CATALOG.find(
    (candidate) => aiModelSelectionCode(candidate.selection) === value,
  );
  if (!entry) {
    throw new Error("INVALID_AI_MODEL_SELECTION");
  }
  return entry.selection;
}

export function getAiModelCatalogEntry(selection: AiModelSelection): AiModelCatalogEntry {
  const parsed = aiModelSelectionSchema.parse(selection);
  const entry = AI_MODEL_CATALOG.find((candidate) => (
    candidate.selection.provider === parsed.provider
    && candidate.selection.model === parsed.model
    && candidate.selection.selectionVersion === parsed.selectionVersion
  ));
  if (!entry) {
    throw new Error("AI_MODEL_NOT_REGISTERED");
  }
  return entry;
}

export function aiSelectionMetadata(
  selection: AiModelSelection,
  authorizationRef: string,
): Readonly<Record<string, string>> {
  const entry = getAiModelCatalogEntry(selection);
  const normalizedAuthorizationRef = authorizationRef.trim();
  if (!normalizedAuthorizationRef || normalizedAuthorizationRef.length > 512) {
    throw new Error("AI_PROVIDER_AUTHORIZATION_REQUIRED");
  }
  return {
    providerKind: entry.selection.provider,
    modelCode: entry.selection.model,
    selectionVersion: entry.selection.selectionVersion,
    approvalRef: normalizedAuthorizationRef,
    approvalVersion: AI_PROVIDER_AUTHORIZATION_VERSION,
    handlingPolicyVersion: entry.dataPolicyVersion,
    ...(entry.pricingVersion ? { pricingVersion: entry.pricingVersion } : {}),
  };
}

export function aiSelectionFromMetadata(
  metadata: Readonly<Record<string, unknown>>,
): AiModelSelection {
  const provider = metadata.providerKind;
  const model = metadata.modelCode;
  const selectionVersion = metadata.selectionVersion;
  if (provider === undefined && model === undefined && selectionVersion === undefined) {
    return DEFAULT_AI_MODEL_SELECTION;
  }
  return getAiModelCatalogEntry(aiModelSelectionSchema.parse({
    provider,
    model,
    selectionVersion,
  })).selection;
}

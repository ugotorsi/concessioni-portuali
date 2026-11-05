import type { FascicoloDocumentAnalysisInput } from "@/server/ai/fascicoloDocumentAnalysis";
import {
  getAiModelCatalogEntry,
  type AiModelSelection,
} from "@/server/ai/providerCatalog";
import {
  calculateGpt56TerraCost,
  type OpenAiBillableUsage,
} from "@/server/ai/openaiAccounting";
import {
  createOpenAiFascicoloDocumentRuntimeFromEnv,
  type OpenAiRuntimeEnv,
} from "@/server/ai/openaiRuntime";
import type { SelvaraPilotAuthorizationScope } from "@/server/ai/selvaraPilotAuthorization";
import { runtimeCostEstimate } from "@/server/runtime/costConfig";

export class AiProviderRuntimeConfigurationError extends Error {
  constructor(readonly code:
    | "AI_PROVIDER_REAL_DATA_NOT_APPROVED"
    | "AI_PROVIDER_PRICING_NOT_APPROVED"
    | "AI_PROVIDER_SELECTION_INVALID") {
    super(code);
    this.name = "AiProviderRuntimeConfigurationError";
  }
}

export interface ResolvedAiDocumentRuntime {
  readonly selection: AiModelSelection;
  readonly authorizationRef: string;
  readonly pricingVersion: string;
  readonly dataPolicyVersion: string;
  readonly estimatedAmountEur: number;
  readonly runtime: {
    analyze(input: FascicoloDocumentAnalysisInput): Promise<unknown>;
  };
  requestWasSent(): boolean;
  actualAmountEur(): number | null;
}

export function isAiModelReadyForRealData(selection: AiModelSelection): boolean {
  const entry = getAiModelCatalogEntry(selection);
  return entry.capabilities.realDataApproved && entry.pricingVersion !== null;
}

export function aiModelEstimatedAmountEur(
  selection: AiModelSelection,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const entry = getAiModelCatalogEntry(selection);
  if (!entry.capabilities.realDataApproved) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_REAL_DATA_NOT_APPROVED");
  }
  if (!entry.pricingVersion) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_PRICING_NOT_APPROVED");
  }
  if (selection.provider !== "OPENAI") {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_SELECTION_INVALID");
  }
  return runtimeCostEstimate("ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR", environment);
}

export function resolveAiDocumentRuntimeFromEnv(input: {
  selection: AiModelSelection;
  environment?: Readonly<Record<string, string | undefined>>;
  authorizationScope?: SelvaraPilotAuthorizationScope;
}): ResolvedAiDocumentRuntime {
  const environment = input.environment ?? process.env;
  const entry = getAiModelCatalogEntry(input.selection);
  if (!entry.capabilities.realDataApproved) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_REAL_DATA_NOT_APPROVED");
  }
  if (!entry.pricingVersion) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_PRICING_NOT_APPROVED");
  }
  if (input.selection.provider !== "OPENAI") {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_SELECTION_INVALID");
  }
  const usdToEurRate = Number(environment.AI_OPENAI_USD_TO_EUR_RATE);
  if (!Number.isFinite(usdToEurRate) || usdToEurRate <= 0) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_PRICING_NOT_APPROVED");
  }
  let requestSent = false;
  let usage: OpenAiBillableUsage | null = null;
  const runtime = createOpenAiFascicoloDocumentRuntimeFromEnv(
    environment as OpenAiRuntimeEnv,
    {
      telemetry: {
        onRequestSent: () => {
          requestSent = true;
        },
        onUsage: (reportedUsage) => {
          usage = reportedUsage;
        },
      },
    },
    input.authorizationScope,
  );
  const authorizationRef = environment.AI_REAL_DATA_APPROVAL_ID?.trim();
  if (!authorizationRef) {
    throw new AiProviderRuntimeConfigurationError("AI_PROVIDER_REAL_DATA_NOT_APPROVED");
  }
  return {
    selection: entry.selection,
    authorizationRef,
    pricingVersion: entry.pricingVersion,
    dataPolicyVersion: entry.dataPolicyVersion,
    estimatedAmountEur: aiModelEstimatedAmountEur(entry.selection, environment),
    runtime,
    requestWasSent: () => requestSent,
    actualAmountEur: () => usage
      ? calculateGpt56TerraCost({ usage, usdToEurRate }).accountedEur
      : null,
  };
}

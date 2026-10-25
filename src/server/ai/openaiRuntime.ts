import {
  createFascicoloLiveAnalysisService,
  type FascicoloLiveAnalysisService,
} from "@/server/ai/fascicoloLiveAnalysis";
import {
  createFascicoloTrustedReviewProductionService,
  type FascicoloTrustedReviewProductionService,
} from "@/server/ai/fascicoloTrustedReviewProduction";
import {
  createFascicoloDocumentAnalysisService,
  type FascicoloDocumentAnalysisProvider,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  createOpenAiAnalysisProvider,
  OPENAI_DEFAULT_REGION,
  type OpenAiFetch,
  type OpenAiProviderTelemetry,
  type OpenAiRegion,
  type OpenAiTokenCounter,
} from "@/server/ai/providers/openai";
import {
  assertRealDataActivation,
  createRealDataActivationPolicy,
  type RealDataActivationEnv,
} from "@/server/ai/realDataActivation";
import { assertGlobalAiExecutionAllowed } from "@/server/ai/globalAiControl";
import {
  assertSelvaraPilotScopeForConfiguredApproval,
  type SelvaraPilotAuthorizationScope,
} from "@/server/ai/selvaraPilotAuthorization";

export const AI_OPENAI_RUNTIME_ENV_NAMES = [
  "AI_OPENAI_API_KEY",
  "AI_OPENAI_REGION",
  "AI_OPENAI_TIMEOUT_MS",
  "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
  "AI_OPENAI_MAX_OUTPUT_TOKENS",
  "AI_OPENAI_MAX_INPUT_TOKENS",
  "AI_MAX_INPUT_BYTES",
] as const;

export { AI_REAL_DATA_ACTIVATION_ENV_NAMES } from "@/server/ai/realDataActivation";

type OpenAiRuntimeEnvName = (typeof AI_OPENAI_RUNTIME_ENV_NAMES)[number];
export type OpenAiRuntimeEnv = Partial<Record<OpenAiRuntimeEnvName, string | undefined>>
  & RealDataActivationEnv;

export class OpenAiRuntimeConfigurationError extends Error {
  readonly code = "AI_CONFIGURATION_ERROR" as const;

  constructor(readonly envName: OpenAiRuntimeEnvName) {
    super(`AI_CONFIGURATION_ERROR: ${envName} is invalid`);
    this.name = "OpenAiRuntimeConfigurationError";
  }
}

interface ParsedOpenAiRuntimeConfig {
  apiKey: string;
  region: OpenAiRegion;
  timeoutMs: number;
  maxRawResponseBytes: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxInputBytes: number;
}

function invalid(envName: OpenAiRuntimeEnvName): never {
  throw new OpenAiRuntimeConfigurationError(envName);
}

function requiredTrimmedString(env: OpenAiRuntimeEnv, envName: OpenAiRuntimeEnvName): string {
  const value = env[envName];
  if (typeof value !== "string") {
    return invalid(envName);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return invalid(envName);
  }
  return trimmed;
}

function positiveSafeInteger(env: OpenAiRuntimeEnv, envName: OpenAiRuntimeEnvName): number {
  const value = requiredTrimmedString(env, envName);
  if (!/^[0-9]+$/.test(value)) {
    return invalid(envName);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return invalid(envName);
  }
  return parsed;
}

function parseRegion(env: OpenAiRuntimeEnv): OpenAiRegion {
  const configured = env.AI_OPENAI_REGION;
  if (configured === undefined) {
    return OPENAI_DEFAULT_REGION;
  }
  const value = configured.trim();
  if (value !== OPENAI_DEFAULT_REGION) {
    return invalid("AI_OPENAI_REGION");
  }
  return value;
}

function parseRuntimeConfig(env: OpenAiRuntimeEnv): ParsedOpenAiRuntimeConfig {
  return {
    apiKey: requiredTrimmedString(env, "AI_OPENAI_API_KEY"),
    region: parseRegion(env),
    timeoutMs: positiveSafeInteger(env, "AI_OPENAI_TIMEOUT_MS"),
    maxRawResponseBytes: positiveSafeInteger(env, "AI_OPENAI_MAX_RAW_RESPONSE_BYTES"),
    maxOutputTokens: positiveSafeInteger(env, "AI_OPENAI_MAX_OUTPUT_TOKENS"),
    maxInputTokens: positiveSafeInteger(env, "AI_OPENAI_MAX_INPUT_TOKENS"),
    maxInputBytes: positiveSafeInteger(env, "AI_MAX_INPUT_BYTES"),
  };
}

interface OpenAiRuntimeDependencies {
  transport?: OpenAiFetch;
  tokenCounter?: OpenAiTokenCounter;
  telemetry?: OpenAiProviderTelemetry;
}

function createOpenAiFascicoloServiceConfig(
  env: OpenAiRuntimeEnv,
  dependencies: OpenAiRuntimeDependencies,
  authorizationScope?: SelvaraPilotAuthorizationScope,
) {
  const realDataActivation = createRealDataActivationPolicy(env);
  assertRealDataActivation(realDataActivation);
  assertSelvaraPilotScopeForConfiguredApproval(env, authorizationScope);
  const config = parseRuntimeConfig(env);
  const provider = createOpenAiAnalysisProvider({
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRawResponseBytes: config.maxRawResponseBytes,
    maxOutputTokens: config.maxOutputTokens,
    maxInputTokens: config.maxInputTokens,
    region: config.region,
    authorizeRequest: assertGlobalAiExecutionAllowed,
    ...(dependencies.transport ? { transport: dependencies.transport } : {}),
    ...(dependencies.tokenCounter ? { tokenCounter: dependencies.tokenCounter } : {}),
    ...(dependencies.telemetry ? { telemetry: dependencies.telemetry } : {}),
  });
  return {
    provider,
    maxInputBytes: config.maxInputBytes,
    realDataActivation,
  };
}

function defaultOpenAiRuntimeEnv(): OpenAiRuntimeEnv {
  return process.env as unknown as OpenAiRuntimeEnv;
}

export function createOpenAiFascicoloRuntimeFromEnv(
  env: OpenAiRuntimeEnv = defaultOpenAiRuntimeEnv(),
  dependencies: OpenAiRuntimeDependencies = {},
): FascicoloLiveAnalysisService {
  return createFascicoloLiveAnalysisService(createOpenAiFascicoloServiceConfig(env, dependencies));
}

export function createOpenAiFascicoloTrustedReviewProductionRuntimeFromEnv(
  env: OpenAiRuntimeEnv = defaultOpenAiRuntimeEnv(),
  dependencies: OpenAiRuntimeDependencies = {},
): FascicoloTrustedReviewProductionService {
  return createFascicoloTrustedReviewProductionService(
    createOpenAiFascicoloServiceConfig(env, dependencies),
  );
}

export function createOpenAiFascicoloDocumentRuntimeFromEnv(
  env: OpenAiRuntimeEnv = defaultOpenAiRuntimeEnv(),
  dependencies: OpenAiRuntimeDependencies = {},
  authorizationScope?: SelvaraPilotAuthorizationScope,
) {
  const config = createOpenAiFascicoloServiceConfig(env, dependencies, authorizationScope);
  return createFascicoloDocumentAnalysisService({
    provider: config.provider as typeof config.provider & FascicoloDocumentAnalysisProvider,
    maxInputBytes: config.maxInputBytes,
    realDataActivation: config.realDataActivation,
  });
}

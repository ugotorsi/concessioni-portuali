import {
  createFascicoloLiveAnalysisService,
  type FascicoloLiveAnalysisService,
} from "@/server/ai/fascicoloLiveAnalysis";
import {
  createOpenAiAnalysisProvider,
  type OpenAiFetch,
  type OpenAiRegion,
} from "@/server/ai/providers/openai";
import {
  assertRealDataActivation,
  createRealDataActivationPolicy,
  type RealDataActivationEnv,
} from "@/server/ai/realDataActivation";

export const AI_OPENAI_RUNTIME_ENV_NAMES = [
  "AI_OPENAI_API_KEY",
  "AI_OPENAI_REGION",
  "AI_OPENAI_TIMEOUT_MS",
  "AI_OPENAI_MAX_RAW_RESPONSE_BYTES",
  "AI_OPENAI_MAX_OUTPUT_TOKENS",
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
  const value = requiredTrimmedString(env, "AI_OPENAI_REGION");
  if (value !== "GLOBAL" && value !== "EU") {
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
    maxInputBytes: positiveSafeInteger(env, "AI_MAX_INPUT_BYTES"),
  };
}

export function createOpenAiFascicoloRuntimeFromEnv(
  env: OpenAiRuntimeEnv = process.env as unknown as OpenAiRuntimeEnv,
  dependencies: { transport?: OpenAiFetch } = {},
): FascicoloLiveAnalysisService {
  const realDataActivation = createRealDataActivationPolicy(env);
  assertRealDataActivation(realDataActivation);
  const config = parseRuntimeConfig(env);
  const provider = createOpenAiAnalysisProvider({
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRawResponseBytes: config.maxRawResponseBytes,
    maxOutputTokens: config.maxOutputTokens,
    region: config.region,
    ...(dependencies.transport ? { transport: dependencies.transport } : {}),
  });
  return createFascicoloLiveAnalysisService({
    provider,
    maxInputBytes: config.maxInputBytes,
    realDataActivation,
  });
}

export const E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID =
  "procedimento-intake-9a0169f9de7e3a1ec2364691";
export const E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH =
  "e2e-unified-fascicolo-20261009";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST =
  "ep-wispy-breeze-ate2kt5o.c-9.us-east-1.aws.neon.tech";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_NAME = "neondb";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH =
  "br-silent-sun-atmiy16m";

export type FascicoloDocumentStructuredKnowledgeAccessCode =
  | "FEATURE_DISABLED"
  | "BUDGET_APPROVAL_REQUIRED"
  | "PROVIDER_APPROVAL_REQUIRED"
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "ENVIRONMENT_NOT_ALLOWED"
  | "DESTINATION_NOT_ALLOWED"
  | "PROCEDIMENTO_NOT_ALLOWED";

export interface FascicoloDocumentStructuredKnowledgeEnvironment {
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED?: string;
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  DATABASE_URL?: string;
  NEON_BRANCH_ID?: string;
  AI_REAL_DATA_ENABLED?: string;
  AI_REAL_DATA_APPROVAL_ID?: string;
  AI_PROVIDER_PROJECT_CLASS?: string;
  AI_OPENAI_API_KEY?: string;
  AI_OPENAI_PROJECT_ID?: string;
  AI_OPENAI_REGION?: string;
  AI_OPENAI_TIMEOUT_MS?: string;
  AI_OPENAI_MAX_RAW_RESPONSE_BYTES?: string;
  AI_OPENAI_MAX_OUTPUT_TOKENS?: string;
  AI_MAX_INPUT_BYTES?: string;
}

export class FascicoloDocumentStructuredKnowledgeAccessError extends Error {
  constructor(readonly code: FascicoloDocumentStructuredKnowledgeAccessCode) {
    super(code);
    this.name = "FascicoloDocumentStructuredKnowledgeAccessError";
  }
}

export function readFascicoloDocumentStructuredKnowledgeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): FascicoloDocumentStructuredKnowledgeEnvironment {
  return {
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED:
      env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED,
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED:
      env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED,
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: env.VERCEL_GIT_COMMIT_REF,
    DATABASE_URL: env.DATABASE_URL,
    NEON_BRANCH_ID: env.NEON_BRANCH_ID,
    AI_REAL_DATA_ENABLED: env.AI_REAL_DATA_ENABLED,
    AI_REAL_DATA_APPROVAL_ID: env.AI_REAL_DATA_APPROVAL_ID,
    AI_PROVIDER_PROJECT_CLASS: env.AI_PROVIDER_PROJECT_CLASS,
    AI_OPENAI_API_KEY: env.AI_OPENAI_API_KEY,
    AI_OPENAI_PROJECT_ID: env.AI_OPENAI_PROJECT_ID,
    AI_OPENAI_REGION: env.AI_OPENAI_REGION,
    AI_OPENAI_TIMEOUT_MS: env.AI_OPENAI_TIMEOUT_MS,
    AI_OPENAI_MAX_RAW_RESPONSE_BYTES: env.AI_OPENAI_MAX_RAW_RESPONSE_BYTES,
    AI_OPENAI_MAX_OUTPUT_TOKENS: env.AI_OPENAI_MAX_OUTPUT_TOKENS,
    AI_MAX_INPUT_BYTES: env.AI_MAX_INPUT_BYTES,
  };
}

function isPositiveInteger(value: string | undefined): boolean {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function hasProviderConfiguration(
  env: FascicoloDocumentStructuredKnowledgeEnvironment,
): boolean {
  return Boolean(env.AI_OPENAI_API_KEY?.trim())
    && Boolean(env.AI_OPENAI_PROJECT_ID?.trim())
    && (env.AI_OPENAI_REGION === "GLOBAL" || env.AI_OPENAI_REGION === "EU")
    && isPositiveInteger(env.AI_OPENAI_TIMEOUT_MS)
    && isPositiveInteger(env.AI_OPENAI_MAX_RAW_RESPONSE_BYTES)
    && isPositiveInteger(env.AI_OPENAI_MAX_OUTPUT_TOKENS)
    && isPositiveInteger(env.AI_MAX_INPUT_BYTES);
}

function hasAuthorizedDatabaseDestination(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;

  try {
    const url = new URL(databaseUrl);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && url.hostname === E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST
      && url.pathname.replace(/^\/+/, "") === E2E_STRUCTURED_KNOWLEDGE_DATABASE_NAME;
  } catch {
    return false;
  }
}

export function getFascicoloDocumentStructuredKnowledgeAccessCode(input: {
  env: FascicoloDocumentStructuredKnowledgeEnvironment;
  procedimentoId: string;
}): FascicoloDocumentStructuredKnowledgeAccessCode | null {
  if (input.procedimentoId !== E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID) {
    return "PROCEDIMENTO_NOT_ALLOWED";
  }
  if (input.env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED !== "true") {
    return "FEATURE_DISABLED";
  }
  if (input.env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED !== "true") {
    return "BUDGET_APPROVAL_REQUIRED";
  }
  if (
    input.env.AI_REAL_DATA_ENABLED !== "true"
    || !input.env.AI_REAL_DATA_APPROVAL_ID?.trim()
    || input.env.AI_PROVIDER_PROJECT_CLASS !== "REAL_DATA_APPROVED"
  ) {
    return "PROVIDER_APPROVAL_REQUIRED";
  }
  if (!hasProviderConfiguration(input.env)) {
    return "PROVIDER_CONFIGURATION_REQUIRED";
  }
  if (
    input.env.VERCEL_ENV !== "preview"
    || input.env.VERCEL_GIT_COMMIT_REF !== E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH
  ) {
    return "ENVIRONMENT_NOT_ALLOWED";
  }
  if (!hasAuthorizedDatabaseDestination(input.env.DATABASE_URL)) {
    return "DESTINATION_NOT_ALLOWED";
  }
  if (input.env.NEON_BRANCH_ID !== E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH) {
    return "DESTINATION_NOT_ALLOWED";
  }
  return null;
}

export function isFascicoloDocumentStructuredKnowledgeAvailable(input: {
  env: FascicoloDocumentStructuredKnowledgeEnvironment;
  procedimentoId: string;
}): boolean {
  return getFascicoloDocumentStructuredKnowledgeAccessCode(input) === null;
}

export function assertFascicoloDocumentStructuredKnowledgeAvailable(input: {
  env: FascicoloDocumentStructuredKnowledgeEnvironment;
  procedimentoId: string;
}): void {
  const code = getFascicoloDocumentStructuredKnowledgeAccessCode(input);
  if (code) {
    throw new FascicoloDocumentStructuredKnowledgeAccessError(code);
  }
}

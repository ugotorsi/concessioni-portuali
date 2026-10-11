export const E2E_STRUCTURED_KNOWLEDGE_PROCEDIMENTO_ID =
  "procedimento-intake-9a0169f9de7e3a1ec2364691";
export const E2E_STRUCTURED_KNOWLEDGE_GIT_BRANCH =
  "e2e-unified-fascicolo-20261009";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_HOST =
  "ep-wispy-breeze-ate2kt5o.c-9.us-east-1.aws.neon.tech";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_NAME = "neondb";
export const E2E_STRUCTURED_KNOWLEDGE_DATABASE_BRANCH =
  "br-silent-sun-atmiy16m";
export const E2E_STRUCTURED_KNOWLEDGE_TENANT_ID =
  "cmrzd08yp000dqwudd9dvaidl";
export const E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID =
  "proj_qgUdhE5ccior406knOnVkayp";
export const E2E_STRUCTURED_KNOWLEDGE_AUTHORIZATION_MAX_MS = 10 * 60 * 1_000;

export type FascicoloDocumentStructuredKnowledgeAccessCode =
  | "FEATURE_DISABLED"
  | "BUDGET_APPROVAL_REQUIRED"
  | "AUTHORIZATION_INVALID"
  | "AUTHORIZATION_EXPIRED"
  | "PROVIDER_CONFIGURATION_REQUIRED"
  | "ENVIRONMENT_NOT_ALLOWED"
  | "DESTINATION_NOT_ALLOWED"
  | "PROCEDIMENTO_NOT_ALLOWED"
  | "TENANT_NOT_ALLOWED";

export interface FascicoloDocumentStructuredKnowledgeEnvironment {
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_ENABLED?: string;
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_BUDGET_APPROVED?: string;
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE?: string;
  E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  DATABASE_URL?: string;
  NEON_BRANCH_ID?: string;
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
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE:
      env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE,
    E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT:
      env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT,
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: env.VERCEL_GIT_COMMIT_REF,
    DATABASE_URL: env.DATABASE_URL,
    NEON_BRANCH_ID: env.NEON_BRANCH_ID,
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
    && env.AI_OPENAI_PROJECT_ID === E2E_STRUCTURED_KNOWLEDGE_OPENAI_PROJECT_ID
    && env.AI_OPENAI_REGION === "GLOBAL"
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

function authorizationWindowCode(
  env: FascicoloDocumentStructuredKnowledgeEnvironment,
  now: Date,
): FascicoloDocumentStructuredKnowledgeAccessCode | null {
  const notBefore = env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_NOT_BEFORE;
  const expiresAt = env.E2E_FASCICOLO_STRUCTURED_ANALYSIS_EXPIRES_AT;
  if (
    typeof notBefore !== "string"
    || typeof expiresAt !== "string"
    || !notBefore.endsWith("Z")
    || !expiresAt.endsWith("Z")
  ) {
    return "AUTHORIZATION_INVALID";
  }
  const notBeforeMs = Date.parse(notBefore);
  const expiresAtMs = Date.parse(expiresAt);
  const durationMs = expiresAtMs - notBeforeMs;
  if (
    !Number.isFinite(notBeforeMs)
    || !Number.isFinite(expiresAtMs)
    || durationMs <= 0
    || durationMs > E2E_STRUCTURED_KNOWLEDGE_AUTHORIZATION_MAX_MS
  ) {
    return "AUTHORIZATION_INVALID";
  }
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || nowMs < notBeforeMs || nowMs >= expiresAtMs) {
    return "AUTHORIZATION_EXPIRED";
  }
  return null;
}

export function getFascicoloDocumentStructuredKnowledgeAccessCode(input: {
  env: FascicoloDocumentStructuredKnowledgeEnvironment;
  procedimentoId: string;
  tenantId?: string;
  now?: Date;
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
  const authorizationCode = authorizationWindowCode(input.env, input.now ?? new Date());
  if (authorizationCode) {
    return authorizationCode;
  }
  if (
    input.tenantId !== undefined
    && input.tenantId !== E2E_STRUCTURED_KNOWLEDGE_TENANT_ID
  ) {
    return "TENANT_NOT_ALLOWED";
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
  tenantId?: string;
  now?: Date;
}): boolean {
  return getFascicoloDocumentStructuredKnowledgeAccessCode(input) === null;
}

export function assertFascicoloDocumentStructuredKnowledgeAvailable(input: {
  env: FascicoloDocumentStructuredKnowledgeEnvironment;
  procedimentoId: string;
  tenantId?: string;
  now?: Date;
}): void {
  const code = getFascicoloDocumentStructuredKnowledgeAccessCode(input);
  if (code) {
    throw new FascicoloDocumentStructuredKnowledgeAccessError(code);
  }
}

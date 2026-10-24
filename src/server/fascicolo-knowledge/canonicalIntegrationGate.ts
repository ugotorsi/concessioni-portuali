export const CANONICAL_IDENTITY_V3_GATE_ENV = "NOETRA_CANONICAL_IDENTITY_V3_ENABLED" as const;
export const CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID =
  "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu" as const;
export const CANONICAL_IDENTITY_V3_PREVIEW_BRANCH =
  "feat/noetra-legal-applicability-e4447" as const;
export const CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID =
  "ep-misty-shadow-atp8yuc1" as const;
export const CANONICAL_IDENTITY_V3_CONTRACT_VERSION =
  "FASCICOLO_STRUCTURED_KNOWLEDGE_V1_CANONICAL_V3" as const;

function allowlist(value: string | undefined): readonly string[] {
  return [...new Set((value ?? "").split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean))];
}

function targetsCanonicalV3Database(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const hostname = new URL(databaseUrl).hostname;
    return hostname === `${CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID}.c-9.us-east-1.aws.neon.tech`
      || hostname === `${CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID}-pooler.c-9.us-east-1.aws.neon.tech`;
  } catch {
    return false;
  }
}

function isAuthorizedDedicatedWorker(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const operationAllowlist = allowlist(environment.ASYNC_WORKER_OPERATION_ALLOWLIST);
  const procedimentoAllowlist = allowlist(environment.ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST);
  return environment.NODE_ENV === "production"
    && environment.VERCEL_ENV === undefined
    && environment.VERCEL_PROJECT_ID === undefined
    && environment.VERCEL_GIT_COMMIT_REF === undefined
    && environment.ASYNC_WORKER_DEDICATED_MODE === "true"
    && environment.ASYNC_PROVIDER_EXECUTION_ENABLED === "true"
    && environment.ASYNC_WORKER_CONCURRENCY === "1"
    && environment.ASYNC_WORKER_MAX_PROCESSED_JOBS === "1"
    && environment.ASYNC_WORKER_EXIT_ON_IDLE === "true"
    && environment.ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES === "false"
    && operationAllowlist.length === 1
    && operationAllowlist[0] === "FASCICOLO.AUTOMATIC_ANALYSIS_V1"
    && procedimentoAllowlist.length === 1
    && targetsCanonicalV3Database(environment.DATABASE_URL);
}

export function isCanonicalIdentityV3Enabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment[CANONICAL_IDENTITY_V3_GATE_ENV] !== "true") return false;
  if (environment.NODE_ENV === "test") return true;
  const authorizedPreview = environment.NODE_ENV === "production"
    && environment.VERCEL_ENV === "preview"
    && environment.VERCEL_PROJECT_ID === CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID
    && environment.VERCEL_GIT_COMMIT_REF === CANONICAL_IDENTITY_V3_PREVIEW_BRANCH;
  return authorizedPreview || isAuthorizedDedicatedWorker(environment);
}

export function isCanonicalIdentityRevision(
  revision: Readonly<{
    contractVersion: string;
    items: readonly Readonly<{ identityState?: string | null }>[];
  }>,
): boolean {
  return revision.contractVersion === CANONICAL_IDENTITY_V3_CONTRACT_VERSION
    && revision.items.every((item) => (
    item.identityState === "VERIFIED_NEW"
    || item.identityState === "VERIFIED_CONTINUATION"
    || item.identityState === "AMBIGUOUS"
  ));
}

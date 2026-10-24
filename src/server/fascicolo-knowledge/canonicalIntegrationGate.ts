export const CANONICAL_IDENTITY_V3_GATE_ENV = "NOETRA_CANONICAL_IDENTITY_V3_ENABLED" as const;
export const CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID =
  "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu" as const;
export const CANONICAL_IDENTITY_V3_PREVIEW_BRANCH =
  "feat/noetra-legal-applicability-e4447" as const;
export const CANONICAL_IDENTITY_V3_CONTRACT_VERSION =
  "FASCICOLO_STRUCTURED_KNOWLEDGE_V1_CANONICAL_V3" as const;

export function isCanonicalIdentityV3Enabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment[CANONICAL_IDENTITY_V3_GATE_ENV] !== "true") return false;
  if (environment.NODE_ENV === "test") return true;
  return environment.NODE_ENV === "production"
    && environment.VERCEL_ENV === "preview"
    && environment.VERCEL_PROJECT_ID === CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID
    && environment.VERCEL_GIT_COMMIT_REF === CANONICAL_IDENTITY_V3_PREVIEW_BRANCH;
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

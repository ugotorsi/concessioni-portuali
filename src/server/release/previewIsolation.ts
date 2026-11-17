import { createHash } from "node:crypto";

export const ISOLATED_PREVIEW_CLASSIFICATION = "SYNTHETIC_ISOLATED";

export function databaseIdentityFingerprint(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("PREVIEW_DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("PREVIEW_DATABASE_URL_INVALID");
  }
  const identity = [
    url.hostname.toLocaleLowerCase("en-US"),
    url.port || "5432",
    url.pathname.replace(/^\/+/u, ""),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function assertProductionDatabaseIdentity(
  environment: Record<string, string | undefined>,
): void {
  if (environment.VERCEL_ENV !== "production" && environment.NODE_ENV !== "production") return;
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("PRODUCTION_DATABASE_URL_REQUIRED");
  const expectedFingerprint = environment.NOETRA_PRODUCTION_DATABASE_FINGERPRINT?.trim();
  if (!expectedFingerprint) throw new Error("PRODUCTION_DATABASE_IDENTITY_REQUIRED");
  if (databaseIdentityFingerprint(databaseUrl) !== expectedFingerprint) {
    throw new Error("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
  }
}

export function assertIsolatedPreviewEnvironment(
  environment: Record<string, string | undefined>,
): void {
  if (environment.VERCEL_ENV !== "preview") return;
  if (environment.NOETRA_REQUIRE_ISOLATED_PREVIEW !== "true") {
    throw new Error("ISOLATED_PREVIEW_GUARD_REQUIRED");
  }
  if (environment.NOETRA_PREVIEW_DATA_CLASSIFICATION !== ISOLATED_PREVIEW_CLASSIFICATION) {
    throw new Error("ISOLATED_PREVIEW_CLASSIFICATION_REQUIRED");
  }
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("ISOLATED_PREVIEW_DATABASE_URL_REQUIRED");
  const actualFingerprint = databaseIdentityFingerprint(databaseUrl);
  const expectedFingerprint = environment.NOETRA_EXPECTED_PREVIEW_DATABASE_FINGERPRINT?.trim();
  const productionFingerprint = environment.NOETRA_PRODUCTION_DATABASE_FINGERPRINT?.trim();
  if (!expectedFingerprint || actualFingerprint !== expectedFingerprint) {
    throw new Error("ISOLATED_PREVIEW_DATABASE_IDENTITY_MISMATCH");
  }
  if (!productionFingerprint || actualFingerprint === productionFingerprint) {
    throw new Error("ISOLATED_PREVIEW_DATABASE_NOT_SEPARATE");
  }
  if (
    environment.AI_REAL_DATA_ENABLED !== "false"
    || environment.ASYNC_PROVIDER_EXECUTION_ENABLED !== "false"
    || environment.AUTOMATIC_RESEARCH_EXECUTION_ENABLED !== "false"
    || environment.DOCUMENT_WORKER_ACTIVATION_MODE !== "DISABLED"
  ) {
    throw new Error("ISOLATED_PREVIEW_EXECUTION_CONTROLS_UNSAFE");
  }
}

import { describe, expect, it } from "vitest";

import {
  assertIsolatedPreviewEnvironment,
  assertProductionDatabaseIdentity,
  databaseIdentityFingerprint,
} from "@/server/release/previewIsolation";

function environment(databaseUrl = "postgresql://test:secret@preview.example.test:5432/noetra_preview") {
  const previewFingerprint = databaseIdentityFingerprint(databaseUrl);
  return {
    VERCEL_ENV: "preview",
    DATABASE_URL: databaseUrl,
    NOETRA_REQUIRE_ISOLATED_PREVIEW: "true",
    NOETRA_PREVIEW_DATA_CLASSIFICATION: "SYNTHETIC_ISOLATED",
    NOETRA_EXPECTED_PREVIEW_DATABASE_FINGERPRINT: previewFingerprint,
    NOETRA_PRODUCTION_DATABASE_FINGERPRINT: "f".repeat(64),
    AI_REAL_DATA_ENABLED: "false",
    ASYNC_PROVIDER_EXECUTION_ENABLED: "false",
    AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
    DOCUMENT_WORKER_ACTIVATION_MODE: "DISABLED",
  };
}

describe("isolated Preview guard", () => {
  it("accepts a separately identified synthetic Preview with execution disabled", () => {
    expect(() => assertIsolatedPreviewEnvironment(environment())).not.toThrow();
  });

  describe("Production database identity guard", () => {
    const databaseUrl = "postgresql://production.example.test:5432/noetra_production";

    it("accepts only the approved Production database identity", () => {
      expect(() => assertProductionDatabaseIdentity({
        VERCEL_ENV: "production",
        DATABASE_URL: databaseUrl,
        NOETRA_PRODUCTION_DATABASE_FINGERPRINT: databaseIdentityFingerprint(databaseUrl),
      })).not.toThrow();
    });

    it("fails closed when the approved identity is missing or different", () => {
      expect(() => assertProductionDatabaseIdentity({
        VERCEL_ENV: "production",
        DATABASE_URL: databaseUrl,
      })).toThrow("PRODUCTION_DATABASE_IDENTITY_REQUIRED");
      expect(() => assertProductionDatabaseIdentity({
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        NOETRA_PRODUCTION_DATABASE_FINGERPRINT: "0".repeat(64),
      })).toThrow("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
    });

    it("does not constrain non-Production runtimes", () => {
      expect(() => assertProductionDatabaseIdentity({
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
      })).not.toThrow();
    });
  });

  it("rejects a Preview database that matches Production", () => {
    const value = environment();
    value.NOETRA_PRODUCTION_DATABASE_FINGERPRINT = value.NOETRA_EXPECTED_PREVIEW_DATABASE_FINGERPRINT;
    expect(() => assertIsolatedPreviewEnvironment(value)).toThrow("ISOLATED_PREVIEW_DATABASE_NOT_SEPARATE");
  });

  it("rejects an incorrect database identity and enabled execution", () => {
    expect(() => assertIsolatedPreviewEnvironment({
      ...environment(),
      NOETRA_EXPECTED_PREVIEW_DATABASE_FINGERPRINT: "0".repeat(64),
    })).toThrow("ISOLATED_PREVIEW_DATABASE_IDENTITY_MISMATCH");
    expect(() => assertIsolatedPreviewEnvironment({
      ...environment(),
      AI_REAL_DATA_ENABLED: "true",
    })).toThrow("ISOLATED_PREVIEW_EXECUTION_CONTROLS_UNSAFE");
  });

  it("does not affect non-Preview environments", () => {
    expect(() => assertIsolatedPreviewEnvironment({})).not.toThrow();
  });

  it("rejects a Preview that has not enabled the isolation guard", () => {
    expect(() => assertIsolatedPreviewEnvironment({ VERCEL_ENV: "preview" }))
      .toThrow("ISOLATED_PREVIEW_GUARD_REQUIRED");
  });
});

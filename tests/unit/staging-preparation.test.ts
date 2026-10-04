import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const operations = require("../../scripts/legal-research/staging-operations.cjs");
const preparation = require("../../scripts/legal-research/prepare-staging.cjs");
const { trustedStagingIdentity } = require("../../scripts/legal-research/trusted-staging-identity.cjs");

function stagingConfig(overrides: Record<string, unknown> = {}) {
  return {
    environment: "preview",
    nonProductionConfirmed: true,
    vercelProjectId: trustedStagingIdentity.vercelProjectId,
    vercelTeamId: trustedStagingIdentity.vercelTeamScope,
    neonProjectId: trustedStagingIdentity.neonProjectId,
    neonBranchId: trustedStagingIdentity.neonBranchId,
    neonSourceHead: "synthetic-head",
    databaseHost: "synthetic-staging.invalid",
    databaseName: "synthetic",
    previewOrigin: `https://${trustedStagingIdentity.stagingAlias}`,
    workosIssuer: "https://synthetic-issuer.invalid",
    productionOrigins: ["https://synthetic-production.invalid"],
    productionDatabaseHosts: ["synthetic-production-db.invalid"],
    ...overrides,
  };
}

function vercelProject() {
  return {
    id: trustedStagingIdentity.vercelProjectId,
    name: trustedStagingIdentity.vercelProjectName,
  };
}

function vercelDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-deployment",
    projectId: trustedStagingIdentity.vercelProjectId,
    target: null,
    readyState: "READY",
    url: "synthetic-preview.invalid",
    meta: { stagingReleaseId: "synthetic-release" },
    ...overrides,
  };
}

describe("controlled staging preparation offline", () => {
  it.each(["plan", ...operations.actions])("defaults to no network and no mutation: %s", (action) => {
    const result = spawnSync(process.execPath, ["--require", path.resolve("scripts/legal-research/offline-network-guard.cjs"),
      "scripts/legal-research/staging-operations.cjs", action], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).mode).toBe("PLAN_ONLY_NO_NETWORK");
  });

  it("rejects incomplete and production targets", () => {
    expect(() => operations.validateTarget({})).toThrow("NON_PRODUCTION_CONFIRMATION_REQUIRED");
    const config = stagingConfig();
    expect(operations.validateTarget(config)).toBe(config.previewOrigin);
    expect(() => operations.validateTarget({ ...config, previewOrigin: config.productionOrigins[0] })).toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
    expect(() => operations.validateTarget({ ...config, databaseHost: config.productionDatabaseHosts[0] })).toThrow("PRODUCTION_OR_DEMO_TARGET_FORBIDDEN");
  });

  it("fails closed when declared Vercel or Neon identities differ from the trusted staging allowlist", () => {
    expect(() => operations.validateTarget(stagingConfig({ vercelProjectId: "production-project" })))
      .toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
    expect(() => operations.validateTarget(stagingConfig({ vercelTeamId: "production-team" })))
      .toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
    expect(() => operations.validateTarget(stagingConfig({ neonProjectId: "production-neon" })))
      .toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
    expect(() => operations.validateTarget(stagingConfig({ neonBranchId: "production-branch" })))
      .toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
  });

  it("allows only the single trusted staging alias", () => {
    expect(() => operations.validateTarget(stagingConfig({ previewOrigin: "https://other-preview.invalid" })))
      .toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
    expect(() => operations.validateTarget(stagingConfig({
      previewOrigin: `https://${trustedStagingIdentity.stagingAlias}:444`,
    }))).toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
  });

  it("does not let nonProductionConfirmed bypass the trusted identity", () => {
    expect(() => operations.validateTarget(stagingConfig({
      nonProductionConfirmed: true,
      vercelProjectId: "production-project",
      neonBranchId: "production-branch",
    }))).toThrow("TRUSTED_STAGING_IDENTITY_MISMATCH");
  });

  it("compares names, checksums and exact pending suffix without inventing ledger state", () => {
    const migrations = [{ name: "first", sha256: "a" }, { name: "second", sha256: "b" }];
    const row = { migration_name: "first", checksum: "a", finished_at: "synthetic-date", rolled_back_at: null };
    expect(operations.compareMigrations(migrations, [row])).toEqual(["second"]);
    expect(() => operations.compareMigrations(migrations, [{ ...row, checksum: "changed" }])).toThrow("MIGRATION_HISTORY_MISMATCH");
    expect(() => operations.compareMigrations(migrations, [{ ...row, finished_at: null }])).toThrow("FAILED_OR_RUNNING_MIGRATION");
    expect(() => operations.compareMigrations(migrations, [{ ...row, migration_name: "unknown" }])).toThrow("MIGRATION_HISTORY_MISMATCH");
    expect(() => operations.compareMigrations(migrations, [{ ...row, migration_name: "second", checksum: "b" }])).toThrow("NON_LINEAR_MIGRATION_HISTORY");
    expect(() => operations.compareMigrations(migrations, [row, row])).toThrow("DUPLICATE_MIGRATION");
  });

  it("rejects production or cross-project deployment metadata before using the deployment", async () => {
    vi.stubEnv("STAGING_VERCEL_TOKEN", "synthetic-verification-token");
    const config = stagingConfig();
    const response = vercelDeployment();
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      fetchMock.mockResolvedValueOnce(Response.json(vercelProject())).mockResolvedValueOnce(Response.json(response));
      await expect(operations.deploymentMetadata(config, response.id)).resolves.toMatchObject({ id: response.id, releaseId: "synthetic-release" });
      fetchMock.mockResolvedValueOnce(Response.json(vercelProject()))
        .mockResolvedValueOnce(Response.json({ ...response, target: "production" }));
      await expect(operations.deploymentMetadata(config, response.id)).rejects.toThrow("DEPLOYMENT_NOT_AUTHORIZED_PREVIEW");
      fetchMock.mockResolvedValueOnce(Response.json(vercelProject()))
        .mockResolvedValueOnce(Response.json({ ...response, projectId: "other-project" }));
      await expect(operations.deploymentMetadata(config, response.id)).rejects.toThrow("DEPLOYMENT_NOT_AUTHORIZED_PREVIEW");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("rejects mismatched externally attested Vercel project metadata", async () => {
    vi.stubEnv("STAGING_VERCEL_TOKEN", "synthetic-verification-token");
    const fetchMock = vi.fn(async () => Response.json({ ...vercelProject(), id: "production-project" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(operations.deploymentMetadata(stagingConfig(), "synthetic-deployment"))
        .rejects.toThrow("VERCEL_PROJECT_IDENTITY_MISMATCH");
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("rejects database hosts not externally attested to the trusted Neon branch", async () => {
    vi.stubEnv("STAGING_NEON_API_KEY", "synthetic-neon-token");
    vi.stubEnv("STAGING_DATABASE_URL", "postgresql://user:password@manipulated.invalid/synthetic");
    const fetchMock = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ project: { id: trustedStagingIdentity.neonProjectId } }))
      .mockResolvedValueOnce(Response.json({ branch: {
        id: trustedStagingIdentity.neonBranchId,
        project_id: trustedStagingIdentity.neonProjectId,
      } }))
      .mockResolvedValueOnce(Response.json({ endpoints: [{
        id: "synthetic-endpoint",
        project_id: trustedStagingIdentity.neonProjectId,
        branch_id: trustedStagingIdentity.neonBranchId,
        host: "actual-staging.invalid",
      }] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(operations.neonTargetMetadata(stagingConfig({ databaseHost: "manipulated.invalid" })))
        .rejects.toThrow("NEON_DATABASE_IDENTITY_MISMATCH");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("denies real operations when external Vercel or Neon attestation is unavailable", async () => {
    vi.stubEnv("STAGING_VERCEL_TOKEN", "synthetic-verification-token");
    vi.stubEnv("STAGING_NEON_API_KEY", "synthetic-neon-token");
    vi.stubEnv("STAGING_DATABASE_URL", "postgresql://user:password@synthetic-staging.invalid/synthetic");
    const fetchMock = vi.fn(async () => { throw new Error("synthetic network failure"); });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(operations.deploymentMetadata(stagingConfig(), "synthetic-deployment"))
        .rejects.toThrow("VERCEL_METADATA_UNAVAILABLE");
      await expect(operations.neonTargetMetadata(stagingConfig()))
        .rejects.toThrow("NEON_METADATA_UNAVAILABLE");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("selects untracked application sources but no credentials, logs, operational samples or preparation output", () => {
    const files = preparation.selectedFiles().map((file: { path: string }) => file.path);
    expect(files).toContain("src/server/legal-research/trusted-mission-executor.ts");
    expect(files).toContain("scripts/legal-research/execute-trusted-mission.ts");
    expect(files).toContain("prisma/migrations/20260926_assisted_verification_persistence/migration.sql");
    expect(files.some((file: string) => /(^|\/)(\.env|artifacts|tests|staging-preparation)|\.(zip|log|pem|key)$/.test(file))).toBe(false);
    expect(files).not.toContain("prisma/seed.ts");
  });
});
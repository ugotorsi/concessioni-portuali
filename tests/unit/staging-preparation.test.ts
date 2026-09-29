import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const operations = require("../../scripts/legal-research/staging-operations.cjs");
const preparation = require("../../scripts/legal-research/prepare-staging.cjs");

describe("controlled staging preparation offline", () => {
  it.each(["plan", ...operations.actions])("defaults to no network and no mutation: %s", (action) => {
    const result = spawnSync(process.execPath, ["--require", path.resolve("scripts/legal-research/offline-network-guard.cjs"),
      "scripts/legal-research/staging-operations.cjs", action], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).mode).toBe("PLAN_ONLY_NO_NETWORK");
  });

  it("rejects incomplete and production targets", () => {
    expect(() => operations.validateTarget({})).toThrow("NON_PRODUCTION_CONFIRMATION_REQUIRED");
    const config = { environment: "preview", nonProductionConfirmed: true, vercelProjectId: "synthetic-project",
      vercelTeamId: "synthetic-team", neonProjectId: "synthetic-neon", neonBranchId: "synthetic-branch", neonSourceHead: "synthetic-head",
      databaseHost: "synthetic-staging.invalid", databaseName: "synthetic", previewOrigin: "https://synthetic-staging.invalid",
      workosIssuer: "https://synthetic-issuer.invalid", productionOrigins: ["https://synthetic-production.invalid"],
      productionDatabaseHosts: ["synthetic-production-db.invalid"] };
    expect(operations.validateTarget(config)).toBe(config.previewOrigin);
    expect(() => operations.validateTarget({ ...config, previewOrigin: config.productionOrigins[0] })).toThrow("PRODUCTION_OR_DEMO_TARGET_FORBIDDEN");
    expect(() => operations.validateTarget({ ...config, databaseHost: config.productionDatabaseHosts[0] })).toThrow("PRODUCTION_OR_DEMO_TARGET_FORBIDDEN");
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
    const config = { vercelProjectId: "synthetic-project", vercelTeamId: "synthetic-team", productionOrigins: ["https://synthetic-production.invalid"] };
    const response = { id: "synthetic-deployment", projectId: "synthetic-project", target: null, readyState: "READY",
      url: "synthetic-preview.invalid", meta: { stagingReleaseId: "synthetic-release" } };
    const fetchMock = vi.fn(async () => Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(operations.deploymentMetadata(config, response.id)).resolves.toMatchObject({ id: response.id, releaseId: "synthetic-release" });
      fetchMock.mockResolvedValueOnce(Response.json({ ...response, target: "production" }));
      await expect(operations.deploymentMetadata(config, response.id)).rejects.toThrow("DEPLOYMENT_NOT_AUTHORIZED_PREVIEW");
      fetchMock.mockResolvedValueOnce(Response.json({ ...response, projectId: "other-project" }));
      await expect(operations.deploymentMetadata(config, response.id)).rejects.toThrow("DEPLOYMENT_NOT_AUTHORIZED_PREVIEW");
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
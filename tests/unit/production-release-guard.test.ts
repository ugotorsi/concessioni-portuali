import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({
  buildRateLimitKey: vi.fn(() => "k"),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, limit: 1, remaining: 1, resetAt: 0 }),
  getRateLimitHeaders: vi.fn(() => ({})),
}));

import { middleware } from "../../middleware";
import { isMisroutedProductionHost } from "@/lib/deployment-host-guard";
import {
  ProductionReleaseError,
  assertAliasResolvesTo,
  assertDeploymentEligibleForProductionDomain,
  assertProductionDomainConfig,
  missingProductionEnv,
  parseProductionReleaseArgs,
  REQUIRED_PRODUCTION_ENV,
} from "../../scripts/deploy/production-release-policy";

const SHA = "8ee3d99f887901c91b8c3dc6f08b568733dd0d96";
const OTHER = "11fe35971c7d202a5174e570dd07e75ea3702d78";

function code(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ProductionReleaseError ? error.code : String(error);
  }
  return undefined;
}

const productionDeployment = {
  id: "dpl_prod",
  projectId: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  target: "production",
  readyState: "READY",
  meta: { gitCommitSha: SHA, gitDirty: "0" },
};

describe("runtime host guard", () => {
  it("refuses app.noetra.it on preview or development deployments only", () => {
    expect(isMisroutedProductionHost("app.noetra.it", "preview")).toBe(true);
    expect(isMisroutedProductionHost("APP.NOETRA.IT:443", "development")).toBe(true);
    expect(isMisroutedProductionHost("app.noetra.it", "production")).toBe(false);
    expect(isMisroutedProductionHost("app.noetra.it", undefined)).toBe(false);
    expect(isMisroutedProductionHost("preview-x.vercel.app", "preview")).toBe(false);
  });

  it("middleware answers 421 before any routing when a preview build serves the production host", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      const blocked = await middleware(new NextRequest("https://app.noetra.it/login"));
      expect(blocked.status).toBe(421);
      expect(blocked.headers.get("cache-control")).toBe("no-store");
      const previewHost = await middleware(new NextRequest("https://preview-x.vercel.app/login"));
      expect(previewHost.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("VERCEL_ENV", "production");
    try {
      const allowed = await middleware(new NextRequest("https://app.noetra.it/login"));
      expect(allowed.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("production release policy", () => {
  it("requires an exact full expected commit and rejects unknown arguments", () => {
    expect(parseProductionReleaseArgs(["--expected-commit", SHA])).toEqual({ expectedCommit: SHA, verifyOnly: false });
    expect(code(() => parseProductionReleaseArgs([]))).toBe("EXPECTED_COMMIT_REQUIRED");
    expect(code(() => parseProductionReleaseArgs(["--expected-commit", "8ee3d99"]))).toBe("EXPECTED_COMMIT_INVALID");
    expect(code(() => parseProductionReleaseArgs(["--expected-commit", SHA, "--target", "preview"]))).toBe("UNSUPPORTED_ARGUMENT");
  });

  it("blocks a production domain bound to a Git branch (the cause of the preview incident)", () => {
    expect(code(() => assertProductionDomainConfig({ name: "app.noetra.it", gitBranch: "staging-operativo" })))
      .toBe("DOMAIN_BOUND_TO_GIT_BRANCH");
    expect(code(() => assertProductionDomainConfig({ name: "app.noetra.it", customEnvironmentId: "env_x" })))
      .toBe("DOMAIN_BOUND_TO_CUSTOM_ENVIRONMENT");
    expect(code(() => assertProductionDomainConfig({ name: "app.noetra.it", gitBranch: null }))).toBeUndefined();
  });

  it("refuses preview-target, not-ready, foreign-commit or dirty deployments", () => {
    expect(code(() => assertDeploymentEligibleForProductionDomain(productionDeployment, SHA))).toBeUndefined();
    expect(code(() => assertDeploymentEligibleForProductionDomain({ ...productionDeployment, target: null }, SHA)))
      .toBe("DEPLOYMENT_NOT_PRODUCTION_TARGET");
    expect(code(() => assertDeploymentEligibleForProductionDomain({ ...productionDeployment, target: "preview" }, SHA)))
      .toBe("DEPLOYMENT_NOT_PRODUCTION_TARGET");
    expect(code(() => assertDeploymentEligibleForProductionDomain({ ...productionDeployment, readyState: "BUILDING" }, SHA)))
      .toBe("DEPLOYMENT_NOT_READY");
    expect(code(() => assertDeploymentEligibleForProductionDomain(productionDeployment, OTHER)))
      .toBe("DEPLOYMENT_COMMIT_MISMATCH");
    expect(code(() => assertDeploymentEligibleForProductionDomain(
      { ...productionDeployment, meta: { gitCommitSha: SHA, gitDirty: "1" } }, SHA,
    ))).toBe("DEPLOYMENT_DIRTY_SOURCE");
    expect(code(() => assertDeploymentEligibleForProductionDomain({ ...productionDeployment, projectId: "prj_other" }, SHA)))
      .toBe("DEPLOYMENT_PROJECT_MISMATCH");
  });

  it("verifies after release that the domain resolves to the same production deployment", () => {
    expect(code(() => assertAliasResolvesTo(productionDeployment, "dpl_prod", SHA))).toBeUndefined();
    expect(code(() => assertAliasResolvesTo(productionDeployment, "dpl_new", SHA))).toBe("ALIAS_MISMATCH");
    expect(code(() => assertAliasResolvesTo({ ...productionDeployment, target: null }, "dpl_prod", SHA)))
      .toBe("DEPLOYMENT_NOT_PRODUCTION_TARGET");
  });

  it("counts only unscoped production variables as present", () => {
    const envs = REQUIRED_PRODUCTION_ENV.map((key) => ({ key, target: ["production"] }));
    expect(missingProductionEnv(envs)).toEqual([]);
    const previewOnly = envs.map((entry) => entry.key === "DATABASE_URL"
      ? { key: "DATABASE_URL", target: ["preview"], gitBranch: "staging-operativo" }
      : entry);
    expect(missingProductionEnv(previewOnly)).toEqual(["DATABASE_URL"]);
  });
});

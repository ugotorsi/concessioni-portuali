export const PRODUCTION_RELEASE = Object.freeze({
  projectId: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  organizationId: "team_jT8QBufySulc3clxzIl6RqnL",
  scope: "ugotorsis-projects",
  productionDomain: "app.noetra.it",
} as const);

export const REQUIRED_PRODUCTION_ENV = Object.freeze([
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "MFA_ENCRYPTION_KEY",
  "RUNTIME_EXPECTED_DATABASE_NAME",
  "RUNTIME_EXPECTED_NEON_PROJECT_ID",
  "RUNTIME_EXPECTED_NEON_BRANCH_ID",
  "AUTOMATIC_RESEARCH_EXECUTION_ENABLED",
  "SERVER_AUTONOMOUS_RESEARCH_ENABLED",
] as const);

export type ProductionReleaseErrorCode =
  | "EXPECTED_COMMIT_REQUIRED"
  | "EXPECTED_COMMIT_INVALID"
  | "UNSUPPORTED_ARGUMENT"
  | "RESUME_DEPLOYMENT_INVALID"
  | "WORKTREE_DIRTY"
  | "GIT_HEAD_MISMATCH"
  | "COMMIT_NOT_ON_REMOTE"
  | "VERCEL_IDENTITY_MISMATCH"
  | "PRODUCTION_DOMAIN_MISMATCH"
  | "DOMAIN_BOUND_TO_GIT_BRANCH"
  | "DOMAIN_BOUND_TO_CUSTOM_ENVIRONMENT"
  | "DOMAIN_REDIRECT_FORBIDDEN"
  | "PRODUCTION_ENV_MISSING"
  | "DEPLOYMENT_NOT_PRODUCTION_TARGET"
  | "DEPLOYMENT_NOT_READY"
  | "DEPLOYMENT_PROJECT_MISMATCH"
  | "DEPLOYMENT_ID_MISMATCH"
  | "DEPLOYMENT_COMMIT_MISMATCH"
  | "DEPLOYMENT_DIRTY_SOURCE"
  | "ALIAS_MISMATCH"
  | "HEALTHCHECK_FAILED"
  | "VERCEL_COMMAND_FAILED";

export class ProductionReleaseError extends Error {
  constructor(readonly code: ProductionReleaseErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ProductionReleaseError";
  }
}

export interface ProductionReleaseArgs {
  readonly expectedCommit: string;
  readonly verifyOnly: boolean;
  readonly resumeDeployment?: string;
}

export function parseProductionReleaseArgs(argv: readonly string[]): ProductionReleaseArgs {
  let expectedCommit: string | undefined;
  let verifyOnly = false;
  let resumeDeployment: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--expected-commit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || expectedCommit !== undefined) {
        throw new ProductionReleaseError("EXPECTED_COMMIT_REQUIRED");
      }
      expectedCommit = value;
      index += 1;
      continue;
    }
    if (argument === "--verify-only") {
      verifyOnly = true;
      continue;
    }
    if (argument === "--resume-deployment") {
      const value = argv[index + 1];
      if (!value || !/^dpl_[a-z0-9]+$/i.test(value) || resumeDeployment !== undefined) {
        throw new ProductionReleaseError("RESUME_DEPLOYMENT_INVALID");
      }
      resumeDeployment = value;
      index += 1;
      continue;
    }
    throw new ProductionReleaseError("UNSUPPORTED_ARGUMENT", argument);
  }
  if (!expectedCommit) throw new ProductionReleaseError("EXPECTED_COMMIT_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw new ProductionReleaseError("EXPECTED_COMMIT_INVALID");
  if (verifyOnly && resumeDeployment) throw new ProductionReleaseError("UNSUPPORTED_ARGUMENT", "--resume-deployment");
  return resumeDeployment ? { expectedCommit, verifyOnly, resumeDeployment } : { expectedCommit, verifyOnly };
}

export interface VercelDomainConfig {
  readonly name: string;
  readonly gitBranch?: string | null;
  readonly customEnvironmentId?: string | null;
  readonly redirect?: string | null;
}

/**
 * A domain bound to a Git branch is a Preview branch domain: every push to that
 * branch would publish a Preview build on it. The production domain must be
 * unbound so that only production-target deployments can receive it.
 */
export function assertProductionDomainConfig(domain: VercelDomainConfig): void {
  if (domain.name !== PRODUCTION_RELEASE.productionDomain) {
    throw new ProductionReleaseError("PRODUCTION_DOMAIN_MISMATCH", domain.name);
  }
  if (domain.gitBranch) throw new ProductionReleaseError("DOMAIN_BOUND_TO_GIT_BRANCH", domain.gitBranch);
  if (domain.customEnvironmentId) {
    throw new ProductionReleaseError("DOMAIN_BOUND_TO_CUSTOM_ENVIRONMENT", domain.customEnvironmentId);
  }
  if (domain.redirect) throw new ProductionReleaseError("DOMAIN_REDIRECT_FORBIDDEN", domain.redirect);
}

export interface VercelEnvEntry {
  readonly key: string;
  readonly target?: readonly string[] | string | null;
  readonly gitBranch?: string | null;
}

export function missingProductionEnv(
  envs: readonly VercelEnvEntry[],
  required: readonly string[] = REQUIRED_PRODUCTION_ENV,
): string[] {
  const present = new Set(
    envs
      .filter((entry) => {
        const targets = Array.isArray(entry.target) ? entry.target : entry.target ? [entry.target] : [];
        return targets.includes("production") && !entry.gitBranch;
      })
      .map((entry) => entry.key),
  );
  return required.filter((key) => !present.has(key));
}

export interface VercelDeploymentSnapshot {
  readonly id: string;
  readonly url?: string;
  readonly projectId?: string;
  readonly target?: string | null;
  readonly readyState?: string;
  readonly meta?: Record<string, string | undefined>;
}

export function assertDeploymentEligibleForProductionDomain(
  deployment: VercelDeploymentSnapshot,
  expectedCommit: string,
): void {
  if (deployment.projectId !== PRODUCTION_RELEASE.projectId) {
    throw new ProductionReleaseError("DEPLOYMENT_PROJECT_MISMATCH", deployment.projectId ?? "missing");
  }
  if (deployment.target !== "production") {
    throw new ProductionReleaseError("DEPLOYMENT_NOT_PRODUCTION_TARGET", String(deployment.target ?? "preview"));
  }
  if (deployment.readyState !== "READY") {
    throw new ProductionReleaseError("DEPLOYMENT_NOT_READY", String(deployment.readyState));
  }
  const sha = deployment.meta?.gitCommitSha ?? deployment.meta?.githubCommitSha;
  if (sha !== expectedCommit) {
    throw new ProductionReleaseError("DEPLOYMENT_COMMIT_MISMATCH", String(sha));
  }
  const gitDirty = deployment.meta?.gitDirty;
  if (gitDirty !== undefined && (typeof gitDirty !== "string" || !["0", "false"].includes(gitDirty.toLowerCase()))) {
    throw new ProductionReleaseError("DEPLOYMENT_DIRTY_SOURCE", String(gitDirty));
  }
}

export function assertAliasResolvesTo(
  aliasDeployment: VercelDeploymentSnapshot,
  expectedDeploymentId: string,
  expectedCommit: string,
): void {
  if (aliasDeployment.id !== expectedDeploymentId) {
    throw new ProductionReleaseError("ALIAS_MISMATCH", `${aliasDeployment.id} != ${expectedDeploymentId}`);
  }
  assertDeploymentEligibleForProductionDomain(aliasDeployment, expectedCommit);
}

/** Picks the deployment URL from `vercel deploy` output, ignoring the dashboard "Inspect" link. */
export function extractDeploymentUrl(output: string): string | null {
  const labelled = /^\s*(?:\S+\s+)?(?:Production|Preview):\s*(https:\/\/[a-z0-9.-]+\.vercel\.app)\b/im.exec(output);
  if (labelled) return labelled[1];
  const urls = [...output.matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app\b/gi)].map((match) => match[0]);
  return urls.at(-1) ?? null;
}
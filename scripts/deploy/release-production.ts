import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PRODUCTION_RELEASE,
  ProductionReleaseError,
  assertAliasResolvesTo,
  assertDeploymentEligibleForProductionDomain,
  assertProductionDomainConfig,
  missingProductionEnv,
  parseProductionReleaseArgs,
  type VercelDeploymentSnapshot,
  type VercelDomainConfig,
  type VercelEnvEntry,
} from "./production-release-policy";

function run(command: string, args: readonly string[], input?: string): string {
  // Arguments are internal constants or validated identifiers; Windows needs a shell to resolve vercel.cmd.
  const useShell = process.platform === "win32";
  const result = useShell
    ? spawnSync([command, ...args].join(" "), { encoding: "utf8", input, shell: true, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new ProductionReleaseError("VERCEL_COMMAND_FAILED", `${command} ${args[0] ?? ""}: ${result.stderr.slice(-400)}`);
  }
  return result.stdout.trim();
}

function vercelApi<T>(apiPath: string): T {
  return JSON.parse(run("vercel", ["api", apiPath, `--scope=${PRODUCTION_RELEASE.scope}`, "--raw"])) as T;
}

function deploymentSnapshot(idOrHost: string): VercelDeploymentSnapshot {
  return vercelApi<VercelDeploymentSnapshot>(`/v13/deployments/${encodeURIComponent(idOrHost)}`);
}

function log(step: string, detail: unknown): void {
  process.stdout.write(`${JSON.stringify({ step, ...(typeof detail === "object" ? detail : { detail }) })}\n`);
}

function verifyLocalSource(expectedCommit: string): void {
  if (run("git", ["status", "--porcelain"]) !== "") throw new ProductionReleaseError("WORKTREE_DIRTY");
  const head = run("git", ["rev-parse", "HEAD"]);
  if (head !== expectedCommit) throw new ProductionReleaseError("GIT_HEAD_MISMATCH", head);
  run("git", ["fetch", "--quiet", "origin"]);
  if (run("git", ["branch", "-r", "--contains", expectedCommit]) === "") {
    throw new ProductionReleaseError("COMMIT_NOT_ON_REMOTE");
  }
}

function verifyProjectConfiguration(): void {
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== PRODUCTION_RELEASE.projectId) {
    throw new ProductionReleaseError("VERCEL_IDENTITY_MISMATCH");
  }
  if (process.env.VERCEL_ORG_ID && process.env.VERCEL_ORG_ID !== PRODUCTION_RELEASE.organizationId) {
    throw new ProductionReleaseError("VERCEL_IDENTITY_MISMATCH");
  }
  const domain = vercelApi<VercelDomainConfig>(
    `/v9/projects/${PRODUCTION_RELEASE.projectId}/domains/${PRODUCTION_RELEASE.productionDomain}`,
  );
  assertProductionDomainConfig(domain);
  const { envs } = vercelApi<{ envs: VercelEnvEntry[] }>(`/v9/projects/${PRODUCTION_RELEASE.projectId}/env`);
  const missing = missingProductionEnv(envs);
  if (missing.length > 0) throw new ProductionReleaseError("PRODUCTION_ENV_MISSING", missing.join(","));
  log("project-configuration", { domain: domain.name, gitBranch: domain.gitBranch ?? null, requiredEnv: "present" });
}

async function verifyLive(deploymentId: string, expectedCommit: string): Promise<void> {
  const alias = deploymentSnapshot(PRODUCTION_RELEASE.productionDomain);
  assertAliasResolvesTo(alias, deploymentId, expectedCommit);
  const response = await fetch(`https://${PRODUCTION_RELEASE.productionDomain}/login`, { redirect: "manual" });
  if (response.status !== 200) throw new ProductionReleaseError("HEALTHCHECK_FAILED", String(response.status));
  log("live-verification", { alias: PRODUCTION_RELEASE.productionDomain, deploymentId, commit: expectedCommit, login: 200 });
}

export async function releaseProduction(argv: readonly string[]): Promise<void> {
  const args = parseProductionReleaseArgs(argv);
  verifyProjectConfiguration();
  const before = deploymentSnapshot(PRODUCTION_RELEASE.productionDomain);
  log("before", { deploymentId: before.id, target: before.target, commit: before.meta?.gitCommitSha ?? null });

  if (args.verifyOnly) {
    await verifyLive(before.id, args.expectedCommit);
    return;
  }

  verifyLocalSource(args.expectedCommit);
  const deploymentUrl = run("vercel", ["deploy", "--prod", "--yes", `--scope=${PRODUCTION_RELEASE.scope}`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("https://"))
    .pop();
  if (!deploymentUrl) throw new ProductionReleaseError("VERCEL_COMMAND_FAILED", "deployment URL missing");
  const deployment = deploymentSnapshot(new URL(deploymentUrl).host);
  assertDeploymentEligibleForProductionDomain(deployment, args.expectedCommit);
  log("deployment", { deploymentId: deployment.id, target: deployment.target, readyState: deployment.readyState });

  const aliased = deploymentSnapshot(PRODUCTION_RELEASE.productionDomain);
  if (aliased.id !== deployment.id) {
    run("vercel", ["alias", "set", new URL(deploymentUrl).host, PRODUCTION_RELEASE.productionDomain, `--scope=${PRODUCTION_RELEASE.scope}`]);
  }
  await verifyLive(deployment.id, args.expectedCommit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  releaseProduction(process.argv.slice(2)).catch((error: unknown) => {
    const code = error instanceof ProductionReleaseError ? error.message : String(error);
    process.stderr.write(`RELEASE_BLOCKED ${code}\n`);
    process.exitCode = 1;
  });
}

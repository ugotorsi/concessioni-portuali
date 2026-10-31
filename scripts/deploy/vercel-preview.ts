import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SELVARA_PREVIEW_MCP_RESOURCE } from "../runtime/configure-workos-mcp-resource";

export const VERCEL_PREVIEW_DEPLOYMENT = Object.freeze({
  projectName: "concessioni-portuali-demo",
  projectId: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  organizationId: "team_jT8QBufySulc3clxzIl6RqnL",
  scope: "ugotorsis-projects",
  target: "preview",
  gitBranch: "feat/noetra-legal-applicability-e4447",
  githubRepositoryId: 1288038811,
} as const);

export class VercelPreviewDeployError extends Error {
  constructor(readonly code:
    | "EXPECTED_COMMIT_REQUIRED"
    | "EXPECTED_COMMIT_INVALID"
    | "DUPLICATE_EXPECTED_COMMIT"
    | "DUPLICATE_DIAGNOSTIC_PROCEDURE"
    | "DIAGNOSTIC_PROCEDURE_INVALID"
    | "DUPLICATE_AUTH_DIAGNOSTIC"
    | "AUTH_DIAGNOSTIC_MISSION_INVALID"
    | "DUPLICATE_RECOVERY_DIAGNOSTIC"
    | "RECOVERY_DIAGNOSTIC_MISSION_INVALID"
    | "DUPLICATE_WORKOS_RESOURCE_CONFIGURATION"
    | "PRODUCTION_TARGET_FORBIDDEN"
    | "TARGET_OVERRIDE_FORBIDDEN"
    | "PROJECT_OVERRIDE_FORBIDDEN"
    | "UNSUPPORTED_ARGUMENT"
    | "VERCEL_IDENTITY_MISMATCH"
    | "GIT_HEAD_READ_FAILED"
    | "GIT_HEAD_MISMATCH"
    | "GIT_BRANCH_READ_FAILED"
    | "GIT_BRANCH_MISMATCH"
    | "VERCEL_DEPLOY_FAILED") {
    super(code);
    this.name = "VercelPreviewDeployError";
  }
}

export interface VercelPreviewDeployArgs {
  readonly expectedCommit: string;
  readonly diagnosticProcedureId?: string;
  readonly diagnosticAuthMissionId?: string;
  readonly diagnosticRecoveryMissionId?: string;
  readonly configureWorkosResource?: boolean;
}

function isProductionArgument(argument: string): boolean {
  const normalized = argument.toLowerCase();
  return normalized === "--prod"
    || normalized === "--production"
    || normalized === "production"
    || normalized === "--target=production"
    || normalized === "--environment=production";
}

export function parseVercelPreviewDeployArgs(argv: readonly string[]): VercelPreviewDeployArgs {
  let expectedCommit: string | undefined;
  let diagnosticProcedureId: string | undefined;
  let diagnosticAuthMissionId: string | undefined;
  let diagnosticRecoveryMissionId: string | undefined;
  let configureWorkosResource = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--expected-commit") {
      if (expectedCommit !== undefined) {
        throw new VercelPreviewDeployError("DUPLICATE_EXPECTED_COMMIT");
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new VercelPreviewDeployError("EXPECTED_COMMIT_REQUIRED");
      }
      expectedCommit = value;
      index += 1;
      continue;
    }
    if (argument === "--diagnose-research-procedure") {
      if (diagnosticProcedureId !== undefined) {
        throw new VercelPreviewDeployError("DUPLICATE_DIAGNOSTIC_PROCEDURE");
      }
      const value = argv[index + 1];
      if (!value || !/^procedimento-intake-[a-f0-9]{24}$/.test(value)) {
        throw new VercelPreviewDeployError("DIAGNOSTIC_PROCEDURE_INVALID");
      }
      diagnosticProcedureId = value;
      index += 1;
      continue;
    }
    if (argument === "--configure-workos-resource") {
      if (configureWorkosResource) {
        throw new VercelPreviewDeployError("DUPLICATE_WORKOS_RESOURCE_CONFIGURATION");
      }
      configureWorkosResource = true;
      continue;
    }
    if (argument === "--diagnose-research-auth") {
      if (diagnosticAuthMissionId !== undefined) {
        throw new VercelPreviewDeployError("DUPLICATE_AUTH_DIAGNOSTIC");
      }
      const value = argv[index + 1];
      if (!value || !/^research-mission:[a-f0-9]{64}$/.test(value)) {
        throw new VercelPreviewDeployError("AUTH_DIAGNOSTIC_MISSION_INVALID");
      }
      diagnosticAuthMissionId = value;
      index += 1;
      continue;
    }
    if (argument === "--diagnose-preview-recovery") {
      if (diagnosticRecoveryMissionId !== undefined) {
        throw new VercelPreviewDeployError("DUPLICATE_RECOVERY_DIAGNOSTIC");
      }
      const value = argv[index + 1];
      if (!value || !/^research-mission:[a-f0-9]{64}$/.test(value)) {
        throw new VercelPreviewDeployError("RECOVERY_DIAGNOSTIC_MISSION_INVALID");
      }
      diagnosticRecoveryMissionId = value;
      index += 1;
      continue;
    }
    if (isProductionArgument(argument)) {
      throw new VercelPreviewDeployError("PRODUCTION_TARGET_FORBIDDEN");
    }
    if (
      (argument === "--target" || argument === "--environment")
      && argv[index + 1]?.toLowerCase() === "production"
    ) {
      throw new VercelPreviewDeployError("PRODUCTION_TARGET_FORBIDDEN");
    }
    if (
      argument === "--target"
      || argument.startsWith("--target=")
      || argument === "--environment"
      || argument.startsWith("--environment=")
    ) {
      throw new VercelPreviewDeployError("TARGET_OVERRIDE_FORBIDDEN");
    }
    if (
      argument === "--project"
      || argument.startsWith("--project=")
      || argument === "--scope"
      || argument.startsWith("--scope=")
    ) {
      throw new VercelPreviewDeployError("PROJECT_OVERRIDE_FORBIDDEN");
    }
    throw new VercelPreviewDeployError("UNSUPPORTED_ARGUMENT");
  }
  if (!expectedCommit) {
    throw new VercelPreviewDeployError("EXPECTED_COMMIT_REQUIRED");
  }
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new VercelPreviewDeployError("EXPECTED_COMMIT_INVALID");
  }
  return {
    expectedCommit,
    diagnosticProcedureId,
    diagnosticAuthMissionId,
    diagnosticRecoveryMissionId,
    configureWorkosResource,
  };
}

export function createVercelPreviewDeploySpec(
  input: VercelPreviewDeployArgs,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (
    environment.VERCEL_PROJECT_ID
    && environment.VERCEL_PROJECT_ID !== VERCEL_PREVIEW_DEPLOYMENT.projectId
  ) {
    throw new VercelPreviewDeployError("VERCEL_IDENTITY_MISMATCH");
  }
  if (
    environment.VERCEL_ORG_ID
    && environment.VERCEL_ORG_ID !== VERCEL_PREVIEW_DEPLOYMENT.organizationId
  ) {
    throw new VercelPreviewDeployError("VERCEL_IDENTITY_MISMATCH");
  }
  const vercelArgs = [
    "api",
    "/v13/deployments",
    "-X",
    "POST",
    `--scope=${VERCEL_PREVIEW_DEPLOYMENT.scope}`,
    "--input",
    "-",
    "--raw",
  ];
  const buildCommands = [
    ...(input.configureWorkosResource ? [
      `npm run runtime:configure-workos-mcp-resource -- --resource ${SELVARA_PREVIEW_MCP_RESOURCE} --apply --confirm-resource ${SELVARA_PREVIEW_MCP_RESOURCE}`,
    ] : []),
    ...(input.diagnosticProcedureId ? [
      `npm run runtime:diagnose-research-missions -- ${input.diagnosticProcedureId}`,
    ] : []),
    ...(input.diagnosticAuthMissionId ? [
      `npm run runtime:diagnose-research-auth -- ${input.diagnosticAuthMissionId}`,
    ] : []),
    ...(input.diagnosticRecoveryMissionId ? [
      `npm run runtime:diagnose-preview-recovery -- ${input.diagnosticRecoveryMissionId}`,
    ] : []),
    "npm run build",
  ];
  return {
    executable: platform === "win32" ? environment.ComSpec ?? "cmd.exe" : "vercel",
    args: platform === "win32"
      ? ["/d", "/s", "/c", "vercel.cmd", ...vercelArgs]
      : vercelArgs,
    input: JSON.stringify({
      name: VERCEL_PREVIEW_DEPLOYMENT.projectName,
      project: VERCEL_PREVIEW_DEPLOYMENT.projectId,
      gitSource: {
        type: "github",
        repoId: VERCEL_PREVIEW_DEPLOYMENT.githubRepositoryId,
        ref: VERCEL_PREVIEW_DEPLOYMENT.gitBranch,
        sha: input.expectedCommit,
      },
      projectSettings: {
        commandForIgnoringBuildStep: "exit 1",
        ...(input.configureWorkosResource
          || input.diagnosticProcedureId
          || input.diagnosticAuthMissionId
          || input.diagnosticRecoveryMissionId ? {
          buildCommand: buildCommands.join(" && "),
        } : {}),
      },
      meta: {
        noetraApprovedCommit: input.expectedCommit,
        githubCommitSha: input.expectedCommit,
        githubCommitRef: VERCEL_PREVIEW_DEPLOYMENT.gitBranch,
      },
    }),
    environment: {
      ...environment,
      VERCEL_PROJECT_ID: VERCEL_PREVIEW_DEPLOYMENT.projectId,
      VERCEL_ORG_ID: VERCEL_PREVIEW_DEPLOYMENT.organizationId,
    },
  };
}

export function runVercelPreviewDeploy(
  argv: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const input = parseVercelPreviewDeployArgs(argv);
  const git = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (git.status !== 0 || !git.stdout.trim()) {
    throw new VercelPreviewDeployError("GIT_HEAD_READ_FAILED");
  }
  if (git.stdout.trim() !== input.expectedCommit) {
    throw new VercelPreviewDeployError("GIT_HEAD_MISMATCH");
  }
  const remoteBranch = spawnSync("git", [
    "ls-remote",
    "--exit-code",
    "origin",
    `refs/heads/${VERCEL_PREVIEW_DEPLOYMENT.gitBranch}`,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (remoteBranch.status !== 0 || !remoteBranch.stdout.trim()) {
    throw new VercelPreviewDeployError("GIT_BRANCH_READ_FAILED");
  }
  if (remoteBranch.stdout.trim().split(/\s+/, 1)[0] !== input.expectedCommit) {
    throw new VercelPreviewDeployError("GIT_BRANCH_MISMATCH");
  }
  const spec = createVercelPreviewDeploySpec(input, environment);
  const deployment = spawnSync(spec.executable, spec.args, {
    cwd: process.cwd(),
    env: spec.environment,
    input: spec.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (deployment.status !== 0 || !deployment.stdout.trim()) {
    if (deployment.error) console.error(deployment.error.message);
    throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
  }
  let created: { id?: string };
  try {
    created = JSON.parse(deployment.stdout) as { id?: string };
  } catch {
    throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
  }
  if (!created.id) {
    throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const statusArgs = [
      "api",
      `/v13/deployments/${created.id}`,
      `--scope=${VERCEL_PREVIEW_DEPLOYMENT.scope}`,
      "--raw",
    ];
    const status = spawnSync(
      spec.executable,
      process.platform === "win32"
        ? ["/d", "/s", "/c", "vercel.cmd", ...statusArgs]
        : statusArgs,
      {
        cwd: process.cwd(),
        env: spec.environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    if (status.status !== 0 || !status.stdout.trim()) {
      throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
    }
    const current = JSON.parse(status.stdout) as {
      readyState?: string;
      url?: string;
    };
    if (current.readyState === "READY") {
      process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
      return;
    }
    if (current.readyState === "ERROR" || current.readyState === "CANCELED") {
      throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  }
  throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    runVercelPreviewDeploy();
  } catch (error) {
    console.error(error instanceof VercelPreviewDeployError ? error.code : "VERCEL_DEPLOY_FAILED");
    process.exitCode = 1;
  }
}

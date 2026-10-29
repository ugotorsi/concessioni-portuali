import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERCEL_PREVIEW_DEPLOYMENT = Object.freeze({
  projectName: "concessioni-portuali-demo",
  projectId: "prj_Dg5N94gGCa5DmJbI44bS0TOwcJiu",
  organizationId: "team_jT8QBufySulc3clxzIl6RqnL",
  scope: "ugotorsis-projects",
  target: "preview",
} as const);

export class VercelPreviewDeployError extends Error {
  constructor(readonly code:
    | "EXPECTED_COMMIT_REQUIRED"
    | "EXPECTED_COMMIT_INVALID"
    | "DUPLICATE_EXPECTED_COMMIT"
    | "PRODUCTION_TARGET_FORBIDDEN"
    | "TARGET_OVERRIDE_FORBIDDEN"
    | "PROJECT_OVERRIDE_FORBIDDEN"
    | "VERCEL_IDENTITY_MISMATCH"
    | "GIT_HEAD_READ_FAILED"
    | "GIT_HEAD_MISMATCH"
    | "VERCEL_DEPLOY_FAILED") {
    super(code);
    this.name = "VercelPreviewDeployError";
  }
}

export interface VercelPreviewDeployArgs {
  readonly expectedCommit: string;
  readonly passthrough: readonly string[];
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
  const passthrough: string[] = [];
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
    passthrough.push(argument);
  }
  if (!expectedCommit) {
    throw new VercelPreviewDeployError("EXPECTED_COMMIT_REQUIRED");
  }
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) {
    throw new VercelPreviewDeployError("EXPECTED_COMMIT_INVALID");
  }
  return { expectedCommit, passthrough };
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
    "deploy",
    "--target=preview",
    `--scope=${VERCEL_PREVIEW_DEPLOYMENT.scope}`,
    "--yes",
    ...input.passthrough,
  ];
  return {
    executable: platform === "win32" ? environment.ComSpec ?? "cmd.exe" : "vercel",
    args: platform === "win32"
      ? ["/d", "/s", "/c", "vercel.cmd", ...vercelArgs]
      : vercelArgs,
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
  const spec = createVercelPreviewDeploySpec(input, environment);
  const deployment = spawnSync(spec.executable, spec.args, {
    cwd: process.cwd(),
    env: spec.environment,
    stdio: "inherit",
  });
  if (deployment.status !== 0) {
    if (deployment.error) console.error(deployment.error.message);
    throw new VercelPreviewDeployError("VERCEL_DEPLOY_FAILED");
  }
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

import path from "node:path";
import { pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";
import {
  TrustedResearchClientError,
  TrustedResearchHttpError,
  TrustedResearchMcpError,
  createTrustedResearchHttpClient,
} from "../../src/server/legal-research/trusted-research-http-client";
import {
  TrustedMissionExecutorError,
  createTrustedMissionExecutor,
  type TrustedMissionExecutorResult,
} from "../../src/server/legal-research/trusted-mission-executor";
import type { ResearchProviderAdapter } from "../../src/server/legal-research/provider-research-adapters";
import { createAutomaticResearchProviderAdapters } from "../../src/server/legal-research/automatic-research-providers";
import type { TrustedResearchHttpClient } from "../../src/server/legal-research/trusted-research-http-client";

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export type TrustedMissionExecutorCliArgs = Readonly<{
  execute: true;
  missionId: string;
  stagingOrigin: string;
  leaseDurationMs?: number;
}>;

type TokenReader = NonNullable<Parameters<typeof createAutomaticResearchProviderAdapters>[0]["moonlitTokenReader"]>;

export type TrustedMissionExecutorCliDependencies = Readonly<{
  createClient(options: Parameters<typeof createTrustedResearchHttpClient>[0]): TrustedResearchHttpClient;
  createExecutor: typeof createTrustedMissionExecutor;
  createProviderAdapters(options: Readonly<{
    requestTimeoutMs: number;
  }>): Promise<readonly ResearchProviderAdapter[]>;
  loadEnvironment(workspacePath?: string, env?: NodeJS.ProcessEnv): void;
  output(message: string): void;
  processState: { exitCode?: number };
}>;

export function parseTrustedMissionExecutorArgs(argv: readonly string[]): TrustedMissionExecutorCliArgs {
  let execute = false;
  let missionId: string | undefined;
  let stagingOrigin: string | undefined;
  let leaseDurationMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") {
      if (execute) throw new TrustedMissionExecutorError("DUPLICATE_EXECUTE_FLAG");
      execute = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new TrustedMissionExecutorError("CLI_ARGUMENT_VALUE_REQUIRED");
    if (argument === "--mission-id") {
      if (missionId !== undefined) throw new TrustedMissionExecutorError("DUPLICATE_MISSION_ID");
      missionId = value;
    } else if (argument === "--staging-origin") {
      if (stagingOrigin !== undefined) throw new TrustedMissionExecutorError("DUPLICATE_STAGING_ORIGIN");
      stagingOrigin = value;
    } else if (argument === "--lease-duration-ms") {
      if (leaseDurationMs !== undefined) throw new TrustedMissionExecutorError("DUPLICATE_LEASE_DURATION");
      leaseDurationMs = Number(value);
    } else {
      throw new TrustedMissionExecutorError("UNKNOWN_CLI_ARGUMENT");
    }
    index += 1;
  }

  if (!execute) throw new TrustedMissionExecutorError("EXPLICIT_EXECUTE_FLAG_REQUIRED");
  if (!missionId?.trim()) throw new TrustedMissionExecutorError("MISSION_ID_REQUIRED");
  if (!stagingOrigin?.trim()) throw new TrustedMissionExecutorError("STAGING_ORIGIN_REQUIRED");
  if (leaseDurationMs !== undefined && (
    !Number.isInteger(leaseDurationMs)
    || leaseDurationMs < 1_000
    || leaseDurationMs > 86_400_000
  )) throw new TrustedMissionExecutorError("LEASE_DURATION_INVALID");

  return {
    execute: true,
    missionId,
    stagingOrigin,
    ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
  };
}

export function loadTrustedMissionExecutorEnvironment(
  workspacePath: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  loadDotenv({
    path: path.resolve(workspacePath, ".env.local"),
    override: false,
    processEnv: env,
    quiet: true,
  });
}

export async function createBearerOnlyProviderAdapters(options: Readonly<{
  requestTimeoutMs?: number;
  moonlitTokenReader?: TokenReader;
  simpliciterTokenReader?: TokenReader;
  fetch?: typeof fetch;
}> = {}): Promise<readonly ResearchProviderAdapter[]> {
  return createAutomaticResearchProviderAdapters({
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    moonlitTokenReader: options.moonlitTokenReader,
    simpliciterTokenReader: options.simpliciterTokenReader,
    fetch: options.fetch,
  });
}

function publicErrorCode(error: unknown): string {
  if (
    error instanceof TrustedMissionExecutorError
    || error instanceof TrustedResearchClientError
    || error instanceof TrustedResearchMcpError
  ) return error.code;
  if (error instanceof TrustedResearchHttpError) return `TRUSTED_HTTP_${error.status}_${error.code}`;
  return "TRUSTED_MISSION_EXECUTION_FAILED";
}

export function reportTrustedMissionExecutorResult(
  result: TrustedMissionExecutorResult,
  output: (message: string) => void = console.log,
  processState?: { exitCode?: number },
): void {
  output(JSON.stringify(result));
  if (
    result.status === "BLOCKED"
    || result.status === "LEASE_EXPIRED"
    || result.status === "RECOVERY_REQUIRED"
  ) {
    if (processState) processState.exitCode = 2;
    else process.exitCode = 2;
  }
}

export async function runTrustedMissionExecutorCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<TrustedMissionExecutorCliDependencies> = {},
): Promise<void> {
  const args = parseTrustedMissionExecutorArgs(argv);
  (dependencies.loadEnvironment ?? loadTrustedMissionExecutorEnvironment)(process.cwd(), env);
  const configuredRequestTimeout = env.TRUSTED_RESEARCH_HTTP_TIMEOUT_MS?.trim();
  const requestTimeoutMs = configuredRequestTimeout
    ? Number(configuredRequestTimeout)
    : DEFAULT_PROVIDER_TIMEOUT_MS;
  const client = (dependencies.createClient ?? createTrustedResearchHttpClient)({
    stagingOrigin: args.stagingOrigin,
    issuer: env.WORKOS_AUTHKIT_ISSUER ?? "",
    resource: env.MCP_RESOURCE_URI ?? "",
    ...(configuredRequestTimeout ? { requestTimeoutMs: Number(configuredRequestTimeout) } : {}),
  });
  const providerAdapters = await (dependencies.createProviderAdapters ?? createBearerOnlyProviderAdapters)({
    requestTimeoutMs,
  });
  const executor = (dependencies.createExecutor ?? createTrustedMissionExecutor)({
    client,
    legalDataHunterApiKey: env.LEGAL_DATA_HUNTER_API_KEY ?? null,
    providerAdapters,
    ...(args.leaseDurationMs === undefined ? {} : { leaseDurationMs: args.leaseDurationMs }),
  });
  const result = await executor.execute(args.missionId);
  reportTrustedMissionExecutorResult(
    result,
    dependencies.output ?? console.log,
    dependencies.processState,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  runTrustedMissionExecutorCli().catch((error: unknown) => {
    console.error(JSON.stringify({ error: publicErrorCode(error) }));
    process.exitCode = 1;
  });
}

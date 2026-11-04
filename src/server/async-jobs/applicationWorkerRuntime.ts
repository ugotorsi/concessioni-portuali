import { hostname } from "node:os";

import {
  heartbeatRuntimeWorker,
  registerRuntimeWorker,
  setRuntimeWorkerStatus,
} from "@/server/runtime/health";
import { RuntimeCostConfigurationError, runtimeCostEstimate } from "@/server/runtime/costConfig";

import type { DrainOneAsyncJobOutcome } from "./worker";

export const DEFAULT_APPLICATION_ASYNC_WORKER_CONCURRENCY = 1 as const;

const DEFAULT_IDLE_BACKOFF_MS = 1_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;

export interface ApplicationAsyncWorkerConfig {
  readonly workerId: string;
  readonly concurrency: number;
  readonly retryDelayMs: number;
  readonly idleBackoffMs: number;
  readonly errorBackoffMs: number;
  readonly operationAllowlist: readonly string[];
  readonly procedimentoAllowlist: readonly string[];
  readonly dedicatedMode: boolean;
  readonly exitOnIdle: boolean;
  readonly maxProcessedJobs?: number;
  readonly bootstrapTimeWatches: boolean;
  readonly providerExecutionEnabled?: boolean;
  readonly targetJobId?: string;
  readonly targetTenantId?: string;
}

export type ApplicationAsyncWorkerEvent =
  | { event: "ASYNC_WORKER_STARTED"; workerId: string; concurrency: number }
  | { event: "ASYNC_WORKER_STOPPED"; workerId: string }
  | { event: "ASYNC_WORKER_SHUTDOWN_REQUESTED"; workerId: string; reason: string }
  | { event: "ASYNC_WORKER_IDLE"; workerId: string; backoffMs: number }
  | {
      event: "ASYNC_WORKER_JOB_PROCESSED";
      workerId: string;
      jobId: string;
      outcome: "SUCCEEDED" | "RETRY_SCHEDULED" | "TERMINAL_FAILED" | "CANCELLED";
    }
  | {
      event: "ASYNC_WORKER_RECOVERABLE_ERROR";
      workerId: string;
      errorName: string;
      errorCode: string | null;
      errorSource: string | null;
      backoffMs: number;
    };

export class ApplicationAsyncWorkerConfigurationError extends Error {
  constructor(readonly code: "DATABASE_URL_REQUIRED" | "INVALID_CONFIGURATION") {
    super(code);
    this.name = "ApplicationAsyncWorkerConfigurationError";
  }
}

type Drain = (input: {
  workerId: string;
  retryDelayMs: number;
  operationAllowlist: readonly string[];
  procedimentoAllowlist: readonly string[];
  providerExecutionEnabled?: boolean;
  targetJobId?: string;
  targetTenantId?: string;
}) => Promise<DrainOneAsyncJobOutcome>;

interface ApplicationAsyncWorkerDependencies {
  readonly drain?: Drain;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly report?: (event: ApplicationAsyncWorkerEvent) => void;
  readonly registerWorker?: typeof registerRuntimeWorker;
  readonly heartbeatWorker?: typeof heartbeatRuntimeWorker;
  readonly setWorkerStatus?: typeof setRuntimeWorkerStatus;
}

interface SignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return parsed;
}

function defaultWorkerId(): string {
  return `${hostname()}:${process.pid}`;
}

function allowlist(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return [];
  const parsed = [...new Set(value.split(/[,\r\n]+/).map((item) => item.trim()).filter(Boolean))];
  if (parsed.some((item) => item.length > 256)) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return parsed;
}

function targetIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(parsed)) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return parsed;
}

function enabled(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function errorName(error: unknown): string {
  if (error instanceof Error && error.name.trim()) return error.name;
  return "UnknownError";
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && code.length <= 128 ? code : null;
}

function errorSource(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("diagnosticSource" in error)) return null;
  const source = Reflect.get(error, "diagnosticSource");
  return typeof source === "string" && source.length <= 256 ? source : null;
}

function applicationWorkerLoadErrorSource(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  const stack = error.stack.replaceAll("\\", "/");
  const packageMatch = /\/node_modules\/((?:@[^/]+\/)?[^/:\s)]+)/.exec(stack);
  if (packageMatch?.[1]) return `node_modules/${packageMatch[1]}`;
  const workspaceMatch = /\/((?:src|scripts|generated)\/[^:\s)]+):\d+/.exec(stack);
  return workspaceMatch?.[1] ?? null;
}

function applicationWorkerLoadErrorCode(error: unknown): string {
  const sourceCode = errorCode(error);
  if (sourceCode) return `APPLICATION_WORKER_${sourceCode}`.slice(0, 128);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("@napi-rs/canvas") || message.includes("native binding")) {
    return "APPLICATION_WORKER_NATIVE_BINDING_LOAD_FAILED";
  }
  if (message.includes("sharp")) return "APPLICATION_WORKER_SHARP_LOAD_FAILED";
  if (message.includes("cannot find module") || message.includes("module not found")) {
    return "APPLICATION_WORKER_MODULE_NOT_FOUND";
  }
  return "APPLICATION_WORKER_MODULE_LOAD_FAILED";
}

const defaultDrain: Drain = async (input) => {
  let applicationWorker: typeof import("./applicationWorker");
  try {
    applicationWorker = await import("./applicationWorker");
  } catch (error) {
    throw Object.assign(new Error("APPLICATION_WORKER_MODULE_LOAD_FAILED"), {
      code: applicationWorkerLoadErrorCode(error),
      diagnosticSource: applicationWorkerLoadErrorSource(error),
    });
  }
  if (input.targetJobId && input.targetTenantId) {
    return applicationWorker.drainTargetedFascicoloAnalysisJob({
      jobId: input.targetJobId,
      tenantId: input.targetTenantId,
      procedimentoId: input.procedimentoAllowlist[0]!,
      workerId: input.workerId,
      retryDelayMs: input.retryDelayMs,
      providerExecutionEnabled: input.providerExecutionEnabled,
    });
  }
  return applicationWorker.drainOneApplicationAsyncJob(input);
};

export function parseApplicationAsyncWorkerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApplicationAsyncWorkerConfig {
  if (!environment.DATABASE_URL?.trim()) {
    throw new ApplicationAsyncWorkerConfigurationError("DATABASE_URL_REQUIRED");
  }
  const workerId = environment.ASYNC_WORKER_ID?.trim() || defaultWorkerId();
  if (workerId.length > 256) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  const providerExecutionEnabled = enabled(environment.ASYNC_PROVIDER_EXECUTION_ENABLED);
  const dedicatedMode = enabled(environment.ASYNC_WORKER_DEDICATED_MODE);
  const operationAllowlist = allowlist(environment.ASYNC_WORKER_OPERATION_ALLOWLIST);
  const procedimentoAllowlist = allowlist(environment.ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST);
  if (providerExecutionEnabled) {
    const hasUnknownOrUnscopedOperation = operationAllowlist.length === 0
      || operationAllowlist.some((operation) => (
        operation !== "FASCICOLO.AUTOMATIC_ANALYSIS_V1"
        && operation !== "LEGAL_RESEARCH.EXECUTE_V1"
      ));
    try {
      if (
        hasUnknownOrUnscopedOperation
        || operationAllowlist.includes("FASCICOLO.AUTOMATIC_ANALYSIS_V1")
      ) {
        runtimeCostEstimate("ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR", environment);
      }
      if (
        hasUnknownOrUnscopedOperation
        || operationAllowlist.includes("LEGAL_RESEARCH.EXECUTE_V1")
      ) {
        runtimeCostEstimate("ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR", environment);
      }
    } catch (error) {
      if (error instanceof RuntimeCostConfigurationError) {
        throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
      }
      throw error;
    }
  }
  const targetJobId = targetIdentifier(environment.ASYNC_WORKER_TARGET_JOB_ID);
  const targetTenantId = targetIdentifier(environment.ASYNC_WORKER_TARGET_TENANT_ID);
  if ((targetJobId === undefined) !== (targetTenantId === undefined)) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  if (environment.ASYNC_WORKER_MAX_PROCESSED_JOBS !== undefined
    && (!dedicatedMode || !providerExecutionEnabled
      || operationAllowlist.length !== 1
      || operationAllowlist[0] !== "FASCICOLO.AUTOMATIC_ANALYSIS_V1"
      || procedimentoAllowlist.length !== 1
      || targetJobId === undefined
      || targetTenantId === undefined
      || environment.ASYNC_WORKER_CONCURRENCY !== "1"
      || !enabled(environment.ASYNC_WORKER_EXIT_ON_IDLE))) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  if (dedicatedMode && (operationAllowlist.length === 0 || procedimentoAllowlist.length === 0)) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  if (
    targetJobId !== undefined
    && (
      !dedicatedMode
      || operationAllowlist.length !== 1
      || operationAllowlist[0] !== "FASCICOLO.AUTOMATIC_ANALYSIS_V1"
      || procedimentoAllowlist.length !== 1
    )
  ) {
    throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
  }
  return Object.freeze({
    workerId,
    concurrency: boundedInteger(
      environment.ASYNC_WORKER_CONCURRENCY,
      DEFAULT_APPLICATION_ASYNC_WORKER_CONCURRENCY,
      1,
      32,
    ),
    idleBackoffMs: boundedInteger(
      environment.ASYNC_WORKER_IDLE_BACKOFF_MS,
      DEFAULT_IDLE_BACKOFF_MS,
      100,
      60_000,
    ),
    errorBackoffMs: boundedInteger(
      environment.ASYNC_WORKER_ERROR_BACKOFF_MS,
      DEFAULT_ERROR_BACKOFF_MS,
      100,
      60_000,
    ),
    retryDelayMs: boundedInteger(
      environment.ASYNC_WORKER_RETRY_DELAY_MS,
      DEFAULT_RETRY_DELAY_MS,
      0,
      30 * 24 * 60 * 60 * 1_000,
    ),
    operationAllowlist,
    procedimentoAllowlist,
    dedicatedMode,
    exitOnIdle: enabled(environment.ASYNC_WORKER_EXIT_ON_IDLE),
    ...(environment.ASYNC_WORKER_MAX_PROCESSED_JOBS === undefined ? {} : {
      maxProcessedJobs: boundedInteger(environment.ASYNC_WORKER_MAX_PROCESSED_JOBS, 1, 1, 1),
    }),
    bootstrapTimeWatches: environment.ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES === undefined
      ? true
      : enabled(environment.ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES),
    providerExecutionEnabled,
    ...(targetJobId === undefined ? {} : { targetJobId, targetTenantId: targetTenantId! }),
  });
}

export function createApplicationAsyncWorkerRuntime(
  config: ApplicationAsyncWorkerConfig,
  dependencies: ApplicationAsyncWorkerDependencies = {},
) {
  const drain = dependencies.drain ?? defaultDrain;
  const report = dependencies.report ?? (() => undefined);
  const registerWorker = dependencies.registerWorker ?? registerRuntimeWorker;
  const heartbeatWorker = dependencies.heartbeatWorker ?? heartbeatRuntimeWorker;
  const setWorkerStatus = dependencies.setWorkerStatus ?? setRuntimeWorkerStatus;
  let running = false;
  let shutdownRequested = false;
  let processedJobs = 0;
  const shutdownController = new AbortController();
  let resolveShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  function requestShutdown(reason: string): void {
    if (shutdownRequested) return;
    shutdownRequested = true;
    report({ event: "ASYNC_WORKER_SHUTDOWN_REQUESTED", workerId: config.workerId, reason });
    void setWorkerStatus(config.workerId, "DRAINING").catch(() => undefined);
    shutdownController.abort();
    resolveShutdown();
  }

  async function wait(delayMs: number): Promise<void> {
    if (dependencies.sleep) {
      await Promise.race([dependencies.sleep(delayMs), shutdown]);
      return;
    }
    await defaultSleep(delayMs, shutdownController.signal);
  }

  async function run(): Promise<void> {
    if (running) throw new Error("ASYNC_WORKER_ALREADY_RUNNING");
    running = true;
    report({
      event: "ASYNC_WORKER_STARTED",
      workerId: config.workerId,
      concurrency: config.concurrency,
    });
    try {
      await registerWorker({
        workerId: config.workerId,
        concurrency: config.concurrency,
        providerExecutionEnabled: config.providerExecutionEnabled ?? false,
      });
      const runLane = async (laneIndex: number): Promise<void> => {
        const laneWorkerId = config.concurrency === 1
          ? config.workerId
          : `${config.workerId}:${laneIndex + 1}`;
        let idleReported = false;
        while (!shutdownRequested) {
        try {
          await heartbeatWorker(config.workerId);
          const result = await drain({
            workerId: laneWorkerId,
            retryDelayMs: config.retryDelayMs,
            operationAllowlist: config.operationAllowlist,
            procedimentoAllowlist: config.procedimentoAllowlist,
            providerExecutionEnabled: config.providerExecutionEnabled,
            targetJobId: config.targetJobId,
            targetTenantId: config.targetTenantId,
          });
          if (result.outcome === "IDLE") {
            if (!idleReported) {
              report({
                event: "ASYNC_WORKER_IDLE",
                workerId: laneWorkerId,
                backoffMs: config.idleBackoffMs,
              });
              idleReported = true;
            }
            if (config.exitOnIdle) return;
            if (!shutdownRequested) await wait(config.idleBackoffMs);
            continue;
          }
          idleReported = false;
          report({
            event: "ASYNC_WORKER_JOB_PROCESSED",
            workerId: laneWorkerId,
            jobId: result.jobId,
            outcome: result.outcome,
          });
          processedJobs += 1;
          if (config.maxProcessedJobs !== undefined && processedJobs >= config.maxProcessedJobs) {
            requestShutdown("MAX_PROCESSED_JOBS_REACHED");
            return;
          }
          if (config.exitOnIdle && result.outcome === "RETRY_SCHEDULED" && !shutdownRequested) {
            await wait(config.retryDelayMs);
          }
        } catch (error) {
          report({
            event: "ASYNC_WORKER_RECOVERABLE_ERROR",
            workerId: laneWorkerId,
            errorName: errorName(error),
            errorCode: errorCode(error),
            errorSource: errorSource(error),
            backoffMs: config.errorBackoffMs,
          });
          if (!shutdownRequested) await wait(config.errorBackoffMs);
        }
        }
      };
      await Promise.all(Array.from({ length: config.concurrency }, (_, laneIndex) => runLane(laneIndex)));
    } finally {
      running = false;
      await setWorkerStatus(config.workerId, "STOPPED").catch(() => undefined);
      report({ event: "ASYNC_WORKER_STOPPED", workerId: config.workerId });
    }
  }

  return Object.freeze({ run, requestShutdown });
}

export function installApplicationAsyncWorkerSignalHandlers(
  runtime: Pick<ReturnType<typeof createApplicationAsyncWorkerRuntime>, "requestShutdown">,
  signalSource: SignalSource = process,
): () => void {
  const onSigint = () => runtime.requestShutdown("SIGINT");
  const onSigterm = () => runtime.requestShutdown("SIGTERM");
  signalSource.on("SIGINT", onSigint);
  signalSource.on("SIGTERM", onSigterm);
  return () => {
    signalSource.off("SIGINT", onSigint);
    signalSource.off("SIGTERM", onSigterm);
  };
}

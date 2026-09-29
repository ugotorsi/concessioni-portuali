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
  readonly providerExecutionEnabled?: boolean;
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
  | { event: "ASYNC_WORKER_RECOVERABLE_ERROR"; workerId: string; errorName: string; backoffMs: number };

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
  const parsed = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (parsed.some((item) => item.length > 256)) {
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

const defaultDrain: Drain = async (input) => {
  const { drainOneApplicationAsyncJob } = await import("./applicationWorker");
  return drainOneApplicationAsyncJob(input);
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
  if (providerExecutionEnabled) {
    try {
      runtimeCostEstimate("ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR", environment);
      runtimeCostEstimate("ASYNC_COST_RESEARCH_CALL_ESTIMATE_EUR", environment);
    } catch (error) {
      if (error instanceof RuntimeCostConfigurationError) {
        throw new ApplicationAsyncWorkerConfigurationError("INVALID_CONFIGURATION");
      }
      throw error;
    }
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
    operationAllowlist: allowlist(environment.ASYNC_WORKER_OPERATION_ALLOWLIST),
    procedimentoAllowlist: allowlist(environment.ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST),
    providerExecutionEnabled,
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
        } catch (error) {
          report({
            event: "ASYNC_WORKER_RECOVERABLE_ERROR",
            workerId: laneWorkerId,
            errorName: errorName(error),
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
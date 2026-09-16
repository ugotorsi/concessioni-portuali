import { hostname } from "node:os";

import type { DrainOneAsyncJobOutcome } from "./worker";

export const APPLICATION_ASYNC_WORKER_CONCURRENCY = 1 as const;

const DEFAULT_IDLE_BACKOFF_MS = 1_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;

export interface ApplicationAsyncWorkerConfig {
  readonly workerId: string;
  readonly retryDelayMs: number;
  readonly idleBackoffMs: number;
  readonly errorBackoffMs: number;
}

export type ApplicationAsyncWorkerEvent =
  | { event: "ASYNC_WORKER_STARTED"; workerId: string; concurrency: 1 }
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
}) => Promise<DrainOneAsyncJobOutcome>;

interface ApplicationAsyncWorkerDependencies {
  readonly drain?: Drain;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly report?: (event: ApplicationAsyncWorkerEvent) => void;
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
  return Object.freeze({
    workerId,
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
  });
}

export function createApplicationAsyncWorkerRuntime(
  config: ApplicationAsyncWorkerConfig,
  dependencies: ApplicationAsyncWorkerDependencies = {},
) {
  const drain = dependencies.drain ?? defaultDrain;
  const report = dependencies.report ?? (() => undefined);
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
    let idleReported = false;
    report({
      event: "ASYNC_WORKER_STARTED",
      workerId: config.workerId,
      concurrency: APPLICATION_ASYNC_WORKER_CONCURRENCY,
    });
    try {
      while (!shutdownRequested) {
        try {
          const result = await drain({
            workerId: config.workerId,
            retryDelayMs: config.retryDelayMs,
          });
          if (result.outcome === "IDLE") {
            if (!idleReported) {
              report({
                event: "ASYNC_WORKER_IDLE",
                workerId: config.workerId,
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
            workerId: config.workerId,
            jobId: result.jobId,
            outcome: result.outcome,
          });
        } catch (error) {
          report({
            event: "ASYNC_WORKER_RECOVERABLE_ERROR",
            workerId: config.workerId,
            errorName: errorName(error),
            backoffMs: config.errorBackoffMs,
          });
          if (!shutdownRequested) await wait(config.errorBackoffMs);
        }
      }
    } finally {
      running = false;
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
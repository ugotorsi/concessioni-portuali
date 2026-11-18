import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ApplicationAsyncWorkerConfigurationError,
  createApplicationAsyncWorkerRuntime,
  installApplicationAsyncWorkerSignalHandlers,
  parseApplicationAsyncWorkerConfig,
  type ApplicationAsyncWorkerEvent,
} from "./applicationWorkerRuntime";

function report(event: ApplicationAsyncWorkerEvent): void {
  console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString() }));
}

function boundedErrorField(error: unknown, field: string, maxLength: number): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) return undefined;
  const value = Reflect.get(error, field);
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("meta" in error)) return undefined;
  const meta = Reflect.get(error, "meta");
  return boundedErrorField(meta, "code", 32);
}

function reportFatal(error: unknown): void {
  const configurationCode = error instanceof ApplicationAsyncWorkerConfigurationError
    ? error.code
    : undefined;
  console.error(JSON.stringify({
    event: error instanceof ApplicationAsyncWorkerConfigurationError
      ? "ASYNC_WORKER_FATAL_CONFIGURATION"
      : "ASYNC_WORKER_FATAL_ERROR",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: configurationCode ?? boundedErrorField(error, "code", 128) ?? "UNEXPECTED_FAILURE",
    errorSource: boundedErrorField(error, "diagnosticSource", 256),
    databaseErrorCode: databaseErrorCode(error),
    timestamp: new Date().toISOString(),
  }));
}

interface ApplicationAsyncWorkerProcessDependencies {
  readonly parseConfig?: typeof parseApplicationAsyncWorkerConfig;
  readonly createRuntime?: typeof createApplicationAsyncWorkerRuntime;
  readonly installSignalHandlers?: typeof installApplicationAsyncWorkerSignalHandlers;
  readonly bootstrap?: () => Promise<unknown>;
  readonly disconnect?: () => Promise<void>;
  readonly report?: (event: ApplicationAsyncWorkerEvent) => void;
  readonly reportFatal?: (error: unknown) => void;
  readonly markFailure?: () => void;
}

export async function runApplicationAsyncWorkerProcess(
  dependencies: ApplicationAsyncWorkerProcessDependencies = {},
): Promise<void> {
  const parseConfig = dependencies.parseConfig ?? parseApplicationAsyncWorkerConfig;
  const createRuntime = dependencies.createRuntime ?? createApplicationAsyncWorkerRuntime;
  const installSignalHandlers = dependencies.installSignalHandlers
    ?? installApplicationAsyncWorkerSignalHandlers;
  const disconnect = dependencies.disconnect ?? (async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  try {
    const config = parseConfig();
    const { runR2WorkerProbeIfEnabled } = await import("../../../scripts/runtime/r2-worker-probe");
    await runR2WorkerProbeIfEnabled();
    const runtime = createRuntime(config, { report: dependencies.report ?? report });
    const removeSignalHandlers = installSignalHandlers(runtime);
    try {
      const bootstrap = dependencies.bootstrap ?? (async () => {
        const { bootstrapConcessioneTimeWatches } = await import(
          "../fascicolo-lifecycle/concessioneTimeWatchBootstrap"
        );
        return bootstrapConcessioneTimeWatches();
      });
      if (config.bootstrapTimeWatches) await bootstrap();
      await runtime.run();
    } finally {
      let teardownError: unknown;
      try {
        removeSignalHandlers();
      } catch (error) {
        teardownError = error;
      }
      try {
        await disconnect();
      } catch (error) {
        teardownError ??= error;
      }
      if (teardownError) throw teardownError;
    }
  } catch (error) {
    (dependencies.reportFatal ?? reportFatal)(error);
    (dependencies.markFailure ?? (() => { process.exitCode = 1; }))();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runApplicationAsyncWorkerProcess();
}
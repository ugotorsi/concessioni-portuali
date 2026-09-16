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

function reportFatal(error: unknown): void {
  console.error(JSON.stringify({
    event: error instanceof ApplicationAsyncWorkerConfigurationError
      ? "ASYNC_WORKER_FATAL_CONFIGURATION"
      : "ASYNC_WORKER_FATAL_ERROR",
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: error instanceof ApplicationAsyncWorkerConfigurationError ? error.code : "UNEXPECTED_FAILURE",
    timestamp: new Date().toISOString(),
  }));
}

interface ApplicationAsyncWorkerProcessDependencies {
  readonly parseConfig?: typeof parseApplicationAsyncWorkerConfig;
  readonly createRuntime?: typeof createApplicationAsyncWorkerRuntime;
  readonly installSignalHandlers?: typeof installApplicationAsyncWorkerSignalHandlers;
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
    const runtime = createRuntime(config, { report: dependencies.report ?? report });
    const removeSignalHandlers = installSignalHandlers(runtime);
    try {
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
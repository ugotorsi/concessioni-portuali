import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const applicationWorker = vi.hoisted(() => ({
  drainOneApplicationAsyncJob: vi.fn(),
}));
const timeWatchBootstrap = vi.hoisted(() => ({
  bootstrapConcessioneTimeWatches: vi.fn(),
}));

vi.mock("@/server/async-jobs/applicationWorker", () => ({
  drainOneApplicationAsyncJob: applicationWorker.drainOneApplicationAsyncJob,
}));
vi.mock("@/server/fascicolo-lifecycle/concessioneTimeWatchBootstrap", () => ({
  bootstrapConcessioneTimeWatches: timeWatchBootstrap.bootstrapConcessioneTimeWatches,
}));

import {
  APPLICATION_ASYNC_WORKER_CONCURRENCY,
  ApplicationAsyncWorkerConfigurationError,
  createApplicationAsyncWorkerRuntime,
  installApplicationAsyncWorkerSignalHandlers,
  parseApplicationAsyncWorkerConfig,
  type ApplicationAsyncWorkerEvent,
} from "@/server/async-jobs/applicationWorkerRuntime";
import { runApplicationAsyncWorkerProcess } from "@/server/async-jobs/applicationWorkerProcess";

const config = {
  workerId: "worker-process-1",
  retryDelayMs: 5_000,
  idleBackoffMs: 1_000,
  errorBackoffMs: 2_000,
};

function harness() {
  const events: ApplicationAsyncWorkerEvent[] = [];
  const sleeps: number[] = [];
  let runtime: ReturnType<typeof createApplicationAsyncWorkerRuntime>;
  const sleep = vi.fn(async (delayMs: number) => {
    sleeps.push(delayMs);
    runtime.requestShutdown("TEST_COMPLETE");
  });
  runtime = createApplicationAsyncWorkerRuntime(config, {
    sleep,
    report: (event) => events.push(event),
  });
  return { runtime, events, sleeps, sleep };
}

describe("Block 3B.7 application async worker runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeWatchBootstrap.bootstrapConcessioneTimeWatches.mockResolvedValue({
      scannedCount: 0,
      admittedCount: 0,
      reusedCount: 0,
    });
  });

  it("uses a single bounded idle backoff without busy-looping or noisy repeated idle reports", async () => {
    applicationWorker.drainOneApplicationAsyncJob.mockResolvedValue({ outcome: "IDLE" });
    const { runtime, events, sleeps } = harness();

    await runtime.run();

    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce();
    expect(sleeps).toEqual([config.idleBackoffMs]);
    expect(events.filter((event) => event.event === "ASYNC_WORKER_IDLE")).toHaveLength(1);
  });

  it("drains available jobs sequentially through the existing application drain", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirstDrain!: () => void;
    let releaseSecondDrain!: () => void;
    applicationWorker.drainOneApplicationAsyncJob.mockImplementation(async () => {
      const callNumber = applicationWorker.drainOneApplicationAsyncJob.mock.calls.length;
      if (callNumber > 2) throw new Error("unexpected additional drain");
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise<void>((resolve) => {
          if (callNumber === 1) releaseFirstDrain = resolve;
          else releaseSecondDrain = resolve;
        });
        return { outcome: "SUCCEEDED", jobId: `job-${callNumber}` };
      } finally {
        active -= 1;
      }
    });
    const events: ApplicationAsyncWorkerEvent[] = [];
    const runtime = createApplicationAsyncWorkerRuntime(config, {
      report: (event) => events.push(event),
    });

    const running = runtime.run();
    await vi.waitFor(() => expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce());
    expect(maxActive).toBe(1);
    await Promise.resolve();
    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce();

    releaseFirstDrain();
    await vi.waitFor(() => expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(1);

    runtime.requestShutdown("TEST_COMPLETE");
    releaseSecondDrain();
    await running;

    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(events.filter((event) => event.event === "ASYNC_WORKER_JOB_PROCESSED"))
      .toEqual([
        expect.objectContaining({ jobId: "job-1", outcome: "SUCCEEDED" }),
        expect.objectContaining({ jobId: "job-2", outcome: "SUCCEEDED" }),
      ]);
  });

  it("removes process handlers and disconnects exactly once after a normal runtime exit", async () => {
    const order: string[] = [];
    let finishRun!: () => void;
    const runtime = {
      requestShutdown: vi.fn(),
      run: vi.fn(async () => {
        order.push("run-start");
        await new Promise<void>((resolve) => { finishRun = resolve; });
        order.push("run-end");
      }),
    };
    const removeSignalHandlers = vi.fn(() => { order.push("remove-handlers"); });
    const disconnect = vi.fn(async () => { order.push("disconnect"); });

    const running = runApplicationAsyncWorkerProcess({
      parseConfig: () => config,
      createRuntime: () => runtime,
      installSignalHandlers: () => removeSignalHandlers,
      disconnect,
      reportFatal: vi.fn(),
      markFailure: vi.fn(),
    });

    await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
    expect(order).toEqual(["run-start"]);
    expect(removeSignalHandlers).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();

    finishRun();
    await running;

    expect(order).toEqual(["run-start", "run-end", "remove-handlers", "disconnect"]);
    expect(removeSignalHandlers).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("completes the time-watch bootstrap before starting the normal drain runtime", async () => {
    const order: string[] = [];
    const runtime = {
      requestShutdown: vi.fn(),
      run: vi.fn(async () => { order.push("runtime"); }),
    };

    await runApplicationAsyncWorkerProcess({
      parseConfig: () => config,
      createRuntime: () => runtime,
      installSignalHandlers: () => vi.fn(),
      bootstrap: vi.fn(async () => { order.push("bootstrap"); }),
      disconnect: vi.fn(async () => undefined),
      reportFatal: vi.fn(),
      markFailure: vi.fn(),
    });

    expect(order).toEqual(["bootstrap", "runtime"]);
  });

  it("does not start the worker when the time-watch bootstrap fails", async () => {
    const runtime = { requestShutdown: vi.fn(), run: vi.fn() };
    const disconnect = vi.fn(async () => undefined);
    const reportFatal = vi.fn();
    const markFailure = vi.fn();
    const failure = new Error("bootstrap unavailable");

    await runApplicationAsyncWorkerProcess({
      parseConfig: () => config,
      createRuntime: () => runtime,
      installSignalHandlers: () => vi.fn(),
      bootstrap: vi.fn(async () => { throw failure; }),
      disconnect,
      reportFatal,
      markFailure,
    });

    expect(runtime.run).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(reportFatal).toHaveBeenCalledWith(failure);
    expect(markFailure).toHaveBeenCalledOnce();
  });

  it("cleans up after a fatal runtime exit and reports failure without another drain", async () => {
    const fatalError = new Error("sensitive runtime detail");
    const runtime = {
      requestShutdown: vi.fn(),
      run: vi.fn(async () => { throw fatalError; }),
    };
    const removeSignalHandlers = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    const reportFatal = vi.fn();
    const markFailure = vi.fn();

    await runApplicationAsyncWorkerProcess({
      parseConfig: () => config,
      createRuntime: () => runtime,
      installSignalHandlers: () => removeSignalHandlers,
      disconnect,
      reportFatal,
      markFailure,
    });

    expect(runtime.run).toHaveBeenCalledOnce();
    expect(removeSignalHandlers).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(reportFatal).toHaveBeenCalledWith(fatalError);
    expect(markFailure).toHaveBeenCalledOnce();
  });

  it("reports teardown failure safely and does not retry runtime or disconnect", async () => {
    const runtime = {
      requestShutdown: vi.fn(),
      run: vi.fn(async () => undefined),
    };
    const disconnect = vi.fn(async () => {
      throw new Error("postgresql://secret@database.example/app");
    });
    const markFailure = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await runApplicationAsyncWorkerProcess({
        parseConfig: () => config,
        createRuntime: () => runtime,
        installSignalHandlers: () => vi.fn(),
        disconnect,
        markFailure,
      });

      expect(runtime.run).toHaveBeenCalledOnce();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(markFailure).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();
      expect(consoleError.mock.calls[0]?.[0]).toContain('"event":"ASYNC_WORKER_FATAL_ERROR"');
      expect(consoleError.mock.calls[0]?.[0]).not.toContain("postgresql://");
      expect(consoleError.mock.calls[0]?.[0]).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("continues after a recoverable drain error using the bounded error backoff", async () => {
    applicationWorker.drainOneApplicationAsyncJob
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce({ outcome: "IDLE" });
    const { runtime, events, sleeps, sleep } = harness();
    sleep.mockImplementationOnce(async (delayMs: number) => {
      sleeps.push(delayMs);
    });

    await runtime.run();

    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([config.errorBackoffMs, config.idleBackoffMs]);
    expect(events).toContainEqual(expect.objectContaining({
      event: "ASYNC_WORKER_RECOVERABLE_ERROR",
      errorName: "Error",
    }));
    expect(JSON.stringify(events)).not.toContain("database temporarily unavailable");
  });

  it("handles SIGTERM cleanly and starts no new drain after shutdown begins", async () => {
    const signals = new EventEmitter();
    let releaseDrain!: () => void;
    applicationWorker.drainOneApplicationAsyncJob.mockImplementationOnce(() =>
      new Promise((resolve) => {
        releaseDrain = () => resolve({ outcome: "SUCCEEDED", jobId: "job-1" });
      }));
    const events: ApplicationAsyncWorkerEvent[] = [];
    const runtime = createApplicationAsyncWorkerRuntime(config, {
      sleep: vi.fn(async () => undefined),
      report: (event) => events.push(event),
    });
    const removeHandlers = installApplicationAsyncWorkerSignalHandlers(runtime, signals);

    const running = runtime.run();
    await vi.waitFor(() => expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce());
    signals.emit("SIGTERM");
    releaseDrain();
    await running;
    removeHandlers();

    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({
      event: "ASYNC_WORKER_SHUTDOWN_REQUESTED",
      reason: "SIGTERM",
    }));
    expect(events.at(-1)).toEqual(expect.objectContaining({ event: "ASYNC_WORKER_STOPPED" }));
  });

  it("cancels the default idle timer when shutdown is requested", async () => {
    vi.useFakeTimers();
    try {
      applicationWorker.drainOneApplicationAsyncJob.mockResolvedValue({ outcome: "IDLE" });
      const runtime = createApplicationAsyncWorkerRuntime(config);

      const running = runtime.run();
      await vi.waitFor(() => expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce());
      expect(vi.getTimerCount()).toBe(1);
      runtime.requestShutdown("TEST_COMPLETE");
      await running;

      expect(vi.getTimerCount()).toBe(0);
      expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps concurrency at one and passes stable process configuration to every drain", async () => {
    applicationWorker.drainOneApplicationAsyncJob
      .mockResolvedValueOnce({ outcome: "SUCCEEDED", jobId: "job-1" })
      .mockResolvedValueOnce({ outcome: "IDLE" });
    const { runtime, events } = harness();

    await runtime.run();

    expect(APPLICATION_ASYNC_WORKER_CONCURRENCY).toBe(1);
    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenNthCalledWith(1, {
      workerId: config.workerId,
      retryDelayMs: config.retryDelayMs,
    });
    expect(applicationWorker.drainOneApplicationAsyncJob).toHaveBeenNthCalledWith(2, {
      workerId: config.workerId,
      retryDelayMs: config.retryDelayMs,
    });
    expect(events[0]).toEqual(expect.objectContaining({
      event: "ASYNC_WORKER_STARTED",
      concurrency: 1,
      workerId: config.workerId,
    }));
  });

  it("parses bounded server configuration and fails closed without DATABASE_URL", () => {
    const parsed = parseApplicationAsyncWorkerConfig({
      DATABASE_URL: "postgresql://server/database",
      ASYNC_WORKER_ID: "configured-worker",
      ASYNC_WORKER_IDLE_BACKOFF_MS: "250",
      ASYNC_WORKER_ERROR_BACKOFF_MS: "750",
      ASYNC_WORKER_RETRY_DELAY_MS: "1500",
    });

    expect(parsed).toEqual({
      workerId: "configured-worker",
      idleBackoffMs: 250,
      errorBackoffMs: 750,
      retryDelayMs: 1_500,
    });
    expect(() => parseApplicationAsyncWorkerConfig({}))
      .toThrowError(expect.objectContaining<Partial<ApplicationAsyncWorkerConfigurationError>>({
        code: "DATABASE_URL_REQUIRED",
      }));
  });

  it("delegates to the existing application drain without a parallel job engine", () => {
    const runtimeSource = readFileSync(resolve(
      process.cwd(),
      "src/server/async-jobs/applicationWorkerRuntime.ts",
    ), "utf8");
    const processSource = readFileSync(resolve(
      process.cwd(),
      "src/server/async-jobs/applicationWorkerProcess.ts",
    ), "utf8");
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

    expect(runtimeSource).toContain('import("./applicationWorker")');
    expect(runtimeSource).toContain("drainOneApplicationAsyncJob");
    expect(runtimeSource).not.toMatch(/claimNextAsyncJob|heartbeatAsyncJob|failAsyncJob|succeedAsyncJob/);
    expect(runtimeSource).not.toMatch(/new AsyncJobHandlerRegistry|applicationAsyncJobRegistry/);
    expect(processSource).toContain("createApplicationAsyncWorkerRuntime");
    expect(packageJson.scripts["worker:async"]).toBe(
      "tsx src/server/async-jobs/applicationWorkerProcess.ts",
    );
  });
});
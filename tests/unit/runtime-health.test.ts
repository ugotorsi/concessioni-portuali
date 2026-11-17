import { describe, expect, it, vi } from "vitest";

import { getRuntimeHealthSnapshot, registerRuntimeWorker, type RuntimeSqlExecutor } from "@/server/runtime/health";

function executor(rows: unknown[]): RuntimeSqlExecutor & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("Lotto 8 runtime health", () => {
  it("reports queued work without a live worker as unavailable", async () => {
    const db = executor([{
      queueDepth: 4, runningJobs: 0, failedJobs: 0, staleLeases: 0,
      oldestPendingAgeSeconds: 80, activeWorkers: 0, lastSuccessfulJobAt: null,
      migrationCompatible: true,
    }]);
    await expect(getRuntimeHealthSnapshot(60, db)).resolves.toMatchObject({
      status: "WORKER_UNAVAILABLE", queueDepth: 4, activeWorkers: 0,
      databaseConnected: true, migrationState: "COMPATIBLE",
    });
  });

  it("reports stale leases or failed jobs as degraded", async () => {
    const db = executor([{
      queueDepth: 0, runningJobs: 1, failedJobs: 1, staleLeases: 1,
      oldestPendingAgeSeconds: null, activeWorkers: 1, lastSuccessfulJobAt: null,
      migrationCompatible: true,
    }]);
    await expect(getRuntimeHealthSnapshot(60, db)).resolves.toMatchObject({ status: "DEGRADED" });
  });

  it("degrades instead of failing when the migrations table is missing", async () => {
    const undefinedTable = Object.assign(new Error('relation "_prisma_migrations" does not exist'), {
      code: "42P01",
    });
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          queueDepth: 0, runningJobs: 0, failedJobs: 0, staleLeases: 0,
          oldestPendingAgeSeconds: null, activeWorkers: 1, lastSuccessfulJobAt: null,
        }],
      })
      .mockRejectedValueOnce(undefinedTable);
    const db: RuntimeSqlExecutor = { query };
    await expect(getRuntimeHealthSnapshot(60, db)).resolves.toMatchObject({
      status: "DEGRADED",
      migrationState: "PENDING_OR_UNKNOWN",
      databaseConnected: true,
    });
  });

  it("propagates non-42P01 errors from the migration check", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          queueDepth: 0, runningJobs: 0, failedJobs: 0, staleLeases: 0,
          oldestPendingAgeSeconds: null, activeWorkers: 1, lastSuccessfulJobAt: null,
        }],
      })
      .mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "57P01" }));
    const db: RuntimeSqlExecutor = { query };
    await expect(getRuntimeHealthSnapshot(60, db)).rejects.toThrow("connection reset");
  });

  it("registers the worker without including job payloads", async () => {
    const db = executor([]);
    await registerRuntimeWorker({ workerId: "worker-a", concurrency: 3, providerExecutionEnabled: false }, db);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), [
      "runtime_worker_worker-a", "worker-a", 3, false,
    ]);
  });
});
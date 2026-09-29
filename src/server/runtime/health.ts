import { prisma } from "@/lib/prisma";

export interface RuntimeSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

const defaultExecutor: RuntimeSqlExecutor = {
  async query<T>(sql: string, params: readonly unknown[] = []) {
    return { rows: await prisma.$queryRawUnsafe<T[]>(sql, ...params) };
  },
};

export async function registerRuntimeWorker(input: {
  workerId: string;
  concurrency: number;
  providerExecutionEnabled: boolean;
}, executor: RuntimeSqlExecutor = defaultExecutor): Promise<void> {
  await executor.query(`
    INSERT INTO "RuntimeWorkerHeartbeat" (
      "id","workerId","status","concurrency","providerExecutionEnabled","startedAt","lastSeenAt"
    ) VALUES ($1,$2,'RUNNING',$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT ("workerId") DO UPDATE SET
      "status"='RUNNING', "concurrency"=EXCLUDED."concurrency",
      "providerExecutionEnabled"=EXCLUDED."providerExecutionEnabled",
      "startedAt"=CURRENT_TIMESTAMP, "lastSeenAt"=CURRENT_TIMESTAMP, "stoppedAt"=NULL
  `, [`runtime_worker_${input.workerId}`, input.workerId, input.concurrency, input.providerExecutionEnabled]);
}

export async function heartbeatRuntimeWorker(
  workerId: string,
  executor: RuntimeSqlExecutor = defaultExecutor,
): Promise<void> {
  await executor.query(`
    WITH expired AS (
      UPDATE "RuntimeCostReservation"
      SET "status"='EXPIRED', "releasedAmount"="reservedAmount",
          "releasedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP
      WHERE "status"='RESERVED' AND "expiresAt"<=CURRENT_TIMESTAMP
      RETURNING "id"
    )
    UPDATE "RuntimeWorkerHeartbeat" SET "lastSeenAt"=CURRENT_TIMESTAMP
    WHERE "workerId"=$1 AND "status" IN ('RUNNING','DRAINING')
  `, [workerId]);
}

export async function setRuntimeWorkerStatus(
  workerId: string,
  status: "DRAINING" | "STOPPED",
  executor: RuntimeSqlExecutor = defaultExecutor,
): Promise<void> {
  await executor.query(`
    UPDATE "RuntimeWorkerHeartbeat"
    SET "status"=$2::"RuntimeWorkerStatus", "lastSeenAt"=CURRENT_TIMESTAMP,
        "stoppedAt"=CASE WHEN $2='STOPPED' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE "workerId"=$1
  `, [workerId, status]);
}

export interface RuntimeHealthSnapshot {
  status: "HEALTHY" | "DEGRADED" | "WORKER_UNAVAILABLE";
  databaseConnected: boolean;
  queueDepth: number;
  runningJobs: number;
  failedJobs: number;
  staleLeases: number;
  oldestPendingAgeSeconds: number | null;
  activeWorkers: number;
  lastSuccessfulJobAt: Date | null;
  migrationState: "COMPATIBLE" | "PENDING_OR_UNKNOWN";
}

export async function getRuntimeHealthSnapshot(
  staleWorkerSeconds = 60,
  executor: RuntimeSqlExecutor = defaultExecutor,
): Promise<RuntimeHealthSnapshot> {
  const result = await executor.query<{
    queueDepth: number;
    runningJobs: number;
    failedJobs: number;
    staleLeases: number;
    oldestPendingAgeSeconds: number | null;
    activeWorkers: number;
    lastSuccessfulJobAt: Date | null;
    migrationCompatible: boolean;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM "AsyncJob" WHERE "status" IN ('QUEUED','RETRY_WAIT')) AS "queueDepth",
      (SELECT COUNT(*)::int FROM "AsyncJob" WHERE "status" IN ('RUNNING','CANCELLATION_REQUESTED')) AS "runningJobs",
      (SELECT COUNT(*)::int FROM "AsyncJob" WHERE "status"='TERMINAL_FAILED') AS "failedJobs",
      (SELECT COUNT(*)::int FROM "AsyncJob" WHERE "status"='RUNNING' AND "leaseExpiresAt" <= CURRENT_TIMESTAMP) AS "staleLeases",
      (SELECT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP-MIN("createdAt"))::int FROM "AsyncJob" WHERE "status" IN ('QUEUED','RETRY_WAIT')) AS "oldestPendingAgeSeconds",
      (SELECT COUNT(*)::int FROM "RuntimeWorkerHeartbeat" WHERE "status"='RUNNING' AND "lastSeenAt" > CURRENT_TIMESTAMP-($1*INTERVAL '1 second')) AS "activeWorkers",
      (SELECT MAX("completedAt") FROM "AsyncJob" WHERE "status"='SUCCEEDED') AS "lastSuccessfulJobAt",
      EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name"='20261001_runtime_worker_cost_readiness' AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) AS "migrationCompatible"
  `, [staleWorkerSeconds]);
  const row = result.rows[0];
  if (!row) throw new Error("RUNTIME_HEALTH_QUERY_FAILED");
  const status = row.queueDepth > 0 && row.activeWorkers === 0
    ? "WORKER_UNAVAILABLE" as const
    : row.failedJobs > 0 || row.staleLeases > 0 || !row.migrationCompatible
      ? "DEGRADED" as const
      : "HEALTHY" as const;
  return {
    status,
    databaseConnected: true,
    queueDepth: row.queueDepth,
    runningJobs: row.runningJobs,
    failedJobs: row.failedJobs,
    staleLeases: row.staleLeases,
    oldestPendingAgeSeconds: row.oldestPendingAgeSeconds,
    activeWorkers: row.activeWorkers,
    lastSuccessfulJobAt: row.lastSuccessfulJobAt,
    migrationState: row.migrationCompatible ? "COMPATIBLE" : "PENDING_OR_UNKNOWN",
  };
}
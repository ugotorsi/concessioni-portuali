import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "prisma/migrations/20261001_runtime_worker_cost_readiness/migration.sql",
), "utf8");

describe("Lotto 8 runtime readiness migration", () => {
  it("is additive and contains the queue, worker, and cost controls", () => {
    expect(migration).not.toMatch(/\b(DROP\s+(TABLE|TYPE|COLUMN|INDEX)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i);
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(3);
    expect(migration).toContain('ALTER TABLE "AsyncJob"');
    expect(migration).toContain('"AsyncJob_dependsOnJobId_fkey"');
    expect(migration).toContain('"RuntimeWorkerHeartbeat_concurrency_ck"');
    expect(migration).toContain('"RuntimeBudgetPolicy_scope_ck"');
    expect(migration).toContain('"RuntimeCostReservation_amounts_ck"');
  });

  it("applies to a compatible baseline and enforces key runtime constraints", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TYPE "AsyncJobStatus" AS ENUM ('QUEUED','RUNNING','RETRY_WAIT','CANCELLATION_REQUESTED','SUCCEEDED','TERMINAL_FAILED','CANCELLED');
        CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "AsyncJob" (
          "id" TEXT PRIMARY KEY,
          "status" "AsyncJobStatus" NOT NULL DEFAULT 'QUEUED',
          "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "tenantId" TEXT
        );
      `);
      await database.exec(migration);
      await database.exec(`
        INSERT INTO "Ente" ("id") VALUES ('tenant-1');
        INSERT INTO "Procedimento" ("id") VALUES ('procedure-1');
        INSERT INTO "AsyncJob" ("id","tenantId","procedimentoId","priority")
          VALUES ('job-1','tenant-1','procedure-1','HIGH');
        INSERT INTO "RuntimeWorkerHeartbeat" ("id","workerId","concurrency")
          VALUES ('heartbeat-1','worker-1',2);
        INSERT INTO "RuntimeBudgetPolicy" (
          "id","scope","tenantId","procedimentoId","hardCapAmount","windowSeconds"
        ) VALUES ('policy-1','PROCEDIMENTO','tenant-1','procedure-1',10,3600);
        INSERT INTO "RuntimeCostReservation" (
          "id","tenantId","procedimentoId","jobId","provider","operationType",
          "estimatedAmount","reservedAmount","idempotencyKey","expiresAt"
        ) VALUES ('reservation-1','tenant-1','procedure-1','job-1','fixture','SYNTHETIC',2.5,2.5,
          '${"a".repeat(64)}',CURRENT_TIMESTAMP + INTERVAL '15 minutes');
      `);
      const rows = await database.query<{ status: string; priority: string; concurrency: number }>(`
        SELECT reservation."status", job."priority", worker."concurrency"
        FROM "RuntimeCostReservation" reservation
        JOIN "AsyncJob" job ON job."id"=reservation."jobId"
        CROSS JOIN "RuntimeWorkerHeartbeat" worker
      `);
      expect(rows.rows).toEqual([{ status: "RESERVED", priority: "HIGH", concurrency: 2 }]);
      await expect(database.exec(`
        INSERT INTO "RuntimeWorkerHeartbeat" ("id","workerId","concurrency") VALUES ('bad','bad-worker',0)
      `)).rejects.toThrow();
      await expect(database.exec(`
        INSERT INTO "RuntimeBudgetPolicy" ("id","scope","tenantId","hardCapAmount","windowSeconds")
          VALUES ('bad-policy','GLOBAL','tenant-1',10,3600)
      `)).rejects.toThrow();
      await database.exec(`
        INSERT INTO "RuntimeBudgetPolicy" ("id","scope","hardCapAmount","windowSeconds")
          VALUES ('global-policy','GLOBAL',100,3600)
      `);
      await expect(database.exec(`
        INSERT INTO "RuntimeBudgetPolicy" ("id","scope","hardCapAmount","windowSeconds")
          VALUES ('duplicate-global-policy','GLOBAL',200,3600)
      `)).rejects.toThrow();
      await expect(database.exec(`
        INSERT INTO "RuntimeCostReservation" (
          "id","provider","operationType","estimatedAmount","reservedAmount","idempotencyKey","expiresAt"
        ) VALUES ('bad-reservation','fixture','SYNTHETIC',-1,-1,'${"b".repeat(64)}',CURRENT_TIMESTAMP)
      `)).rejects.toThrow();
    } finally {
      await database.close();
    }
  });
});
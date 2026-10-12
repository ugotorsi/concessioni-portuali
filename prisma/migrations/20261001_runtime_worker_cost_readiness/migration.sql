CREATE TYPE "AsyncJobPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');
CREATE TYPE "RuntimeWorkerStatus" AS ENUM ('RUNNING', 'DRAINING', 'STOPPED');
CREATE TYPE "RuntimeBudgetScope" AS ENUM ('GLOBAL', 'TENANT', 'PROCEDIMENTO');
CREATE TYPE "RuntimeCostReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED');

ALTER TABLE "AsyncJob"
  ADD COLUMN "procedimentoId" TEXT,
  ADD COLUMN "dependsOnJobId" TEXT,
  ADD COLUMN "priority" "AsyncJobPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "blockedReason" TEXT;

ALTER TABLE "AsyncJob"
  ADD CONSTRAINT "AsyncJob_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AsyncJob_dependsOnJobId_fkey" FOREIGN KEY ("dependsOnJobId") REFERENCES "AsyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AsyncJob_procedimentoId_createdAt_idx" ON "AsyncJob"("procedimentoId", "createdAt");
CREATE INDEX "AsyncJob_dependsOnJobId_idx" ON "AsyncJob"("dependsOnJobId");
CREATE INDEX "AsyncJob_status_priority_availableAt_createdAt_idx" ON "AsyncJob"("status", "priority", "availableAt", "createdAt");

CREATE TABLE "RuntimeWorkerHeartbeat" (
  "id" TEXT PRIMARY KEY,
  "workerId" VARCHAR(256) NOT NULL,
  "status" "RuntimeWorkerStatus" NOT NULL DEFAULT 'RUNNING',
  "concurrency" INTEGER NOT NULL,
  "providerExecutionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stoppedAt" TIMESTAMPTZ,
  "metadata" JSONB,
  CONSTRAINT "RuntimeWorkerHeartbeat_concurrency_ck" CHECK ("concurrency" BETWEEN 1 AND 32)
);
CREATE UNIQUE INDEX "RuntimeWorkerHeartbeat_workerId_key" ON "RuntimeWorkerHeartbeat"("workerId");
CREATE INDEX "RuntimeWorkerHeartbeat_status_lastSeenAt_idx" ON "RuntimeWorkerHeartbeat"("status", "lastSeenAt");

CREATE TABLE "RuntimeBudgetPolicy" (
  "id" TEXT PRIMARY KEY,
  "scope" "RuntimeBudgetScope" NOT NULL,
  "tenantId" TEXT,
  "procedimentoId" TEXT,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "hardCapAmount" DECIMAL(18,6) NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeBudgetPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RuntimeBudgetPolicy_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RuntimeBudgetPolicy_amount_ck" CHECK ("hardCapAmount" >= 0),
  CONSTRAINT "RuntimeBudgetPolicy_window_ck" CHECK ("windowSeconds" > 0),
  CONSTRAINT "RuntimeBudgetPolicy_scope_ck" CHECK (
    ("scope" = 'GLOBAL' AND "tenantId" IS NULL AND "procedimentoId" IS NULL) OR
    ("scope" = 'TENANT' AND "tenantId" IS NOT NULL AND "procedimentoId" IS NULL) OR
    ("scope" = 'PROCEDIMENTO' AND "tenantId" IS NOT NULL AND "procedimentoId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "RuntimeBudgetPolicy_scope_tenantId_procedimentoId_currency_windowSeconds_key"
  ON "RuntimeBudgetPolicy"("scope", "tenantId", "procedimentoId", "currency", "windowSeconds") NULLS NOT DISTINCT;
CREATE INDEX "RuntimeBudgetPolicy_enabled_scope_effectiveFrom_idx" ON "RuntimeBudgetPolicy"("enabled", "scope", "effectiveFrom");

CREATE TABLE "RuntimeCostReservation" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT,
  "procedimentoId" TEXT,
  "jobId" TEXT,
  "provider" VARCHAR(128) NOT NULL,
  "operationType" VARCHAR(256) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "estimatedAmount" DECIMAL(18,6) NOT NULL,
  "reservedAmount" DECIMAL(18,6) NOT NULL,
  "actualAmount" DECIMAL(18,6),
  "releasedAmount" DECIMAL(18,6),
  "status" "RuntimeCostReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "idempotencyKey" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "settledAt" TIMESTAMPTZ,
  "releasedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeCostReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RuntimeCostReservation_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RuntimeCostReservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AsyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RuntimeCostReservation_amounts_ck" CHECK (
    "estimatedAmount" >= 0 AND "reservedAmount" >= 0 AND
    ("actualAmount" IS NULL OR "actualAmount" >= 0) AND
    ("releasedAmount" IS NULL OR "releasedAmount" >= 0)
  )
);
CREATE UNIQUE INDEX "RuntimeCostReservation_idempotencyKey_key" ON "RuntimeCostReservation"("idempotencyKey");
CREATE INDEX "RuntimeCostReservation_tenantId_createdAt_idx" ON "RuntimeCostReservation"("tenantId", "createdAt");
CREATE INDEX "RuntimeCostReservation_procedimentoId_createdAt_idx" ON "RuntimeCostReservation"("procedimentoId", "createdAt");
CREATE INDEX "RuntimeCostReservation_jobId_idx" ON "RuntimeCostReservation"("jobId");
CREATE INDEX "RuntimeCostReservation_status_expiresAt_idx" ON "RuntimeCostReservation"("status", "expiresAt");
CREATE INDEX "RuntimeCostReservation_currency_createdAt_idx" ON "RuntimeCostReservation"("currency", "createdAt");
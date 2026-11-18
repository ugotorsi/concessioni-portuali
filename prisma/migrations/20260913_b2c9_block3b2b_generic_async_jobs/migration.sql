-- CreateEnum
CREATE TYPE "AsyncJobStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'RETRY_WAIT',
    'CANCELLATION_REQUESTED',
    'SUCCEEDED',
    'TERMINAL_FAILED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "AsyncJobAdmissionType" AS ENUM ('AUTHENTICATED_USER', 'AUTHORIZED_SYSTEM');

-- CreateTable
CREATE TABLE "AsyncJob" (
    "id" TEXT NOT NULL,
    "idempotencyKey" CHAR(64) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "operation" TEXT NOT NULL,
    "logicalOperationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "policyDecisionRef" TEXT,
    "inputReference" JSONB NOT NULL,
    "admissionType" "AsyncJobAdmissionType" NOT NULL,
    "tenantId" TEXT,
    "initiatingUserId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorRole" TEXT NOT NULL,
    "status" "AsyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "leaseOwner" TEXT,
    "leaseToken" CHAR(64),
    "leaseExpiresAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "cancellationRequestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureCategory" TEXT,
    "failureCode" TEXT,
    "resultReference" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsyncJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "async_job_hashes_ck" CHECK (
        "idempotencyKey" ~ '^[0-9a-f]{64}$'
        AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
        AND ("leaseToken" IS NULL OR "leaseToken" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "async_job_required_text_ck" CHECK (
        "operation" ~ '[^[:space:]]'
        AND "logicalOperationId" ~ '[^[:space:]]'
        AND "purpose" ~ '[^[:space:]]'
        AND "correlationId" ~ '[^[:space:]]'
        AND "actorId" ~ '[^[:space:]]'
        AND "actorRole" ~ '[^[:space:]]'
    ),
    CONSTRAINT "async_job_admission_ck" CHECK (
        ("admissionType" = 'AUTHENTICATED_USER' AND "initiatingUserId" IS NOT NULL AND "actorId" = "initiatingUserId")
        OR ("admissionType" = 'AUTHORIZED_SYSTEM' AND "initiatingUserId" IS NULL AND "policyDecisionRef" ~ '[^[:space:]]')
    ),
    CONSTRAINT "async_job_attempts_ck" CHECK (
        "maxAttempts" BETWEEN 1 AND 100
        AND "attemptCount" BETWEEN 0 AND "maxAttempts"
    ),
    CONSTRAINT "async_job_reference_size_ck" CHECK (
        octet_length("inputReference"::text) <= 16384
        AND ("resultReference" IS NULL OR octet_length("resultReference"::text) <= 16384)
    ),
    CONSTRAINT "async_job_lease_tuple_ck" CHECK (
        ("leaseOwner" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL AND "lastHeartbeatAt" IS NULL)
        OR ("leaseOwner" ~ '[^[:space:]]' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "lastHeartbeatAt" IS NOT NULL)
    ),
    CONSTRAINT "async_job_lease_status_ck" CHECK (
        ("status" IN ('RUNNING', 'CANCELLATION_REQUESTED') AND "leaseToken" IS NOT NULL AND "startedAt" IS NOT NULL AND "completedAt" IS NULL)
        OR ("status" NOT IN ('RUNNING', 'CANCELLATION_REQUESTED') AND "leaseToken" IS NULL)
    ),
    CONSTRAINT "async_job_cancellation_ck" CHECK (
        ("status" IN ('CANCELLATION_REQUESTED', 'CANCELLED') AND "cancellationRequestedAt" IS NOT NULL)
        OR ("status" NOT IN ('CANCELLATION_REQUESTED', 'CANCELLED') AND "cancellationRequestedAt" IS NULL)
    ),
    CONSTRAINT "async_job_terminal_ck" CHECK (
        ("status" IN ('SUCCEEDED', 'TERMINAL_FAILED', 'CANCELLED') AND "completedAt" IS NOT NULL)
        OR ("status" NOT IN ('SUCCEEDED', 'TERMINAL_FAILED', 'CANCELLED') AND "completedAt" IS NULL)
    ),
    CONSTRAINT "async_job_result_failure_ck" CHECK (
        ("status" = 'SUCCEEDED' AND "failureCategory" IS NULL AND "failureCode" IS NULL)
        OR ("status" = 'TERMINAL_FAILED' AND "failureCategory" ~ '[^[:space:]]' AND "failureCode" ~ '[^[:space:]]' AND "resultReference" IS NULL)
        OR ("status" = 'RETRY_WAIT' AND "failureCategory" ~ '[^[:space:]]' AND "failureCode" ~ '[^[:space:]]' AND "resultReference" IS NULL)
        OR ("status" NOT IN ('SUCCEEDED', 'TERMINAL_FAILED', 'RETRY_WAIT') AND "failureCategory" IS NULL AND "failureCode" IS NULL AND "resultReference" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "AsyncJob_idempotencyKey_key" ON "AsyncJob"("idempotencyKey");
CREATE INDEX "AsyncJob_status_availableAt_createdAt_idx" ON "AsyncJob"("status", "availableAt", "createdAt");
CREATE INDEX "AsyncJob_status_leaseExpiresAt_idx" ON "AsyncJob"("status", "leaseExpiresAt");
CREATE INDEX "AsyncJob_tenantId_createdAt_idx" ON "AsyncJob"("tenantId", "createdAt");
CREATE INDEX "AsyncJob_initiatingUserId_idx" ON "AsyncJob"("initiatingUserId");
CREATE INDEX "AsyncJob_correlationId_idx" ON "AsyncJob"("correlationId");
CREATE INDEX "AsyncJob_operation_createdAt_idx" ON "AsyncJob"("operation", "createdAt");

-- AddForeignKey
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_initiatingUserId_fkey" FOREIGN KEY ("initiatingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Admission identity and provenance are immutable; lifecycle fields remain mutable.
CREATE FUNCTION "reject_async_job_admission_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."idempotencyKey", NEW."requestFingerprint", NEW."operation", NEW."logicalOperationId",
        NEW."purpose", NEW."correlationId", NEW."policyDecisionRef", NEW."inputReference",
        NEW."admissionType", NEW."tenantId", NEW."initiatingUserId", NEW."actorId",
        NEW."actorEmail", NEW."actorRole", NEW."maxAttempts", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."idempotencyKey", OLD."requestFingerprint", OLD."operation", OLD."logicalOperationId",
        OLD."purpose", OLD."correlationId", OLD."policyDecisionRef", OLD."inputReference",
        OLD."admissionType", OLD."tenantId", OLD."initiatingUserId", OLD."actorId",
        OLD."actorEmail", OLD."actorRole", OLD."maxAttempts", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Async job admission identity and provenance are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "async_job_reject_admission_mutation"
BEFORE UPDATE ON "AsyncJob"
FOR EACH ROW EXECUTE FUNCTION "reject_async_job_admission_mutation"();
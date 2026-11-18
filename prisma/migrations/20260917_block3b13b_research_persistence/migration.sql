-- CreateEnum
CREATE TYPE "ResearchMissionStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'BUDGET_EXHAUSTED',
    'DEFERRED',
    'REJECTED'
);

-- CreateEnum
CREATE TYPE "ResearchExecutionState" AS ENUM (
    'COMPLETE',
    'PARTIAL',
    'BUDGET_EXHAUSTED',
    'DEFERRED',
    'FAILED',
    'HUMAN_DECISION_REQUIRED'
);

-- CreateEnum
CREATE TYPE "ResearchCompletionState" AS ENUM (
    'COMPLETE',
    'PARTIAL',
    'BUDGET_EXHAUSTED',
    'FAILED',
    'HUMAN_DECISION_REQUIRED'
);

-- CreateTable
CREATE TABLE "ResearchMissionRecord" (
    "id" VARCHAR(96) NOT NULL,
    "tenantId" TEXT,
    "contractVersion" VARCHAR(64) NOT NULL,
    "caseId" VARCHAR(256) NOT NULL,
    "fascicoloReference" VARCHAR(256),
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "mode" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadFingerprint" CHAR(64) NOT NULL,
    "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PENDING',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "claimantId" VARCHAR(256),
    "claimToken" CHAR(64),
    "claimExpiresAt" TIMESTAMP(3),
    "activeExecutionId" VARCHAR(256),
    "completedAt" TIMESTAMP(3),
    "deferredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchMissionRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_mission_hash_ck" CHECK (
        "payloadFingerprint" ~ '^[0-9a-f]{64}$'
        AND ("claimToken" IS NULL OR "claimToken" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "research_mission_text_ck" CHECK (
        "id" ~ '[^[:space:]]'
        AND "contractVersion" ~ '[^[:space:]]'
        AND "caseId" ~ '[^[:space:]]'
        AND "mode" ~ '[^[:space:]]'
    ),
    CONSTRAINT "research_mission_lease_ck" CHECK (
        ("claimantId" IS NULL AND "claimToken" IS NULL AND "claimExpiresAt" IS NULL AND "activeExecutionId" IS NULL)
        OR ("claimantId" ~ '[^[:space:]]' AND "claimToken" IS NOT NULL AND "claimExpiresAt" IS NOT NULL AND "activeExecutionId" ~ '[^[:space:]]')
    ),
    CONSTRAINT "research_mission_state_ck" CHECK (
        ("status" = 'IN_PROGRESS' AND "claimToken" IS NOT NULL AND "completedAt" IS NULL AND "deferredAt" IS NULL)
        OR ("status" IN ('PENDING') AND "claimToken" IS NULL AND "completedAt" IS NULL AND "deferredAt" IS NULL)
        OR ("status" IN ('COMPLETED', 'BUDGET_EXHAUSTED', 'REJECTED') AND "claimToken" IS NULL AND "completedAt" IS NOT NULL)
        OR ("status" = 'DEFERRED' AND "claimToken" IS NULL AND "completedAt" IS NULL AND "deferredAt" IS NOT NULL)
    ),
    CONSTRAINT "research_mission_version_ck" CHECK ("stateVersion" >= 0),
    CONSTRAINT "research_mission_payload_size_ck" CHECK (octet_length("payload"::text) <= 1048576)
);

-- CreateTable
CREATE TABLE "ResearchExecutionAttempt" (
    "id" VARCHAR(256) NOT NULL,
    "missionId" VARCHAR(96) NOT NULL,
    "executorKind" VARCHAR(64) NOT NULL,
    "claimantId" VARCHAR(256) NOT NULL,
    "claimToken" CHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completionState" "ResearchExecutionState",
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "moonlitCalls" INTEGER NOT NULL DEFAULT 0,
    "simpliciterCalls" INTEGER NOT NULL DEFAULT 0,
    "legalDataHunterCalls" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(128),
    "deferReason" VARCHAR(512),
    "finalBundleId" VARCHAR(96),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchExecutionAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_attempt_hash_ck" CHECK ("claimToken" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "research_attempt_text_ck" CHECK (
        "id" ~ '[^[:space:]]'
        AND "missionId" ~ '[^[:space:]]'
        AND "executorKind" ~ '[^[:space:]]'
        AND "claimantId" ~ '[^[:space:]]'
    ),
    CONSTRAINT "research_attempt_calls_ck" CHECK (
        "totalCalls" >= 0
        AND "moonlitCalls" >= 0
        AND "simpliciterCalls" >= 0
        AND "legalDataHunterCalls" >= 0
        AND "moonlitCalls" + "simpliciterCalls" + "legalDataHunterCalls" <= "totalCalls"
    ),
    CONSTRAINT "research_attempt_completion_ck" CHECK (
        ("completionState" IS NULL AND "completedAt" IS NULL)
        OR ("completionState" IS NOT NULL AND "completedAt" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "ResearchEvidenceBundleRecord" (
    "id" VARCHAR(96) NOT NULL,
    "missionId" VARCHAR(96) NOT NULL,
    "executionId" VARCHAR(256) NOT NULL,
    "contractVersion" VARCHAR(64) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "completionState" "ResearchCompletionState" NOT NULL,
    "totalCalls" INTEGER NOT NULL,
    "moonlitCalls" INTEGER NOT NULL,
    "simpliciterCalls" INTEGER NOT NULL,
    "legalDataHunterCalls" INTEGER NOT NULL,
    "submittedByActorId" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchEvidenceBundleRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_bundle_hash_ck" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "research_bundle_text_ck" CHECK (
        "id" ~ '[^[:space:]]'
        AND "missionId" ~ '[^[:space:]]'
        AND "executionId" ~ '[^[:space:]]'
        AND "contractVersion" ~ '[^[:space:]]'
        AND "submittedByActorId" ~ '[^[:space:]]'
    ),
    CONSTRAINT "research_bundle_calls_ck" CHECK (
        "totalCalls" >= 0
        AND "moonlitCalls" >= 0
        AND "simpliciterCalls" >= 0
        AND "legalDataHunterCalls" >= 0
        AND "moonlitCalls" + "simpliciterCalls" + "legalDataHunterCalls" <= "totalCalls"
    ),
    CONSTRAINT "research_bundle_payload_size_ck" CHECK (octet_length("payload"::text) <= 4194304)
);

-- CreateIndex
CREATE UNIQUE INDEX "research_mission_payload_uq" ON "ResearchMissionRecord"("payloadFingerprint");
CREATE UNIQUE INDEX "research_mission_active_exec_uq" ON "ResearchMissionRecord"("activeExecutionId");
CREATE INDEX "research_mission_tenant_status_idx" ON "ResearchMissionRecord"("tenantId", "status", "createdAt");
CREATE INDEX "research_mission_claim_queue_idx" ON "ResearchMissionRecord"("status", "claimExpiresAt", "createdAt");
CREATE INDEX "research_mission_case_idx" ON "ResearchMissionRecord"("caseId", "createdAt");
CREATE UNIQUE INDEX "research_attempt_mission_uq" ON "ResearchExecutionAttempt"("id", "missionId");
CREATE INDEX "research_attempt_mission_idx" ON "ResearchExecutionAttempt"("missionId", "startedAt");
CREATE INDEX "research_attempt_claimant_idx" ON "ResearchExecutionAttempt"("claimantId", "startedAt");
CREATE INDEX "research_attempt_final_bundle_idx" ON "ResearchExecutionAttempt"("finalBundleId");
CREATE UNIQUE INDEX "research_bundle_fingerprint_uq" ON "ResearchEvidenceBundleRecord"("fingerprint");
CREATE INDEX "research_bundle_mission_idx" ON "ResearchEvidenceBundleRecord"("missionId", "createdAt");
CREATE INDEX "research_bundle_execution_idx" ON "ResearchEvidenceBundleRecord"("executionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ResearchMissionRecord" ADD CONSTRAINT "research_mission_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResearchExecutionAttempt" ADD CONSTRAINT "research_attempt_mission_fk" FOREIGN KEY ("missionId") REFERENCES "ResearchMissionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResearchEvidenceBundleRecord" ADD CONSTRAINT "research_bundle_attempt_fk" FOREIGN KEY ("executionId", "missionId") REFERENCES "ResearchExecutionAttempt"("id", "missionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mission substance is immutable; only operational lifecycle fields may change.
CREATE FUNCTION "protect_research_mission_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id", NEW."tenantId", NEW."contractVersion", NEW."caseId",
        NEW."fascicoloReference", NEW."referenceDate", NEW."mode",
        NEW."payload", NEW."payloadFingerprint", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."id", OLD."tenantId", OLD."contractVersion", OLD."caseId",
        OLD."fascicoloReference", OLD."referenceDate", OLD."mode",
        OLD."payload", OLD."payloadFingerprint", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Research mission snapshot is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "research_mission_snapshot_trg"
BEFORE UPDATE ON "ResearchMissionRecord"
FOR EACH ROW EXECUTE FUNCTION "protect_research_mission_snapshot"();

-- Attempt identity and claim provenance are immutable; completion and counters may advance.
CREATE FUNCTION "protect_research_attempt_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id", NEW."missionId", NEW."executorKind", NEW."claimantId",
        NEW."claimToken", NEW."startedAt", NEW."leaseExpiresAt", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."id", OLD."missionId", OLD."executorKind", OLD."claimantId",
        OLD."claimToken", OLD."startedAt", OLD."leaseExpiresAt", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Research execution identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "research_attempt_identity_trg"
BEFORE UPDATE ON "ResearchExecutionAttempt"
FOR EACH ROW EXECUTE FUNCTION "protect_research_attempt_identity"();

-- Evidence bundles are append-only audit evidence.
CREATE FUNCTION "reject_research_bundle_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Research evidence bundles are append-only';
END;
$$;

CREATE TRIGGER "research_bundle_update_trg"
BEFORE UPDATE ON "ResearchEvidenceBundleRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_research_bundle_mutation"();

CREATE TRIGGER "research_bundle_delete_trg"
BEFORE DELETE ON "ResearchEvidenceBundleRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_research_bundle_mutation"();
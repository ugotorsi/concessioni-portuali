-- CreateEnum
CREATE TYPE "NeutralIntakeStatus" AS ENUM (
    'RECEIVED',
    'EVIDENCE_READY',
    'REVIEW_REQUIRED',
    'ROUTED',
    'FAILED_EXTRACTION',
    'FAILED_CLASSIFICATION',
    'FAILED_HANDOFF'
);

-- CreateTable
CREATE TABLE "NeutralIntake" (
    "id" TEXT NOT NULL,
    "idempotencyKey" CHAR(64) NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageBucket" TEXT,
    "storageKey" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "ingressChannel" TEXT NOT NULL,
    "originReference" TEXT,
    "enteId" TEXT,
    "receivedByUserId" TEXT,
    "receivedByActorId" TEXT NOT NULL,
    "receivedByRole" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "NeutralIntakeStatus" NOT NULL DEFAULT 'RECEIVED',
    "statusVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NeutralIntake_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "neutral_intake_required_text_ck" CHECK (
        "storageProvider" ~ '[^[:space:]]'
        AND "storageKey" ~ '[^[:space:]]'
        AND "mimeType" ~ '[^[:space:]]'
        AND "ingressChannel" ~ '[^[:space:]]'
        AND "receivedByActorId" ~ '[^[:space:]]'
        AND "receivedByRole" ~ '[^[:space:]]'
    ),
    CONSTRAINT "neutral_intake_optional_text_ck" CHECK (
        ("storageBucket" IS NULL OR "storageBucket" ~ '[^[:space:]]')
        AND ("originalName" IS NULL OR "originalName" ~ '[^[:space:]]')
        AND ("originReference" IS NULL OR "originReference" ~ '[^[:space:]]')
    ),
    CONSTRAINT "neutral_intake_storage_provider_ck" CHECK ("storageProvider" IN ('local', 's3')),
    CONSTRAINT "neutral_intake_idempotency_key_ck" CHECK ("idempotencyKey" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "neutral_intake_sha256_ck" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "neutral_intake_size_ck" CHECK ("sizeBytes" > 0),
    CONSTRAINT "neutral_intake_status_version_ck" CHECK ("statusVersion" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "NeutralIntake_idempotencyKey_key" ON "NeutralIntake"("idempotencyKey");
CREATE INDEX "NeutralIntake_storageProvider_storageKey_idx" ON "NeutralIntake"("storageProvider", "storageKey");
CREATE INDEX "NeutralIntake_sha256_idx" ON "NeutralIntake"("sha256");
CREATE INDEX "NeutralIntake_enteId_status_receivedAt_idx" ON "NeutralIntake"("enteId", "status", "receivedAt");
CREATE INDEX "NeutralIntake_receivedByUserId_idx" ON "NeutralIntake"("receivedByUserId");

-- AddForeignKey
ALTER TABLE "NeutralIntake" ADD CONSTRAINT "NeutralIntake_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NeutralIntake" ADD CONSTRAINT "NeutralIntake_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable provenance guard; lifecycle projection remains mutable.
CREATE FUNCTION "reject_neutral_intake_provenance_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
        OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider"
        OR NEW."storageBucket" IS DISTINCT FROM OLD."storageBucket"
        OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
        OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
        OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
        OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
        OR NEW."originalName" IS DISTINCT FROM OLD."originalName"
        OR NEW."ingressChannel" IS DISTINCT FROM OLD."ingressChannel"
        OR NEW."originReference" IS DISTINCT FROM OLD."originReference"
        OR NEW."enteId" IS DISTINCT FROM OLD."enteId"
        OR NEW."receivedByUserId" IS DISTINCT FROM OLD."receivedByUserId"
        OR NEW."receivedByActorId" IS DISTINCT FROM OLD."receivedByActorId"
        OR NEW."receivedByRole" IS DISTINCT FROM OLD."receivedByRole"
        OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
    THEN
        RAISE EXCEPTION 'NeutralIntake provenance is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "neutral_intake_reject_provenance_update"
BEFORE UPDATE ON "NeutralIntake"
FOR EACH ROW EXECUTE FUNCTION "reject_neutral_intake_provenance_mutation"();

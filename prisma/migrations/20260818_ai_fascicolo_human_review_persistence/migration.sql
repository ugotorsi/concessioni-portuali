-- CreateEnum
CREATE TYPE "AiFascicoloHumanReviewDisposition" AS ENUM ('COMPANY_ACCEPTED', 'COMPANY_REJECTED', 'COMPANY_NEEDS_VERIFICATION', 'COMPANY_AMENDED');

-- CreateTable
CREATE TABLE "AiFascicoloTrustedReviewMaterial" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "identityContractVersion" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "fingerprintAlgorithm" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "trustedReviewSchemaVersion" TEXT NOT NULL,
    "analysisSchemaVersion" TEXT NOT NULL,
    "snapshotSchemaVersion" TEXT NOT NULL,
    "outboundSchemaVersion" TEXT NOT NULL,
    "sourceSnapshotContentHash" TEXT NOT NULL,
    "outboundProjectionHash" TEXT NOT NULL,
    "outboundProjectionHashAlgorithm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFascicoloTrustedReviewMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFascicoloHumanReviewState" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "statementPath" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "latestDisposition" "AiFascicoloHumanReviewDisposition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFascicoloHumanReviewState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFascicoloHumanReviewEvent" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "statementPath" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "disposition" "AiFascicoloHumanReviewDisposition" NOT NULL,
    "humanUserId" TEXT NOT NULL,
    "actorIdSnapshot" TEXT NOT NULL,
    "actorEmailSnapshot" TEXT NOT NULL,
    "actorRoleSnapshot" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "reason" TEXT,
    "amendmentText" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandFingerprint" TEXT NOT NULL,

    CONSTRAINT "AiFascicoloHumanReviewEvent_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
ALTER TABLE "AiFascicoloTrustedReviewMaterial"
ADD CONSTRAINT "ai_review_material_required_text_ck"
CHECK (
    "identityContractVersion" ~ '[^[:space:]]'
    AND "canonicalizationVersion" ~ '[^[:space:]]'
    AND "fingerprintAlgorithm" ~ '[^[:space:]]'
    AND "fingerprint" ~ '[^[:space:]]'
    AND "canonicalPayload" ~ '[^[:space:]]'
    AND "trustedReviewSchemaVersion" ~ '[^[:space:]]'
    AND "analysisSchemaVersion" ~ '[^[:space:]]'
    AND "snapshotSchemaVersion" ~ '[^[:space:]]'
    AND "outboundSchemaVersion" ~ '[^[:space:]]'
    AND "sourceSnapshotContentHash" ~ '[^[:space:]]'
    AND "outboundProjectionHash" ~ '[^[:space:]]'
    AND "outboundProjectionHashAlgorithm" ~ '[^[:space:]]'
);

ALTER TABLE "AiFascicoloTrustedReviewMaterial"
ADD CONSTRAINT "ai_review_material_fingerprint_ck"
CHECK (
    "fingerprint" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "AiFascicoloHumanReviewState"
ADD CONSTRAINT "ai_review_state_version_ck"
CHECK (
    "version" >= 0
);

ALTER TABLE "AiFascicoloHumanReviewState"
ADD CONSTRAINT "ai_review_state_projection_ck"
CHECK (
    (
        "version" = 0
        AND "latestDisposition" IS NULL
    )
    OR
    (
        "version" > 0
        AND "latestDisposition" IS NOT NULL
    )
);

ALTER TABLE "AiFascicoloHumanReviewEvent"
ADD CONSTRAINT "ai_review_event_sequence_ck"
CHECK (
    "sequence" > 0
);

ALTER TABLE "AiFascicoloHumanReviewEvent"
ADD CONSTRAINT "ai_review_event_required_text_ck"
CHECK (
    "statementPath" ~ '[^[:space:]]'
    AND "actorIdSnapshot" ~ '[^[:space:]]'
    AND "actorEmailSnapshot" ~ '[^[:space:]]'
    AND "actorRoleSnapshot" ~ '[^[:space:]]'
    AND "idempotencyKey" ~ '[^[:space:]]'
    AND "commandFingerprint" ~ '[^[:space:]]'
);

ALTER TABLE "AiFascicoloHumanReviewEvent"
ADD CONSTRAINT "ai_review_event_command_fingerprint_ck"
CHECK (
    "commandFingerprint" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "AiFascicoloHumanReviewEvent"
ADD CONSTRAINT "ai_review_event_optional_text_ck"
CHECK (
    ("note" IS NULL OR "note" ~ '[^[:space:]]')
    AND ("reason" IS NULL OR "reason" ~ '[^[:space:]]')
    AND ("amendmentText" IS NULL OR "amendmentText" ~ '[^[:space:]]')
);

ALTER TABLE "AiFascicoloHumanReviewEvent"
ADD CONSTRAINT "ai_review_event_disposition_payload_ck"
CHECK (
    (
        "disposition" = 'COMPANY_ACCEPTED'
        AND "reason" IS NULL
        AND "amendmentText" IS NULL
    )
    OR
    (
        "disposition" = 'COMPANY_REJECTED'
        AND "reason" IS NOT NULL
        AND "reason" ~ '[^[:space:]]'
        AND "amendmentText" IS NULL
    )
    OR
    (
        "disposition" = 'COMPANY_NEEDS_VERIFICATION'
        AND "reason" IS NOT NULL
        AND "reason" ~ '[^[:space:]]'
        AND "amendmentText" IS NULL
    )
    OR
    (
        "disposition" = 'COMPANY_AMENDED'
        AND "reason" IS NOT NULL
        AND "reason" ~ '[^[:space:]]'
        AND "amendmentText" IS NOT NULL
        AND "amendmentText" ~ '[^[:space:]]'
    )
);

-- CreateIndex
CREATE INDEX "AiFascicoloTrustedReviewMaterial_enteId_procedimentoId_idx" ON "AiFascicoloTrustedReviewMaterial"("enteId", "procedimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloTrustedReviewMaterial_enteId_procedimentoId_iden_key" ON "AiFascicoloTrustedReviewMaterial"("enteId", "procedimentoId", "identityContractVersion", "canonicalizationVersion", "fingerprintAlgorithm", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloTrustedReviewMaterial_id_enteId_procedimentoId_key" ON "AiFascicoloTrustedReviewMaterial"("id", "enteId", "procedimentoId");

-- CreateIndex
CREATE INDEX "AiFascicoloHumanReviewState_enteId_procedimentoId_idx" ON "AiFascicoloHumanReviewState"("enteId", "procedimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloHumanReviewState_materialId_statementPath_key" ON "AiFascicoloHumanReviewState"("materialId", "statementPath");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloHumanReviewState_id_materialId_statementPath_ent_key" ON "AiFascicoloHumanReviewState"("id", "materialId", "statementPath", "enteId", "procedimentoId");

-- CreateIndex
CREATE INDEX "AiFascicoloHumanReviewEvent_enteId_procedimentoId_idx" ON "AiFascicoloHumanReviewEvent"("enteId", "procedimentoId");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloHumanReviewEvent_materialId_statementPath_sequen_key" ON "AiFascicoloHumanReviewEvent"("materialId", "statementPath", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AiFascicoloHumanReviewEvent_enteId_idempotencyKey_key" ON "AiFascicoloHumanReviewEvent"("enteId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AiFascicoloTrustedReviewMaterial" ADD CONSTRAINT "AiFascicoloTrustedReviewMaterial_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloTrustedReviewMaterial" ADD CONSTRAINT "AiFascicoloTrustedReviewMaterial_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewState" ADD CONSTRAINT "AiFascicoloHumanReviewState_materialId_enteId_procedimento_fkey" FOREIGN KEY ("materialId", "enteId", "procedimentoId") REFERENCES "AiFascicoloTrustedReviewMaterial"("id", "enteId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewState" ADD CONSTRAINT "AiFascicoloHumanReviewState_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewState" ADD CONSTRAINT "AiFascicoloHumanReviewState_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewEvent" ADD CONSTRAINT "AiFascicoloHumanReviewEvent_stateId_materialId_statementPa_fkey" FOREIGN KEY ("stateId", "materialId", "statementPath", "enteId", "procedimentoId") REFERENCES "AiFascicoloHumanReviewState"("id", "materialId", "statementPath", "enteId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewEvent" ADD CONSTRAINT "AiFascicoloHumanReviewEvent_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewEvent" ADD CONSTRAINT "AiFascicoloHumanReviewEvent_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFascicoloHumanReviewEvent" ADD CONSTRAINT "AiFascicoloHumanReviewEvent_humanUserId_fkey" FOREIGN KEY ("humanUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

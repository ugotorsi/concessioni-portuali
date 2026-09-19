-- CreateEnum
CREATE TYPE "FascicoloSignalStatus" AS ENUM ('OPEN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FascicoloSignalAttentionLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FascicoloSignalKind" AS ENUM ('CONCESSION_EXPIRY');

-- CreateTable
CREATE TABLE "FascicoloSignal" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "concessioneId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "kind" "FascicoloSignalKind" NOT NULL,
    "sourceOperation" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "semanticKey" CHAR(64) NOT NULL,
    "generationFingerprint" CHAR(64) NOT NULL,
    "identityKey" CHAR(64) NOT NULL,
    "currentThreshold" TEXT NOT NULL,
    "attentionLevel" "FascicoloSignalAttentionLevel" NOT NULL,
    "factsSnapshot" JSONB NOT NULL,
    "status" "FascicoloSignalStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FascicoloSignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fascicolo_signal_hash_ck" CHECK (
        "semanticKey" ~ '^[0-9a-f]{64}$'
        AND "generationFingerprint" ~ '^[0-9a-f]{64}$'
        AND "identityKey" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "fascicolo_signal_required_text_ck" CHECK (
        "sourceOperation" ~ '[^[:space:]]'
        AND "ruleCode" ~ '[^[:space:]]'
        AND "subjectType" ~ '[^[:space:]]'
        AND "subjectId" ~ '[^[:space:]]'
        AND "currentThreshold" ~ '[^[:space:]]'
    ),
    CONSTRAINT "fascicolo_signal_rule_version_ck" CHECK ("ruleVersion" >= 1),
    CONSTRAINT "fascicolo_signal_threshold_attention_ck" CHECK (
        ("currentThreshold" = 'CONCESSION_90_DAYS' AND "attentionLevel" = 'LOW')
        OR ("currentThreshold" = 'CONCESSION_60_DAYS' AND "attentionLevel" = 'MEDIUM')
        OR ("currentThreshold" = 'CONCESSION_30_DAYS' AND "attentionLevel" = 'HIGH')
        OR ("currentThreshold" = 'DEADLINE_DUE' AND "attentionLevel" = 'CRITICAL')
    ),
    CONSTRAINT "fascicolo_signal_facts_ck" CHECK (
        jsonb_typeof("factsSnapshot") = 'object'
        AND octet_length("factsSnapshot"::text) <= 4096
    ),
    CONSTRAINT "fascicolo_signal_status_ck" CHECK (
        "lastObservedAt" >= "detectedAt"
        AND (
            ("status" = 'OPEN' AND "supersededAt" IS NULL)
            OR ("status" = 'SUPERSEDED' AND "supersededAt" >= "detectedAt")
        )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloSignal_identityKey_key" ON "FascicoloSignal"("identityKey");
CREATE UNIQUE INDEX "fascicolo_signal_open_semantic_uq" ON "FascicoloSignal"("semanticKey") WHERE "status" = 'OPEN';
CREATE INDEX "FascicoloSignal_enteId_status_idx" ON "FascicoloSignal"("enteId", "status");
CREATE INDEX "FascicoloSignal_procedimentoId_status_idx" ON "FascicoloSignal"("procedimentoId", "status");
CREATE INDEX "FascicoloSignal_concessioneId_status_idx" ON "FascicoloSignal"("concessioneId", "status");
CREATE INDEX "FascicoloSignal_semanticKey_status_idx" ON "FascicoloSignal"("semanticKey", "status");
CREATE INDEX "FascicoloSignal_attentionLevel_idx" ON "FascicoloSignal"("attentionLevel");

-- AddForeignKey
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "FascicoloSignal_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "FascicoloSignal_concessioneId_fkey" FOREIGN KEY ("concessioneId") REFERENCES "Concessione"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "FascicoloSignal_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

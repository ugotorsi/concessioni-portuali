-- CreateEnum
CREATE TYPE "FascicoloSignalHumanDisposition" AS ENUM ('UNREVIEWED', 'ACKNOWLEDGED', 'DISMISSED', 'PROMOTED');

-- AlterTable
ALTER TABLE "FascicoloSignal"
ADD COLUMN "humanDisposition" "FascicoloSignalHumanDisposition" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN "dispositionThreshold" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedByUserId" TEXT,
ADD COLUMN "reviewedByActorId" TEXT,
ADD COLUMN "reviewedByEmail" TEXT,
ADD COLUMN "reviewedByRole" TEXT,
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "criticitaId" TEXT;

-- AddCheckConstraint
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "fascicolo_signal_human_disposition_ck" CHECK (
  (
    "humanDisposition" = 'UNREVIEWED'
    AND "dispositionThreshold" IS NULL
    AND "reviewedAt" IS NULL
    AND "reviewedByUserId" IS NULL
    AND "reviewedByActorId" IS NULL
    AND "reviewedByEmail" IS NULL
    AND "reviewedByRole" IS NULL
    AND "reviewNote" IS NULL
    AND "criticitaId" IS NULL
  )
  OR (
    "humanDisposition" = 'ACKNOWLEDGED'
    AND "dispositionThreshold" IN ('CONCESSION_90_DAYS', 'CONCESSION_60_DAYS', 'CONCESSION_30_DAYS', 'DEADLINE_DUE')
    AND "reviewedAt" IS NOT NULL
    AND "reviewedByActorId" ~ '[^[:space:]]'
    AND "reviewedByEmail" ~ '[^[:space:]]'
    AND "reviewedByRole" ~ '[^[:space:]]'
    AND "criticitaId" IS NULL
  )
  OR (
    "humanDisposition" = 'DISMISSED'
    AND "dispositionThreshold" IN ('CONCESSION_90_DAYS', 'CONCESSION_60_DAYS', 'CONCESSION_30_DAYS', 'DEADLINE_DUE')
    AND "reviewedAt" IS NOT NULL
    AND "reviewedByActorId" ~ '[^[:space:]]'
    AND "reviewedByEmail" ~ '[^[:space:]]'
    AND "reviewedByRole" ~ '[^[:space:]]'
    AND "reviewNote" ~ '[^[:space:]]'
    AND "criticitaId" IS NULL
  )
  OR (
    "humanDisposition" = 'PROMOTED'
    AND "dispositionThreshold" IN ('CONCESSION_90_DAYS', 'CONCESSION_60_DAYS', 'CONCESSION_30_DAYS', 'DEADLINE_DUE')
    AND "reviewedAt" IS NOT NULL
    AND "reviewedByActorId" ~ '[^[:space:]]'
    AND "reviewedByEmail" ~ '[^[:space:]]'
    AND "reviewedByRole" ~ '[^[:space:]]'
    AND "criticitaId" IS NOT NULL
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloSignal_criticitaId_key" ON "FascicoloSignal"("criticitaId");
CREATE INDEX "FascicoloSignal_enteId_status_humanDisposition_idx" ON "FascicoloSignal"("enteId", "status", "humanDisposition");
CREATE INDEX "FascicoloSignal_procedimentoId_status_humanDisposition_idx" ON "FascicoloSignal"("procedimentoId", "status", "humanDisposition");

-- AddForeignKey
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "FascicoloSignal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FascicoloSignal" ADD CONSTRAINT "FascicoloSignal_criticitaId_fkey" FOREIGN KEY ("criticitaId") REFERENCES "Criticita"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
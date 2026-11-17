-- CreateEnum
CREATE TYPE "FascicoloObservationKind" AS ENUM ('DOCUMENT_COMPLETENESS');

-- CreateEnum
CREATE TYPE "FascicoloObservationStatus" AS ENUM ('PROPOSTO', 'VALIDATO', 'RIFIUTATO', 'SUPERATO');

-- CreateTable
CREATE TABLE "FascicoloObservation" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "kind" "FascicoloObservationKind" NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "factsSnapshot" JSONB NOT NULL,
    "status" "FascicoloObservationStatus" NOT NULL DEFAULT 'PROPOSTO',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedByActorId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedByRole" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FascicoloObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloObservation_ruleVersion_positive" CHECK ("ruleVersion" > 0),
    CONSTRAINT "FascicoloObservation_review_state_consistency" CHECK (
      ("status" = 'PROPOSTO' AND "reviewedAt" IS NULL AND "reviewedByActorId" IS NULL AND "reviewedByUserId" IS NULL AND "reviewedByEmail" IS NULL AND "reviewedByRole" IS NULL AND "reviewNote" IS NULL)
      OR
      ("status" = 'VALIDATO' AND "reviewedAt" IS NOT NULL AND "reviewedByActorId" IS NOT NULL AND "reviewedByRole" IS NOT NULL)
      OR
      ("status" IN ('RIFIUTATO', 'SUPERATO') AND "reviewedAt" IS NOT NULL AND "reviewedByActorId" IS NOT NULL AND "reviewedByRole" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloObservation_enteId_procedimentoId_documentoId_ruleCode_ruleVersion_key" ON "FascicoloObservation"("enteId", "procedimentoId", "documentoId", "ruleCode", "ruleVersion");
CREATE INDEX "FascicoloObservation_enteId_status_idx" ON "FascicoloObservation"("enteId", "status");
CREATE INDEX "FascicoloObservation_procedimentoId_status_idx" ON "FascicoloObservation"("procedimentoId", "status");
CREATE INDEX "FascicoloObservation_documentoId_idx" ON "FascicoloObservation"("documentoId");
CREATE INDEX "FascicoloObservation_reviewedByUserId_idx" ON "FascicoloObservation"("reviewedByUserId");
CREATE INDEX "FascicoloObservation_detectedAt_idx" ON "FascicoloObservation"("detectedAt");

-- AddForeignKey
ALTER TABLE "FascicoloObservation" ADD CONSTRAINT "FascicoloObservation_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloObservation" ADD CONSTRAINT "FascicoloObservation_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloObservation" ADD CONSTRAINT "FascicoloObservation_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloObservation" ADD CONSTRAINT "FascicoloObservation_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
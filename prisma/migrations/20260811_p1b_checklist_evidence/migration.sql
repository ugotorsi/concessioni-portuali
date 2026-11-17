-- CreateEnum
CREATE TYPE "FascicoloChecklistEvidenceStatus" AS ENUM ('PROPOSTO', 'VALIDATO', 'RIFIUTATO');

-- CreateTable
CREATE TABLE "FascicoloChecklistEvidence" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "checklistItemCode" TEXT NOT NULL,
    "status" "FascicoloChecklistEvidenceStatus" NOT NULL DEFAULT 'PROPOSTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByActorId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByActorId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedByRole" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "FascicoloChecklistEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloChecklistEvidence_nonblank_fields" CHECK (
      length(btrim("createdByActorId")) > 0
      AND length(btrim("createdByEmail")) > 0
      AND length(btrim("createdByRole")) > 0
      AND length(btrim("checklistItemCode")) > 0
    ),
    CONSTRAINT "FascicoloChecklistEvidence_review_state_consistency" CHECK (
      ("status" = 'PROPOSTO' AND "reviewedAt" IS NULL AND "reviewedByActorId" IS NULL AND "reviewedByUserId" IS NULL AND "reviewedByEmail" IS NULL AND "reviewedByRole" IS NULL AND "reviewNote" IS NULL)
      OR
      ("status" = 'VALIDATO' AND "reviewedAt" IS NOT NULL AND "reviewedByActorId" IS NOT NULL AND "reviewedByEmail" IS NOT NULL AND "reviewedByRole" IS NOT NULL)
      OR
      ("status" = 'RIFIUTATO' AND "reviewedAt" IS NOT NULL AND "reviewedByActorId" IS NOT NULL AND "reviewedByEmail" IS NOT NULL AND "reviewedByRole" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloChecklistEvidence_enteId_procedimentoId_documentoId_checklistItemCode_key" ON "FascicoloChecklistEvidence"("enteId", "procedimentoId", "documentoId", "checklistItemCode");
CREATE INDEX "FascicoloChecklistEvidence_enteId_procedimentoId_checklistItemCode_idx" ON "FascicoloChecklistEvidence"("enteId", "procedimentoId", "checklistItemCode");
CREATE INDEX "FascicoloChecklistEvidence_documentoId_idx" ON "FascicoloChecklistEvidence"("documentoId");
CREATE INDEX "FascicoloChecklistEvidence_createdByUserId_idx" ON "FascicoloChecklistEvidence"("createdByUserId");
CREATE INDEX "FascicoloChecklistEvidence_reviewedByUserId_idx" ON "FascicoloChecklistEvidence"("reviewedByUserId");
CREATE INDEX "FascicoloChecklistEvidence_createdAt_idx" ON "FascicoloChecklistEvidence"("createdAt");
CREATE INDEX "FascicoloChecklistEvidence_reviewedAt_idx" ON "FascicoloChecklistEvidence"("reviewedAt");

-- AddForeignKey
ALTER TABLE "FascicoloChecklistEvidence" ADD CONSTRAINT "FascicoloChecklistEvidence_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloChecklistEvidence" ADD CONSTRAINT "FascicoloChecklistEvidence_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloChecklistEvidence" ADD CONSTRAINT "FascicoloChecklistEvidence_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloChecklistEvidence" ADD CONSTRAINT "FascicoloChecklistEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FascicoloChecklistEvidence" ADD CONSTRAINT "FascicoloChecklistEvidence_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
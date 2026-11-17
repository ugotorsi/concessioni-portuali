-- CreateTable
CREATE TABLE "FascicoloDocumentRequirementEvidence" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByActorId" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedByActorId" TEXT,
    "revokedByEmail" TEXT,
    "revokedByRole" TEXT,
    "revocationNote" TEXT,

    CONSTRAINT "FascicoloDocumentRequirementEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloDocumentRequirementEvidence_nonblank_creation_fields" CHECK (
      length(btrim("createdByActorId")) > 0
      AND length(btrim("createdByEmail")) > 0
      AND length(btrim("createdByRole")) > 0
    ),
    CONSTRAINT "FascicoloDocumentRequirementEvidence_revocation_consistency" CHECK (
      ("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokedByActorId" IS NULL AND "revokedByEmail" IS NULL AND "revokedByRole" IS NULL AND "revocationNote" IS NULL)
      OR
      ("revokedAt" IS NOT NULL AND "revokedByActorId" IS NOT NULL AND length(btrim("revokedByActorId")) > 0 AND "revokedByEmail" IS NOT NULL AND length(btrim("revokedByEmail")) > 0 AND "revokedByRole" IS NOT NULL AND length(btrim("revokedByRole")) > 0 AND "revocationNote" IS NOT NULL AND length(btrim("revocationNote")) > 0)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloDocumentRequirementEvidence_enteId_proposalId_documentoId_key" ON "FascicoloDocumentRequirementEvidence"("enteId", "proposalId", "documentoId");
CREATE INDEX "FascicoloDocumentRequirementEvidence_enteId_proposalId_idx" ON "FascicoloDocumentRequirementEvidence"("enteId", "proposalId");
CREATE INDEX "FascicoloDocumentRequirementEvidence_documentoId_idx" ON "FascicoloDocumentRequirementEvidence"("documentoId");
CREATE INDEX "FascicoloDocumentRequirementEvidence_createdByUserId_idx" ON "FascicoloDocumentRequirementEvidence"("createdByUserId");
CREATE INDEX "FascicoloDocumentRequirementEvidence_revokedByUserId_idx" ON "FascicoloDocumentRequirementEvidence"("revokedByUserId");
CREATE INDEX "FascicoloDocumentRequirementEvidence_createdAt_idx" ON "FascicoloDocumentRequirementEvidence"("createdAt");

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementEvidence" ADD CONSTRAINT "FascicoloDocumentRequirementEvidence_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloDocumentRequirementEvidence" ADD CONSTRAINT "FascicoloDocumentRequirementEvidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "FascicoloDocumentRequirementProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloDocumentRequirementEvidence" ADD CONSTRAINT "FascicoloDocumentRequirementEvidence_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloDocumentRequirementEvidence" ADD CONSTRAINT "FascicoloDocumentRequirementEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FascicoloDocumentRequirementEvidence" ADD CONSTRAINT "FascicoloDocumentRequirementEvidence_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
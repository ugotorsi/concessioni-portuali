-- CreateEnum
CREATE TYPE "FascicoloDocumentRequirementProposalStatus" AS ENUM ('PROPOSTO', 'VALIDATO', 'RIFIUTATO');

-- CreateTable
CREATE TABLE "FascicoloDocumentRequirementProposal" (
    "id" TEXT NOT NULL,
    "enteId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "legalSourceId" TEXT NOT NULL,
    "legalRuleId" TEXT NOT NULL,
    "documentGapId" TEXT NOT NULL,
    "status" "FascicoloDocumentRequirementProposalStatus" NOT NULL DEFAULT 'PROPOSTO',
    "matcherAlgorithmVersion" TEXT NOT NULL,
    "screeningFingerprint" TEXT NOT NULL,
    "canonicalArt18Snapshot" "NormaRiferimento" NOT NULL,
    "portActivityLegalTypeSnapshot" "PortActivityLegalType" NOT NULL,
    "sourceStableKeySnapshot" TEXT NOT NULL,
    "sourceTitleSnapshot" TEXT NOT NULL,
    "sourceRelevantProvisionsSnapshot" JSONB NOT NULL,
    "ruleCodeSnapshot" TEXT NOT NULL,
    "ruleContractVersionSnapshot" INTEGER NOT NULL,
    "legalRuleDefinitionSnapshot" JSONB NOT NULL,
    "gapKeySnapshot" TEXT NOT NULL,
    "gapLabelSnapshot" TEXT NOT NULL,
    "gapDescriptionSnapshot" TEXT NOT NULL,
    "matchedCriteriaSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdByActorId" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedByActorId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedByRole" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "FascicoloDocumentRequirementProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloDocumentRequirementProposal_enteId_procedimentoId_screeningFingerprint_key" ON "FascicoloDocumentRequirementProposal"("enteId", "procedimentoId", "screeningFingerprint");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_enteId_procedimentoId_status_idx" ON "FascicoloDocumentRequirementProposal"("enteId", "procedimentoId", "status");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_legalSourceId_idx" ON "FascicoloDocumentRequirementProposal"("legalSourceId");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_legalRuleId_idx" ON "FascicoloDocumentRequirementProposal"("legalRuleId");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_documentGapId_idx" ON "FascicoloDocumentRequirementProposal"("documentGapId");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_createdByUserId_idx" ON "FascicoloDocumentRequirementProposal"("createdByUserId");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_reviewedByUserId_idx" ON "FascicoloDocumentRequirementProposal"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "FascicoloDocumentRequirementProposal_createdAt_idx" ON "FascicoloDocumentRequirementProposal"("createdAt");

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_enteId_fkey" FOREIGN KEY ("enteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_legalSourceId_fkey" FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_legalRuleId_fkey" FOREIGN KEY ("legalRuleId") REFERENCES "LegalRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_documentGapId_fkey" FOREIGN KEY ("documentGapId") REFERENCES "DocumentGap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementProposal" ADD CONSTRAINT "FascicoloDocumentRequirementProposal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
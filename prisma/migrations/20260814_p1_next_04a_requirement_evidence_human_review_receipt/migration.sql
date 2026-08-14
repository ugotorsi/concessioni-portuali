-- CreateTable
CREATE TABLE "FascicoloDocumentRequirementEvidenceReview" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedByActorId" TEXT NOT NULL,
    "reviewedByEmail" TEXT NOT NULL,
    "reviewedByRole" TEXT NOT NULL,
    "reviewNote" TEXT,

    CONSTRAINT "FascicoloDocumentRequirementEvidenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FascicoloDocumentRequirementEvidenceReview_evidenceId_key" ON "FascicoloDocumentRequirementEvidenceReview"("evidenceId");
CREATE INDEX "FascicoloDocumentRequirementEvidenceReview_reviewedByUserId_idx" ON "FascicoloDocumentRequirementEvidenceReview"("reviewedByUserId");
CREATE INDEX "FascicoloDocumentRequirementEvidenceReview_createdAt_idx" ON "FascicoloDocumentRequirementEvidenceReview"("createdAt");

-- AddForeignKey
ALTER TABLE "FascicoloDocumentRequirementEvidenceReview" ADD CONSTRAINT "FascicoloDocumentRequirementEvidenceReview_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "FascicoloDocumentRequirementEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloDocumentRequirementEvidenceReview" ADD CONSTRAINT "FascicoloDocumentRequirementEvidenceReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- CreateEnum
CREATE TYPE "LegalSourceCandidateResolutionOutcome" AS ENUM ('LINKED', 'NO_MATCH');

-- CreateTable
CREATE TABLE "LegalSourceCandidateResolution" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "outcome" "LegalSourceCandidateResolutionOutcome" NOT NULL,
    "legalSourceId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedByActorId" TEXT NOT NULL,
    "reviewedByEmail" TEXT NOT NULL,
    "reviewedByRole" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewNote" VARCHAR(2000),

    CONSTRAINT "LegalSourceCandidateResolution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_source_candidate_resolution_outcome_source_ck" CHECK (
        ("outcome" = 'LINKED' AND "legalSourceId" IS NOT NULL)
        OR ("outcome" = 'NO_MATCH' AND "legalSourceId" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalSourceCandidateResolution_admissionId_key" ON "LegalSourceCandidateResolution"("admissionId");

-- CreateIndex
CREATE INDEX "LegalSourceCandidateResolution_legalSourceId_idx" ON "LegalSourceCandidateResolution"("legalSourceId");

-- CreateIndex
CREATE INDEX "LegalSourceCandidateResolution_reviewedByUserId_idx" ON "LegalSourceCandidateResolution"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "LegalSourceCandidateResolution_outcome_resolvedAt_idx" ON "LegalSourceCandidateResolution"("outcome", "resolvedAt");

-- AddForeignKey
ALTER TABLE "LegalSourceCandidateResolution" ADD CONSTRAINT "LegalSourceCandidateResolution_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "LegalSourceCandidateAdmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSourceCandidateResolution" ADD CONSTRAINT "LegalSourceCandidateResolution_legalSourceId_fkey" FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSourceCandidateResolution" ADD CONSTRAINT "LegalSourceCandidateResolution_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
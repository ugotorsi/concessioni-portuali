CREATE TYPE "ProfessionalLegalQuestionVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED');

CREATE TABLE "ProfessionalLegalQuestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalLegalQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfessionalLegalQuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "questionText" TEXT NOT NULL,
    "theme" VARCHAR(256),
    "rationale" TEXT,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "status" "ProfessionalLegalQuestionVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "semanticKey" CHAR(64) NOT NULL,
    "contentFingerprint" CHAR(64) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalLegalQuestionVersion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ResearchMissionRecord"
ADD COLUMN "professionalQuestionVersionId" TEXT;

CREATE UNIQUE INDEX "professional_legal_question_tenant_uq"
ON "ProfessionalLegalQuestion"("id", "tenantId");

CREATE INDEX "professional_legal_question_procedure_idx"
ON "ProfessionalLegalQuestion"("tenantId", "procedimentoId", "archivedAt");

CREATE INDEX "professional_legal_question_creator_idx"
ON "ProfessionalLegalQuestion"("createdByUserId");

CREATE UNIQUE INDEX "professional_legal_question_version_number_uq"
ON "ProfessionalLegalQuestionVersion"("questionId", "version");

CREATE INDEX "professional_legal_question_version_status_idx"
ON "ProfessionalLegalQuestionVersion"("questionId", "status", "version");

CREATE INDEX "professional_legal_question_version_semantic_idx"
ON "ProfessionalLegalQuestionVersion"("semanticKey");

CREATE INDEX "professional_legal_question_version_creator_idx"
ON "ProfessionalLegalQuestionVersion"("createdByUserId");

CREATE INDEX "professional_legal_question_version_approver_idx"
ON "ProfessionalLegalQuestionVersion"("approvedByUserId");

CREATE UNIQUE INDEX "research_mission_professional_question_version_uq"
ON "ResearchMissionRecord"("professionalQuestionVersionId");

ALTER TABLE "ProfessionalLegalQuestion"
ADD CONSTRAINT "professional_legal_question_tenant_fk"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProfessionalLegalQuestion"
ADD CONSTRAINT "professional_legal_question_procedure_fk"
FOREIGN KEY ("procedimentoId", "tenantId") REFERENCES "Procedimento"("id", "enteId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProfessionalLegalQuestionVersion"
ADD CONSTRAINT "professional_legal_question_version_question_fk"
FOREIGN KEY ("questionId") REFERENCES "ProfessionalLegalQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResearchMissionRecord"
ADD CONSTRAINT "research_mission_professional_question_version_fk"
FOREIGN KEY ("professionalQuestionVersionId") REFERENCES "ProfessionalLegalQuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

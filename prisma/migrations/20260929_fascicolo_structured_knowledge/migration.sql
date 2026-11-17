-- ExtendEnum
ALTER TYPE "FascicoloKnowledgeRelationType" ADD VALUE 'CONTRADICTS';
ALTER TYPE "FascicoloKnowledgeRelationType" ADD VALUE 'ISSUE_DERIVED_FROM';
ALTER TYPE "FascicoloKnowledgeRelationType" ADD VALUE 'QUESTION_FOR_ISSUE';

-- ExtendTable
ALTER TABLE "FascicoloKnowledgeRevision" ADD COLUMN "warnings" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "FascicoloKnowledgeItem" ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "FascicoloSubjectType" AS ENUM (
    'PERSON',
    'ORGANIZATION',
    'PUBLIC_ADMINISTRATION',
    'OFFICE',
    'AUTHORITY',
    'UNKNOWN'
);

CREATE TYPE "FascicoloKnowledgeProvenanceType" AS ENUM ('DOCUMENT_EXTRACTION');

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD COLUMN "provenanceType" "FascicoloKnowledgeProvenanceType" NOT NULL DEFAULT 'DOCUMENT_EXTRACTION';
ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_document_extraction_check"
  CHECK (
    "provenanceType" <> 'DOCUMENT_EXTRACTION'
    OR ("documentFileVersionId" IS NOT NULL AND "extractionAttemptId" IS NOT NULL AND "basisRef" IS NOT NULL)
  );

-- CreateTable
CREATE TABLE "FascicoloSubject" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "canonicalName" VARCHAR(512) NOT NULL,
    "normalizedName" VARCHAR(512) NOT NULL,
    "subjectType" "FascicoloSubjectType" NOT NULL DEFAULT 'UNKNOWN',
    "strongIdentifiers" JSONB NOT NULL DEFAULT '[]',
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fascicolo_subject_scope_uq" ON "FascicoloSubject"("id", "tenantId");
CREATE INDEX "fascicolo_subject_name_idx" ON "FascicoloSubject"("tenantId", "normalizedName");
CREATE INDEX "fascicolo_subject_type_idx" ON "FascicoloSubject"("tenantId", "subjectType");
CREATE INDEX "fascicolo_subject_merged_idx" ON "FascicoloSubject"("mergedIntoId");

CREATE TABLE "FascicoloSubjectIdentifier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "identifierType" VARCHAR(64) NOT NULL,
    "normalizedValue" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloSubjectIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fascicolo_subject_identifier_value_uq"
  ON "FascicoloSubjectIdentifier"("tenantId", "identifierType", "normalizedValue");
CREATE INDEX "fascicolo_subject_identifier_subject_idx"
  ON "FascicoloSubjectIdentifier"("subjectId", "tenantId");

-- AddForeignKey
ALTER TABLE "FascicoloSubject" ADD CONSTRAINT "FascicoloSubject_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloSubject" ADD CONSTRAINT "FascicoloSubject_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "FascicoloSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloSubjectIdentifier" ADD CONSTRAINT "FascicoloSubjectIdentifier_subject_scope_fkey"
  FOREIGN KEY ("subjectId", "tenantId") REFERENCES "FascicoloSubject"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "FascicoloKnowledgeReviewEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "previousStatus" "FascicoloKnowledgeItemStatus" NOT NULL,
    "nextStatus" "FascicoloKnowledgeItemStatus" NOT NULL,
    "reviewVersion" INTEGER NOT NULL,
    "actorId" VARCHAR(256) NOT NULL,
    "actorEmail" VARCHAR(320),
    "actorRole" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloKnowledgeReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fascicolo_knowledge_review_item_version_uq" ON "FascicoloKnowledgeReviewEvent"("itemId", "reviewVersion");
CREATE INDEX "fascicolo_knowledge_review_scope_idx" ON "FascicoloKnowledgeReviewEvent"("tenantId", "procedimentoId", "createdAt");

ALTER TABLE "FascicoloKnowledgeReviewEvent" ADD CONSTRAINT "FascicoloKnowledgeReviewEvent_item_scope_fkey"
  FOREIGN KEY ("itemId", "tenantId", "procedimentoId")
  REFERENCES "FascicoloKnowledgeItem"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
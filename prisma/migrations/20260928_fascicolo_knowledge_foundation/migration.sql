-- CreateEnum
CREATE TYPE "FascicoloKnowledgeRevisionStatus" AS ENUM ('BUILDING', 'CURRENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FascicoloKnowledgeItemStatus" AS ENUM ('AI_PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FascicoloKnowledgeRelationType" AS ENUM ('RELATED_TO', 'SUPERSEDES');

-- CreateTable
CREATE TABLE "FascicoloKnowledgeRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "corpusFingerprint" CHAR(64) NOT NULL,
    "contractVersion" VARCHAR(64) NOT NULL,
    "status" "FascicoloKnowledgeRevisionStatus" NOT NULL DEFAULT 'BUILDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    CONSTRAINT "FascicoloKnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FascicoloKnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "semanticKey" CHAR(64) NOT NULL,
    "semanticKeyVersion" VARCHAR(32) NOT NULL,
    "contentFingerprint" CHAR(64) NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "structuredPayload" JSONB NOT NULL,
    "confidence" INTEGER,
    "status" "FascicoloKnowledgeItemStatus" NOT NULL DEFAULT 'AI_PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    CONSTRAINT "FascicoloKnowledgeItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloKnowledgeItem_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 100)
);

-- CreateTable
CREATE TABLE "FascicoloKnowledgeEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "documentFileVersionId" TEXT,
    "extractionAttemptId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "textSha256" CHAR(64) NOT NULL,
    "quoteSha256" CHAR(64),
    "basisRef" VARCHAR(256),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloKnowledgeEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloKnowledgeEvidence_page_check" CHECK ("pageNumber" > 0)
);

-- CreateTable
CREATE TABLE "FascicoloKnowledgeRelation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "relationType" "FascicoloKnowledgeRelationType" NOT NULL,
    "confidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FascicoloKnowledgeRelation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FascicoloKnowledgeRelation_distinct_items_check" CHECK ("sourceItemId" <> "targetItemId"),
    CONSTRAINT "FascicoloKnowledgeRelation_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 100)
);

-- Scope and identity indexes
CREATE UNIQUE INDEX "fascicolo_knowledge_revision_scope_uq" ON "FascicoloKnowledgeRevision"("id", "tenantId", "procedimentoId");
CREATE UNIQUE INDEX "fascicolo_knowledge_revision_corpus_uq" ON "FascicoloKnowledgeRevision"("tenantId", "procedimentoId", "corpusFingerprint", "contractVersion");
CREATE INDEX "fascicolo_knowledge_revision_scope_status_idx" ON "FascicoloKnowledgeRevision"("tenantId", "procedimentoId", "status", "createdAt");
CREATE UNIQUE INDEX "fascicolo_knowledge_revision_one_current_uq" ON "FascicoloKnowledgeRevision"("tenantId", "procedimentoId") WHERE "status" = 'CURRENT';
CREATE UNIQUE INDEX "fascicolo_knowledge_item_scope_uq" ON "FascicoloKnowledgeItem"("id", "tenantId", "procedimentoId");
CREATE UNIQUE INDEX "fascicolo_knowledge_item_revision_semantic_uq" ON "FascicoloKnowledgeItem"("revisionId", "semanticKeyVersion", "semanticKey");
CREATE INDEX "fascicolo_knowledge_item_scope_status_idx" ON "FascicoloKnowledgeItem"("tenantId", "procedimentoId", "revisionId", "status");
CREATE INDEX "fascicolo_knowledge_item_semantic_idx" ON "FascicoloKnowledgeItem"("tenantId", "procedimentoId", "semanticKeyVersion", "semanticKey");
CREATE UNIQUE INDEX "fascicolo_knowledge_evidence_identity_uq" ON "FascicoloKnowledgeEvidence"("itemId", "documentoId", "documentFileVersionId", "extractionAttemptId", "pageNumber", "textSha256", "quoteSha256") NULLS NOT DISTINCT;
CREATE INDEX "fascicolo_knowledge_evidence_scope_item_idx" ON "FascicoloKnowledgeEvidence"("tenantId", "procedimentoId", "itemId");
CREATE INDEX "fascicolo_knowledge_evidence_document_idx" ON "FascicoloKnowledgeEvidence"("documentoId", "documentFileVersionId");
CREATE INDEX "fascicolo_knowledge_evidence_extraction_idx" ON "FascicoloKnowledgeEvidence"("extractionAttemptId");
CREATE UNIQUE INDEX "fascicolo_knowledge_relation_identity_uq" ON "FascicoloKnowledgeRelation"("revisionId", "sourceItemId", "targetItemId", "relationType");
CREATE INDEX "fascicolo_knowledge_relation_scope_revision_idx" ON "FascicoloKnowledgeRelation"("tenantId", "procedimentoId", "revisionId");
CREATE INDEX "fascicolo_knowledge_relation_target_idx" ON "FascicoloKnowledgeRelation"("targetItemId");

-- AddForeignKey
ALTER TABLE "FascicoloKnowledgeRevision" ADD CONSTRAINT "FascicoloKnowledgeRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRevision" ADD CONSTRAINT "FascicoloKnowledgeRevision_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeItem" ADD CONSTRAINT "FascicoloKnowledgeItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeItem" ADD CONSTRAINT "FascicoloKnowledgeItem_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeItem" ADD CONSTRAINT "FascicoloKnowledgeItem_revision_scope_fkey" FOREIGN KEY ("revisionId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeRevision"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_item_scope_fkey" FOREIGN KEY ("itemId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeItem"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_documentFileVersionId_fkey" FOREIGN KEY ("documentFileVersionId") REFERENCES "DocumentFileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeEvidence" ADD CONSTRAINT "FascicoloKnowledgeEvidence_extractionAttemptId_fkey" FOREIGN KEY ("extractionAttemptId") REFERENCES "NeutralIntakeExtractionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRelation" ADD CONSTRAINT "FascicoloKnowledgeRelation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRelation" ADD CONSTRAINT "FascicoloKnowledgeRelation_procedimentoId_fkey" FOREIGN KEY ("procedimentoId") REFERENCES "Procedimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRelation" ADD CONSTRAINT "FascicoloKnowledgeRelation_revision_scope_fkey" FOREIGN KEY ("revisionId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeRevision"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRelation" ADD CONSTRAINT "FascicoloKnowledgeRelation_source_scope_fkey" FOREIGN KEY ("sourceItemId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeItem"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FascicoloKnowledgeRelation" ADD CONSTRAINT "FascicoloKnowledgeRelation_target_scope_fkey" FOREIGN KEY ("targetItemId", "tenantId", "procedimentoId") REFERENCES "FascicoloKnowledgeItem"("id", "tenantId", "procedimentoId") ON DELETE RESTRICT ON UPDATE CASCADE;
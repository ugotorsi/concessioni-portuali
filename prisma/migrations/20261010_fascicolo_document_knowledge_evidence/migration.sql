-- ExtendTable
ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD COLUMN "documentExtractionAttemptId" TEXT;

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "FascicoloKnowledgeEvidence_documentExtractionAttemptId_fkey"
  FOREIGN KEY ("documentExtractionAttemptId")
  REFERENCES "DocumentExtractionAttempt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the historical Neutral Intake path and the ordinary fascicolo path mutually exclusive.
ALTER TABLE "FascicoloKnowledgeEvidence"
  DROP CONSTRAINT "fascicolo_knowledge_evidence_document_extraction_check";

ALTER TABLE "FascicoloKnowledgeEvidence"
  ADD CONSTRAINT "fascicolo_knowledge_evidence_extraction_source_check"
  CHECK (
    (
      "provenanceType" = 'DOCUMENT_EXTRACTION'
      AND "documentFileVersionId" IS NOT NULL
      AND "extractionAttemptId" IS NOT NULL
      AND "documentExtractionAttemptId" IS NULL
      AND "basisRef" IS NOT NULL
    )
    OR
    (
      "provenanceType" = 'FASCICOLO_DOCUMENT_EXTRACTION'
      AND "documentFileVersionId" IS NOT NULL
      AND "extractionAttemptId" IS NULL
      AND "documentExtractionAttemptId" IS NOT NULL
      AND "basisRef" IS NOT NULL
    )
  );

DROP INDEX "fascicolo_knowledge_evidence_identity_uq";
CREATE UNIQUE INDEX "fascicolo_knowledge_evidence_identity_uq"
  ON "FascicoloKnowledgeEvidence"(
    "itemId",
    "documentoId",
    "documentFileVersionId",
    "extractionAttemptId",
    "documentExtractionAttemptId",
    "pageNumber",
    "textSha256",
    "quoteSha256"
  ) NULLS NOT DISTINCT;

CREATE INDEX "fascicolo_knowledge_evidence_document_extraction_idx"
  ON "FascicoloKnowledgeEvidence"("documentExtractionAttemptId");

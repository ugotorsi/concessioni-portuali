-- CreateEnum
CREATE TYPE "DocumentExtractionOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentExtractionMethod" AS ENUM ('DIRECT_TEXT', 'OCR');

-- Existing primary keys make these composite identities additive and safe.
CREATE UNIQUE INDEX "procedimento_extraction_scope_uq"
ON "Procedimento"("id", "enteId");

CREATE UNIQUE INDEX "documento_extraction_scope_uq"
ON "Documento"("id", "enteId", "procedimentoId");

-- CreateTable
CREATE TABLE "DocumentExtractionAttempt" (
    "id" TEXT NOT NULL,
    "executionKey" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "documentFileVersionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "retryOfAttemptId" TEXT,
    "retryAuthorizationId" TEXT,
    "outcome" "DocumentExtractionOutcome" NOT NULL,
    "sourceSha256" CHAR(64) NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "detectedMimeType" TEXT,
    "sourceSizeBytes" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "directExtractorName" TEXT,
    "directExtractorVersion" TEXT,
    "ocrExtractorName" TEXT,
    "ocrExtractorVersion" TEXT,
    "rasterizerName" TEXT,
    "rasterizerVersion" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "warnings" JSONB,
    "technicalMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExtractionAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_extraction_attempt_required_text_ck" CHECK (
        "executionKey" ~ '[^[:space:]]'
        AND length("executionKey") <= 256
        AND "policyVersion" ~ '[^[:space:]]'
        AND "sourceSha256" ~ '^[0-9a-f]{64}$'
        AND "declaredMimeType" ~ '[^[:space:]]'
    ),
    CONSTRAINT "document_extraction_attempt_retry_ck" CHECK (
        ("retryOfAttemptId" IS NULL AND "retryAuthorizationId" IS NULL)
        OR (
            "retryOfAttemptId" IS NOT NULL
            AND COALESCE("retryAuthorizationId" ~ '[^[:space:]]', FALSE)
            AND length("retryAuthorizationId") <= 256
            AND "retryOfAttemptId" <> "id"
        )
    ),
    CONSTRAINT "document_extraction_attempt_size_ck" CHECK ("sourceSizeBytes" > 0),
    CONSTRAINT "document_extraction_attempt_time_ck" CHECK ("completedAt" >= "startedAt"),
    CONSTRAINT "document_extraction_attempt_outcome_ck" CHECK (
        ("outcome" = 'SUCCEEDED' AND "failureCode" IS NULL AND "failureMessage" IS NULL)
        OR ("outcome" = 'FAILED' AND "failureCode" ~ '[^[:space:]]')
    )
);

-- CreateTable
CREATE TABLE "DocumentExtractionPage" (
    "id" TEXT NOT NULL,
    "extractionAttemptId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "extractionMethod" "DocumentExtractionMethod" NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "textSha256" CHAR(64) NOT NULL,
    "normalizedCharacterCount" INTEGER NOT NULL,
    "ocrConfidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "technicalMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExtractionPage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_extraction_page_number_ck" CHECK ("pageNumber" > 0),
    CONSTRAINT "document_extraction_page_sha_ck" CHECK ("textSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "document_extraction_page_chars_ck" CHECK ("normalizedCharacterCount" >= 0),
    CONSTRAINT "document_extraction_page_confidence_ck" CHECK (
        "ocrConfidence" IS NULL OR ("ocrConfidence" >= 0 AND "ocrConfidence" <= 100)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "document_extraction_execution_key_uq"
ON "DocumentExtractionAttempt"("executionKey");

CREATE UNIQUE INDEX "document_extraction_succeeded_version_policy_uq"
ON "DocumentExtractionAttempt"("documentFileVersionId", "policyVersion")
WHERE "outcome" = 'SUCCEEDED';

CREATE INDEX "document_extraction_canonical_result_idx"
ON "DocumentExtractionAttempt"("documentFileVersionId", "policyVersion", "outcome");

CREATE INDEX "document_extraction_retry_source_idx"
ON "DocumentExtractionAttempt"("retryOfAttemptId");

CREATE INDEX "document_extraction_document_version_idx"
ON "DocumentExtractionAttempt"("documentoId", "documentFileVersionId", "createdAt");

CREATE INDEX "document_extraction_scope_idx"
ON "DocumentExtractionAttempt"("tenantId", "procedimentoId", "createdAt");

CREATE INDEX "document_extraction_outcome_idx"
ON "DocumentExtractionAttempt"("outcome", "createdAt");

CREATE UNIQUE INDEX "DocumentExtractionPage_extractionAttemptId_pageNumber_key"
ON "DocumentExtractionPage"("extractionAttemptId", "pageNumber");

CREATE INDEX "DocumentExtractionPage_textSha256_idx"
ON "DocumentExtractionPage"("textSha256");

-- AddForeignKey
ALTER TABLE "DocumentExtractionAttempt"
ADD CONSTRAINT "DocumentExtractionAttempt_documento_fkey"
FOREIGN KEY ("documentoId", "tenantId", "procedimentoId")
REFERENCES "Documento"("id", "enteId", "procedimentoId")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentExtractionAttempt"
ADD CONSTRAINT "DocumentExtractionAttempt_documentFileVersion_fkey"
FOREIGN KEY ("documentFileVersionId", "documentoId", "tenantId")
REFERENCES "DocumentFileVersion"("id", "documentId", "canonicalEnteId")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentExtractionAttempt"
ADD CONSTRAINT "DocumentExtractionAttempt_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentExtractionAttempt"
ADD CONSTRAINT "DocumentExtractionAttempt_procedimento_fkey"
FOREIGN KEY ("procedimentoId", "tenantId")
REFERENCES "Procedimento"("id", "enteId")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentExtractionAttempt"
ADD CONSTRAINT "DocumentExtractionAttempt_retryOfAttemptId_fkey"
FOREIGN KEY ("retryOfAttemptId") REFERENCES "DocumentExtractionAttempt"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentExtractionPage"
ADD CONSTRAINT "DocumentExtractionPage_extractionAttemptId_fkey"
FOREIGN KEY ("extractionAttemptId") REFERENCES "DocumentExtractionAttempt"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_document_extraction_retry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."retryOfAttemptId" IS NULL THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "DocumentExtractionAttempt" previous
        WHERE previous."id" = NEW."retryOfAttemptId"
          AND previous."outcome" = 'FAILED'
          AND previous."failureCode" IN ('STORAGE_READ_FAILURE', 'INTERNAL_EXTRACTION_FAILURE')
          AND previous."documentoId" = NEW."documentoId"
          AND previous."documentFileVersionId" = NEW."documentFileVersionId"
          AND previous."tenantId" = NEW."tenantId"
          AND previous."procedimentoId" = NEW."procedimentoId"
          AND previous."policyVersion" = NEW."policyVersion"
    ) THEN
        RAISE EXCEPTION 'Document extraction retry source must be a retryable failed attempt in the same scope';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "document_extraction_attempt_validate_retry"
BEFORE INSERT ON "DocumentExtractionAttempt"
FOR EACH ROW EXECUTE FUNCTION "validate_document_extraction_retry"();

-- Extraction evidence is append-only after insertion.
CREATE FUNCTION "reject_document_extraction_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Document extraction evidence is immutable';
END;
$$;

CREATE TRIGGER "document_extraction_attempt_reject_mutation"
BEFORE UPDATE OR DELETE ON "DocumentExtractionAttempt"
FOR EACH ROW EXECUTE FUNCTION "reject_document_extraction_mutation"();

CREATE TRIGGER "document_extraction_page_reject_mutation"
BEFORE UPDATE OR DELETE ON "DocumentExtractionPage"
FOR EACH ROW EXECUTE FUNCTION "reject_document_extraction_mutation"();

CREATE TYPE "DocumentOcrRunStatus" AS ENUM ('PLANNED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "DocumentOcrRun" (
    "id" TEXT NOT NULL,
    "coordinatorJobId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "documentFileVersionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "procedimentoId" TEXT NOT NULL,
    "sourceAttemptId" TEXT NOT NULL,
    "authorizationRef" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "sourceSha256" CHAR(64) NOT NULL,
    "sourceSizeBytes" INTEGER NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "batchSize" INTEGER NOT NULL,
    "status" "DocumentOcrRunStatus" NOT NULL DEFAULT 'PLANNED',
    "completedPageCount" INTEGER NOT NULL DEFAULT 0,
    "extractionAttemptId" TEXT,
    "failureCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentOcrRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_ocr_run_manifest_ck" CHECK (
        "coordinatorJobId" ~ '[^[:space:]]'
        AND "authorizationRef" ~ '[^[:space:]]'
        AND "policyVersion" ~ '[^[:space:]]'
        AND "sourceSha256" ~ '^[0-9a-f]{64}$'
        AND "declaredMimeType" ~ '[^[:space:]]'
        AND "sourceSizeBytes" > 0
        AND "pageCount" BETWEEN 1 AND 100
        AND "batchSize" BETWEEN 1 AND 10
        AND "completedPageCount" BETWEEN 0 AND "pageCount"
    ),
    CONSTRAINT "document_ocr_run_state_ck" CHECK (
        ("status" IN ('PLANNED', 'PROCESSING') AND "completedAt" IS NULL AND "extractionAttemptId" IS NULL AND "failureCode" IS NULL)
        OR ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "extractionAttemptId" IS NOT NULL AND "failureCode" IS NULL AND "completedPageCount" = "pageCount")
        OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "extractionAttemptId" IS NULL AND "failureCode" ~ '[^[:space:]]')
    )
);

CREATE TABLE "DocumentOcrPageCheckpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "extractionMethod" "DocumentExtractionMethod" NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "textSha256" CHAR(64) NOT NULL,
    "normalizedCharacterCount" INTEGER NOT NULL,
    "ocrConfidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "directExtractorName" TEXT,
    "directExtractorVersion" TEXT,
    "ocrExtractorName" TEXT,
    "ocrExtractorVersion" TEXT,
    "rasterizerName" TEXT,
    "rasterizerVersion" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentOcrPageCheckpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_ocr_page_number_ck" CHECK ("pageNumber" > 0),
    CONSTRAINT "document_ocr_page_sha_ck" CHECK ("textSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "document_ocr_page_chars_ck" CHECK ("normalizedCharacterCount" >= 0),
    CONSTRAINT "document_ocr_page_confidence_ck" CHECK (
        "ocrConfidence" IS NULL OR ("ocrConfidence" >= 0 AND "ocrConfidence" <= 100)
    )
);

CREATE UNIQUE INDEX "DocumentOcrRun_coordinatorJobId_key"
ON "DocumentOcrRun"("coordinatorJobId");

CREATE UNIQUE INDEX "DocumentOcrRun_extractionAttemptId_key"
ON "DocumentOcrRun"("extractionAttemptId");

CREATE UNIQUE INDEX "document_ocr_run_version_policy_uq"
ON "DocumentOcrRun"("documentFileVersionId", "policyVersion");

CREATE INDEX "document_ocr_run_scope_status_idx"
ON "DocumentOcrRun"("tenantId", "procedimentoId", "status", "createdAt");

CREATE INDEX "document_ocr_run_source_attempt_idx"
ON "DocumentOcrRun"("sourceAttemptId");

CREATE UNIQUE INDEX "document_ocr_page_run_page_uq"
ON "DocumentOcrPageCheckpoint"("runId", "pageNumber");

CREATE INDEX "document_ocr_page_sha_idx"
ON "DocumentOcrPageCheckpoint"("textSha256");

ALTER TABLE "DocumentOcrRun"
ADD CONSTRAINT "DocumentOcrRun_documento_fkey"
FOREIGN KEY ("documentoId", "tenantId", "procedimentoId")
REFERENCES "Documento"("id", "enteId", "procedimentoId")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentOcrRun"
ADD CONSTRAINT "DocumentOcrRun_documentFileVersion_fkey"
FOREIGN KEY ("documentFileVersionId", "documentoId", "tenantId")
REFERENCES "DocumentFileVersion"("id", "documentId", "canonicalEnteId")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentOcrRun"
ADD CONSTRAINT "DocumentOcrRun_sourceAttemptId_fkey"
FOREIGN KEY ("sourceAttemptId") REFERENCES "DocumentExtractionAttempt"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentOcrRun"
ADD CONSTRAINT "DocumentOcrRun_extractionAttemptId_fkey"
FOREIGN KEY ("extractionAttemptId") REFERENCES "DocumentExtractionAttempt"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "DocumentOcrPageCheckpoint"
ADD CONSTRAINT "DocumentOcrPageCheckpoint_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "DocumentOcrRun"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_document_ocr_run_authority"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW."coordinatorJobId" IS DISTINCT FROM OLD."coordinatorJobId"
        OR NEW."documentoId" IS DISTINCT FROM OLD."documentoId"
        OR NEW."documentFileVersionId" IS DISTINCT FROM OLD."documentFileVersionId"
        OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
        OR NEW."procedimentoId" IS DISTINCT FROM OLD."procedimentoId"
        OR NEW."sourceAttemptId" IS DISTINCT FROM OLD."sourceAttemptId"
        OR NEW."authorizationRef" IS DISTINCT FROM OLD."authorizationRef"
        OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
        OR NEW."sourceSha256" IS DISTINCT FROM OLD."sourceSha256"
        OR NEW."sourceSizeBytes" IS DISTINCT FROM OLD."sourceSizeBytes"
        OR NEW."declaredMimeType" IS DISTINCT FROM OLD."declaredMimeType"
        OR NEW."pageCount" IS DISTINCT FROM OLD."pageCount"
        OR NEW."batchSize" IS DISTINCT FROM OLD."batchSize"
    ) THEN
        RAISE EXCEPTION 'Document OCR run authority is immutable';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "DocumentExtractionAttempt" source
        WHERE source."id" = NEW."sourceAttemptId"
          AND source."documentoId" = NEW."documentoId"
          AND source."documentFileVersionId" = NEW."documentFileVersionId"
          AND source."tenantId" = NEW."tenantId"
          AND source."procedimentoId" = NEW."procedimentoId"
          AND source."policyVersion" = 'DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1'
          AND source."outcome" = 'FAILED'
          AND source."failureCode" IN ('OCR_REQUIRED', 'ARTIFACT_TOO_LARGE')
          AND source."sourceSha256" = NEW."sourceSha256"
          AND source."sourceSizeBytes" = NEW."sourceSizeBytes"
          AND source."declaredMimeType" = NEW."declaredMimeType"
    ) THEN
        RAISE EXCEPTION 'Document OCR run source authority is invalid';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "document_ocr_run_validate_authority"
BEFORE INSERT OR UPDATE ON "DocumentOcrRun"
FOR EACH ROW EXECUTE FUNCTION "validate_document_ocr_run_authority"();

CREATE FUNCTION "reject_document_ocr_page_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Document OCR page checkpoints are immutable';
END;
$$;

CREATE TRIGGER "document_ocr_page_reject_mutation"
BEFORE UPDATE OR DELETE ON "DocumentOcrPageCheckpoint"
FOR EACH ROW EXECUTE FUNCTION "reject_document_ocr_page_mutation"();

CREATE OR REPLACE FUNCTION "validate_document_extraction_retry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."retryOfAttemptId" IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW."policyVersion" = 'DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "DocumentExtractionAttempt" previous
            WHERE previous."id" = NEW."retryOfAttemptId"
              AND previous."outcome" = 'FAILED'
              AND previous."failureCode" IN ('OCR_REQUIRED', 'ARTIFACT_TOO_LARGE')
              AND previous."documentoId" = NEW."documentoId"
              AND previous."documentFileVersionId" = NEW."documentFileVersionId"
              AND previous."tenantId" = NEW."tenantId"
              AND previous."procedimentoId" = NEW."procedimentoId"
              AND previous."policyVersion" = 'DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1'
              AND EXISTS (
                  SELECT 1
                  FROM "DocumentOcrRun" run
                  WHERE run."sourceAttemptId" = previous."id"
                    AND run."documentoId" = NEW."documentoId"
                    AND run."documentFileVersionId" = NEW."documentFileVersionId"
                    AND run."tenantId" = NEW."tenantId"
                    AND run."procedimentoId" = NEW."procedimentoId"
                    AND run."policyVersion" = NEW."policyVersion"
                    AND run."authorizationRef" = NEW."retryAuthorizationId"
              )
        ) THEN
            RAISE EXCEPTION 'Document OCR source must be an eligible DIRECT_TEXT_V1 failure in the same scope';
        END IF;
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

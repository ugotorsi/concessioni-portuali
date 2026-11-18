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
          AND previous."failureCode" IN (
              'STORAGE_READ_FAILURE',
              'INTERNAL_EXTRACTION_FAILURE',
              'DIRECT_PARSER_FAILURE',
              'PROVIDER_MISMATCH',
              'BUCKET_MISMATCH'
          )
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

CREATE OR REPLACE FUNCTION "reject_async_job_admission_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."idempotencyKey", NEW."requestFingerprint", NEW."operation", NEW."logicalOperationId",
        NEW."purpose", NEW."correlationId", NEW."policyDecisionRef", NEW."inputReference",
        NEW."admissionType", NEW."tenantId", NEW."initiatingUserId", NEW."actorId",
        NEW."actorEmail", NEW."actorRole", NEW."createdAt"
    ) IS DISTINCT FROM ROW(
        OLD."idempotencyKey", OLD."requestFingerprint", OLD."operation", OLD."logicalOperationId",
        OLD."purpose", OLD."correlationId", OLD."policyDecisionRef", OLD."inputReference",
        OLD."admissionType", OLD."tenantId", OLD."initiatingUserId", OLD."actorId",
        OLD."actorEmail", OLD."actorRole", OLD."createdAt"
    ) THEN
        RAISE EXCEPTION 'Async job admission identity and provenance are immutable';
    END IF;

    IF NEW."maxAttempts" IS DISTINCT FROM OLD."maxAttempts"
       AND NOT (
           OLD."status" = 'TERMINAL_FAILED'
           AND NEW."status" = 'QUEUED'
           AND NEW."maxAttempts" = OLD."attemptCount" + 1
           AND NEW."maxAttempts" <= 100
       )
    THEN
        RAISE EXCEPTION 'Async job attempt budget is immutable outside manual retry';
    END IF;

    RETURN NEW;
END;
$$;

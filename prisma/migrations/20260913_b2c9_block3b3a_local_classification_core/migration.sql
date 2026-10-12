-- CreateEnum
CREATE TYPE "NeutralIntakeClassificationOutcome" AS ENUM (
    'LEGAL_SOURCE_CANDIDATE',
    'CASE_DOCUMENT',
    'UNCERTAIN_REVIEW_REQUIRED'
);

-- CreateEnum
CREATE TYPE "NeutralIntakeClassificationConfidence" AS ENUM (
    'HIGH',
    'MEDIUM',
    'LOW',
    'INSUFFICIENT'
);

-- CreateTable
CREATE TABLE "NeutralIntakeClassificationAttempt" (
    "id" TEXT NOT NULL,
    "neutralIntakeId" TEXT NOT NULL,
    "extractionAttemptId" TEXT NOT NULL,
    "idempotencyKey" CHAR(64) NOT NULL,
    "classifierVersion" TEXT NOT NULL,
    "evidenceHash" CHAR(64) NOT NULL,
    "outcome" "NeutralIntakeClassificationOutcome" NOT NULL,
    "confidence" "NeutralIntakeClassificationConfidence" NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "evidenceMarkers" JSONB NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeutralIntakeClassificationAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "neutral_intake_classification_required_text_ck" CHECK (
        "classifierVersion" ~ '[^[:space:]]'
        AND "idempotencyKey" ~ '^[0-9a-f]{64}$'
        AND "evidenceHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "neutral_intake_classification_review_ck" CHECK (
        ("outcome" = 'UNCERTAIN_REVIEW_REQUIRED' AND "reviewRequired" = TRUE)
        OR ("outcome" <> 'UNCERTAIN_REVIEW_REQUIRED' AND "reviewRequired" = FALSE)
    ),
    CONSTRAINT "neutral_intake_classification_reason_codes_ck" CHECK (
        jsonb_typeof("reasonCodes") = 'array'
        AND jsonb_array_length("reasonCodes") BETWEEN 1 AND 10
        AND "reasonCodes" <@ '["SELF_IDENTIFIES_REGULATION", "GENERAL_NORMATIVE_STRUCTURE", "JUDICIAL_DECISION_STRUCTURE", "CASE_FILING_STRUCTURE", "SPECIFIC_ADMINISTRATIVE_ACT", "CONTRACTUAL_DOCUMENT_STRUCTURE", "CORRESPONDENCE_STRUCTURE", "MIXED_STRONG_SIGNALS", "INSUFFICIENT_EVIDENCE", "EXTRACTION_QUALITY_INSUFFICIENT"]'::jsonb
    ),
    CONSTRAINT "neutral_intake_classification_evidence_markers_ck" CHECK (
        jsonb_typeof("evidenceMarkers") = 'array'
        AND jsonb_array_length("evidenceMarkers") BETWEEN 1 AND 10
        AND "evidenceMarkers" <@ '["SELF_IDENTIFIES_REGULATION", "GENERAL_NORMATIVE_STRUCTURE", "JUDICIAL_DECISION_STRUCTURE", "CASE_FILING_STRUCTURE", "SPECIFIC_ADMINISTRATIVE_ACT", "CONTRACTUAL_DOCUMENT_STRUCTURE", "CORRESPONDENCE_STRUCTURE", "MIXED_STRONG_SIGNALS", "INSUFFICIENT_EVIDENCE", "EXTRACTION_QUALITY_INSUFFICIENT"]'::jsonb
    )
);

CREATE UNIQUE INDEX "NeutralIntakeClassificationAttempt_idempotencyKey_key"
ON "NeutralIntakeClassificationAttempt"("idempotencyKey");

CREATE UNIQUE INDEX "NeutralIntakeClassificationAttempt_neutralIntakeId_evidenceHash_classifierVersion_key"
ON "NeutralIntakeClassificationAttempt"("neutralIntakeId", "evidenceHash", "classifierVersion");

CREATE UNIQUE INDEX "NeutralIntakeExtractionAttempt_id_neutralIntakeId_key"
ON "NeutralIntakeExtractionAttempt"("id", "neutralIntakeId");

CREATE INDEX "NeutralIntakeClassificationAttempt_neutralIntakeId_classifiedAt_idx"
ON "NeutralIntakeClassificationAttempt"("neutralIntakeId", "classifiedAt");

CREATE INDEX "NeutralIntakeClassificationAttempt_extractionAttemptId_idx"
ON "NeutralIntakeClassificationAttempt"("extractionAttemptId");

CREATE INDEX "NeutralIntakeClassificationAttempt_outcome_reviewRequired_idx"
ON "NeutralIntakeClassificationAttempt"("outcome", "reviewRequired");

ALTER TABLE "NeutralIntakeClassificationAttempt"
ADD CONSTRAINT "NeutralIntakeClassificationAttempt_neutralIntakeId_fkey"
FOREIGN KEY ("neutralIntakeId") REFERENCES "NeutralIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NeutralIntakeClassificationAttempt"
ADD CONSTRAINT "NeutralIntakeClassificationAttempt_extractionAttemptId_fkey"
FOREIGN KEY ("extractionAttemptId", "neutralIntakeId")
REFERENCES "NeutralIntakeExtractionAttempt"("id", "neutralIntakeId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_neutral_intake_classification_attempt_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'NeutralIntakeClassificationAttempt rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER neutral_intake_classification_attempt_immutable
BEFORE UPDATE OR DELETE ON "NeutralIntakeClassificationAttempt"
FOR EACH ROW EXECUTE FUNCTION reject_neutral_intake_classification_attempt_mutation();
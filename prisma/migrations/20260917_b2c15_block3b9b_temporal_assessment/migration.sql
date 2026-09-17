CREATE TABLE "LegalSourceTemporalAssessment" (
    "id" TEXT NOT NULL,
    "sourceFamilyId" TEXT NOT NULL,
    "legalExpressionVersionId" TEXT NOT NULL,
    "assessmentVersion" VARCHAR(100) NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "validityState" VARCHAR(50) NOT NULL,
    "temporalWindowState" VARCHAR(50) NOT NULL,
    "applicabilityState" VARCHAR(50) NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "effectiveFromSnapshot" TIMESTAMP(3),
    "effectiveToSnapshot" TIMESTAMP(3),
    "humanReviewRequired" BOOLEAN NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "inputFingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceTemporalAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "temporal_assessment_fingerprint_ck" CHECK ("inputFingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "temporal_assessment_required_text_ck" CHECK (
        "assessmentVersion" ~ '[^[:space:]]'
        AND "validityState" ~ '[^[:space:]]'
        AND "temporalWindowState" ~ '[^[:space:]]'
        AND "applicabilityState" ~ '[^[:space:]]'
        AND "confidence" ~ '[^[:space:]]'
    ),
    CONSTRAINT "temporal_assessment_reason_codes_ck" CHECK (jsonb_typeof("reasonCodes") = 'array')
);

CREATE UNIQUE INDEX "temporal_assessment_identity_uq"
ON "LegalSourceTemporalAssessment"("inputFingerprint");

CREATE INDEX "temporal_assessment_latest_idx"
ON "LegalSourceTemporalAssessment"("legalExpressionVersionId", "referenceDate", "createdAt");

CREATE INDEX "temporal_assessment_family_idx"
ON "LegalSourceTemporalAssessment"("sourceFamilyId");

ALTER TABLE "LegalSourceTemporalAssessment"
ADD CONSTRAINT "temporal_assessment_source_fk"
FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalSourceTemporalAssessment"
ADD CONSTRAINT "temporal_assessment_expression_fk"
FOREIGN KEY ("legalExpressionVersionId", "sourceFamilyId")
REFERENCES "LegalExpressionVersion"("id", "sourceFamilyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_temporal_assessment_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'LegalSourceTemporalAssessment rows are append-only';
END;
$$;

CREATE TRIGGER "temporal_assessment_append_only_trg"
BEFORE UPDATE OR DELETE ON "LegalSourceTemporalAssessment"
FOR EACH ROW EXECUTE FUNCTION "reject_temporal_assessment_mutation"();
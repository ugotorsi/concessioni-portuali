-- CreateEnum
CREATE TYPE "NeutralIntakeExtractionOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NeutralIntakeExtractionMethod" AS ENUM ('DIRECT_TEXT', 'OCR');

-- CreateTable
CREATE TABLE "NeutralIntakeExtractionAttempt" (
    "id" TEXT NOT NULL,
    "neutralIntakeId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "outcome" "NeutralIntakeExtractionOutcome" NOT NULL,
    "artifactSha256" CHAR(64) NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "detectedMimeType" TEXT,
    "artifactSizeBytes" INTEGER NOT NULL,
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

    CONSTRAINT "NeutralIntakeExtractionAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "neutral_intake_extraction_attempt_required_text_ck" CHECK (
        "policyVersion" ~ '[^[:space:]]'
        AND "artifactSha256" ~ '^[0-9a-f]{64}$'
        AND "declaredMimeType" ~ '[^[:space:]]'
    ),
    CONSTRAINT "neutral_intake_extraction_attempt_size_ck" CHECK ("artifactSizeBytes" > 0),
    CONSTRAINT "neutral_intake_extraction_attempt_time_ck" CHECK ("completedAt" >= "startedAt"),
    CONSTRAINT "neutral_intake_extraction_attempt_outcome_ck" CHECK (
        ("outcome" = 'SUCCEEDED' AND "failureCode" IS NULL AND "failureMessage" IS NULL)
        OR ("outcome" = 'FAILED' AND "failureCode" ~ '[^[:space:]]')
    )
);

-- CreateTable
CREATE TABLE "NeutralIntakeExtractionPage" (
    "id" TEXT NOT NULL,
    "extractionAttemptId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "extractionMethod" "NeutralIntakeExtractionMethod" NOT NULL,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "textSha256" CHAR(64) NOT NULL,
    "normalizedCharacterCount" INTEGER NOT NULL,
    "ocrConfidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "technicalMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NeutralIntakeExtractionPage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "neutral_intake_extraction_page_number_ck" CHECK ("pageNumber" > 0),
    CONSTRAINT "neutral_intake_extraction_page_sha_ck" CHECK ("textSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "neutral_intake_extraction_page_chars_ck" CHECK ("normalizedCharacterCount" >= 0),
    CONSTRAINT "neutral_intake_extraction_page_confidence_ck" CHECK (
        "ocrConfidence" IS NULL OR ("ocrConfidence" >= 0 AND "ocrConfidence" <= 100)
    )
);

-- CreateIndex
CREATE INDEX "NeutralIntakeExtractionAttempt_neutralIntakeId_createdAt_idx" ON "NeutralIntakeExtractionAttempt"("neutralIntakeId", "createdAt");
CREATE INDEX "NeutralIntakeExtractionAttempt_outcome_createdAt_idx" ON "NeutralIntakeExtractionAttempt"("outcome", "createdAt");
CREATE UNIQUE INDEX "NeutralIntakeExtractionPage_extractionAttemptId_pageNumber_key" ON "NeutralIntakeExtractionPage"("extractionAttemptId", "pageNumber");
CREATE INDEX "NeutralIntakeExtractionPage_textSha256_idx" ON "NeutralIntakeExtractionPage"("textSha256");

-- AddForeignKey
ALTER TABLE "NeutralIntakeExtractionAttempt" ADD CONSTRAINT "NeutralIntakeExtractionAttempt_neutralIntakeId_fkey" FOREIGN KEY ("neutralIntakeId") REFERENCES "NeutralIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NeutralIntakeExtractionPage" ADD CONSTRAINT "NeutralIntakeExtractionPage_extractionAttemptId_fkey" FOREIGN KEY ("extractionAttemptId") REFERENCES "NeutralIntakeExtractionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extraction evidence is append-only after insertion.
CREATE FUNCTION "reject_neutral_intake_extraction_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Neutral intake extraction evidence is immutable';
END;
$$;

CREATE TRIGGER "neutral_intake_extraction_attempt_reject_mutation"
BEFORE UPDATE OR DELETE ON "NeutralIntakeExtractionAttempt"
FOR EACH ROW EXECUTE FUNCTION "reject_neutral_intake_extraction_mutation"();

CREATE TRIGGER "neutral_intake_extraction_page_reject_mutation"
BEFORE UPDATE OR DELETE ON "NeutralIntakeExtractionPage"
FOR EACH ROW EXECUTE FUNCTION "reject_neutral_intake_extraction_mutation"();
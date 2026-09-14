-- CreateEnum
CREATE TYPE "LegalReferenceKind" AS ENUM ('LEGISLATION', 'CODE', 'CASE_LAW');

-- Extend the extraction page identity so mentions cannot be bound to another attempt.
CREATE UNIQUE INDEX "NeutralIntakeExtractionPage_id_extractionAttemptId_key"
ON "NeutralIntakeExtractionPage"("id", "extractionAttemptId");

-- CreateTable
CREATE TABLE "LegalReferenceMention" (
    "id" TEXT NOT NULL,
    "extractionAttemptId" TEXT NOT NULL,
    "extractionPageId" TEXT NOT NULL,
    "discoveryVersion" TEXT NOT NULL,
    "kind" "LegalReferenceKind" NOT NULL,
    "observedText" VARCHAR(500) NOT NULL,
    "normalizedKey" VARCHAR(500) NOT NULL,
    "authorityHint" VARCHAR(200),
    "actType" VARCHAR(100),
    "actNumber" VARCHAR(100),
    "year" INTEGER,
    "article" VARCHAR(100),
    "subArticle" VARCHAR(50),
    "chamberSection" VARCHAR(100),
    "characterStart" INTEGER NOT NULL,
    "characterEnd" INTEGER NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalReferenceMention_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_reference_mention_required_text_ck" CHECK (
        "discoveryVersion" ~ '[^[:space:]]'
        AND "observedText" ~ '[^[:space:]]'
        AND "normalizedKey" ~ '[^[:space:]]'
    ),
    CONSTRAINT "legal_reference_mention_location_ck" CHECK (
        "characterStart" >= 0 AND "characterEnd" > "characterStart"
    ),
    CONSTRAINT "legal_reference_mention_year_ck" CHECK (
        "year" IS NULL OR ("year" >= 1000 AND "year" <= 9999)
    )
);

CREATE UNIQUE INDEX "LegalReferenceMention_occurrence_key"
ON "LegalReferenceMention"("extractionPageId", "discoveryVersion", "characterStart", "characterEnd", "normalizedKey");

CREATE INDEX "LegalReferenceMention_extractionAttemptId_discoveryVersion_idx"
ON "LegalReferenceMention"("extractionAttemptId", "discoveryVersion");

CREATE INDEX "LegalReferenceMention_kind_normalizedKey_idx"
ON "LegalReferenceMention"("kind", "normalizedKey");

ALTER TABLE "LegalReferenceMention"
ADD CONSTRAINT "LegalReferenceMention_extractionAttemptId_fkey"
FOREIGN KEY ("extractionAttemptId") REFERENCES "NeutralIntakeExtractionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceMention"
ADD CONSTRAINT "LegalReferenceMention_extractionPage_binding_fkey"
FOREIGN KEY ("extractionPageId", "extractionAttemptId")
REFERENCES "NeutralIntakeExtractionPage"("id", "extractionAttemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Discovered mentions are append-only local observations.
CREATE FUNCTION "reject_legal_reference_mention_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Legal reference mentions are immutable';
END;
$$;

CREATE TRIGGER "legal_reference_mention_reject_mutation"
BEFORE UPDATE OR DELETE ON "LegalReferenceMention"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_reference_mention_mutation"();
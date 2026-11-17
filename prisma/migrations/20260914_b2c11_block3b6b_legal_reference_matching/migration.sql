-- CreateEnum
CREATE TYPE "LegalReferenceMatchStatus" AS ENUM ('MATCHED', 'AMBIGUOUS', 'NO_MATCH');

-- CreateEnum
CREATE TYPE "LegalReferenceMatchReason" AS ENUM (
    'EXACT_IDENTITY',
    'MULTIPLE_EXACT_MATCHES',
    'NO_CATALOG_MATCH',
    'INSUFFICIENT_IDENTITY'
);

-- CreateTable
CREATE TABLE "LegalReferenceMatch" (
    "id" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "matchingVersion" TEXT NOT NULL,
    "status" "LegalReferenceMatchStatus" NOT NULL,
    "reason" "LegalReferenceMatchReason" NOT NULL,
    "legalSourceId" TEXT,
    "candidateCount" INTEGER NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalReferenceMatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_reference_match_version_ck" CHECK ("matchingVersion" ~ '[^[:space:]]'),
    CONSTRAINT "legal_reference_match_outcome_ck" CHECK (
        ("status" = 'MATCHED' AND "reason" = 'EXACT_IDENTITY' AND "legalSourceId" IS NOT NULL AND "candidateCount" = 1)
        OR ("status" = 'AMBIGUOUS' AND "reason" = 'MULTIPLE_EXACT_MATCHES' AND "legalSourceId" IS NULL AND "candidateCount" > 1)
        OR ("status" = 'NO_MATCH' AND "reason" IN ('NO_CATALOG_MATCH', 'INSUFFICIENT_IDENTITY') AND "legalSourceId" IS NULL AND "candidateCount" = 0)
    )
);

CREATE UNIQUE INDEX "LegalReferenceMatch_mentionId_matchingVersion_key"
ON "LegalReferenceMatch"("mentionId", "matchingVersion");

CREATE INDEX "LegalReferenceMatch_legalSourceId_idx"
ON "LegalReferenceMatch"("legalSourceId");

CREATE INDEX "LegalReferenceMatch_status_matchedAt_idx"
ON "LegalReferenceMatch"("status", "matchedAt");

ALTER TABLE "LegalReferenceMatch"
ADD CONSTRAINT "LegalReferenceMatch_mentionId_fkey"
FOREIGN KEY ("mentionId") REFERENCES "LegalReferenceMention"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceMatch"
ADD CONSTRAINT "LegalReferenceMatch_legalSourceId_fkey"
FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Matching results are immutable snapshots; a later algorithm uses a new version.
CREATE FUNCTION "reject_legal_reference_match_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Legal reference matches are immutable';
END;
$$;

CREATE TRIGGER "legal_reference_match_reject_mutation"
BEFORE UPDATE OR DELETE ON "LegalReferenceMatch"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_reference_match_mutation"();
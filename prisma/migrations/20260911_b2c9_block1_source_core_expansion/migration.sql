-- CreateEnum
CREATE TYPE "ResourceSemanticType" AS ENUM ('NORMATIVE_INSTRUMENT', 'JUDICIAL_DECISION', 'ADMINISTRATIVE_ACT', 'CONTRACT', 'CORRESPONDENCE', 'TECHNICAL_DOCUMENT', 'MEDIA_RECORD', 'OTHER');
CREATE TYPE "LegalAuthorityKind" AS ENUM ('LEGISLATION', 'CASE_LAW', 'ADMINISTRATIVE_REGULATION', 'ADMINISTRATIVE_ACT', 'AUTHORITY_PRACTICE', 'OTHER_LEGAL_AUTHORITY');
CREATE TYPE "SourceCharacter" AS ENUM ('PUBLIC_OFFICIAL', 'PUBLIC_NON_OFFICIAL', 'PRIVATE', 'UNKNOWN');
CREATE TYPE "LegalSourceIdentityVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED', 'CONFLICTING');

-- AlterTable
ALTER TABLE "LegalSource"
ADD COLUMN "resourceSemanticType" "ResourceSemanticType",
ADD COLUMN "legalAuthorityKind" "LegalAuthorityKind",
ADD COLUMN "sourceCharacter" "SourceCharacter";

ALTER TABLE "LegalSourceVersion" ADD COLUMN "legalExpressionVersionId" TEXT;

-- CreateTable
CREATE TABLE "LegalExpressionVersion" (
    "id" TEXT NOT NULL,
    "sourceFamilyId" TEXT NOT NULL,
    "expressionKey" TEXT NOT NULL,
    "publicationDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "expressionStatus" TEXT,
    "correctionMetadata" JSONB,
    "consolidationMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalExpressionVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_expression_version_key_ck" CHECK ("expressionKey" ~ '[^[:space:]]'),
    CONSTRAINT "legal_expression_version_temporal_ck" CHECK (
        "effectiveTo" IS NULL
        OR "effectiveFrom" IS NULL
        OR "effectiveTo" >= "effectiveFrom"
    )
);

CREATE TABLE "LegalSourceIdentityAssertion" (
    "id" TEXT NOT NULL,
    "sourceFamilyId" TEXT NOT NULL,
    "identifierScheme" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "jurisdiction" TEXT,
    "verificationStatus" "LegalSourceIdentityVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "provenanceReference" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceIdentityAssertion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_source_identity_assertion_required_text_ck" CHECK (
        "identifierScheme" ~ '[^[:space:]]'
        AND "normalizedValue" ~ '[^[:space:]]'
        AND "provenanceReference" ~ '[^[:space:]]'
    )
);

-- CreateIndex
CREATE INDEX "LegalSource_resourceSemanticType_idx" ON "LegalSource"("resourceSemanticType");
CREATE INDEX "LegalSource_legalAuthorityKind_idx" ON "LegalSource"("legalAuthorityKind");
CREATE INDEX "LegalSource_sourceCharacter_idx" ON "LegalSource"("sourceCharacter");
CREATE UNIQUE INDEX "LegalExpressionVersion_sourceFamilyId_expressionKey_key" ON "LegalExpressionVersion"("sourceFamilyId", "expressionKey");
CREATE UNIQUE INDEX "LegalExpressionVersion_id_sourceFamilyId_key" ON "LegalExpressionVersion"("id", "sourceFamilyId");
CREATE INDEX "LegalExpressionVersion_sourceFamilyId_effectiveFrom_idx" ON "LegalExpressionVersion"("sourceFamilyId", "effectiveFrom");
CREATE INDEX "LegalExpressionVersion_effectiveTo_idx" ON "LegalExpressionVersion"("effectiveTo");
CREATE INDEX "LegalSourceVersion_legalExpressionVersionId_idx" ON "LegalSourceVersion"("legalExpressionVersionId");
CREATE INDEX "LegalSourceIdentityAssertion_sourceFamilyId_identifierScheme_normalizedValue_idx" ON "LegalSourceIdentityAssertion"("sourceFamilyId", "identifierScheme", "normalizedValue");
CREATE INDEX "LegalSourceIdentityAssertion_identifierScheme_normalizedValue_idx" ON "LegalSourceIdentityAssertion"("identifierScheme", "normalizedValue");
CREATE INDEX "LegalSourceIdentityAssertion_verificationStatus_idx" ON "LegalSourceIdentityAssertion"("verificationStatus");

-- AddForeignKey
ALTER TABLE "LegalExpressionVersion" ADD CONSTRAINT "LegalExpressionVersion_sourceFamilyId_fkey" FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalSourceVersion" ADD CONSTRAINT "LegalSourceVersion_legalExpressionVersionId_sourceFamilyId_fkey" FOREIGN KEY ("legalExpressionVersionId", "sourceFamilyId") REFERENCES "LegalExpressionVersion"("id", "sourceFamilyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalSourceIdentityAssertion" ADD CONSTRAINT "LegalSourceIdentityAssertion_sourceFamilyId_fkey" FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Expression identity guard: identity is id + sourceFamilyId + expressionKey.
CREATE FUNCTION "protect_legal_expression_version_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."sourceFamilyId" IS DISTINCT FROM OLD."sourceFamilyId"
        OR NEW."expressionKey" IS DISTINCT FROM OLD."expressionKey"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
        RAISE EXCEPTION 'LegalExpressionVersion identity fields are immutable';
    END IF;

    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "legal_expression_version_protect_identity"
BEFORE UPDATE ON "LegalExpressionVersion"
FOR EACH ROW EXECUTE FUNCTION "protect_legal_expression_version_identity"();
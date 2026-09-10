-- CreateEnum
CREATE TYPE "LegalSourceIdentityScopeKind" AS ENUM ('GLOBAL', 'TENANT');
CREATE TYPE "LegalSourceVersionLifecycleStatus" AS ENUM ('CURRENT', 'CURRENT_SUBJECT_TO_REVIEW', 'PENDING_VALIDITY_CHECK', 'HISTORICAL', 'SUPERSEDED', 'PARTIALLY_SUPERSEDED', 'DRAFT_OR_ONGOING_PROCEDURE', 'CASE_SPECIFIC');
CREATE TYPE "LegalSourceAcquisitionOutcome" AS ENUM ('ACQUIRED', 'MISSING', 'INTEGRITY_MISMATCH', 'FAILED');

-- AlterTable
ALTER TABLE "LegalSource"
ADD COLUMN "identityNamespace" TEXT,
ADD COLUMN "identityScopeKind" "LegalSourceIdentityScopeKind",
ADD COLUMN "identityScopeKey" TEXT,
ADD COLUMN "canonicalKey" TEXT;

ALTER TABLE "NormaFonte" ADD COLUMN "legalSourceId" TEXT;
ALTER TABLE "NormaVersione" ADD COLUMN "legalSourceVersionId" TEXT;

-- CreateTable
CREATE TABLE "LegalSourceVersion" (
    "id" TEXT NOT NULL,
    "sourceFamilyId" TEXT NOT NULL,
    "observedSha256" CHAR(64) NOT NULL,
    "observedSizeBytes" INTEGER NOT NULL,
    "observedMimeType" TEXT NOT NULL,
    "versionLabel" TEXT,
    "publicationDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "legalLifecycleStatus" "LegalSourceVersionLifecycleStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSourceVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_source_version_sha256_ck" CHECK ("observedSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "legal_source_version_size_ck" CHECK ("observedSizeBytes" > 0),
    CONSTRAINT "legal_source_version_mime_ck" CHECK ("observedMimeType" ~ '[^[:space:]]'),
    CONSTRAINT "legal_source_version_temporal_ck" CHECK (
        "effectiveTo" IS NULL
        OR "effectiveFrom" IS NULL
        OR "effectiveTo" >= "effectiveFrom"
    )
);

CREATE TABLE "LegalSourceAcquisition" (
    "id" TEXT NOT NULL,
    "sourceFamilyId" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "outcome" "LegalSourceAcquisitionOutcome" NOT NULL,
    "originClass" TEXT NOT NULL,
    "providerOrChannel" TEXT NOT NULL,
    "originalUrl" TEXT,
    "externalSourceId" TEXT,
    "artifactLocator" TEXT,
    "originalFilename" TEXT,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "observedSha256" CHAR(64),
    "declaredSha256" CHAR(64),
    "observedSizeBytes" INTEGER,
    "declaredSizeBytes" INTEGER,
    "observedMimeType" TEXT,
    "importRunId" TEXT,
    "acquiredByActorId" TEXT,
    "acquiredByProcess" TEXT,
    "transformationType" TEXT,
    "transformationVersion" TEXT,
    "transformedContentSha256" CHAR(64),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalSourceAcquisition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_source_acquisition_required_text_ck" CHECK (
        "originClass" ~ '[^[:space:]]'
        AND "providerOrChannel" ~ '[^[:space:]]'
    ),
    CONSTRAINT "legal_source_acquisition_actor_process_ck" CHECK (
        COALESCE("acquiredByActorId" ~ '[^[:space:]]', false)
        OR COALESCE("acquiredByProcess" ~ '[^[:space:]]', false)
    ),
    CONSTRAINT "legal_source_acquisition_hashes_ck" CHECK (
        ("observedSha256" IS NULL OR "observedSha256" ~ '^[0-9a-f]{64}$')
        AND ("declaredSha256" IS NULL OR "declaredSha256" ~ '^[0-9a-f]{64}$')
        AND ("transformedContentSha256" IS NULL OR "transformedContentSha256" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "legal_source_acquisition_sizes_ck" CHECK (
        ("observedSizeBytes" IS NULL OR "observedSizeBytes" > 0)
        AND ("declaredSizeBytes" IS NULL OR "declaredSizeBytes" > 0)
    ),
    CONSTRAINT "legal_source_acquisition_outcome_ck" CHECK (
        (
            "outcome" = 'ACQUIRED'
            AND "sourceVersionId" IS NOT NULL
            AND "artifactLocator" IS NOT NULL
            AND "artifactLocator" ~ '[^[:space:]]'
            AND "observedSha256" IS NOT NULL
            AND "observedSizeBytes" > 0
            AND "observedMimeType" IS NOT NULL
            AND "observedMimeType" ~ '[^[:space:]]'
        )
        OR (
            "outcome" = 'MISSING'
            AND "sourceVersionId" IS NULL
            AND "observedSha256" IS NULL
            AND "observedSizeBytes" IS NULL
            AND "observedMimeType" IS NULL
        )
        OR (
            "outcome" = 'INTEGRITY_MISMATCH'
            AND "sourceVersionId" IS NULL
            AND "observedSha256" IS NOT NULL
            AND "declaredSha256" IS NOT NULL
            AND "observedSha256" <> "declaredSha256"
        )
        OR (
            "outcome" = 'FAILED'
            AND "sourceVersionId" IS NULL
            AND "failureCode" IS NOT NULL
            AND "failureCode" ~ '[^[:space:]]'
        )
    )
);

-- AddCheckConstraint
ALTER TABLE "LegalSource"
ADD CONSTRAINT "legal_source_canonical_identity_ck"
CHECK (
    (
        "identityNamespace" IS NULL
        AND "identityScopeKind" IS NULL
        AND "identityScopeKey" IS NULL
        AND "canonicalKey" IS NULL
    )
    OR (
        "identityNamespace" IS NOT NULL
        AND "identityScopeKind" IS NOT NULL
        AND "identityScopeKey" IS NOT NULL
        AND "canonicalKey" IS NOT NULL
        AND "identityNamespace" ~ '[^[:space:]]'
        AND "identityScopeKey" ~ '[^[:space:]]'
        AND "canonicalKey" ~ '[^[:space:]]'
        AND (
            (
                "identityScopeKind" = 'GLOBAL'
                AND "enteId" IS NULL
                AND "identityScopeKey" = 'GLOBAL'
            )
            OR (
                "identityScopeKind" = 'TENANT'
                AND "enteId" IS NOT NULL
                AND "identityScopeKey" = 'TENANT:' || "enteId"
            )
        )
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalSource_identityNamespace_identityScopeKey_canonicalKey_key" ON "LegalSource"("identityNamespace", "identityScopeKey", "canonicalKey");
CREATE UNIQUE INDEX "LegalSourceVersion_sourceFamilyId_observedSha256_key" ON "LegalSourceVersion"("sourceFamilyId", "observedSha256");
CREATE UNIQUE INDEX "LegalSourceVersion_id_sourceFamilyId_key" ON "LegalSourceVersion"("id", "sourceFamilyId");
CREATE UNIQUE INDEX "LegalSourceVersion_id_sourceFamilyId_observedSha256_key" ON "LegalSourceVersion"("id", "sourceFamilyId", "observedSha256");
CREATE INDEX "LegalSourceVersion_sourceFamilyId_legalLifecycleStatus_idx" ON "LegalSourceVersion"("sourceFamilyId", "legalLifecycleStatus");
CREATE INDEX "LegalSourceVersion_effectiveFrom_idx" ON "LegalSourceVersion"("effectiveFrom");
CREATE INDEX "LegalSourceVersion_effectiveTo_idx" ON "LegalSourceVersion"("effectiveTo");
CREATE INDEX "LegalSourceAcquisition_sourceFamilyId_acquiredAt_idx" ON "LegalSourceAcquisition"("sourceFamilyId", "acquiredAt");
CREATE INDEX "LegalSourceAcquisition_sourceVersionId_idx" ON "LegalSourceAcquisition"("sourceVersionId");
CREATE INDEX "LegalSourceAcquisition_importRunId_idx" ON "LegalSourceAcquisition"("importRunId");
CREATE INDEX "LegalSourceAcquisition_outcome_acquiredAt_idx" ON "LegalSourceAcquisition"("outcome", "acquiredAt");
CREATE INDEX "NormaFonte_legalSourceId_idx" ON "NormaFonte"("legalSourceId");
CREATE INDEX "NormaVersione_legalSourceVersionId_idx" ON "NormaVersione"("legalSourceVersionId");

-- AddForeignKey
ALTER TABLE "LegalSourceVersion" ADD CONSTRAINT "LegalSourceVersion_sourceFamilyId_fkey" FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalSourceAcquisition" ADD CONSTRAINT "LegalSourceAcquisition_sourceFamilyId_fkey" FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalSourceAcquisition" ADD CONSTRAINT "LegalSourceAcquisition_sourceVersionId_sourceFamilyId_observedSha256_fkey" FOREIGN KEY ("sourceVersionId", "sourceFamilyId", "observedSha256") REFERENCES "LegalSourceVersion"("id", "sourceFamilyId", "observedSha256") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalSourceAcquisition" ADD CONSTRAINT "LegalSourceAcquisition_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormaFonte" ADD CONSTRAINT "NormaFonte_legalSourceId_fkey" FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormaVersione" ADD CONSTRAINT "NormaVersione_legalSourceVersionId_fkey" FOREIGN KEY ("legalSourceVersionId") REFERENCES "LegalSourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Selective content-identity update guard
CREATE FUNCTION "protect_legal_source_version_content_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."sourceFamilyId" IS DISTINCT FROM OLD."sourceFamilyId"
        OR NEW."observedSha256" IS DISTINCT FROM OLD."observedSha256"
        OR NEW."observedSizeBytes" IS DISTINCT FROM OLD."observedSizeBytes"
        OR NEW."observedMimeType" IS DISTINCT FROM OLD."observedMimeType"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
        RAISE EXCEPTION 'LegalSourceVersion content identity fields are immutable';
    END IF;

    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "legal_source_version_protect_content_identity"
BEFORE UPDATE ON "LegalSourceVersion"
FOR EACH ROW EXECUTE FUNCTION "protect_legal_source_version_content_identity"();

-- Version delete guard
CREATE FUNCTION "reject_legal_source_version_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'LegalSourceVersion rows cannot be deleted';
END;
$$;

CREATE TRIGGER "legal_source_version_reject_delete"
BEFORE DELETE ON "LegalSourceVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_source_version_delete"();

-- Acquisition append-only guard
CREATE FUNCTION "reject_legal_source_acquisition_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'LegalSourceAcquisition rows are immutable';
END;
$$;

CREATE TRIGGER "legal_source_acquisition_reject_update"
BEFORE UPDATE ON "LegalSourceAcquisition"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_source_acquisition_mutation"();

CREATE TRIGGER "legal_source_acquisition_reject_delete"
BEFORE DELETE ON "LegalSourceAcquisition"
FOR EACH ROW EXECUTE FUNCTION "reject_legal_source_acquisition_mutation"();

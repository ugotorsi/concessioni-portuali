-- Permit pre-canonical acquisitions and add tenant-safe deterministic identity.
ALTER TABLE "LegalSourceAcquisition"
DROP CONSTRAINT "LegalSourceAcquisition_sourceFamilyId_fkey",
DROP CONSTRAINT "legal_source_acquisition_outcome_ck",
ALTER COLUMN "sourceFamilyId" DROP NOT NULL,
ADD COLUMN "enteId" TEXT,
ADD COLUMN "idempotencyKey" CHAR(64) NOT NULL;

ALTER TABLE "LegalSourceAcquisition"
ADD CONSTRAINT "LegalSourceAcquisition_sourceFamilyId_fkey"
FOREIGN KEY ("sourceFamilyId") REFERENCES "LegalSource"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "LegalSourceAcquisition_enteId_fkey"
FOREIGN KEY ("enteId") REFERENCES "Ente"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "legal_source_acquisition_source_version_requires_family_ck"
CHECK ("sourceVersionId" IS NULL OR "sourceFamilyId" IS NOT NULL),
ADD CONSTRAINT "legal_source_acquisition_idempotency_key_ck"
CHECK ("idempotencyKey" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "legal_source_acquisition_outcome_ck" CHECK (
    (
        "outcome" = 'ACQUIRED'
        AND "sourceFamilyId" IS NOT NULL
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
        AND "sourceFamilyId" IS NOT NULL
        AND "sourceVersionId" IS NULL
        AND "observedSha256" IS NULL
        AND "observedSizeBytes" IS NULL
        AND "observedMimeType" IS NULL
    )
    OR (
        "outcome" = 'INTEGRITY_MISMATCH'
        AND "sourceFamilyId" IS NOT NULL
        AND "sourceVersionId" IS NULL
        AND "observedSha256" IS NOT NULL
        AND "declaredSha256" IS NOT NULL
        AND "observedSha256" <> "declaredSha256"
    )
    OR (
        "outcome" = 'FAILED'
        AND "sourceFamilyId" IS NOT NULL
        AND "sourceVersionId" IS NULL
        AND "failureCode" IS NOT NULL
        AND "failureCode" ~ '[^[:space:]]'
    )
    OR (
        "outcome" = 'PENDING_IDENTITY'
        AND "sourceFamilyId" IS NULL
        AND "sourceVersionId" IS NULL
        AND "failureCode" IS NULL
        AND (
            COALESCE("originalUrl" ~ '[^[:space:]]', false)
            OR COALESCE("externalSourceId" ~ '[^[:space:]]', false)
            OR COALESCE("artifactLocator" ~ '[^[:space:]]', false)
        )
    )
),
ADD CONSTRAINT "legal_source_acquisition_local_pack_pending_ck" CHECK (
    "outcome" <> 'PENDING_IDENTITY'
    OR "providerOrChannel" <> 'LOCAL_PACK_ENTRY'
    OR (
        "originClass" = 'LOCAL_DOMAIN_DOCUMENT'
        AND "enteId" IS NOT NULL
        AND "importRunId" IS NOT NULL
        AND "externalSourceId" IS NOT NULL
        AND "externalSourceId" ~ '[^[:space:]]'
        AND "artifactLocator" IS NOT NULL
        AND "artifactLocator" ~ '[^[:space:]]'
        AND "originalFilename" IS NOT NULL
        AND "originalFilename" ~ '[^[:space:]]'
        AND "observedSha256" IS NOT NULL
        AND "declaredSha256" IS NOT NULL
        AND "observedSha256" = "declaredSha256"
        AND "observedSizeBytes" IS NOT NULL
        AND "declaredSizeBytes" IS NOT NULL
        AND "observedSizeBytes" > 0
        AND "declaredSizeBytes" > 0
        AND "observedSizeBytes" = "declaredSizeBytes"
        AND "observedMimeType" IS NOT NULL
        AND "observedMimeType" ~ '[^[:space:]]'
        AND "failureCode" IS NULL
    )
);

CREATE UNIQUE INDEX "LegalSourceAcquisition_idempotencyKey_key"
ON "LegalSourceAcquisition"("idempotencyKey");

CREATE INDEX "LegalSourceAcquisition_enteId_outcome_acquiredAt_idx"
ON "LegalSourceAcquisition"("enteId", "outcome", "acquiredAt");
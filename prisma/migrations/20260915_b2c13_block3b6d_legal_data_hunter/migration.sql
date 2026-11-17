ALTER TABLE "LegalReferenceOfficialHit"
ALTER COLUMN "denominazioneAtto" DROP NOT NULL,
ALTER COLUMN "numeroProvvedimento" DROP NOT NULL,
ALTER COLUMN "annoProvvedimento" DROP NOT NULL,
ADD COLUMN "documentKind" VARCHAR(20) NOT NULL DEFAULT 'LEGISLATION',
ADD COLUMN "providerSourceId" VARCHAR(200) NOT NULL DEFAULT 'NORMATTIVA_OPENDATA_V1',
ADD COLUMN "authority" VARCHAR(200),
ADD COLUMN "court" VARCHAR(200),
ADD COLUMN "decisionNumber" VARCHAR(100),
ADD COLUMN "decisionYear" INTEGER,
ADD COLUMN "decisionDate" TIMESTAMP(3),
ADD COLUMN "chamberSection" VARCHAR(100),
ADD COLUMN "decisionType" VARCHAR(100),
ADD COLUMN "sourceUrl" VARCHAR(2000);

ALTER TABLE "LegalReferenceOfficialHit"
ALTER COLUMN "documentKind" DROP DEFAULT,
ALTER COLUMN "providerSourceId" DROP DEFAULT;

DROP INDEX "LegalReferenceOfficialHit_lookupId_providerRecordId_key";

CREATE UNIQUE INDEX "LegalReferenceOfficialHit_lookupId_providerSourceId_providerRecordId_key"
ON "LegalReferenceOfficialHit"("lookupId", "providerSourceId", "providerRecordId");

ALTER TABLE "LegalReferenceOfficialHit"
ADD CONSTRAINT "legal_reference_official_hit_identity_ck" CHECK (
    (
        "documentKind" = 'LEGISLATION'
        AND "denominazioneAtto" IS NOT NULL
        AND "numeroProvvedimento" IS NOT NULL
        AND "annoProvvedimento" IS NOT NULL
        AND "authority" IS NULL
        AND "decisionNumber" IS NULL
        AND "decisionYear" IS NULL
    )
    OR
    (
        "documentKind" = 'CASE_LAW'
        AND "authority" IS NOT NULL
        AND "decisionNumber" IS NOT NULL
        AND "decisionYear" IS NOT NULL
        AND "denominazioneAtto" IS NULL
        AND "numeroProvvedimento" IS NULL
        AND "annoProvvedimento" IS NULL
    )
);

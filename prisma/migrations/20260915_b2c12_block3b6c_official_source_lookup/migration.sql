-- CreateEnum
CREATE TYPE "LegalReferenceOfficialLookupStatus" AS ENUM ('NOT_FOUND', 'FOUND_UNIQUE', 'AMBIGUOUS');

-- CreateTable
CREATE TABLE "LegalReferenceOfficialLookup" (
    "id" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "lookupVersion" VARCHAR(100) NOT NULL,
    "status" "LegalReferenceOfficialLookupStatus" NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalReferenceOfficialLookup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_reference_official_lookup_count_ck" CHECK (
        ("status" = 'NOT_FOUND' AND "resultCount" = 0)
        OR ("status" = 'FOUND_UNIQUE' AND "resultCount" = 1)
        OR ("status" = 'AMBIGUOUS' AND "resultCount" > 1)
    )
);

-- CreateTable
CREATE TABLE "LegalReferenceOfficialHit" (
    "id" TEXT NOT NULL,
    "lookupId" TEXT NOT NULL,
    "providerRecordId" VARCHAR(200) NOT NULL,
    "denominazioneAtto" VARCHAR(200) NOT NULL,
    "numeroProvvedimento" VARCHAR(100) NOT NULL,
    "annoProvvedimento" INTEGER NOT NULL,
    "dataEmanazione" TIMESTAMP(3),
    "descrizioneAtto" VARCHAR(500),
    "titoloAtto" VARCHAR(500),
    "numeroGU" VARCHAR(100),
    "dataGU" TIMESTAMP(3),

    CONSTRAINT "LegalReferenceOfficialHit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalReferenceOfficialLookup_mentionId_provider_lookupVersion_key"
ON "LegalReferenceOfficialLookup"("mentionId", "provider", "lookupVersion");

CREATE INDEX "LegalReferenceOfficialLookup_status_completedAt_idx"
ON "LegalReferenceOfficialLookup"("status", "completedAt");

CREATE UNIQUE INDEX "LegalReferenceOfficialHit_lookupId_providerRecordId_key"
ON "LegalReferenceOfficialHit"("lookupId", "providerRecordId");

CREATE INDEX "LegalReferenceOfficialHit_providerRecordId_idx"
ON "LegalReferenceOfficialHit"("providerRecordId");

ALTER TABLE "LegalReferenceOfficialLookup"
ADD CONSTRAINT "LegalReferenceOfficialLookup_mentionId_fkey"
FOREIGN KEY ("mentionId") REFERENCES "LegalReferenceMention"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceOfficialHit"
ADD CONSTRAINT "LegalReferenceOfficialHit_lookupId_fkey"
FOREIGN KEY ("lookupId") REFERENCES "LegalReferenceOfficialLookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
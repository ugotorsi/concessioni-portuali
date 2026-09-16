ALTER TYPE "LegalSourceStatus" ADD VALUE 'IDENTITY_VERIFIED_PENDING_VALIDITY';

ALTER TABLE "LegalReferenceOfficialHit"
ADD COLUMN "ecli" VARCHAR(200),
ADD COLUMN "publicationDate" TIMESTAMP(3),
ADD COLUMN "subject" VARCHAR(500),
ADD COLUMN "outcome" VARCHAR(500);

CREATE UNIQUE INDEX "LegalSourceIdentityAssertion_sourceFamilyId_identifierScheme_normalizedValue_key"
ON "LegalSourceIdentityAssertion"("sourceFamilyId", "identifierScheme", "normalizedValue");

CREATE TYPE "LegalReferenceOfficialReconciliationState" AS ENUM (
    'INCOMPLETE',
    'PENDING_REVIEW',
    'CONFLICTED',
    'LINKED_EXISTING',
    'ACCEPTED_NEW',
    'REJECTED'
);

CREATE TYPE "LegalReferenceOfficialEvidenceClassification" AS ENUM (
    'OFFICIAL_AUTHORITY',
    'COMMERCIAL_CORROBORATION'
);

CREATE TYPE "LegalReferenceOfficialEvidenceDisposition" AS ENUM (
    'COMPATIBLE',
    'CONFLICTING',
    'INCOMPLETE',
    'RECORDED_AFTER_TERMINAL'
);

CREATE TABLE "LegalReferenceOfficialReconciliation" (
    "id" TEXT NOT NULL,
    "mentionId" TEXT NOT NULL,
    "kind" "LegalReferenceKind" NOT NULL,
    "jurisdiction" VARCHAR(100),
    "courtFamily" VARCHAR(200),
    "courtLocality" VARCHAR(200),
    "courtBranch" VARCHAR(100),
    "decisionType" VARCHAR(100),
    "decisionNumber" VARCHAR(100),
    "decisionYear" INTEGER,
    "section" VARCHAR(100),
    "ecli" VARCHAR(200),
    "decisionDate" TIMESTAMP(3),
    "publicationDate" TIMESTAMP(3),
    "identityVersion" VARCHAR(100) NOT NULL,
    "normalizedIdentity" JSONB NOT NULL,
    "identityFingerprint" CHAR(64),
    "policyVersion" VARCHAR(100) NOT NULL,
    "state" "LegalReferenceOfficialReconciliationState" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "legalSourceId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedByActorId" VARCHAR(256),
    "reviewedByEmail" VARCHAR(320),
    "reviewedByRole" VARCHAR(100),
    "reviewNote" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalReferenceOfficialReconciliation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_reference_official_reconciliation_revision_ck" CHECK ("revision" >= 0),
    CONSTRAINT "legal_reference_official_reconciliation_payload_ck" CHECK (jsonb_typeof("normalizedIdentity") = 'object'),
    CONSTRAINT "legal_reference_official_reconciliation_identity_ck" CHECK (
        ("state" = 'INCOMPLETE' AND "identityFingerprint" IS NULL)
        OR
        ("state" IN ('PENDING_REVIEW', 'LINKED_EXISTING', 'ACCEPTED_NEW') AND "identityFingerprint" ~ '^[0-9a-f]{64}$')
        OR
        ("state" IN ('CONFLICTED', 'REJECTED') AND ("identityFingerprint" IS NULL OR "identityFingerprint" ~ '^[0-9a-f]{64}$'))
    ),
    CONSTRAINT "legal_reference_official_reconciliation_source_ck" CHECK (
        ("state" IN ('LINKED_EXISTING', 'ACCEPTED_NEW') AND "legalSourceId" IS NOT NULL)
        OR
        ("state" = 'CONFLICTED')
        OR
        ("state" NOT IN ('LINKED_EXISTING', 'ACCEPTED_NEW', 'CONFLICTED') AND "legalSourceId" IS NULL)
    ),
    CONSTRAINT "legal_reference_official_reconciliation_reviewer_ck" CHECK (
        (
            "reviewedAt" IS NULL
            AND "reviewedByActorId" IS NULL
            AND "reviewedByEmail" IS NULL
            AND "reviewedByRole" IS NULL
            AND "reviewedByUserId" IS NULL
            AND "reviewNote" IS NULL
            AND "state" NOT IN ('ACCEPTED_NEW', 'REJECTED')
        )
        OR
        (
            "reviewedAt" IS NOT NULL
            AND "reviewedByActorId" IS NOT NULL
            AND "reviewedByEmail" IS NOT NULL
            AND "reviewedByRole" IS NOT NULL
            AND "state" IN ('LINKED_EXISTING', 'ACCEPTED_NEW', 'REJECTED', 'CONFLICTED')
        )
    )
);

CREATE TABLE "LegalReferenceOfficialReconciliationEvidence" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "officialHitId" TEXT NOT NULL,
    "identityVersion" VARCHAR(100) NOT NULL,
    "evidenceFingerprint" CHAR(64) NOT NULL,
    "classification" "LegalReferenceOfficialEvidenceClassification" NOT NULL,
    "disposition" "LegalReferenceOfficialEvidenceDisposition" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalReferenceOfficialReconciliationEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_reference_official_reconciliation_evidence_fingerprint_ck"
        CHECK ("evidenceFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "LegalReferenceOfficialReconciliation_mentionId_identityVersion_key"
ON "LegalReferenceOfficialReconciliation"("mentionId", "identityVersion");

CREATE UNIQUE INDEX "LegalReferenceOfficialReconciliation_id_identityVersion_key"
ON "LegalReferenceOfficialReconciliation"("id", "identityVersion");

CREATE INDEX "LegalReferenceOfficialReconciliation_identityVersion_identityFingerprint_idx"
ON "LegalReferenceOfficialReconciliation"("identityVersion", "identityFingerprint");

CREATE INDEX "LegalReferenceOfficialReconciliation_state_updatedAt_idx"
ON "LegalReferenceOfficialReconciliation"("state", "updatedAt");

CREATE INDEX "LegalReferenceOfficialReconciliation_legalSourceId_idx"
ON "LegalReferenceOfficialReconciliation"("legalSourceId");

CREATE INDEX "LegalReferenceOfficialReconciliation_reviewedByUserId_idx"
ON "LegalReferenceOfficialReconciliation"("reviewedByUserId");

CREATE UNIQUE INDEX "LegalReferenceOfficialReconciliationEvidence_officialHitId_identityVersion_key"
ON "LegalReferenceOfficialReconciliationEvidence"("officialHitId", "identityVersion");

CREATE INDEX "LegalReferenceOfficialReconciliationEvidence_reconciliationId_createdAt_idx"
ON "LegalReferenceOfficialReconciliationEvidence"("reconciliationId", "createdAt");

CREATE INDEX "LegalReferenceOfficialReconciliationEvidence_classification_disposition_idx"
ON "LegalReferenceOfficialReconciliationEvidence"("classification", "disposition");

ALTER TABLE "LegalReferenceOfficialReconciliation"
ADD CONSTRAINT "LegalReferenceOfficialReconciliation_mentionId_fkey"
FOREIGN KEY ("mentionId") REFERENCES "LegalReferenceMention"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceOfficialReconciliation"
ADD CONSTRAINT "LegalReferenceOfficialReconciliation_legalSourceId_fkey"
FOREIGN KEY ("legalSourceId") REFERENCES "LegalSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceOfficialReconciliation"
ADD CONSTRAINT "LegalReferenceOfficialReconciliation_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceOfficialReconciliationEvidence"
ADD CONSTRAINT "LegalReferenceOfficialReconciliationEvidence_reconciliationId_fkey"
FOREIGN KEY ("reconciliationId", "identityVersion")
REFERENCES "LegalReferenceOfficialReconciliation"("id", "identityVersion") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegalReferenceOfficialReconciliationEvidence"
ADD CONSTRAINT "LegalReferenceOfficialReconciliationEvidence_officialHitId_fkey"
FOREIGN KEY ("officialHitId") REFERENCES "LegalReferenceOfficialHit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
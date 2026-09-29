-- CreateTable
CREATE TABLE "ResearchAssistedVerificationRecord" (
    "id" VARCHAR(96) NOT NULL,
    "missionId" VARCHAR(96) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractVersion" VARCHAR(64) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "recordedByActorId" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchAssistedVerificationRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "research_assisted_verification_hash_ck" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "research_assisted_verification_text_ck" CHECK (
        "id" ~ '[^[:space:]]'
        AND "missionId" ~ '[^[:space:]]'
        AND "contractVersion" ~ '[^[:space:]]'
        AND "recordedByActorId" ~ '[^[:space:]]'
    ),
    CONSTRAINT "research_assisted_verification_payload_size_ck" CHECK (
        octet_length("payload"::text) <= 1048576
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "research_assisted_verification_fingerprint_uq"
ON "ResearchAssistedVerificationRecord"("fingerprint");

CREATE UNIQUE INDEX "research_mission_tenant_uq"
ON "ResearchMissionRecord"("id", "tenantId");

CREATE INDEX "research_assisted_verification_tenant_mission_idx"
ON "ResearchAssistedVerificationRecord"("tenantId", "missionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ResearchAssistedVerificationRecord"
ADD CONSTRAINT "research_assisted_verification_mission_tenant_fk"
FOREIGN KEY ("missionId", "tenantId") REFERENCES "ResearchMissionRecord"("id", "tenantId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResearchAssistedVerificationRecord"
ADD CONSTRAINT "research_assisted_verification_tenant_fk"
FOREIGN KEY ("tenantId") REFERENCES "Ente"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assisted verification snapshots are append-only audit evidence.
CREATE FUNCTION "reject_research_assisted_verification_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Research assisted verification snapshots are append-only';
END;
$$;

CREATE TRIGGER "research_assisted_verification_update_trg"
BEFORE UPDATE ON "ResearchAssistedVerificationRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_research_assisted_verification_mutation"();

CREATE TRIGGER "research_assisted_verification_delete_trg"
BEFORE DELETE ON "ResearchAssistedVerificationRecord"
FOR EACH ROW EXECUTE FUNCTION "reject_research_assisted_verification_mutation"();
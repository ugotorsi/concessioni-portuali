CREATE TABLE "HistoricalActivityLogArchiveManifest" (
  "id" TEXT NOT NULL,
  "sourceDatabaseFingerprint" TEXT NOT NULL,
  "sourceProjectId" TEXT NOT NULL,
  "sourceBranchId" TEXT NOT NULL,
  "sourceBackupBranchId" TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "firstRecordId" TEXT,
  "finalRecordId" TEXT,
  "finalHash" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "verificationMode" TEXT NOT NULL,
  "payloadHashVerifiedCount" INTEGER NOT NULL,
  "payloadHashIssueCode" TEXT,
  "payloadHashIssueRecordId" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoricalActivityLogArchiveManifest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HistoricalActivityLogArchiveManifest_record_count_check" CHECK ("recordCount" >= 0),
  CONSTRAINT "HistoricalActivityLogArchiveManifest_verified_count_check"
    CHECK ("payloadHashVerifiedCount" >= 0 AND "payloadHashVerifiedCount" <= "recordCount"),
  CONSTRAINT "HistoricalActivityLogArchiveManifest_verification_mode_check"
    CHECK ("verificationMode" IN ('FULL_PAYLOAD_HASH', 'CHAIN_LINKS_AND_CONTENT_SHA256'))
);

CREATE TABLE "HistoricalActivityLogArchiveRecord" (
  "archiveId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "originalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "previousHash" TEXT,
  "currentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "HistoricalActivityLogArchiveRecord_pkey" PRIMARY KEY ("archiveId", "ordinal"),
  CONSTRAINT "HistoricalActivityLogArchiveRecord_original_id_key"
    UNIQUE ("archiveId", "originalId"),
  CONSTRAINT "HistoricalActivityLogArchiveRecord_ordinal_check" CHECK ("ordinal" > 0),
  CONSTRAINT "HistoricalActivityLogArchiveRecord_archive_fkey"
    FOREIGN KEY ("archiveId") REFERENCES "HistoricalActivityLogArchiveManifest"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION "protect_historical_activity_log_archive"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Historical ActivityLog archive is immutable';
END;
$$;

CREATE TRIGGER "historical_activity_log_archive_manifest_immutable"
BEFORE UPDATE OR DELETE ON "HistoricalActivityLogArchiveManifest"
FOR EACH ROW EXECUTE FUNCTION "protect_historical_activity_log_archive"();

CREATE TRIGGER "historical_activity_log_archive_record_immutable"
BEFORE UPDATE OR DELETE ON "HistoricalActivityLogArchiveRecord"
FOR EACH ROW EXECUTE FUNCTION "protect_historical_activity_log_archive"();

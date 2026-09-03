-- CreateTable
CREATE TABLE "DocumentFileVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "canonicalEnteId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageBucket" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdByUserId" TEXT,
    "createdByActorId" TEXT NOT NULL,
    "createdByRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFileVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_file_version_required_text_ck" CHECK (
        "documentId" ~ '[^[:space:]]'
        AND "canonicalEnteId" ~ '[^[:space:]]'
        AND "storageProvider" ~ '[^[:space:]]'
        AND "storageKey" ~ '[^[:space:]]'
        AND "mimeType" ~ '[^[:space:]]'
        AND "createdByActorId" ~ '[^[:space:]]'
        AND "createdByRole" ~ '[^[:space:]]'
    ),
    CONSTRAINT "document_file_version_provider_ck" CHECK ("storageProvider" IN ('local', 's3')),
    CONSTRAINT "document_file_version_sha256_ck" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "document_file_version_size_ck" CHECK ("sizeBytes" > 0)
);

-- AlterTable
ALTER TABLE "Documento" ADD COLUMN "currentFileVersionId" TEXT;

-- Current pointers require a canonical tenant so the composite foreign key cannot be bypassed by NULL.
ALTER TABLE "Documento"
ADD CONSTRAINT "documento_current_file_version_tenant_ck"
CHECK ("currentFileVersionId" IS NULL OR "enteId" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFileVersion_documentId_sha256_key" ON "DocumentFileVersion"("documentId", "sha256");
CREATE UNIQUE INDEX "DocumentFileVersion_storageProvider_storageKey_key" ON "DocumentFileVersion"("storageProvider", "storageKey");
CREATE UNIQUE INDEX "DocumentFileVersion_id_documentId_canonicalEnteId_key" ON "DocumentFileVersion"("id", "documentId", "canonicalEnteId");
CREATE INDEX "DocumentFileVersion_canonicalEnteId_documentId_createdAt_idx" ON "DocumentFileVersion"("canonicalEnteId", "documentId", "createdAt");
CREATE INDEX "DocumentFileVersion_createdByUserId_idx" ON "DocumentFileVersion"("createdByUserId");
CREATE UNIQUE INDEX "Documento_currentFileVersionId_key" ON "Documento"("currentFileVersionId");
CREATE UNIQUE INDEX "Documento_currentFileVersionId_id_enteId_key" ON "Documento"("currentFileVersionId", "id", "enteId");

-- AddForeignKey
ALTER TABLE "DocumentFileVersion" ADD CONSTRAINT "DocumentFileVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentFileVersion" ADD CONSTRAINT "DocumentFileVersion_canonicalEnteId_fkey" FOREIGN KEY ("canonicalEnteId") REFERENCES "Ente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentFileVersion" ADD CONSTRAINT "DocumentFileVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_currentFileVersion_fkey" FOREIGN KEY ("currentFileVersionId", "id", "enteId") REFERENCES "DocumentFileVersion"("id", "documentId", "canonicalEnteId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Append-only guard
CREATE FUNCTION "reject_document_file_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'DocumentFileVersion rows are immutable';
END;
$$;

CREATE TRIGGER "document_file_version_reject_update"
BEFORE UPDATE ON "DocumentFileVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_document_file_version_mutation"();

CREATE TRIGGER "document_file_version_reject_delete"
BEFORE DELETE ON "DocumentFileVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_document_file_version_mutation"();
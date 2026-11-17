import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const extractionMigration = readFileSync(resolve(
  "prisma/migrations/20261009_document_file_version_extraction/migration.sql",
), "utf8");
const ocrMigration = readFileSync(resolve(
  "prisma/migrations/20261012_document_ocr_batch_pipeline/migration.sql",
), "utf8");
const databases: PGlite[] = [];

async function databaseWithOcrSchema(): Promise<PGlite> {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Procedimento" (
      "id" TEXT PRIMARY KEY,
      "enteId" TEXT NOT NULL REFERENCES "Ente"("id")
    );
    CREATE TABLE "Documento" (
      "id" TEXT PRIMARY KEY,
      "enteId" TEXT,
      "procedimentoId" TEXT,
      UNIQUE ("id", "enteId", "procedimentoId")
    );
    CREATE TABLE "DocumentFileVersion" (
      "id" TEXT PRIMARY KEY,
      "documentId" TEXT NOT NULL,
      "canonicalEnteId" TEXT NOT NULL,
      UNIQUE ("id", "documentId", "canonicalEnteId")
    );
  `);
  await database.exec(extractionMigration);
  await database.exec(ocrMigration);
  await database.exec(`
    INSERT INTO "Ente" ("id") VALUES ('tenant-1');
    INSERT INTO "Procedimento" ("id", "enteId") VALUES ('procedure-1', 'tenant-1');
    INSERT INTO "Documento" ("id", "enteId", "procedimentoId")
    VALUES ('document-1', 'tenant-1', 'procedure-1');
    INSERT INTO "DocumentFileVersion" ("id", "documentId", "canonicalEnteId")
    VALUES ('version-1', 'document-1', 'tenant-1');
    INSERT INTO "DocumentExtractionAttempt" (
      "id", "executionKey", "documentoId", "documentFileVersionId", "tenantId", "procedimentoId",
      "policyVersion", "outcome", "sourceSha256", "declaredMimeType", "sourceSizeBytes",
      "startedAt", "completedAt", "failureCode", "failureMessage"
    ) VALUES (
      'direct-failed', 'direct-job', 'document-1', 'version-1', 'tenant-1', 'procedure-1',
      'DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1', 'FAILED', '${"a".repeat(64)}',
      'application/pdf', 30000000, '2026-10-12T10:00:00Z', '2026-10-12T10:00:01Z',
      'ARTIFACT_TOO_LARGE', 'V1 size limit'
    );
  `);
  return database;
}

describe("document OCR batch migration", () => {
  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("persists immutable page checkpoints and permits only the explicit V1-to-V2 transition", async () => {
    const database = await databaseWithOcrSchema();
    await database.exec(`
      INSERT INTO "DocumentOcrRun" (
        "id", "coordinatorJobId", "documentoId", "documentFileVersionId", "tenantId",
        "procedimentoId", "sourceAttemptId", "authorizationRef", "policyVersion",
        "sourceSha256", "sourceSizeBytes", "declaredMimeType", "pageCount", "batchSize",
        "status", "completedPageCount", "updatedAt"
      ) VALUES (
        'run-1', 'coordinator-job', 'document-1', 'version-1', 'tenant-1',
        'procedure-1', 'direct-failed', 'permit-1',
        'DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2', '${"a".repeat(64)}', 30000000,
        'application/pdf', 100, 5, 'PROCESSING', 1, CURRENT_TIMESTAMP
      );
      INSERT INTO "DocumentOcrPageCheckpoint" (
        "id", "runId", "pageNumber", "extractionMethod", "text", "normalizedText",
        "textSha256", "normalizedCharacterCount", "ocrConfidence", "warnings"
      ) VALUES (
        'checkpoint-1', 'run-1', 1, 'OCR', 'testo', 'testo',
        '${"b".repeat(64)}', 5, 91, '[]'
      );
    `);
    await expect(database.exec(`
      UPDATE "DocumentOcrPageCheckpoint" SET "text" = 'changed' WHERE "id" = 'checkpoint-1'
    `)).rejects.toThrow(/immutable/);
    await expect(database.exec(`
      DELETE FROM "DocumentOcrPageCheckpoint" WHERE "id" = 'checkpoint-1'
    `)).rejects.toThrow(/immutable/);
    await expect(database.exec(`
      UPDATE "DocumentOcrRun" SET "authorizationRef" = 'changed' WHERE "id" = 'run-1'
    `)).rejects.toThrow(/authority is immutable/);

    await database.exec(`
      INSERT INTO "DocumentExtractionAttempt" (
        "id", "executionKey", "documentoId", "documentFileVersionId", "tenantId",
        "procedimentoId", "policyVersion", "retryOfAttemptId", "retryAuthorizationId",
        "outcome", "sourceSha256", "declaredMimeType", "detectedMimeType",
        "sourceSizeBytes", "startedAt", "completedAt",
        "ocrExtractorName", "ocrExtractorVersion", "rasterizerName", "rasterizerVersion"
      ) VALUES (
        'ocr-success', 'coordinator-job', 'document-1', 'version-1', 'tenant-1',
        'procedure-1', 'DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2',
        'direct-failed', 'permit-1', 'SUCCEEDED', '${"a".repeat(64)}',
        'application/pdf', 'application/pdf', 30000000,
        '2026-10-12T10:01:00Z', '2026-10-12T10:02:00Z',
        'tesseract.js', '6.0.1', 'pdfjs-canvas', '1'
      );
    `);
    await expect(database.exec(`
      INSERT INTO "DocumentExtractionAttempt" (
        "id", "executionKey", "documentoId", "documentFileVersionId", "tenantId",
        "procedimentoId", "policyVersion", "retryOfAttemptId", "retryAuthorizationId",
        "outcome", "sourceSha256", "declaredMimeType", "sourceSizeBytes",
        "startedAt", "completedAt", "failureCode", "failureMessage"
      ) VALUES (
        'ocr-invalid-permit', 'ocr-invalid-permit-job', 'document-1', 'version-1', 'tenant-1',
        'procedure-1', 'DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2',
        'direct-failed', 'different-permit', 'FAILED', '${"a".repeat(64)}',
        'application/pdf', 30000000, '2026-10-12T10:01:00Z', '2026-10-12T10:02:00Z',
        'INTERNAL_EXTRACTION_FAILURE', 'verification'
      );
    `)).rejects.toThrow(/eligible DIRECT_TEXT_V1 failure in the same scope/);
    const rows = await database.query<{ count: number }>(`
      SELECT COUNT(*)::int AS "count"
      FROM "DocumentExtractionAttempt"
      WHERE "policyVersion" = 'DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2'
        AND "outcome" = 'SUCCEEDED'
    `);
    expect(rows.rows[0]).toEqual({ count: 1 });
  }, 15_000);
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  "prisma/migrations/20261009_document_file_version_extraction/migration.sql",
), "utf8");
const databases: PGlite[] = [];

async function baseline() {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    CREATE TABLE "Ente" (
      "id" TEXT PRIMARY KEY
    );
    CREATE TABLE "Procedimento" (
      "id" TEXT PRIMARY KEY,
      "enteId" TEXT NOT NULL REFERENCES "Ente"("id")
    );
    CREATE TABLE "Documento" (
      "id" TEXT PRIMARY KEY,
      "enteId" TEXT,
      "procedimentoId" TEXT
    );
    CREATE TABLE "DocumentFileVersion" (
      "id" TEXT PRIMARY KEY,
      "documentId" TEXT NOT NULL,
      "canonicalEnteId" TEXT NOT NULL,
      CONSTRAINT "DocumentFileVersion_id_documentId_canonicalEnteId_key"
        UNIQUE ("id", "documentId", "canonicalEnteId")
    );
  `);
  await database.exec(migration);
  return database;
}

async function seedSource(database: PGlite) {
  await database.exec(`
    INSERT INTO "Ente" ("id") VALUES ('tenant-1'), ('tenant-2');
    INSERT INTO "Procedimento" ("id", "enteId") VALUES ('procedure-1', 'tenant-1');
    INSERT INTO "Documento" ("id", "enteId", "procedimentoId")
    VALUES ('document-1', 'tenant-1', 'procedure-1');
    INSERT INTO "DocumentFileVersion" ("id", "documentId", "canonicalEnteId")
    VALUES ('version-1', 'document-1', 'tenant-1');
  `);
}

function attemptSql(input: {
  id: string;
  executionKey?: string;
  tenantId?: string;
  outcome?: "SUCCEEDED" | "FAILED";
  retryOfAttemptId?: string | null;
  retryAuthorizationId?: string | null;
  omitRetryAuthorization?: boolean;
  failureCode?: string;
}) {
  const outcome = input.outcome ?? "SUCCEEDED";
  const succeeded = outcome === "SUCCEEDED";
  return `
    INSERT INTO "DocumentExtractionAttempt" (
      "id", "executionKey", "documentoId", "documentFileVersionId", "tenantId", "procedimentoId",
      "policyVersion", "retryOfAttemptId", "retryAuthorizationId",
      "outcome", "sourceSha256", "declaredMimeType",
      "detectedMimeType", "sourceSizeBytes", "startedAt", "completedAt",
      "directExtractorName", "directExtractorVersion", "failureCode", "failureMessage", "warnings"
    ) VALUES (
      '${input.id}', '${input.executionKey ?? `job-${input.id}`}',
      'document-1', 'version-1', '${input.tenantId ?? "tenant-1"}', 'procedure-1',
      'DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1',
      ${input.retryOfAttemptId ? `'${input.retryOfAttemptId}'` : "NULL"},
      ${input.omitRetryAuthorization
        ? "NULL"
        : input.retryOfAttemptId
          ? `'${input.retryAuthorizationId ?? `permit-${input.id}`}'`
          : "NULL"},
      '${outcome}', '${"a".repeat(64)}',
      'application/pdf', ${succeeded ? "'application/pdf'" : "NULL"}, 1848,
      '2026-10-09T16:30:00Z', '2026-10-09T16:30:01Z',
      ${succeeded
        ? "'pdfjs-dist', '5.4.149', NULL, NULL"
        : `NULL, NULL, '${input.failureCode ?? "STORAGE_READ_FAILURE"}', 'extraction failure'`},
      '[]'
    );
  `;
}

describe("document extraction additive migration", () => {
  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it("creates scoped append-only extraction evidence", async () => {
    const database = await baseline();
    await seedSource(database);
    await database.exec(attemptSql({ id: "attempt-1" }));
    await database.exec(`
      INSERT INTO "DocumentExtractionPage" (
        "id", "extractionAttemptId", "pageNumber", "extractionMethod",
        "text", "normalizedText", "textSha256", "normalizedCharacterCount",
        "ocrConfidence", "warnings"
      ) VALUES (
        'page-1', 'attempt-1', 1, 'DIRECT_TEXT',
        'PORTO AURORA', 'PORTO AURORA', '${"b".repeat(64)}', 12, NULL, '[]'
      );
    `);
    const rows = await database.query<{
      attemptCount: number;
      pageCount: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "DocumentExtractionAttempt") AS "attemptCount",
        (SELECT COUNT(*)::int FROM "DocumentExtractionPage") AS "pageCount"
    `);
    expect(rows.rows[0]).toEqual({ attemptCount: 1, pageCount: 1 });

    await expect(database.exec(attemptSql({ id: "attempt-2" }))).rejects.toThrow();
    await expect(database.exec(
      `UPDATE "DocumentExtractionAttempt" SET "warnings" = '["changed"]' WHERE "id" = 'attempt-1'`,
    )).rejects.toThrow(/immutable/);
  });

  it("preserves multiple failures followed by one canonical success", async () => {
    const database = await baseline();
    await seedSource(database);
    await database.exec(attemptSql({ id: "attempt-failed-1", outcome: "FAILED" }));
    await database.exec(attemptSql({
      id: "attempt-failed-2",
      outcome: "FAILED",
      retryOfAttemptId: "attempt-failed-1",
      retryAuthorizationId: "retry-authorization-1",
    }));
    await database.exec(attemptSql({
      id: "attempt-success",
      retryOfAttemptId: "attempt-failed-2",
      retryAuthorizationId: "retry-authorization-2",
    }));
    const rows = await database.query<{ id: string; outcome: string }>(`
      SELECT "id", "outcome"
      FROM "DocumentExtractionAttempt"
      ORDER BY "createdAt", "id"
    `);
    expect(rows.rows).toEqual([
      { id: "attempt-failed-1", outcome: "FAILED" },
      { id: "attempt-failed-2", outcome: "FAILED" },
      { id: "attempt-success", outcome: "SUCCEEDED" },
    ]);
    await expect(database.exec(attemptSql({
      id: "attempt-second-success",
      retryOfAttemptId: "attempt-failed-2",
      retryAuthorizationId: "retry-authorization-3",
    }))).rejects.toThrow();
    await expect(database.exec(
      `UPDATE "DocumentExtractionAttempt" SET "failureMessage" = 'changed' WHERE "id" = 'attempt-failed-1'`,
    )).rejects.toThrow(/immutable/);
  });

  it("rejects duplicate execution identities and incomplete retry provenance", async () => {
    const database = await baseline();
    await seedSource(database);
    await database.exec(attemptSql({
      id: "attempt-failed",
      executionKey: "job-1",
      outcome: "FAILED",
    }));
    await expect(database.exec(attemptSql({
      id: "attempt-duplicate-execution",
      executionKey: "job-1",
      outcome: "FAILED",
    }))).rejects.toThrow();
    await expect(database.exec(attemptSql({
      id: "attempt-incomplete-retry",
      outcome: "FAILED",
      retryOfAttemptId: "attempt-failed",
      omitRetryAuthorization: true,
    }))).rejects.toThrow();
    await database.exec(attemptSql({ id: "attempt-success" }));
    await expect(database.exec(attemptSql({
      id: "attempt-retry-of-success",
      outcome: "FAILED",
      retryOfAttemptId: "attempt-success",
      retryAuthorizationId: "retry-authorization-invalid",
    }))).rejects.toThrow(/retryable failed attempt in the same scope/);
    await database.exec(attemptSql({
      id: "attempt-integrity-failure",
      outcome: "FAILED",
      failureCode: "INTEGRITY_SHA256_MISMATCH",
    }));
    await expect(database.exec(attemptSql({
      id: "attempt-retry-integrity",
      outcome: "FAILED",
      retryOfAttemptId: "attempt-integrity-failure",
      retryAuthorizationId: "retry-authorization-integrity",
    }))).rejects.toThrow(/retryable failed attempt in the same scope/);
  });

  it("rejects cross-tenant source bindings", async () => {
    const database = await baseline();
    await seedSource(database);
    await expect(database.exec(attemptSql({
      id: "attempt-cross-tenant",
      tenantId: "tenant-2",
    }))).rejects.toThrow();
  });
});

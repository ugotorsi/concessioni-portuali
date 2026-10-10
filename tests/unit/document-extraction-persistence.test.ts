import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  prisma: {
    documentExtractionAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  tx: {
    documentExtractionAttempt: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  createAuditLogInTransaction: vi.fn(),
  runSerializableTransactionWithRetry: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: harness.prisma }));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: harness.createAuditLogInTransaction,
  auditFailure: vi.fn(),
}));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: harness.runSerializableTransactionWithRetry,
}));

import { Prisma } from "@/generated/prisma/client";
import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  persistCompletedDocumentExtraction,
  type CompletedDocumentExtraction,
} from "@/server/documents/documentExtraction";

function completed(): CompletedDocumentExtraction {
  return {
    attemptId: "attempt-1",
    executionKey: "job-1",
    retryAuthorization: null,
    source: {
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      storageProvider: "s3",
      storageBucket: "e2e-bucket",
      storageKey: "documents/tenant-1/document-1/hash",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
    },
    actor: {
      userId: "user-1",
      userEmail: "admin@example.test",
      userRole: "ADMIN",
    },
    startedAt: new Date("2026-10-09T16:30:00.000Z"),
    completedAt: new Date("2026-10-09T16:30:01.000Z"),
    outcome: "SUCCEEDED",
    result: {
      detectedMimeType: "application/pdf",
      pages: [{
        pageNumber: 1,
        method: "DIRECT_TEXT",
        text: "PORTO AURORA",
        normalizedText: "PORTO AURORA",
        normalizedCharacterCount: 12,
        textSha256: "b".repeat(64),
        ocrConfidence: null,
        warnings: [],
      }],
      warnings: [],
      directExtractorName: "pdfjs-dist",
      directExtractorVersion: "5.4.149",
      ocrExtractorName: null,
      ocrExtractorVersion: null,
      rasterizerName: null,
      rasterizerVersion: null,
    },
  };
}

describe("document extraction persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.runSerializableTransactionWithRetry.mockImplementation((callback) => callback(harness.tx));
  });

  it("persists attempt, pages and DOCUMENT_EXTRACTION audit atomically", async () => {
    harness.tx.documentExtractionAttempt.findUnique.mockResolvedValueOnce(null);
    harness.tx.documentExtractionAttempt.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    harness.tx.documentExtractionAttempt.create.mockImplementationOnce(({ data }) => ({
      ...data,
      failureCode: null,
    }));
    await expect(persistCompletedDocumentExtraction(completed())).resolves.toMatchObject({
      reused: false,
      attempt: { id: "attempt-1", outcome: "SUCCEEDED" },
    });
    expect(harness.tx.documentExtractionAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentoId: "document-1",
        executionKey: "job-1",
        documentFileVersionId: "version-1",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        pages: {
          create: [expect.objectContaining({
            pageNumber: 1,
            extractionMethod: "DIRECT_TEXT",
            ocrConfidence: null,
          })],
        },
      }),
    });
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        azione: "DOCUMENT_EXTRACTION",
        entitaId: "document-1",
        enteId: "tenant-1",
        esito: "SUCCESS",
        metadata: expect.objectContaining({
          documentFileVersionId: "version-1",
          procedimentoId: "procedure-1",
          sourceSha256: "a".repeat(64),
          pageCount: 1,
          extractionMethods: ["DIRECT_TEXT"],
        }),
      }),
    );
  });

  it("reuses the canonical successful result without duplicate pages or audit", async () => {
    harness.tx.documentExtractionAttempt.findUnique.mockResolvedValueOnce(null);
    harness.tx.documentExtractionAttempt.findFirst.mockResolvedValueOnce({
      id: "attempt-existing",
      executionKey: "job-existing",
      outcome: "SUCCEEDED",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      retryOfAttemptId: null,
      retryAuthorizationId: null,
      failureCode: null,
    });
    await expect(persistCompletedDocumentExtraction(completed())).resolves.toMatchObject({
      reused: true,
      attempt: { id: "attempt-existing" },
    });
    expect(harness.tx.documentExtractionAttempt.create).not.toHaveBeenCalled();
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("reuses the concurrent winner of the version-policy identity", async () => {
    harness.runSerializableTransactionWithRetry.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: {
          modelName: "DocumentExtractionAttempt",
          target: "document_extraction_succeeded_version_policy_uq",
        },
      }),
    );
    harness.prisma.documentExtractionAttempt.findUnique.mockResolvedValueOnce(null);
    harness.prisma.documentExtractionAttempt.findFirst.mockResolvedValueOnce({
      id: "attempt-winner",
      executionKey: "job-winner",
      outcome: "SUCCEEDED",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      retryOfAttemptId: null,
      retryAuthorizationId: null,
      failureCode: null,
    });
    await expect(persistCompletedDocumentExtraction(completed())).resolves.toMatchObject({
      reused: true,
      attempt: { id: "attempt-winner" },
    });
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("reuses a failed attempt for the same execution key without retrying", async () => {
    harness.tx.documentExtractionAttempt.findUnique.mockResolvedValueOnce({
      id: "attempt-failed",
      executionKey: "job-1",
      outcome: "FAILED",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      retryOfAttemptId: null,
      retryAuthorizationId: null,
      failureCode: "STORAGE_READ_FAILURE",
    });
    await expect(persistCompletedDocumentExtraction(completed())).resolves.toMatchObject({
      reused: true,
      attempt: { id: "attempt-failed", outcome: "FAILED" },
    });
    expect(harness.tx.documentExtractionAttempt.create).not.toHaveBeenCalled();
    expect(harness.createAuditLogInTransaction).not.toHaveBeenCalled();
  });

  it("persists an authorized retry as a distinct attempt linked to the failure", async () => {
    const retry = completed();
    retry.attemptId = "attempt-2";
    retry.executionKey = "job-retry-1";
    retry.retryAuthorization = {
      failedAttemptId: "attempt-failed",
      authorizationId: "retry-authorization-1",
    };
    harness.tx.documentExtractionAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "attempt-failed",
        executionKey: "job-1",
        outcome: "FAILED",
        documentoId: "document-1",
        documentFileVersionId: "version-1",
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryOfAttemptId: null,
        retryAuthorizationId: null,
        failureCode: "STORAGE_READ_FAILURE",
      });
    harness.tx.documentExtractionAttempt.findFirst.mockResolvedValueOnce(null);
    harness.tx.documentExtractionAttempt.create.mockImplementationOnce(({ data }) => data);
    await expect(persistCompletedDocumentExtraction(retry)).resolves.toMatchObject({
      reused: false,
      attempt: {
        id: "attempt-2",
        retryOfAttemptId: "attempt-failed",
        retryAuthorizationId: "retry-authorization-1",
        outcome: "SUCCEEDED",
      },
    });
    expect(harness.createAuditLogInTransaction).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          executionKey: "job-retry-1",
          retryOfAttemptId: "attempt-failed",
          retryAuthorizationId: "retry-authorization-1",
        }),
      }),
    );
  });
});

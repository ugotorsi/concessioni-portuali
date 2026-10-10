import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  extractDocumentFileVersion,
  type ExtractDocumentFileVersionDependencies,
} from "@/server/documents/documentExtraction";
import { DocumentStorageReadCoherenceError } from "@/server/documents/storage/types";
import { ExtractionFailure } from "@/server/intake/extraction/errors";
import { extractTechnicalDocument } from "@/server/intake/extraction/technicalExtractor";

import { createPdf } from "./helpers/extraction-fixtures";

const documentId = "document-1";
const versionId = "version-1";
const tenantId = "tenant-1";
const procedimentoId = "procedure-1";
const sourceBytes = Buffer.from("fixture");
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const executionKey = "job-1";
const actor = {
  userId: "user-1",
  userEmail: "admin@example.test",
  userRole: "ADMIN",
};

function loadedDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    enteId: tenantId,
    procedimentoId,
    currentFileVersionId: versionId,
    procedimento: { enteId: tenantId },
    currentFileVersion: {
      id: versionId,
      documentId,
      canonicalEnteId: tenantId,
      storageProvider: "s3",
      storageBucket: "e2e-bucket",
      storageKey: `documents/${tenantId}/${documentId}/${sourceSha256}`,
      mimeType: "application/pdf",
      sizeBytes: sourceBytes.length,
      sha256: sourceSha256,
    },
    ...overrides,
  };
}

function directResult() {
  return {
    detectedMimeType: "application/pdf" as const,
    pages: [{
      pageNumber: 1,
      method: "DIRECT_TEXT" as const,
      text: "TEST FITTIZIO PORTO AURORA",
      normalizedText: "TEST FITTIZIO PORTO AURORA",
      normalizedCharacterCount: 27,
      textSha256: "a".repeat(64),
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
  };
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    executionKey,
    outcome: "FAILED" as const,
    documentoId: documentId,
    documentFileVersionId: versionId,
    tenantId,
    procedimentoId,
    policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
    retryOfAttemptId: null,
    retryAuthorizationId: null,
    failureCode: "STORAGE_READ_FAILURE",
    ...overrides,
  };
}

function harness() {
  const dependencies: ExtractDocumentFileVersionDependencies = {
    loadDocument: vi.fn().mockResolvedValue(loadedDocument()),
    findExecutionAttempt: vi.fn().mockResolvedValue(null),
    findCanonicalSuccess: vi.fn().mockResolvedValue(null),
    findLatestFailure: vi.fn().mockResolvedValue(null),
    loadRetryAttempt: vi.fn().mockResolvedValue(null),
    readBounded: vi.fn().mockResolvedValue({ disposition: "FOUND", body: sourceBytes }),
    extract: vi.fn().mockResolvedValue(directResult()),
    persist: vi.fn().mockImplementation(async (input) => ({
      reused: false,
      attempt: {
        id: input.attemptId,
        executionKey: input.executionKey,
        outcome: input.outcome,
        documentoId: documentId,
        documentFileVersionId: versionId,
        tenantId,
        procedimentoId,
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryOfAttemptId: input.retryAuthorization?.failedAttemptId ?? null,
        retryAuthorizationId: input.retryAuthorization?.authorizationId ?? null,
        failureCode: input.outcome === "FAILED" ? input.failureCode : null,
      },
    })),
    auditRejected: vi.fn(),
    createAttemptId: vi.fn().mockReturnValue("attempt-1"),
    now: vi.fn()
      .mockReturnValueOnce(new Date("2026-10-09T16:30:00.000Z"))
      .mockReturnValueOnce(new Date("2026-10-09T16:30:01.000Z")),
  };
  return dependencies;
}

describe("archived DocumentFileVersion extraction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extracts the current canonical version and preserves source provenance", async () => {
    const dependencies = harness();
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey,
      actor,
    }, dependencies)).resolves.toMatchObject({
      reused: false,
      attempt: { outcome: "SUCCEEDED" },
    });

    expect(dependencies.readBounded).toHaveBeenCalledWith({
      storageProvider: "s3",
      storageBucket: "e2e-bucket",
      storageKey: `documents/${tenantId}/${documentId}/${sourceSha256}`,
      maxBytes: sourceBytes.length,
    });
    expect(dependencies.extract).toHaveBeenCalledWith({
      bytes: sourceBytes,
      declaredMimeType: "application/pdf",
      expectedSha256: sourceSha256,
      expectedSizeBytes: sourceBytes.length,
    });
    expect(dependencies.persist).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "SUCCEEDED",
      source: expect.objectContaining({
        documentoId: documentId,
        documentFileVersionId: versionId,
        tenantId,
        procedimentoId,
        sha256: sourceSha256,
      }),
      result: expect.objectContaining({
        pages: [expect.objectContaining({ method: "DIRECT_TEXT" })],
      }),
    }));
  });

  it("rejects a tenant mismatch before storage access", async () => {
    const dependencies = harness();
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId: "other-tenant",
      executionKey,
      actor,
    }, dependencies)).rejects.toMatchObject({
      code: "TENANT_MISMATCH",
    });
    expect(dependencies.auditRejected).toHaveBeenCalledWith(expect.objectContaining({
      code: "TENANT_MISMATCH",
    }));
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("rejects a non-current file version", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.loadDocument).mockResolvedValueOnce(
      loadedDocument({ currentFileVersionId: "newer-version" }),
    );
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey,
      actor,
    }, dependencies)).rejects.toMatchObject({ code: "CURRENT_VERSION_MISMATCH" });
    expect(dependencies.readBounded).not.toHaveBeenCalled();
  });

  it.each([
    [new DocumentStorageReadCoherenceError("BUCKET_MISMATCH"), "BUCKET_MISMATCH"],
    [new ExtractionFailure("INTEGRITY_SHA256_MISMATCH"), "INTEGRITY_SHA256_MISMATCH"],
  ])("persists a traced failure for incoherent storage or checksum", async (error, failureCode) => {
    const dependencies = harness();
    if (error instanceof DocumentStorageReadCoherenceError) {
      vi.mocked(dependencies.readBounded).mockRejectedValueOnce(error);
    } else {
      vi.mocked(dependencies.extract).mockRejectedValueOnce(error);
    }
    await extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey,
      actor,
    }, dependencies);
    expect(dependencies.persist).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "FAILED",
      failureCode,
    }));
  });

  it("reuses an existing version-policy attempt without storage or new persistence", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.findCanonicalSuccess).mockResolvedValueOnce(attempt({
      id: "existing-attempt",
      executionKey: "job-existing",
      outcome: "SUCCEEDED",
      failureCode: null,
    }));
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey,
      actor,
    }, dependencies)).resolves.toMatchObject({ reused: true });
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("does not retry a failed attempt implicitly", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.findLatestFailure).mockResolvedValueOnce(attempt());
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey: "job-new-without-authorization",
      actor,
    }, dependencies)).resolves.toMatchObject({
      reused: true,
      attempt: { id: "attempt-1", outcome: "FAILED" },
    });
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("reuses the failed result when the same job is executed again", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.findExecutionAttempt).mockResolvedValueOnce(attempt());
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey,
      actor,
    }, dependencies)).resolves.toMatchObject({
      reused: true,
      attempt: { id: "attempt-1", outcome: "FAILED" },
    });
    expect(dependencies.findCanonicalSuccess).not.toHaveBeenCalled();
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("allows an explicitly authorized retry while preserving the failed source", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.loadRetryAttempt).mockResolvedValueOnce(attempt());
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey: "job-retry-1",
      retryAuthorization: {
        failedAttemptId: "attempt-1",
        authorizationId: "retry-authorization-1",
      },
      actor,
    }, dependencies)).resolves.toMatchObject({
      reused: false,
      attempt: { outcome: "SUCCEEDED" },
    });
    expect(dependencies.persist).toHaveBeenCalledWith(expect.objectContaining({
      executionKey: "job-retry-1",
      retryAuthorization: {
        failedAttemptId: "attempt-1",
        authorizationId: "retry-authorization-1",
      },
      outcome: "SUCCEEDED",
    }));
  });

  it("rejects a retry source outside the canonical scope before storage access", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.loadRetryAttempt).mockResolvedValueOnce(attempt({
      tenantId: "other-tenant",
    }));
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey: "job-retry-invalid",
      retryAuthorization: {
        failedAttemptId: "attempt-1",
        authorizationId: "retry-authorization-invalid",
      },
      actor,
    }, dependencies)).rejects.toMatchObject({
      code: "RETRY_AUTHORIZATION_MISMATCH",
    });
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("does not allow retry to bypass a permanent integrity failure", async () => {
    const dependencies = harness();
    vi.mocked(dependencies.loadRetryAttempt).mockResolvedValueOnce(attempt({
      failureCode: "INTEGRITY_SHA256_MISMATCH",
    }));
    await expect(extractDocumentFileVersion({
      documentoId: documentId,
      documentFileVersionId: versionId,
      tenantId,
      executionKey: "job-retry-integrity",
      retryAuthorization: {
        failedAttemptId: "attempt-1",
        authorizationId: "retry-authorization-integrity",
      },
      actor,
    }, dependencies)).rejects.toMatchObject({
      code: "RETRY_AUTHORIZATION_MISMATCH",
    });
    expect(dependencies.readBounded).not.toHaveBeenCalled();
    expect(dependencies.extract).not.toHaveBeenCalled();
    expect(dependencies.persist).not.toHaveBeenCalled();
  });

  it("extracts digital PDF text directly and refuses OCR fallback", async () => {
    const digitalPdf = await createPdf([{
      type: "text",
      text: "TEST FITTIZIO PORTO AURORA SENZA VALORE GIURIDICO CON TESTO DIGITALE",
    }]);
    const ocr = {
      name: "forbidden-ocr",
      version: "0",
      recognize: vi.fn(),
    };
    const digital = await extractTechnicalDocument({
      bytes: digitalPdf,
      declaredMimeType: "application/pdf",
      expectedSha256: createHash("sha256").update(digitalPdf).digest("hex"),
      expectedSizeBytes: digitalPdf.length,
    }, { ocrMode: "DISABLED", ocr });
    expect(digital.pages.map((page) => page.method)).toEqual(["DIRECT_TEXT"]);
    expect(ocr.recognize).not.toHaveBeenCalled();

    const imageOnlyPdf = await createPdf([{ type: "text", text: "" }]);
    await expect(extractTechnicalDocument({
      bytes: imageOnlyPdf,
      declaredMimeType: "application/pdf",
      expectedSha256: createHash("sha256").update(imageOnlyPdf).digest("hex"),
      expectedSizeBytes: imageOnlyPdf.length,
    }, { ocrMode: "DISABLED", ocr })).rejects.toMatchObject({ code: "OCR_REQUIRED" });
    expect(ocr.recognize).not.toHaveBeenCalled();
  });
});

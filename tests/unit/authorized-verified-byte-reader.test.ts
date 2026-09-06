import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, test, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const documentoFindUniqueMock = vi.hoisted(() => vi.fn());
const readDocumentFileFromProviderMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { documento: { findUnique: documentoFindUniqueMock } },
}));

vi.mock("@/server/documents/storage", () => ({
  readDocumentFileFromProvider: readDocumentFileFromProviderMock,
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
}));

import {
  DocumentReadAuditError,
  DocumentReadAuthorizationError,
  DocumentReadIntegrityError,
  readAuthorizedVerifiedDocumentBytes,
} from "@/server/documents/authorizedVerifiedByteReader";
import {
  DocumentStorageReadCoherenceError,
  DocumentStorageReadUnavailableError,
} from "@/server/documents/storage/types";

const DOCUMENT_ID = "document-1";
const TENANT_ID = "ente-1";
const FILE_VERSION_ID = "version-1";
const VERIFIED_BODY = Buffer.from("verified document");
const VERIFIED_SHA = createHash("sha256").update(VERIFIED_BODY).digest("hex");

function tenantContext(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    role: "TECNICO",
    isAdmin: false,
    tenantMemberships: [],
    defaultTenantId: TENANT_ID,
    accessibleTenantIds: [TENANT_ID],
    ...overrides,
  };
}

function fileVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_VERSION_ID,
    documentId: DOCUMENT_ID,
    canonicalEnteId: TENANT_ID,
    storageProvider: "local",
    storageKey: `documents/${TENANT_ID}/${DOCUMENT_ID}/${VERIFIED_SHA}`,
    storageBucket: null,
    mimeType: "application/pdf",
    sizeBytes: VERIFIED_BODY.length,
    sha256: VERIFIED_SHA,
    ...overrides,
  };
}

function documento(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    nome: "Documento.pdf",
    originalName: "originale.pdf",
    statoDocumento: "ATTIVO",
    enteId: TENANT_ID,
    concessioneId: "concessione-1",
    procedimentoId: "procedimento-1",
    storageKey: null,
    storagePath: null,
    nomeStorage: null,
    publicUrl: null,
    url: `/documenti/${DOCUMENT_ID}/download`,
    checksumSha256: null,
    sha256: null,
    dimensioneBytes: null,
    sizeBytes: null,
    currentFileVersionId: FILE_VERSION_ID,
    concessione: { enteId: TENANT_ID },
    procedimento: { concessione: { enteId: TENANT_ID } },
    currentFileVersion: fileVersion(),
    ...overrides,
  };
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject.");
}

describe("B2C9C1A3B1 authorized verified byte reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue(tenantContext());
    requireTenantAccessMock.mockImplementation((context, enteId) => {
      if (!context.isAdmin && !context.accessibleTenantIds.includes(enteId)) {
        throw new Error("Tenant access denied.");
      }
    });
    documentoFindUniqueMock.mockResolvedValue(documento());
    readDocumentFileFromProviderMock.mockResolvedValue({ disposition: "FOUND", body: VERIFIED_BODY });
    auditFailureMock.mockResolvedValue(undefined);
    auditSuccessMock.mockResolvedValue(undefined);
  });

  describe("authorization and tenant order", () => {
    it("rejects unauthenticated access before querying or reading storage", async () => {
      getCurrentTenantContextMock.mockResolvedValue(null);

      const error = await captureError(() => readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID }));

      expect(error).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(error).toBeInstanceOf(DocumentReadAuthorizationError);
      expect(getCurrentTenantContextMock).toHaveBeenCalledTimes(1);
      expect(documentoFindUniqueMock).not.toHaveBeenCalled();
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        azione: "AUTHZ_DENIED",
        metadata: expect.objectContaining({ outcome: "UNAUTHENTICATED" }),
      }));
    });

    it("makes a missing document non-observable without a storage read", async () => {
      documentoFindUniqueMock.mockResolvedValue(null);

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND_NON_OBSERVABLE",
      });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        azione: "AUTHZ_DENIED",
        metadata: expect.objectContaining({ outcome: "NOT_FOUND_NON_OBSERVABLE" }),
      }));
    });

    it("makes cross-tenant access non-observable before storage", async () => {
      requireTenantAccessMock.mockImplementation(() => {
        throw new Error("Tenant access denied.");
      });

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND_NON_OBSERVABLE",
      });
      expect(requireTenantAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        { mode: "read", allowWhenEnteMissing: false },
      );
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    test.each([
      ["missing", { enteId: null, concessione: null, procedimento: null }],
      ["conflicting", { concessione: { enteId: "ente-2" } }],
    ])("fails closed for %s tenant identity", async (_label, overrides) => {
      documentoFindUniqueMock.mockResolvedValue(documento(overrides));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND_NON_OBSERVABLE",
      });
      expect(requireTenantAccessMock).not.toHaveBeenCalled();
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    it("reuses the existing admin semantics without inventing a bypass", async () => {
      getCurrentTenantContextMock.mockResolvedValue(tenantContext({
        role: "ADMIN",
        isAdmin: true,
        accessibleTenantIds: [],
      }));
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersionId: null,
        currentFileVersion: null,
      }));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).resolves.toEqual({
        status: "NO_FILE_VERSION",
      });
      expect(requireTenantAccessMock).toHaveBeenCalledTimes(1);
      expect(getCurrentTenantContextMock).toHaveBeenCalledTimes(1);
    });

    it("allows an authorized tenant", async () => {
      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).resolves.toMatchObject({
        status: "AVAILABLE_VERIFIED",
      });
      expect(requireTenantAccessMock).toHaveBeenCalledTimes(1);
    });

    it("blocks an archived document for a viewer after tenant authorization", async () => {
      const events: string[] = [];
      getCurrentTenantContextMock.mockResolvedValue(tenantContext({ role: "VIEWER_ADSP" }));
      documentoFindUniqueMock.mockResolvedValue(documento({ statoDocumento: "ARCHIVIATO" }));
      requireTenantAccessMock.mockImplementation(() => events.push("tenant"));
      auditFailureMock.mockImplementation(async (input) => {
        events.push(`audit:${input.metadata.outcome}`);
      });

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(events).toEqual(["tenant", "audit:FORBIDDEN"]);
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    it("does not reveal archived state before a failed tenant check", async () => {
      getCurrentTenantContextMock.mockResolvedValue(tenantContext({ role: "VIEWER_ADSP" }));
      documentoFindUniqueMock.mockResolvedValue(documento({ statoDocumento: "ARCHIVIATO" }));
      requireTenantAccessMock.mockImplementation(() => {
        throw new Error("Tenant access denied.");
      });

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND_NON_OBSERVABLE",
      });
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "NOT_FOUND_NON_OBSERVABLE" }),
      }));
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });
  });

  describe("legacy classification", () => {
    it("returns no version when no reliable file indicator exists and url is isolated", async () => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersionId: null,
        currentFileVersion: null,
        url: `/documenti/${DOCUMENT_ID}/download`,
      }));

      const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      expect(result).toEqual({ status: "NO_FILE_VERSION" });
      expect(result).not.toHaveProperty("body");
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "NO_FILE_VERSION" }),
      }));
    });

    test.each([
      ["storageKey", { storageKey: "legacy/key" }],
      ["storagePath", { storagePath: "legacy/path" }],
      ["nomeStorage", { nomeStorage: "legacy.pdf" }],
      ["publicUrl", { publicUrl: "https://example.test/legacy.pdf" }],
      ["checksumSha256", { checksumSha256: "a".repeat(64) }],
      ["sha256", { sha256: "b".repeat(64) }],
      ["dimensioneBytes", { dimensioneBytes: 1 }],
      ["sizeBytes", { sizeBytes: 1 }],
    ])("returns legacy unverified for persisted %s", async (_label, indicator) => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersionId: null,
        currentFileVersion: null,
        ...indicator,
      }));

      const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      expect(result).toEqual({ status: "LEGACY_UNVERIFIED" });
      expect(result).not.toHaveProperty("body");
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "LEGACY_UNVERIFIED" }),
      }));
    });
  });

  describe("manifest validation", () => {
    test.each([
      ["document mismatch", { documentId: "document-2" }, "DOCUMENT_VERSION_MISMATCH"],
      ["tenant mismatch", { canonicalEnteId: "ente-2" }, "TENANT_VERSION_MISMATCH"],
      ["invalid provider", { storageProvider: "ftp" }, "INVALID_MANIFEST"],
      ["blank key", { storageKey: "  " }, "INVALID_MANIFEST"],
      ["blank mime", { mimeType: "" }, "INVALID_MANIFEST"],
      ["zero size", { sizeBytes: 0 }, "INVALID_MANIFEST"],
      ["negative size", { sizeBytes: -1 }, "INVALID_MANIFEST"],
      ["invalid sha", { sha256: "ABC" }, "INVALID_MANIFEST"],
      ["local bucket", { storageBucket: "unexpected" }, "BUCKET_COHERENCE_FAILURE"],
      ["s3 null bucket", { storageProvider: "s3", storageBucket: null }, "BUCKET_COHERENCE_FAILURE"],
      ["s3 blank bucket", { storageProvider: "s3", storageBucket: "  " }, "BUCKET_COHERENCE_FAILURE"],
    ])("rejects %s before storage", async (_label, versionOverrides, expectedCode) => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersion: fileVersion(versionOverrides),
      }));

      const error = await captureError(() => readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID }));

      expect(error).toBeInstanceOf(DocumentReadIntegrityError);
      expect(error).toMatchObject({ code: expectedCode });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: expectedCode }),
      }));
    });

    it("rejects a missing relation for a non-null current pointer", async () => {
      documentoFindUniqueMock.mockResolvedValue(documento({ currentFileVersion: null }));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "INVALID_MANIFEST",
      });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    it("rejects a current pointer/version id mismatch", async () => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersion: fileVersion({ id: "version-2" }),
      }));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "INVALID_MANIFEST",
      });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    test.each(["", " "])("rejects malformed non-null pointer %j as an integrity failure", async (pointer) => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersionId: pointer,
        currentFileVersion: fileVersion({ id: pointer }),
      }));

      const error = await captureError(() => readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID }));

      expect(error).toBeInstanceOf(DocumentReadIntegrityError);
      expect(error).toMatchObject({ code: "INVALID_MANIFEST" });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "INVALID_MANIFEST" }),
      }));
    });

    it("fails closed when the malformed-pointer integrity audit is unavailable", async () => {
      documentoFindUniqueMock.mockResolvedValue(documento({
        currentFileVersionId: "",
        currentFileVersion: fileVersion({ id: "" }),
      }));
      auditFailureMock.mockRejectedValue(new Error("audit unavailable"));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "AUDIT_UNAVAILABLE",
      });
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });
  });

  describe("C1A3A mapping and content integrity", () => {
    it("maps missing without exposing bytes", async () => {
      readDocumentFileFromProviderMock.mockResolvedValue({ disposition: "MISSING" });

      const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      expect(result).toEqual({ status: "SOURCE_MISSING" });
      expect(result).not.toHaveProperty("body");
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "SOURCE_MISSING" }),
      }));
    });

    it("maps typed unavailable without exposing bytes", async () => {
      readDocumentFileFromProviderMock.mockRejectedValue(new DocumentStorageReadUnavailableError({
        provider: "local",
        code: "EACCES",
      }));

      const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      expect(result).toEqual({ status: "SOURCE_UNAVAILABLE" });
      expect(result).not.toHaveProperty("body");
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "SOURCE_UNAVAILABLE" }),
      }));
    });

    test.each([
      ["PROVIDER_MISMATCH", "PROVIDER_COHERENCE_FAILURE"],
      ["BUCKET_MISMATCH", "BUCKET_COHERENCE_FAILURE"],
    ] as const)("maps %s to integrity failure", async (storageCode, readerCode) => {
      readDocumentFileFromProviderMock.mockRejectedValue(new DocumentStorageReadCoherenceError(storageCode));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: readerCode,
      });
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: readerCode }),
      }));
    });

    it("propagates an unknown storage failure after mandatory audit", async () => {
      const storageError = new Error("unexpected storage failure");
      readDocumentFileFromProviderMock.mockRejectedValue(storageError);

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toBe(storageError);
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "SOURCE_READ_FAILED" }),
      }));
    });

    it("rejects size before accepting or hashing content", async () => {
      readDocumentFileFromProviderMock.mockResolvedValue({ disposition: "FOUND", body: Buffer.from("short") });

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "SIZE_MISMATCH",
      });
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
      expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "SIZE_MISMATCH" }),
      }));
    });

    it("rejects a same-size SHA mismatch", async () => {
      const wrongBody = Buffer.from("x".repeat(VERIFIED_BODY.length));
      readDocumentFileFromProviderMock.mockResolvedValue({ disposition: "FOUND", body: wrongBody });

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "SHA256_MISMATCH",
      });
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
    });

    it("returns the exact verified Buffer and manifest metadata after exactly one read", async () => {
      const result = await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      expect(result).toEqual({
        status: "AVAILABLE_VERIFIED",
        body: VERIFIED_BODY,
        mimeType: "application/pdf",
        fileName: "originale.pdf",
        sizeBytes: VERIFIED_BODY.length,
        sha256: VERIFIED_SHA,
      });
      expect(result.status === "AVAILABLE_VERIFIED" && result.body).toBe(VERIFIED_BODY);
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledWith({
        storageProvider: "local",
        storageKey: `documents/${TENANT_ID}/${DOCUMENT_ID}/${VERIFIED_SHA}`,
        storageBucket: null,
      });
      expect(auditSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
        azione: "DOCUMENT_DOWNLOAD",
        metadata: {
          actionType: "DOCUMENT_DOWNLOAD",
          outcome: "AVAILABLE_VERIFIED",
          fileVersionId: FILE_VERSION_ID,
        },
      }));
    });

    it("uses the document name when originalName is blank", async () => {
      documentoFindUniqueMock.mockResolvedValue(documento({ originalName: "  " }));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).resolves.toMatchObject({
        fileName: "Documento.pdf",
      });
    });
  });

  describe("fail-closed audit", () => {
    it("returns no success bytes when the success audit fails", async () => {
      auditSuccessMock.mockRejectedValue(new Error("audit unavailable"));

      const error = await captureError(() => readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID }));

      expect(error).toBeInstanceOf(DocumentReadAuditError);
      expect(error).toMatchObject({ code: "AUDIT_UNAVAILABLE" });
      expect(readDocumentFileFromProviderMock).toHaveBeenCalledTimes(1);
    });

    it("replaces a failure status with AUDIT_UNAVAILABLE when failure audit fails", async () => {
      readDocumentFileFromProviderMock.mockResolvedValue({ disposition: "MISSING" });
      auditFailureMock.mockRejectedValue(new Error("audit unavailable"));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "AUDIT_UNAVAILABLE",
      });
    });

    it("replaces an authorization outcome with AUDIT_UNAVAILABLE when denied audit fails", async () => {
      getCurrentTenantContextMock.mockResolvedValue(null);
      auditFailureMock.mockRejectedValue(new Error("audit unavailable"));

      await expect(readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID })).rejects.toMatchObject({
        code: "AUDIT_UNAVAILABLE",
      });
      expect(documentoFindUniqueMock).not.toHaveBeenCalled();
      expect(readDocumentFileFromProviderMock).not.toHaveBeenCalled();
    });

    it("does not include storage locators, checksum, bytes, or raw errors in audit metadata", async () => {
      await readAuthorizedVerifiedDocumentBytes({ documentoId: DOCUMENT_ID });

      const metadata = auditSuccessMock.mock.calls[0][0].metadata;
      expect(metadata).not.toHaveProperty("storageKey");
      expect(metadata).not.toHaveProperty("storageBucket");
      expect(metadata).not.toHaveProperty("sha256");
      expect(metadata).not.toHaveProperty("body");
      expect(metadata).not.toHaveProperty("error");
    });
  });
});
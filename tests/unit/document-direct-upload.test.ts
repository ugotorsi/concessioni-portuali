import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const createPresignedPutMock = vi.hoisted(() => vi.fn());
const headMock = vi.hoisted(() => vi.fn());
const readBoundedMock = vi.hoisted(() => vi.fn());
const registerStoredDocumentMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  concessione: { findUnique: vi.fn() },
  criticita: { findUnique: vi.fn() },
  procedimento: { findUnique: vi.fn() },
  sopralluogo: { findUnique: vi.fn() },
  pagamento: { findUnique: vi.fn() },
  report: { findUnique: vi.fn() },
  fascicoloDocumentRequirementProposal: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  BACKOFFICE_ROLES: ["ADMIN", "ISTRUTTORE"],
  canManageProcedimenti: () => true,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/documents/storage", () => ({
  requireS3DocumentStorage: () => ({
    createPresignedPut: createPresignedPutMock,
    head: headMock,
    readBounded: readBoundedMock,
  }),
}));
vi.mock("@/server/documents/storage/config", () => ({
  getS3StorageConfig: () => ({ bucket: "private-documents" }),
}));
vi.mock("@/server/documents/uploadService", () => ({
  registerStoredDocument: registerStoredDocumentMock,
}));
vi.mock("@/server/fascicolo-document-requirement-evidence", () => ({
  createFascicoloDocumentRequirementEvidenceRecordInTransaction: vi.fn(),
  createFascicoloDocumentRequirementEvidenceAuditInTransaction: vi.fn(),
}));

import {
  completeDirectDocumentUpload,
  initiateDirectDocumentUpload,
  type DirectDocumentUploadInput,
} from "@/server/documents/directUploadService";

const operationId = "11111111-1111-4111-8111-111111111111";

function input(size: number): DirectDocumentUploadInput {
  return {
    operationId,
    file: { name: "atto.pdf", size, type: "application/pdf" },
    metadata: {
      tipologia: "NOTA",
      source: "UPLOAD_UTENTE",
      status: "ATTIVO",
      procedimentoId: "procedimento-1",
      nome: "Atto istruttorio",
    },
  };
}

function pdf(size: number): Buffer {
  const body = Buffer.alloc(size, 0x20);
  body.write("%PDF-1.7\n", 0, "ascii");
  return body;
}

describe("direct document upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOCUMENT_MAX_FILE_MB = "30";
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue({ userId: "user-1" });
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue({ enteId: "ente-1" });
    createPresignedPutMock.mockResolvedValue("https://r2.example.test/presigned");
    registerStoredDocumentMock.mockImplementation(async (registration) => ({
      created: true,
      document: { id: registration.documentId, procedimentoId: registration.procedimentoId },
    }));
  });

  it.each([1, 5, 15, 30])(
    "verifies and registers a %i MB object without passing its body through the API",
    async (megabytes) => {
      const size = megabytes * 1024 * 1024;
      const request = input(size);
      const initiated = await initiateDirectDocumentUpload(request);
      const presign = createPresignedPutMock.mock.calls[0][0];
      expect(initiated.headers).toMatchObject({
        "Content-Type": "application/pdf",
        "If-None-Match": "*",
        "x-amz-meta-operationid": operationId,
      });
      expect(presign).toMatchObject({ sizeBytes: size, mimeType: "application/pdf" });
      const body = pdf(size);
      headMock.mockResolvedValue({
        sizeBytes: size,
        mimeType: "application/pdf",
        metadata: presign.metadata,
      });
      readBoundedMock.mockResolvedValue({ disposition: "FOUND", body });

      const completed = await completeDirectDocumentUpload({
        ...request,
        objectKey: initiated.objectKey,
      });

      const sha256 = createHash("sha256").update(body).digest("hex");
      expect(completed).toEqual({
        created: true,
        documentId: operationId,
        procedimentoId: "procedimento-1",
        sha256,
        sizeBytes: size,
        downloadUrl: `/documenti/${operationId}/download`,
      });
      expect(registerStoredDocumentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: operationId,
          enteId: "ente-1",
          procedimentoId: "procedimento-1",
          deterministicStorage: { canonicalEnteId: "ente-1", operationId },
        }),
        expect.objectContaining({
          storageProvider: "s3",
          storageKey: initiated.objectKey,
          bucket: "private-documents",
          sizeBytes: size,
          sha256,
          mimeType: "application/pdf",
        }),
      );
      expect(requireTenantAccessMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "ente-1",
        { mode: "write", allowWhenEnteMissing: false },
      );
    },
    30_000,
  );

  it("recovers an interrupted upload with the same operation and does not duplicate registration", async () => {
    const size = 5 * 1024 * 1024;
    const request = input(size);
    const initiated = await initiateDirectDocumentUpload(request);
    const metadata = createPresignedPutMock.mock.calls[0][0].metadata;
    headMock.mockResolvedValueOnce({
      sizeBytes: size - 1024,
      mimeType: "application/pdf",
      metadata,
    });

    await expect(completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey }))
      .rejects.toThrow("Upload incompleto");
    expect(registerStoredDocumentMock).not.toHaveBeenCalled();

    const body = pdf(size);
    headMock.mockResolvedValue({ sizeBytes: size, mimeType: "application/pdf", metadata });
    readBoundedMock.mockResolvedValue({ disposition: "FOUND", body });
    registerStoredDocumentMock
      .mockResolvedValueOnce({ created: true, document: { id: operationId, procedimentoId: "procedimento-1" } })
      .mockResolvedValueOnce({ created: false, document: { id: operationId, procedimentoId: "procedimento-1" } });

    const first = await completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey });
    const retry = await completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(registerStoredDocumentMock).toHaveBeenCalledTimes(2);
    expect(registerStoredDocumentMock.mock.calls[0][0].documentId)
      .toBe(registerStoredDocumentMock.mock.calls[1][0].documentId);
  });

  it("recovers an accepted R2 object whose query metadata was not materialized", async () => {
    const size = 5 * 1024 * 1024;
    const request = input(size);
    const initiated = await initiateDirectDocumentUpload(request);
    const body = pdf(size);
    headMock.mockResolvedValue({
      sizeBytes: size,
      mimeType: "application/pdf",
      metadata: {},
    });
    readBoundedMock.mockResolvedValue({ disposition: "FOUND", body });

    await expect(completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey }))
      .resolves.toMatchObject({ created: true, documentId: operationId });
  });

  it("rejects partially present identity metadata instead of accepting a mismatch", async () => {
    const size = 5 * 1024 * 1024;
    const request = input(size);
    const initiated = await initiateDirectDocumentUpload(request);
    headMock.mockResolvedValue({
      sizeBytes: size,
      mimeType: "application/pdf",
      metadata: { operationid: "different-operation" },
    });

    await expect(completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey }))
      .rejects.toThrow("Identità dell'oggetto caricato non valida");
    expect(registerStoredDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a binary payload disguised as an allowed text file", async () => {
    const request: DirectDocumentUploadInput = {
      ...input(1024),
      file: { name: "note.txt", size: 1024, type: "text/plain" },
    };
    const initiated = await initiateDirectDocumentUpload(request);
    const metadata = createPresignedPutMock.mock.calls[0][0].metadata;
    headMock.mockResolvedValue({ sizeBytes: 1024, mimeType: "text/plain", metadata });
    readBoundedMock.mockResolvedValue({ disposition: "FOUND", body: Buffer.alloc(1024) });
    await expect(completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey }))
      .rejects.toThrow("contenuto del file");
    expect(registerStoredDocumentMock).not.toHaveBeenCalled();
  });

  it("preserves the validated requirement association and its transactional audit extension", async () => {
    const size = 1024 * 1024;
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({
      id: "proposal-1",
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      status: "VALIDATO",
      procedimento: { enteId: "ente-1", concessioneId: "concessione-1" },
    });
    prismaMock.concessione.findUnique.mockResolvedValue({ enteId: "ente-1" });
    const request: DirectDocumentUploadInput = {
      purpose: "REQUIREMENT_EVIDENCE",
      operationId,
      file: { name: "evidenza.pdf", size, type: "application/pdf" },
      metadata: { proposalId: "proposal-1", tipologia: "NOTA" },
    };
    const initiated = await initiateDirectDocumentUpload(request);
    const metadata = createPresignedPutMock.mock.calls[0][0].metadata;
    headMock.mockResolvedValue({ sizeBytes: size, mimeType: "application/pdf", metadata });
    readBoundedMock.mockResolvedValue({ disposition: "FOUND", body: pdf(size) });

    await completeDirectDocumentUpload({ ...request, objectKey: initiated.objectKey });

    expect(registerStoredDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: operationId,
        enteId: "ente-1",
        concessioneId: "concessione-1",
        procedimentoId: "procedimento-1",
        transactionExtension: {
          createRecord: expect.any(Function),
          writeAudit: expect.any(Function),
        },
      }),
      expect.any(Object),
    );
  });
});

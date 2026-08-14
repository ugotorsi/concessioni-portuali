import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getTenantMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const evidenceCreateMock = vi.hoisted(() => vi.fn());
const storeAtKeyMock = vi.hoisted(() => vi.fn());
const storeMock = vi.hoisted(() => vi.fn());
const deleteFileMock = vi.hoisted(() => vi.fn());
const checksumMock = vi.hoisted(() => vi.fn());
const auditInTxMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());
const consoleErrorMock = vi.hoisted(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

const txMock = vi.hoisted(() => ({ documento: { create: vi.fn() } }));
const prismaMock = vi.hoisted(() => ({
  fascicoloDocumentRequirementProposal: { findUnique: vi.fn() },
  fascicoloDocumentRequirementEvidence: { findUnique: vi.fn() },
  documento: { findUnique: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  canManageProcedimenti: canManageMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getTenantMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/actions/fascicolo-document-requirement-evidence", () => ({
  createFascicoloDocumentRequirementEvidence: evidenceCreateMock,
}));
vi.mock("@/server/documents/storage", () => ({
  computeDocumentFileSha256: checksumMock,
  storeDocumentFileAtKey: storeAtKeyMock,
  storeDocumentFile: storeMock,
  deleteDocumentFile: deleteFileMock,
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: auditInTxMock,
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { uploadFascicoloDocumentRequirementEvidence } from "@/server/actions/fascicolo-document-requirement-upload";
import { uploadDocument } from "@/server/documents/uploadService";

const operationId = "2e1bf47e-9b2f-4ee8-a41a-4ea6ca4e4619";
const checksum = "a".repeat(64);
const storageKey = `documents/ente-1/${operationId}/${checksum}`;
const proposal = {
  id: "proposal-1",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  status: "VALIDATO",
  procedimento: { concessioneId: "concessione-1", concessione: { enteId: "ente-1" } },
};
const stored = {
  storageProvider: "s3",
  storageKey,
  fileName: checksum,
  bucket: "configured-bucket",
  sizeBytes: 7,
  sha256: checksum,
  mimeType: "text/plain",
  originalName: "nota.txt",
};
const documentState = {
  id: operationId,
  enteId: "ente-1",
  concessioneId: "concessione-1",
  criticitaId: null,
  procedimentoId: "procedimento-1",
  sopralluogoId: null,
  pagamentoId: null,
  reportId: null,
  statoDocumento: "ATTIVO",
  source: "UPLOAD_UTENTE",
  storageKey,
  storagePath: storageKey,
  storageProvider: "s3",
  checksumSha256: checksum,
  sha256: checksum,
};

function file(type = "text/plain", content = "content") {
  return new File([content], "nota.txt", { type });
}

function actionInput(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "proposal-1",
    operationId,
    file: file(),
    tipologia: "NOTA" as const,
    nome: "Nota istruttoria",
    ...overrides,
  };
}

function serviceInput(overrides: Record<string, unknown> = {}) {
  return {
    documentId: operationId,
    file: file(),
    actor: { id: "user-1", email: "admin@example.test", role: "ADMIN" },
    enteId: "ente-1",
    concessioneId: "concessione-1",
    procedimentoId: "procedimento-1",
    nome: "Nota istruttoria",
    tipologia: "NOTA" as const,
    source: "UPLOAD_UTENTE" as const,
    status: "ATTIVO" as const,
    deterministicStorage: { canonicalEnteId: "ente-1", operationId },
    ...overrides,
  };
}

describe("P1-NEXT-03A proposal-bound document upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    getTenantMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue(proposal);
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue(null);
    prismaMock.documento.findUnique.mockResolvedValue(null);
    prismaMock.documento.deleteMany.mockResolvedValue({ count: 1 });
    txMock.documento.create.mockResolvedValue(documentState);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
    checksumMock.mockResolvedValue(checksum);
    storeAtKeyMock.mockResolvedValue(stored);
    deleteFileMock.mockResolvedValue(undefined);
    auditInTxMock.mockResolvedValue({});
    auditFailureMock.mockResolvedValue({});
    auditSuccessMock.mockResolvedValue({});
    evidenceCreateMock.mockResolvedValue({ created: true, evidence: { id: "evidence-1" } });
  });

  it("allows a VALIDATO proposal and returns document/evidence identifiers", async () => {
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toEqual({
      created: true,
      documentoId: operationId,
      evidenceId: "evidence-1",
    });
  });

  it.each(["PROPOSTO", "RIFIUTATO"])("rejects a %s proposal", async (status) => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...proposal, status });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("validato");
    expect(storeAtKeyMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized role", async () => {
    canManageMock.mockReturnValue(false);
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("non autorizzato");
    expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
  });

  it("derives canonical tenant and enforces tenant access", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(requireTenantAccessMock).toHaveBeenCalledWith({}, "ente-1", { mode: "write", allowWhenEnteMissing: false });
    expect(txMock.documento.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enteId: "ente-1" }) }));
  });

  it("derives canonical procedimento and concessione", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(txMock.documento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ procedimentoId: "procedimento-1", concessioneId: "concessione-1" }),
    }));
  });

  it("forces ATTIVO and UPLOAD_UTENTE", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(txMock.documento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statoDocumento: "ATTIVO", status: "ATTIVO", source: "UPLOAD_UTENTE" }),
    }));
  });

  it("computes checksum server-side and uses the deterministic key", async () => {
    const uploadedFile = file();
    await uploadFascicoloDocumentRequirementEvidence(actionInput({ file: uploadedFile }));
    expect(checksumMock).toHaveBeenCalledWith(uploadedFile);
    expect(storeAtKeyMock).toHaveBeenCalledWith({ storageKey, file: uploadedFile });
  });

  it("creates Documento and DOCUMENT_UPLOAD audit in one transaction", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTxMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      azione: "DOCUMENT_UPLOAD",
      esito: "SUCCESS",
    }));
  });

  it("reuses the frozen Evidence action contract", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(evidenceCreateMock).toHaveBeenCalledWith({ proposalId: "proposal-1", documentoId: operationId });
  });

  it("returns an existing matching Documento without a second put or create", async () => {
    prismaMock.documento.findUnique.mockResolvedValue(documentState);
    evidenceCreateMock.mockResolvedValue({ created: false, evidence: { id: "evidence-1" } });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toMatchObject({ documentoId: operationId });
    expect(storeAtKeyMock).not.toHaveBeenCalled();
    expect(txMock.documento.create).not.toHaveBeenCalled();
  });

  it("converges concurrent same-operation uploads after the unique create race", async () => {
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback(txMock))
      .mockRejectedValueOnce(new Error("unique"));
    prismaMock.documento.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(documentState);
    const results = await Promise.all([uploadDocument(serviceInput()), uploadDocument(serviceInput())]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(prismaMock.documento.findUnique).toHaveBeenCalledTimes(3);
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("rejects an operationId whose persisted facts mismatch", async () => {
    prismaMock.documento.findUnique.mockResolvedValue({ ...documentState, procedimentoId: "procedimento-2" });
    await expect(uploadDocument(serviceInput())).rejects.toThrow("Conflitto di idempotenza");
    expect(storeAtKeyMock).not.toHaveBeenCalled();
  });

  it("does not create Documento or Evidence when storage fails", async () => {
    storeAtKeyMock.mockRejectedValue(new Error("storage failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("Caricamento documento non riuscito");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(evidenceCreateMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "DOCUMENT_UPLOAD",
      metadata: expect.objectContaining({ reason: "STORAGE_WRITE_FAILED" }),
    }));
  });

  it("deletes the object after the Documento transaction fails", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("db failed"));
    await expect(uploadDocument(serviceInput())).rejects.toThrow("db failed");
    expect(deleteFileMock).toHaveBeenCalledWith(storageKey);
  });

  it("rolls back and deletes the object when upload audit fails", async () => {
    auditInTxMock.mockRejectedValue(new Error("audit failed"));
    await expect(uploadDocument(serviceInput())).rejects.toThrow("audit failed");
    expect(deleteFileMock).toHaveBeenCalledWith(storageKey);
  });

  it("compensates Evidence failure by deleting Documento before object", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    const order: string[] = [];
    prismaMock.documento.deleteMany.mockImplementation(async () => { order.push("db"); return { count: 1 }; });
    deleteFileMock.mockImplementation(async () => { order.push("object"); });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");
    expect(order).toEqual(["db", "object"]);
    expect(prismaMock.documento.deleteMany).toHaveBeenCalledWith({
      where: { id: operationId, enteId: "ente-1", procedimentoId: "procedimento-1" },
    });
  });

  it("retains the object when guarded Documento compensation fails", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    prismaMock.documento.deleteMany.mockRejectedValue(new Error("delete db failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");
    expect(deleteFileMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({ azione: "DOCUMENT_UPLOAD_CLEANUP_FAILURE" }));
  });

  it("retains the object when concurrent Evidence prevents Documento compensation", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValueOnce(null);
    prismaMock.documento.deleteMany.mockRejectedValue(new Error("Foreign key constraint failed"));

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");

    expect(prismaMock.fascicoloDocumentRequirementEvidence.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.documento.deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteFileMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "DOCUMENT_UPLOAD_CLEANUP_FAILURE",
      metadata: expect.objectContaining({ cleanupTarget: "DOCUMENTO" }),
    }));
  });

  it("audits object cleanup failure after Documento deletion", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    deleteFileMock.mockRejectedValue(new Error("delete object failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "DOCUMENT_UPLOAD_CLEANUP_FAILURE",
      metadata: expect.objectContaining({ cleanupTarget: "OBJECT" }),
    }));
  });

  it("uses structured logging when cleanup failure audit also fails", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    deleteFileMock.mockRejectedValue(new Error("delete object failed"));
    auditFailureMock.mockRejectedValue(new Error("cleanup audit failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");
    expect(consoleErrorMock).toHaveBeenCalledWith("DOCUMENT_UPLOAD_CLEANUP_FAILURE", expect.any(Object));
  });

  it("writes DOCUMENT_UPLOAD_COMPENSATED after complete compensation", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");
    expect(auditSuccessMock).toHaveBeenCalledWith(expect.objectContaining({ azione: "DOCUMENT_UPLOAD_COMPENSATED" }));
  });

  it("logs compensated audit failure without recreating resources or retrying cleanup", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("evidence failed"));
    auditSuccessMock.mockRejectedValue(new Error("audit unavailable"));

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");

    expect(prismaMock.documento.deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteFileMock).toHaveBeenCalledTimes(1);
    expect(deleteFileMock).toHaveBeenCalledWith(storageKey);
    expect(txMock.documento.create).toHaveBeenCalledTimes(1);
    expect(storeAtKeyMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorMock).toHaveBeenCalledWith("DOCUMENT_UPLOAD_COMPENSATED_AUDIT_FAILURE", {
      operationId,
      documentoId: operationId,
      phase: "EVIDENCE_ASSOCIATION",
      cleanupState: "DOCUMENTO_AND_OBJECT_DELETED",
      errorClass: "Error",
      errorMessage: "audit unavailable",
    });
  });

  it("treats an already committed active Evidence as converged", async () => {
    evidenceCreateMock.mockRejectedValue(new Error("ambiguous response"));
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue({ id: "evidence-1", revokedAt: null });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toMatchObject({ evidenceId: "evidence-1" });
    expect(prismaMock.documento.deleteMany).not.toHaveBeenCalled();
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME before storage", async () => {
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ file: file("application/x-msdownload") }))).rejects.toThrow("Formato file non consentito");
    expect(storeAtKeyMock).not.toHaveBeenCalled();
  });

  it("rejects an empty file before storage", async () => {
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ file: file("text/plain", "") }))).rejects.toThrow("vuoto");
    expect(storeAtKeyMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file using the existing configured limit", async () => {
    const original = process.env.DOCUMENT_MAX_FILE_MB;
    process.env.DOCUMENT_MAX_FILE_MB = "1";
    try {
      const oversized = new File([new Uint8Array(1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
      await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ file: oversized }))).rejects.toThrow("limite configurato");
      expect(storeAtKeyMock).not.toHaveBeenCalled();
    } finally {
      process.env.DOCUMENT_MAX_FILE_MB = original;
    }
  });

  it.each(["enteId", "tenant", "procedimentoId", "concessioneId", "status", "source", "rule", "gap", "legalFacts"])(
    "rejects client-authoritative %s",
    async (field) => {
      await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ [field]: "override" }))).rejects.toThrow();
      expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
    },
  );

  it("returns no raw storage URL or key", async () => {
    const result = await uploadFascicoloDocumentRequirementEvidence(actionInput());
    expect(result).toEqual({ created: true, documentoId: operationId, evidenceId: "evidence-1" });
  });
});
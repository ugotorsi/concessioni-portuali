import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getTenantMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const createFileMock = vi.hoisted(() => vi.fn());
const createVersionMock = vi.hoisted(() => vi.fn());
const reconcileVersionMock = vi.hoisted(() => vi.fn());
const evidenceRecordMock = vi.hoisted(() => vi.fn());
const evidenceAuditMock = vi.hoisted(() => vi.fn());
const auditInTxMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  documento: { create: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  fascicoloDocumentRequirementProposal: { findUnique: vi.fn() },
  documento: { findUnique: vi.fn() },
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
vi.mock("@/server/documents/storage", () => ({ createDocumentFileIfAbsent: createFileMock }));
vi.mock("@/server/documents/sourceFileVersion", () => ({
  createSourceFileVersionInTransaction: createVersionMock,
  reconcileSourceFileVersionIdentityRaceAfterRollback: reconcileVersionMock,
}));
vi.mock("@/server/fascicolo-document-requirement-evidence", () => ({
  createFascicoloDocumentRequirementEvidenceRecordInTransaction: evidenceRecordMock,
  createFascicoloDocumentRequirementEvidenceAuditInTransaction: evidenceAuditMock,
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: auditInTxMock,
  auditFailure: auditFailureMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

import { uploadFascicoloDocumentRequirementEvidence } from "@/server/actions/fascicolo-document-requirement-upload";
import { uploadDocument } from "@/server/documents/uploadService";

const operationId = "2e1bf47e-9b2f-4ee8-a41a-4ea6ca4e4619";
const checksum = createHash("sha256").update("content").digest("hex");
const storageKey = `documents/ente-1/${operationId}/${checksum}`;
const proposal = {
  id: "proposal-1",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  status: "VALIDATO",
  procedimento: { concessioneId: "concessione-1", concessione: { enteId: "ente-1" } },
};
const stored = {
  storageProvider: "s3" as const,
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
  return { proposalId: "proposal-1", operationId, file: file(), tipologia: "NOTA" as const, ...overrides };
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

function documentoP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "Documento", target: ["id"] },
  });
}

function documentFileVersionP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "DocumentFileVersion", target: ["documentId", "sha256"] },
  });
}

describe("B2C9C1A2B2 atomic evidence upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    getTenantMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue(proposal);
    prismaMock.documento.findUnique.mockResolvedValue(null);
    txMock.documento.create.mockResolvedValue(documentState);
    txMock.documento.findUniqueOrThrow.mockResolvedValue(documentState);
    txMock.documento.update.mockResolvedValue({ ...documentState, currentFileVersionId: "version-1" });
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
    createFileMock.mockResolvedValue({ disposition: "CREATED", object: stored, ownedByAttempt: true });
    createVersionMock.mockResolvedValue({ outcome: "CREATED", version: { id: "version-1" } });
    reconcileVersionMock.mockImplementation(async (_input, error) => { throw error; });
    evidenceRecordMock.mockResolvedValue({ created: true, evidence: { id: "evidence-1" } });
    evidenceAuditMock.mockResolvedValue(undefined);
    auditInTxMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
  });

  it("creates Documento, FileVersion, pointer, evidence and ordered audits in one transaction", async () => {
    const events: string[] = [];
    txMock.documento.create.mockImplementation(async () => { events.push("document"); return documentState; });
    createVersionMock.mockImplementation(async () => { events.push("version"); return { outcome: "CREATED", version: { id: "version-1" } }; });
    txMock.documento.update.mockImplementation(async () => { events.push("pointer"); return { ...documentState, currentFileVersionId: "version-1" }; });
    evidenceRecordMock.mockImplementation(async () => { events.push("evidence"); return { created: true, evidence: { id: "evidence-1" } }; });
    auditInTxMock.mockImplementation(async () => { events.push("document-audit"); });
    evidenceAuditMock.mockImplementation(async () => { events.push("evidence-audit"); });

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toEqual({
      created: true,
      documentoId: operationId,
      evidenceId: "evidence-1",
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["document", "version", "pointer", "evidence", "document-audit", "evidence-audit"]);
  });

  it.each(["PROPOSTO", "RIFIUTATO"])("rejects a %s proposal before storage", async (status) => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...proposal, status });

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("validato");

    expect(createFileMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("derives tenant, links, active status and source from persisted server-side context", async () => {
    await uploadFascicoloDocumentRequirementEvidence(actionInput());

    expect(requireTenantAccessMock).toHaveBeenCalledWith({}, "ente-1", {
      mode: "write",
      allowWhenEnteMissing: false,
    });
    expect(txMock.documento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        concessioneId: "concessione-1",
        statoDocumento: "ATTIVO",
        status: "ATTIVO",
        source: "UPLOAD_UTENTE",
      }),
    }));
    expect(evidenceRecordMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      canonicalEnteId: "ente-1",
      proposalId: "proposal-1",
      documentoId: operationId,
      concessioneId: "concessione-1",
    }));
  });

  it.each([
    ["unsupported MIME", file("application/x-msdownload"), "Formato file non consentito"],
    ["empty file", file("text/plain", ""), "vuoto"],
  ])("rejects %s before storage", async (_scenario, uploadedFile, message) => {
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ file: uploadedFile }))).rejects.toThrow(message);
    expect(createFileMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before storage", async () => {
    const original = process.env.DOCUMENT_MAX_FILE_MB;
    process.env.DOCUMENT_MAX_FILE_MB = "1";
    try {
      const oversized = new File([new Uint8Array(1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
      await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ file: oversized }))).rejects.toThrow(
        "limite configurato",
      );
      expect(createFileMock).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.DOCUMENT_MAX_FILE_MB;
      } else {
        process.env.DOCUMENT_MAX_FILE_MB = original;
      }
    }
  });

  it.each(["enteId", "tenant", "procedimentoId", "concessioneId", "status", "source", "rule", "gap", "legalFacts"])(
    "rejects client-authoritative %s",
    async (field) => {
      await expect(uploadFascicoloDocumentRequirementEvidence(actionInput({ [field]: "override" }))).rejects.toThrow();
      expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
      expect(createFileMock).not.toHaveBeenCalled();
    },
  );

  it.each([["CREATED", true], ["ALREADY_EXISTS", false]] as const)(
    "handles storage %s without overwrite or precheck",
    async (disposition, ownedByAttempt) => {
      createFileMock.mockResolvedValue({ disposition, object: stored, ownedByAttempt });
      await uploadFascicoloDocumentRequirementEvidence(actionInput());
      expect(createFileMock).toHaveBeenCalledWith(expect.objectContaining({
        storageKey,
        body: Buffer.from("content"),
        sizeBytes: 7,
        sha256: checksum,
        mimeType: "text/plain",
      }));
    },
  );

  it("materializes once and derives size, hash and normalized MIME from the same buffer", async () => {
    const uploadedFile = file(" TEXT/PLAIN ");
    const arrayBufferSpy = vi.spyOn(uploadedFile, "arrayBuffer");
    await uploadFascicoloDocumentRequirementEvidence(actionInput({ file: uploadedFile }));
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
    expect(createFileMock).toHaveBeenCalledWith(expect.objectContaining({
      body: Buffer.from("content"),
      sizeBytes: Buffer.byteLength("content"),
      sha256: checksum,
      mimeType: "text/plain",
    }));
  });

  it("preserves operationId replay and reuses the atomic records", async () => {
    prismaMock.documento.findUnique.mockResolvedValue(documentState);
    createFileMock.mockResolvedValue({ disposition: "ALREADY_EXISTS", object: stored, ownedByAttempt: false });
    createVersionMock.mockResolvedValue({ outcome: "REUSED", version: { id: "version-1" } });
    evidenceRecordMock.mockResolvedValue({ created: false, evidence: { id: "evidence-1" } });

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toEqual({
      created: false,
      documentoId: operationId,
      evidenceId: "evidence-1",
    });
    expect(txMock.documento.create).not.toHaveBeenCalled();
    expect(txMock.documento.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: operationId } });
    expect(auditInTxMock).not.toHaveBeenCalled();
    expect(evidenceAuditMock).not.toHaveBeenCalled();
  });

  it("converges concurrent same-operation invocations after the Documento identity race", async () => {
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback(txMock))
      .mockRejectedValueOnce(documentoP2002())
      .mockImplementationOnce(async (callback) => callback(txMock));
    prismaMock.documento.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(documentState);
    createFileMock
      .mockResolvedValueOnce({ disposition: "CREATED", object: stored, ownedByAttempt: true })
      .mockResolvedValueOnce({ disposition: "ALREADY_EXISTS", object: stored, ownedByAttempt: false });
    evidenceRecordMock
      .mockResolvedValueOnce({ created: true, evidence: { id: "evidence-1" } })
      .mockResolvedValueOnce({ created: false, evidence: { id: "evidence-1" } });

    const results = await Promise.all([
      uploadFascicoloDocumentRequirementEvidence(actionInput()),
      uploadFascicoloDocumentRequirementEvidence(actionInput()),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(prismaMock.documento.findUnique).toHaveBeenCalledTimes(3);
  });

  it("preserves idempotency conflict detection before storage", async () => {
    prismaMock.documento.findUnique.mockResolvedValue({ ...documentState, procedimentoId: "procedimento-2" });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("Conflitto di idempotenza");
    expect(createFileMock).not.toHaveBeenCalled();
  });

  it("rolls back DB failures without Documento or storage compensation", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("db failed"));
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("db failed");
    expect(createFileMock).toHaveBeenCalledTimes(1);
    expect(prismaMock).not.toHaveProperty("documento.deleteMany");
  });

  it("rejects evidence creation inside the single atomic attempt without legacy compensation", async () => {
    evidenceRecordMock.mockRejectedValue(new Error("evidence failed"));

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence failed");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTxMock).not.toHaveBeenCalled();
    expect(evidenceAuditMock).not.toHaveBeenCalled();
    expect(prismaMock).not.toHaveProperty("documento.deleteMany");
    expect(createFileMock).toHaveBeenCalledTimes(1);
  });

  it("rejects evidence audit failure inside the single atomic attempt without returning success", async () => {
    evidenceAuditMock.mockRejectedValue(new Error("evidence audit failed"));

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("evidence audit failed");

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(evidenceRecordMock).toHaveBeenCalledTimes(1);
    expect(auditInTxMock).toHaveBeenCalledTimes(1);
    expect(evidenceAuditMock).toHaveBeenCalledTimes(1);
    expect(prismaMock).not.toHaveProperty("documento.deleteMany");
  });

  it("reports storage failure through the evidence action before any DB success", async () => {
    createFileMock.mockRejectedValue(new Error("storage failed"));

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow(
      "Caricamento documento non riuscito: errore durante la persistenza storage.",
    );

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(evidenceRecordMock).not.toHaveBeenCalled();
    expect(auditInTxMock).not.toHaveBeenCalled();
    expect(evidenceAuditMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "DOCUMENT_UPLOAD",
      metadata: expect.objectContaining({ reason: "STORAGE_WRITE_FAILED", issue: "storage failed" }),
    }));
  });

  it("reconciles after rollback and retries the entire unit in a fresh transaction", async () => {
    const race = documentoP2002();
    prismaMock.$transaction
      .mockRejectedValueOnce(race)
      .mockImplementationOnce(async (callback) => callback(txMock));
    prismaMock.documento.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(documentState);

    await expect(uploadDocument(serviceInput())).resolves.toMatchObject({ created: false });
    expect(reconcileVersionMock).toHaveBeenCalledWith(expect.objectContaining({ documentId: operationId }), race);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(txMock.documento.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: operationId } });
  });

  it("reconciles a DocumentFileVersion race only after rollback and retries with a fresh transaction client", async () => {
    const race = documentFileVersionP2002();
    const events: string[] = [];
    const firstTx = {
      documento: {
        create: vi.fn(async () => documentState),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
    };
    const secondTx = {
      documento: {
        create: vi.fn(),
        findUniqueOrThrow: vi.fn(async () => documentState),
        update: vi.fn(async () => ({ ...documentState, currentFileVersionId: "version-1" })),
      },
    };
    let transactionCall = 0;
    prismaMock.$transaction.mockImplementation(async (callback) => {
      transactionCall += 1;
      const current = transactionCall === 1 ? firstTx : secondTx;
      events.push(`transaction-${transactionCall}-start`);
      try {
        return await callback(current);
      } catch (error) {
        events.push(`transaction-${transactionCall}-rejected`);
        throw error;
      }
    });
    createVersionMock
      .mockImplementationOnce(async (client) => {
        expect(client).toBe(firstTx);
        throw race;
      })
      .mockImplementationOnce(async (client) => {
        expect(client).toBe(secondTx);
        return { outcome: "REUSED", version: { id: "version-1" } };
      });
    reconcileVersionMock.mockImplementation(async () => {
      events.push("reconcile-reused");
      return { outcome: "REUSED", version: { id: "version-1" } };
    });
    prismaMock.documento.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(documentState);

    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).resolves.toEqual({
      created: true,
      documentoId: operationId,
      evidenceId: "evidence-1",
    });

    expect(events).toEqual([
      "transaction-1-start",
      "transaction-1-rejected",
      "reconcile-reused",
      "transaction-2-start",
    ]);
    expect(reconcileVersionMock).toHaveBeenCalledTimes(1);
    expect(reconcileVersionMock).toHaveBeenCalledWith(expect.objectContaining({ documentId: operationId }), race);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(createVersionMock).toHaveBeenNthCalledWith(1, firstTx, expect.objectContaining({ documentId: operationId }));
    expect(createVersionMock).toHaveBeenNthCalledWith(2, secondTx, expect.objectContaining({ documentId: operationId }));
    expect(firstTx.documento.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(secondTx.documento.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: operationId } });
    expect(evidenceRecordMock).toHaveBeenCalledTimes(1);
    expect(auditInTxMock).not.toHaveBeenCalled();
    expect(evidenceAuditMock).toHaveBeenCalledTimes(1);
    expect(prismaMock).not.toHaveProperty("documento.deleteMany");
  });

  it("rejects tenant, proposal and file failures before storage", async () => {
    requireTenantAccessMock.mockImplementationOnce(() => { throw new Error("tenant denied"); });
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("Accesso tenant non consentito");
    expect(createFileMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "AUTHZ_DENIED",
      entita: "Documento",
      concessioneId: "concessione-1",
      enteId: "ente-1",
      actor: {
        userId: "user-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
      metadata: {
        actionType: "DOCUMENT_REQUIREMENT_EVIDENCE_UPLOAD",
        reason: "CROSS_TENANT_BLOCKED",
      },
    }));

    vi.clearAllMocks();
    canManageMock.mockReturnValue(false);
    requireRoleMock.mockResolvedValue("VIEWER_ADSP");
    await expect(uploadFascicoloDocumentRequirementEvidence(actionInput())).rejects.toThrow("non autorizzato");
  });

  it("keeps the technical preview actor out of user foreign keys", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await uploadFascicoloDocumentRequirementEvidence(actionInput());

    expect(evidenceRecordMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      createdByUserId: null,
      createdByActorId: "staging-preview-admin",
      createdByEmail: "preview@example.test",
    }));
  });
});
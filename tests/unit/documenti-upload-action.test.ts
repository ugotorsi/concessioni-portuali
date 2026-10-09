import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditInTxMock = vi.hoisted(() => vi.fn());
const uploadDocumentMock = vi.hoisted(() => vi.fn());
const createNeutralIntakeMock = vi.hoisted(() => vi.fn());
const admitAsyncJobMock = vi.hoisted(() => vi.fn());
const createDocumentFileMock = vi.hoisted(() => vi.fn());
const createVersionMock = vi.hoisted(() => vi.fn());
const reconcileVersionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  documento: { create: vi.fn(), update: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  documento: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  BACKOFFICE_ROLES: ["ADMIN"],
  canManageProcedimenti: canManageProcedimentiMock,
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
  createAuditLogInTransaction: auditInTxMock,
}));
vi.mock("@/server/documents/storage", () => ({
  createDocumentFileIfAbsent: createDocumentFileMock,
}));
vi.mock("@/server/documents/sourceFileVersion", () => ({
  createSourceFileVersionInTransaction: createVersionMock,
  reconcileSourceFileVersionIdentityRaceAfterRollback: reconcileVersionMock,
}));
vi.mock("@/server/documents/validation", () => ({
  buildLinkedEntityMetadata: vi.fn(() => ({ procedimentoId: "procedimento-1" })),
  validateUploadFile: vi.fn(),
  parseUploadDocumentFormData: vi.fn(() => ({
    nome: "verbale.txt",
    tipologia: "VERBALE",
    source: "UPLOAD_UTENTE",
    status: "ATTIVO",
    descrizione: "Verbale istruttorio",
    dataDocumento: null,
    direzione: "ENTRATA",
    canale: "PEC",
    numeroProtocollo: "PG/2026/001",
    dataProtocollo: new Date("2026-08-01T00:00:00.000Z"),
    mittente: null,
    destinatario: null,
    pecMessageId: null,
    pecRicevutaAccettazioneId: null,
    pecRicevutaConsegnaId: null,
    pecWarningMancataRicevuta: false,
    procedimentoId: "procedimento-1",
    file: new File(["contenuto"], "verbale.txt", { type: "text/plain" }),
  })),
  DOCUMENT_TIPOLOGIA_VALUES: ["VERBALE"],
}));
vi.mock("@/server/documents/protocollo", () => ({
  DOCUMENT_CANALE_VALUES: ["PEC"],
  DOCUMENT_DIREZIONE_VALUES: ["ENTRATA"],
  normalizeProtocolloMetadata: vi.fn((input) => ({
    ...input,
    dataProtocollo: input.dataProtocollo ? new Date(`${input.dataProtocollo}T00:00:00.000Z`) : null,
    pecWarningMancataRicevuta: false,
  })),
}));
vi.mock("@/server/documents/uploadService", () => ({ uploadDocument: uploadDocumentMock }));
vi.mock("@/server/intake/createNeutralIntake", () => ({ createNeutralIntake: createNeutralIntakeMock }));
vi.mock("@/server/async-jobs/persistence", () => ({ admitAsyncJobInTransaction: admitAsyncJobMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  archiveDocumentoAction,
  createDocumentoUploadAction,
  updateDocumentoMetadataAction,
} from "@/server/actions/documenti";
import { DocumentStorageS3Error } from "@/server/documents/storage/s3StorageAdapter";

function archiveFormData() {
  const formData = new FormData();
  formData.set("id", "documento-1");
  return formData;
}

function uploadFormData() {
  return new FormData();
}

function metadataFormData() {
  const formData = archiveFormData();
  formData.set("nome", "Verbale aggiornato");
  formData.set("tipologia", "VERBALE");
  formData.set("descrizione", "Descrizione aggiornata");
  formData.set("direzione", "ENTRATA");
  formData.set("canale", "PEC");
  formData.set("numeroProtocollo", "PG/2026/002");
  formData.set("dataProtocollo", "2026-08-02");
  return formData;
}

describe("createDocumentoUploadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentTenantContextMock.mockResolvedValue({});
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.documento.findUnique.mockResolvedValue({
      id: "documento-1",
      enteId: "ente-1",
      concessione: { enteId: "ente-1" },
    });
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-1",
      enteId: "ente-1",
    });
    prismaMock.documento.create.mockResolvedValue({
      id: "documento-1",
      concessioneId: null,
      criticitaId: null,
      procedimentoId: "procedimento-1",
      sopralluogoId: null,
      pagamentoId: null,
      reportId: null,
    });
    prismaMock.documento.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
    txMock.documento.create.mockResolvedValue({ id: "documento-1" });
    txMock.documento.update.mockResolvedValue({ id: "documento-1", procedimentoId: "procedimento-1" });
    createVersionMock.mockResolvedValue({ outcome: "CREATED", version: { id: "version-1" } });
    reconcileVersionMock.mockImplementation(async (_input, error) => { throw error; });
    uploadDocumentMock.mockResolvedValue({
      created: true,
      storageKey: "documento-1/123-verbale.txt",
      checksum: "sha256-test",
      document: {
        id: "documento-1",
        concessioneId: null,
        criticitaId: null,
        procedimentoId: "procedimento-1",
        sopralluogoId: null,
        pagamentoId: null,
        reportId: null,
      },
    });
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
  });

  it("archives a procedure upload directly with its canonical tenant and no automatic pipeline", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await createDocumentoUploadAction(uploadFormData());

    expect(requireTenantAccessMock).toHaveBeenCalledWith({}, "ente-1", {
      mode: "write",
      allowWhenEnteMissing: false,
    });
    expect(uploadDocumentMock).toHaveBeenCalledWith({
      documentId: expect.any(String),
      file: expect.objectContaining({ name: "verbale.txt", type: "text/plain" }),
      actor: {
        id: "staging-preview-admin",
        email: "preview@example.test",
        role: "ADMIN",
      },
      enteId: "ente-1",
      concessioneId: undefined,
      criticitaId: undefined,
      procedimentoId: "procedimento-1",
      sopralluogoId: undefined,
      pagamentoId: undefined,
      reportId: undefined,
      nome: "verbale.txt",
      tipologia: "VERBALE",
      descrizione: "Verbale istruttorio",
      dataDocumento: null,
      source: "UPLOAD_UTENTE",
      status: "ATTIVO",
      direzione: "ENTRATA",
      canale: "PEC",
      numeroProtocollo: "PG/2026/001",
      dataProtocollo: new Date("2026-08-01T00:00:00.000Z"),
      mittente: null,
      destinatario: null,
      pecMessageId: null,
      pecRicevutaAccettazioneId: null,
      pecRicevutaConsegnaId: null,
      pecWarningMancataRicevuta: false,
    });
    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(admitAsyncJobMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it("passes the authenticated user provenance to the direct upload service", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });

    await createDocumentoUploadAction(uploadFormData());

    expect(uploadDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        id: "user-1",
        email: "admin@example.test",
        role: "ADMIN",
      },
    }));
    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(admitAsyncJobMock).not.toHaveBeenCalled();
  });

  it("preserves a null actor email and returns to the current fascicolo", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: null });

    await createDocumentoUploadAction(uploadFormData());

    expect(uploadDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: { id: "user-1", email: null, role: "ADMIN" },
    }));
    expect(redirectMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it("rejects a cross-tenant procedure upload before storage", async () => {
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementationOnce(() => { throw new Error("tenant denied"); });

    await expect(createDocumentoUploadAction(uploadFormData())).rejects.toThrow("Accesso tenant non consentito");

    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(uploadDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a procedure upload without authenticated tenant context before storage", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    getCurrentTenantContextMock.mockResolvedValue(null);

    await expect(createDocumentoUploadAction(uploadFormData())).rejects.toThrow("Contesto tenant autenticato richiesto");

    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(uploadDocumentMock).not.toHaveBeenCalled();
  });

  it("rejects a role without procedure-management authority before storage", async () => {
    canManageProcedimentiMock.mockReturnValue(false);

    await expect(createDocumentoUploadAction(uploadFormData())).rejects.toThrow("Profilo non autorizzato");

    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(uploadDocumentMock).not.toHaveBeenCalled();
  });

  it("preserves S3 storage diagnostics and the user-facing failure through the shared service", async () => {
    const { uploadDocument } = await vi.importActual<typeof import("@/server/documents/uploadService")>(
      "@/server/documents/uploadService",
    );
    createDocumentFileMock.mockRejectedValue(new DocumentStorageS3Error("Storage S3 PUT failed (TimeoutError).", {
      provider: "s3",
      operation: "PUT",
      code: "TimeoutError",
      statusCode: 503,
      retryable: true,
      bucketConfigured: true,
      endpointConfigured: true,
      regionConfigured: true,
      forcePathStyle: true,
    }));
    await expect(uploadDocument({
      documentId: "documento-1",
      file: new File(["contenuto"], "verbale.txt", { type: "text/plain" }),
      actor: { id: "user-1", email: null, role: "ADMIN" },
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      nome: "verbale.txt",
      tipologia: "VERBALE",
      source: "UPLOAD_UTENTE",
      status: "ATTIVO",
    })).rejects.toThrow("Caricamento documento non riuscito: errore durante la persistenza storage.");

    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "DOCUMENT_UPLOAD",
      actor: expect.objectContaining({ userEmail: null }),
      metadata: {
        reason: "STORAGE_WRITE_FAILED",
        issue: "Storage S3 PUT failed (TimeoutError).",
        storageDiagnostics: {
          provider: "s3",
          operation: "PUT",
          code: "TimeoutError",
          statusCode: 503,
          retryable: true,
          bucketConfigured: true,
          endpointConfigured: true,
          regionConfigured: true,
          forcePathStyle: true,
        },
      },
    }));
  });

  it("fails closed before storage when no canonical tenant can be derived", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-1",
      enteId: null,
    });

    await expect(createDocumentoUploadAction(uploadFormData())).rejects.toThrow("Tenant canonico non derivabile");
    expect(createNeutralIntakeMock).not.toHaveBeenCalled();
    expect(uploadDocumentMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: "CANONICAL_TENANT_REQUIRED" }),
    }));
  });

  it.each([["CREATED", true], ["ALREADY_EXISTS", false]] as const)(
    "uses one normalized buffer and conditional storage for generic %s",
    async (disposition, ownedByAttempt) => {
      const { uploadDocument } = await vi.importActual<typeof import("@/server/documents/uploadService")>(
        "@/server/documents/uploadService",
      );
      const file = new File(["contenuto"], "verbale.txt", { type: " TEXT/PLAIN " });
      const arrayBufferSpy = vi.spyOn(file, "arrayBuffer");
      const checksum = createHash("sha256").update("contenuto").digest("hex");
      const storageKey = `documents/ente-1/documento-1/${checksum}`;
      createDocumentFileMock.mockResolvedValue({
        disposition,
        ownedByAttempt,
        object: {
          storageProvider: "local",
          storageKey,
          fileName: checksum,
          bucket: null,
          sizeBytes: Buffer.byteLength("contenuto"),
          sha256: checksum,
          mimeType: "text/plain",
          originalName: "verbale.txt",
        },
      });

      await expect(uploadDocument({
        documentId: "documento-1",
        file,
        actor: { id: "user-1", email: null, role: "ADMIN" },
        enteId: "ente-1",
        procedimentoId: "procedimento-1",
        nome: "verbale.txt",
        tipologia: "VERBALE",
        source: "UPLOAD_UTENTE",
        status: "ATTIVO",
      })).resolves.toMatchObject({ created: true, storageKey, checksum });

      expect(arrayBufferSpy).toHaveBeenCalledTimes(1);
      expect(createDocumentFileMock).toHaveBeenCalledWith({
        storageKey,
        body: Buffer.from("contenuto"),
        mimeType: "text/plain",
        originalName: "verbale.txt",
        sha256: checksum,
        sizeBytes: Buffer.byteLength("contenuto"),
      });
      expect(txMock.documento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "documento-1",
          enteId: "ente-1",
          procedimentoId: "procedimento-1",
          storageKey,
          storageProvider: "local",
          storageBucket: null,
          checksumSha256: checksum,
          sha256: checksum,
          url: "/documenti/documento-1/download",
        }),
      });
      expect(createVersionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
        documentId: "documento-1",
        canonicalEnteId: "ente-1",
        storageKey,
        sizeBytes: Buffer.byteLength("contenuto"),
        sha256: checksum,
        mimeType: "text/plain",
      }));
      expect(txMock.documento.update).toHaveBeenCalledWith({
        where: { id: "documento-1" },
        data: { currentFileVersionId: "version-1" },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(auditInTxMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
        azione: "DOCUMENT_UPLOAD",
        entitaId: "documento-1",
        enteId: "ente-1",
        esito: "SUCCESS",
        metadata: expect.objectContaining({
          storageKey,
          linkedEntities: expect.objectContaining({ procedimentoId: "procedimento-1" }),
        }),
      }));
      expect(createNeutralIntakeMock).not.toHaveBeenCalled();
      expect(admitAsyncJobMock).not.toHaveBeenCalled();
    },
  );
});

describe("document archive and metadata audit actors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentTenantContextMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.documento.findUnique.mockResolvedValue({
      id: "documento-1",
      enteId: "ente-1",
      concessione: { enteId: "ente-1" },
    });
    prismaMock.documento.update.mockResolvedValue({
      id: "documento-1",
      concessioneId: "concessione-1",
      criticitaId: null,
      procedimentoId: "procedimento-1",
      sopralluogoId: null,
      pagamentoId: null,
      reportId: null,
    });
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
  });

  it("archives with a null audit User FK for the technical Preview actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await archiveDocumentoAction(archiveFormData());

    expect(prismaMock.documento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statoDocumento: "ARCHIVIATO", status: "ARCHIVIATO" }) }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: "DOCUMENT_ARCHIVE", actor: expect.objectContaining({ userId: null }) }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
    expect(redirectMock).toHaveBeenCalledWith("/documenti");
  });

  it("archives with the persisted actor User FK", async () => {
    await archiveDocumentoAction(archiveFormData());

    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("updates metadata with a null audit User FK for the technical Preview actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await updateDocumentoMetadataAction(metadataFormData());

    expect(prismaMock.documento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nome: "Verbale aggiornato", numeroProtocollo: "PG/2026/002" }) }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ azione: "DOCUMENT_METADATA_UPDATE", actor: expect.objectContaining({ userId: null }) }),
    );
    expect(redirectMock).toHaveBeenCalledWith("/documenti");
  });

  it("updates metadata with the persisted actor User FK", async () => {
    await updateDocumentoMetadataAction(metadataFormData());

    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("writes a null audit User FK when tenant enforcement denies the technical Preview actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("TENANT_WRITE_DENIED");
    });

    await expect(archiveDocumentoAction(archiveFormData())).rejects.toThrow("Accesso tenant non consentito.");

    expect(prismaMock.documento.update).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: null }) }),
    );
  });
});
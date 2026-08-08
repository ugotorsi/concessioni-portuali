import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const storeDocumentFileMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  documento: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  BACKOFFICE_ROLES: ["ADMIN"],
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
}));
vi.mock("@/server/documents/validation", () => ({
  buildLinkedEntityMetadata: vi.fn(() => ({ procedimentoId: "procedimento-1" })),
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
vi.mock("@/server/documents/storage", () => ({ storeDocumentFile: storeDocumentFileMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import {
  archiveDocumentoAction,
  createDocumentoUploadAction,
  updateDocumentoMetadataAction,
} from "@/server/actions/documenti";

function archiveFormData() {
  const formData = new FormData();
  formData.set("id", "documento-1");
  return formData;
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
    getCurrentTenantContextMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.documento.findUnique.mockResolvedValue({
      id: "documento-1",
      enteId: "ente-1",
      concessione: { enteId: "ente-1" },
    });
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-1",
      concessione: { enteId: "ente-1" },
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
    storeDocumentFileMock.mockResolvedValue({
      fileName: "stored-verbale.txt",
      storageKey: "documento-1/123-verbale.txt",
      storageProvider: "local",
      bucket: null,
      publicUrl: null,
      mimeType: "text/plain",
      originalName: "verbale.txt",
      sizeBytes: 9,
      sha256: "sha256-test",
    });
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
  });

  it("writes null User FKs for the technical Preview actor while preserving document linkage and storage metadata", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await createDocumentoUploadAction(new FormData());

    expect(prismaMock.documento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          uploadedByUserId: null,
          procedimentoId: "procedimento-1",
          nome: "verbale.txt",
          tipologia: "VERBALE",
          source: "UPLOAD_UTENTE",
          status: "ATTIVO",
          descrizione: "Verbale istruttorio",
          numeroProtocollo: "PG/2026/001",
        }),
      }),
    );
    expect(prismaMock.documento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storageKey: "documento-1/123-verbale.txt" }),
      }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: null }) }),
    );
  });

  it("writes persisted User FKs for a persisted actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });

    await createDocumentoUploadAction(new FormData());

    expect(prismaMock.documento.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ uploadedByUserId: "user-1" }) }),
    );
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: expect.objectContaining({ userId: "user-1" }) }),
    );
  });
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
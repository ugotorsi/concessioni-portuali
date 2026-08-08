import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const storeDocumentFileMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  documento: { create: vi.fn(), update: vi.fn() },
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
  DOCUMENT_TIPOLOGIA_VALUES: [],
}));
vi.mock("@/server/documents/protocollo", () => ({
  DOCUMENT_CANALE_VALUES: [],
  DOCUMENT_DIREZIONE_VALUES: [],
  normalizeProtocolloMetadata: vi.fn(),
}));
vi.mock("@/server/documents/storage", () => ({ storeDocumentFile: storeDocumentFileMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createDocumentoUploadAction } from "@/server/actions/documenti";

describe("createDocumentoUploadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentTenantContextMock.mockResolvedValue(null);
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
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  fascicoloObservation: { updateMany: vi.fn() },
  activityLog: { findFirst: vi.fn(), create: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  documento: { findMany: vi.fn() },
  fascicoloObservation: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

vi.mock("@/lib/auth", () => ({
  canManageProcedimenti: vi.fn(() => true),
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditInTransactionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { refreshFascicoloObservationsAction, reviewFascicoloObservationAction } from "@/server/actions/fascicolo-observations";
import { getFascicoloObservations } from "@/server/queries/fascicolo-observations";

function refreshFormData() {
  const formData = new FormData();
  formData.set("procedimentoId", "procedimento-1");
  return formData;
}

function reviewFormData(status: "VALIDATO" | "RIFIUTATO" | "SUPERATO", reviewNote?: string) {
  const formData = new FormData();
  formData.set("observationId", "observation-1");
  formData.set("status", status);
  if (reviewNote) formData.set("reviewNote", reviewNote);
  return formData;
}

const procedure = { id: "procedimento-1", concessioneId: "concessione-1", concessione: { enteId: "ente-1" } };
const warningDocument = {
  id: "documento-1",
  procedimentoId: "procedimento-1",
  enteId: "ente-1",
  statoDocumento: "ATTIVO",
  canale: "PEC",
  pecRicevutaAccettazioneId: null,
  pecRicevutaConsegnaId: null,
  pecWarningMancataRicevuta: true,
};

describe("fascicolo observation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue(procedure);
    prismaMock.documento.findMany.mockResolvedValue([warningDocument]);
    prismaMock.fascicoloObservation.createMany.mockResolvedValue({ count: 1 });
    prismaMock.fascicoloObservation.findUnique.mockResolvedValue({
      id: "observation-1",
      status: "PROPOSTO",
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      procedimento: { concessioneId: "concessione-1", concessione: { enteId: "ente-1" } },
    });
    prismaMock.fascicoloObservation.findMany.mockResolvedValue([]);
    txMock.fascicoloObservation.updateMany.mockResolvedValue({ count: 1 });
    auditInTransactionMock.mockResolvedValue({});
  });

  it("refreshes only candidates through createMany with skipDuplicates and no P0 side effects", async () => {
    await refreshFascicoloObservationsAction(refreshFormData());

    expect(prismaMock.fascicoloObservation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ documentoId: "documento-1" })] }),
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it("does not create observations when no document matches", async () => {
    prismaMock.documento.findMany.mockResolvedValue([]);

    await refreshFascicoloObservationsAction(refreshFormData());

    expect(prismaMock.fascicoloObservation.createMany).not.toHaveBeenCalled();
  });

  it("denies tenant access before any observation write", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("Tenant access denied.");
    });

    await expect(refreshFascicoloObservationsAction(refreshFormData())).rejects.toThrow("Tenant access denied.");

    expect(prismaMock.fascicoloObservation.createMany).not.toHaveBeenCalled();
  });

  it("preserves the technical actor snapshot while writing no User FK", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });

    await reviewFascicoloObservationAction(reviewFormData("VALIDATO"));

    expect(txMock.fascicoloObservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "observation-1", status: "PROPOSTO", enteId: "ente-1" },
        data: expect.objectContaining({ reviewedByUserId: null, reviewedByActorId: "staging-preview-admin" }),
      }),
    );
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({ actor: expect.objectContaining({ userId: null }) }));
  });

  it("preserves a persisted User FK and writes audit through the same transaction path", async () => {
    await reviewFascicoloObservationAction(reviewFormData("VALIDATO"));

    expect(txMock.fascicoloObservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "observation-1", status: "PROPOSTO", enteId: "ente-1" },
        data: expect.objectContaining({ reviewedByUserId: "user-1", reviewedByActorId: "user-1" }),
      }),
    );
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.any(Object));
  });

  it("blocks a second review when the guarded update affects no proposed observation", async () => {
    txMock.fascicoloObservation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(reviewFascicoloObservationAction(reviewFormData("SUPERATO", "Gia verificata"))).rejects.toThrow(
      "gia revisionata o non piu disponibile",
    );

    expect(txMock.fascicoloObservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "observation-1", status: "PROPOSTO", enteId: "ente-1" } }),
    );
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each(["RIFIUTATO", "SUPERATO"] as const)("rejects %s without a review note", async (status) => {
    await expect(reviewFascicoloObservationAction(reviewFormData(status))).rejects.toThrow("nota di review e obbligatoria");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("does not permit review of terminal observations", async () => {
    prismaMock.fascicoloObservation.findUnique.mockResolvedValueOnce({
      id: "observation-1",
      status: "VALIDATO",
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      procedimento: { concessioneId: "concessione-1", concessione: { enteId: "ente-1" } },
    });

    await expect(reviewFascicoloObservationAction(reviewFormData("SUPERATO", "Nuova verifica"))).rejects.toThrow("non disponibile");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns a cleared current condition without writing or changing the persisted status", async () => {
    prismaMock.fascicoloObservation.findMany.mockResolvedValue([
      {
        id: "observation-1",
        status: "PROPOSTO",
        ruleCode: "P1-PEC-RECEIPT-001",
        ruleVersion: 1,
        detectedAt: new Date("2026-08-08T00:00:00.000Z"),
        reviewedAt: null,
        reviewNote: null,
        factsSnapshot: {
          canale: "PEC",
          pecRicevutaAccettazioneId: null,
          pecRicevutaConsegnaId: null,
          pecWarningMancataRicevuta: true,
        },
        documento: { id: "documento-1", nome: "PEC", pecWarningMancataRicevuta: false },
      },
    ]);

    const observations = await getFascicoloObservations("procedimento-1");

    expect(observations[0]).toMatchObject({ status: "PROPOSTO", currentConditionDetected: false });
    expect(prismaMock.fascicoloObservation.createMany).not.toHaveBeenCalled();
    expect(txMock.fascicoloObservation.updateMany).not.toHaveBeenCalled();
  });
});
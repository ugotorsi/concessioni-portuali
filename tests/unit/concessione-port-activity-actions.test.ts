import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const permissionMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireConcessioneTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  concessione: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

vi.mock("@/lib/auth", () => ({
  canManageConcessioneLegalClassification: permissionMock,
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireConcessioneTenantAccess: requireConcessioneTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditInTransactionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { updateConcessionePortActivityLegalType } from "@/server/actions/concessioni";

function createForm(value: string | null = "OPERAZIONI_PORTUALI") {
  const formData = new FormData();
  formData.set("concessioneId", "concessione-1");
  formData.set("portActivityLegalType", value ?? "");
  return formData;
}

describe("concessione port activity legal type action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    permissionMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue({ enteId: "ente-1" });
    requireConcessioneTenantAccessMock.mockResolvedValue({ id: "concessione-1", enteId: "ente-1" });
    txMock.concessione.findUnique.mockResolvedValue({ portActivityLegalType: null, enteId: "ente-1" });
    txMock.concessione.updateMany.mockResolvedValue({ count: 1 });
    auditInTransactionMock.mockResolvedValue({});
  });

  it("requires the dedicated permission before tenant access", async () => {
    permissionMock.mockReturnValue(false);
    await expect(updateConcessionePortActivityLegalType(createForm())).rejects.toThrow("non autorizzato");
    expect(requireConcessioneTenantAccessMock).not.toHaveBeenCalled();
  });

  it("rejects invalid client input before tenant access", async () => {
    await expect(updateConcessionePortActivityLegalType(createForm("PORTUALE_ADSP"))).rejects.toThrow();
    expect(requireConcessioneTenantAccessMock).not.toHaveBeenCalled();
  });

  it("requires write access with a canonical tenant", async () => {
    await updateConcessionePortActivityLegalType(createForm());
    expect(requireConcessioneTenantAccessMock).toHaveBeenCalledWith(
      { enteId: "ente-1" },
      "concessione-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
  });

  it("propagates tenant rejection without starting a transaction", async () => {
    requireConcessioneTenantAccessMock.mockRejectedValue(new Error("tenant denied"));
    await expect(updateConcessionePortActivityLegalType(createForm())).rejects.toThrow("tenant denied");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("writes with the previous value and tenant as optimistic guards", async () => {
    txMock.concessione.findUnique.mockResolvedValue({ portActivityLegalType: "SERVIZI_PORTUALI", enteId: "ente-1" });
    await updateConcessionePortActivityLegalType(createForm("OPERAZIONI_PORTUALI"));
    expect(txMock.concessione.updateMany).toHaveBeenCalledWith({
      where: {
        id: "concessione-1",
        enteId: "ente-1",
        portActivityLegalType: "SERVIZI_PORTUALI",
      },
      data: { portActivityLegalType: "OPERAZIONI_PORTUALI" },
    });
  });

  it("supports classification removal and audits both values in the transaction", async () => {
    txMock.concessione.findUnique.mockResolvedValue({ portActivityLegalType: "PASSEGGERI", enteId: "ente-1" });
    await updateConcessionePortActivityLegalType(createForm(null));
    expect(txMock.concessione.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { portActivityLegalType: null } }));
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      azione: "CONCESSIONE_PORT_ACTIVITY_LEGAL_TYPE_UPDATE",
      entitaId: "concessione-1",
      enteId: "ente-1",
      concessioneId: "concessione-1",
      metadata: expect.objectContaining({ previousValue: "PASSEGGERI", newValue: null }),
    }));
  });

  it("does not write or audit an unchanged value", async () => {
    txMock.concessione.findUnique.mockResolvedValue({ portActivityLegalType: "ALTRO", enteId: "ente-1" });
    await updateConcessionePortActivityLegalType(createForm("ALTRO"));
    expect(txMock.concessione.updateMany).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a concurrent update and emits no losing audit", async () => {
    txMock.concessione.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateConcessionePortActivityLegalType(createForm())).rejects.toThrow("altro operatore");
    expect(auditInTransactionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("uses no User FK for the technical preview actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test", role: "ADMIN" });
    await updateConcessionePortActivityLegalType(createForm());
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      actor: { userId: null, userEmail: "preview@example.test", userRole: "ADMIN" },
    }));
  });

  it("revalidates only the concession detail after a successful transaction", async () => {
    await updateConcessionePortActivityLegalType(createForm());
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/concessioni/concessione-1");
  });
});
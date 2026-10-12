import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const changeConcessioneExpiryMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  canManageConcessioneLegalClassification: vi.fn(),
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireConcessioneTenantAccess: vi.fn(),
}));
vi.mock("@/server/fascicolo-lifecycle/concessioneExpiryChange", () => ({
  changeConcessioneExpiry: changeConcessioneExpiryMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { changeConcessioneExpiryAction } from "@/server/actions/concessioni";

function createForm() {
  const formData = new FormData();
  formData.set("requestId", "request-1");
  formData.set("concessioneId", "concessione-1");
  formData.set("expectedGeneration", "3");
  formData.set("expectedDataScadenza", "2027-01-15T14:30:00.000Z");
  formData.set("newDate", "2027-02-01");
  formData.set("motivation", "Proroga formalizzata");
  formData.set("reference", "Atto 42/2026");
  return formData;
}

describe("concessione expiry change action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("OPERATORE_SOCIETA");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "OPERATORE_SOCIETA" });
    getCurrentTenantContextMock.mockResolvedValue({ userId: "user-1", tenantMemberships: [] });
    changeConcessioneExpiryMock.mockResolvedValue({
      outcome: "UPDATED",
      concessioneId: "concessione-1",
      expiryGeneration: 4,
    });
  });

  it("inoltra al servizio l ISO esatto e la generazione attesa", async () => {
    await changeConcessioneExpiryAction(createForm());

    expect(changeConcessioneExpiryMock).toHaveBeenCalledWith({
      command: {
        requestId: "request-1",
        concessioneId: "concessione-1",
        expectedGeneration: 3,
        expectedDataScadenza: "2027-01-15T14:30:00.000Z",
        newDate: "2027-02-01",
        motivation: "Proroga formalizzata",
        reference: "Atto 42/2026",
      },
      actor: { id: "user-1", email: "user@example.test", role: "OPERATORE_SOCIETA" },
      tenantContext: { userId: "user-1", tenantMemberships: [] },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/concessioni/concessione-1");
  });

  it("propaga il flag server-side disabilitato", async () => {
    changeConcessioneExpiryMock.mockRejectedValueOnce(new Error("CONCESSIONE_EXPIRY_CHANGE_DISABLED"));

    await expect(changeConcessioneExpiryAction(createForm())).rejects.toThrow("CONCESSIONE_EXPIRY_CHANGE_DISABLED");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("trasforma il CONFLICT in un errore operatore senza revalidation", async () => {
    changeConcessioneExpiryMock.mockResolvedValueOnce({ outcome: "CONFLICT", concessioneId: "concessione-1" });

    await expect(changeConcessioneExpiryAction(createForm())).rejects.toThrow("altro operatore");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
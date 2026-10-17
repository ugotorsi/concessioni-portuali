import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const provisionMock = vi.hoisted(() => vi.fn());
const readAuthorizationMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ auditSuccess: auditSuccessMock }));
vi.mock("@/server/runtime/procedimentoBudgetPolicy", () => ({
  provisionDefaultProcedimentoBudgetPolicy: provisionMock,
  readDefaultProcedimentoBudgetAuthorization: readAuthorizationMock,
}));
vi.mock("@/server/async-jobs/persistence", () => ({
  retryTerminalAsyncJob: vi.fn(),
}));
vi.mock("@/server/async-jobs/documentWorkerActivation", () => ({
  documentWorkerKindForOperation: vi.fn(),
  requestDocumentWorkerActivation: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { assignDefaultProcedimentoBudgetPolicy } from "@/app/admin/runtime/actions";

function formData() {
  const data = new FormData();
  data.set("procedimentoId", "procedure-1");
  return data;
}

describe("assignDefaultProcedimentoBudgetPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "admin-1",
      role: "ADMIN",
      isAdmin: true,
      defaultTenantId: "tenant-1",
      accessibleTenantIds: ["tenant-1"],
    });
    readAuthorizationMock.mockReturnValue({
      authorized: true,
      currency: "EUR",
      hardCapAmount: "1.000000",
      windowSeconds: 86_400,
    });
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedure-1",
      enteId: "tenant-1",
    });
    provisionMock.mockResolvedValue({
      outcome: "CREATED",
      policy: {
        id: "policy-1",
        enabled: true,
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });
  });

  it("requires ADMIN and tenant write access before provisioning", async () => {
    await assignDefaultProcedimentoBudgetPolicy(formData());

    expect(requireRoleMock).toHaveBeenCalledWith(["ADMIN"]);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(provisionMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization: {
        authorized: true,
        currency: "EUR",
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });
  });

  it("fails closed when the default budget is not authorized", async () => {
    readAuthorizationMock.mockReturnValue({ authorized: false });

    await expect(assignDefaultProcedimentoBudgetPolicy(formData()))
      .rejects.toThrow("PROCEDIMENTO_BUDGET_NOT_AUTHORIZED");
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("does not provision a missing or tenant-less procedimento", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(null);

    await expect(assignDefaultProcedimentoBudgetPolicy(formData()))
      .rejects.toThrow("PROCEDIMENTO_NOT_FOUND");
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
    expect(provisionMock).not.toHaveBeenCalled();
  });
});

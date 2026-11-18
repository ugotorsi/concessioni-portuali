import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminWithMfaMock = vi.hoisted(() => vi.fn());
const procedimentoFindUniqueMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: requireAdminWithMfaMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: procedimentoFindUniqueMock },
  },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));

import { updateFascicoloAiPolicyAction } from "@/server/actions/fascicolo-ai-policy";

function requestForm(): FormData {
  const formData = new FormData();
  formData.set("confirmation", "UPDATE_FASCICOLO_AI_POLICY");
  formData.set("procedimentoId", "case-1");
  return formData;
}

describe("fascicolo AI policy action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires ADMIN with MFA before reading the fascicolo", async () => {
    requireAdminWithMfaMock.mockRejectedValue(new Error("MFA_REQUIRED"));

    await expect(updateFascicoloAiPolicyAction(requestForm()))
      .rejects.toThrow("MFA_REQUIRED");
    expect(procedimentoFindUniqueMock).not.toHaveBeenCalled();
  });

  it("enforces tenant write access before parsing or persisting policy", async () => {
    requireAdminWithMfaMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    procedimentoFindUniqueMock.mockResolvedValue({ enteId: "tenant-2" });
    getCurrentTenantContextMock.mockResolvedValue({ activeEnteId: "tenant-1" });
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("TENANT_ACCESS_DENIED");
    });

    await expect(updateFascicoloAiPolicyAction(requestForm()))
      .rejects.toThrow("TENANT_ACCESS_DENIED");
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      { activeEnteId: "tenant-1" },
      "tenant-2",
      { mode: "write", allowWhenEnteMissing: false },
    );
  });
});

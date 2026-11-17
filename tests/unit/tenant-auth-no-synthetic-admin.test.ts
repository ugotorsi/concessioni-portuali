import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const tenantMembershipFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantMembership: {
      findMany: tenantMembershipFindManyMock,
    },
  },
}));

import { getCurrentTenantContext } from "@/lib/tenant-auth";

describe("tenant auth without synthetic admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no authenticated user exists", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(getCurrentTenantContext()).resolves.toBeNull();
    expect(tenantMembershipFindManyMock).not.toHaveBeenCalled();
  });

  it("builds context from DB memberships only", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "u-10",
      email: "giuridico@example.it",
      name: "Giuridico",
      role: "GIURIDICO",
    });

    tenantMembershipFindManyMock.mockResolvedValue([
      {
        id: "m-1",
        userId: "u-10",
        enteId: "ente-a",
        role: "GIURIDICO",
        isDefault: true,
        ente: { id: "ente-a", codice: "EA", nome: "Ente A" },
      },
    ]);

    const context = await getCurrentTenantContext();

    expect(context).toMatchObject({
      userId: "u-10",
      role: "GIURIDICO",
      isAdmin: false,
      defaultTenantId: "ente-a",
      accessibleTenantIds: ["ente-a"],
    });
    expect(context?.userId).not.toBe("INVESTOR-DEMO-TENANT");
    expect(tenantMembershipFindManyMock).toHaveBeenCalledTimes(1);
  });
});

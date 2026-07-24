import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const isInvestorDemoModeMock = vi.hoisted(() => vi.fn());
const tenantMembershipFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/investor-demo", () => ({
  isInvestorDemoMode: isInvestorDemoModeMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantMembership: {
      findMany: tenantMembershipFindManyMock,
    },
  },
}));

import { investorDemoIdentity } from "@/lib/investor-demo-data";
import { getCurrentTenantContext } from "@/lib/tenant-auth";

describe("getCurrentTenantContext investor mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns synthetic admin context and never queries tenantMembership", async () => {
    isInvestorDemoModeMock.mockReturnValue(true);

    const context = await getCurrentTenantContext();

    expect(context).toEqual({
      userId: investorDemoIdentity.tenantId,
      role: "ADMIN",
      isAdmin: true,
      tenantMemberships: [],
      defaultTenantId: investorDemoIdentity.tenantId,
      accessibleTenantIds: [],
    });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(tenantMembershipFindManyMock).not.toHaveBeenCalled();
  });

  it("keeps original behavior when investor demo mode is disabled", async () => {
    isInvestorDemoModeMock.mockReturnValue(false);
    getCurrentUserMock.mockResolvedValue(null);

    const context = await getCurrentTenantContext();

    expect(context).toBeNull();
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
  });
});
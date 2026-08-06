import { describe, expect, it } from "vitest";

import { assertSameTenant, canReadTenantResource, requireTenantAccess, type CurrentTenantContext } from "@/lib/tenant-auth";

function context(): CurrentTenantContext {
  return {
    userId: "u-1",
    role: "TECNICO",
    isAdmin: false,
    tenantMemberships: [],
    defaultTenantId: "ente-a",
    accessibleTenantIds: ["ente-a"],
  };
}

describe("tenant cross-access guard", () => {
  it("denies cross-tenant access for non-admin users", () => {
    const ctx = context();

    expect(canReadTenantResource(ctx, "ente-a")).toBe(true);
    expect(canReadTenantResource(ctx, "ente-b")).toBe(false);

    expect(() => assertSameTenant(ctx, "ente-a")).not.toThrow();
    expect(() => assertSameTenant(ctx, "ente-b")).toThrow("Cross-tenant access denied.");

    expect(() => requireTenantAccess(ctx, "ente-a", { mode: "write" })).not.toThrow();
    expect(() => requireTenantAccess(ctx, "ente-b", { mode: "read" })).toThrow("Tenant access denied.");
  });
});

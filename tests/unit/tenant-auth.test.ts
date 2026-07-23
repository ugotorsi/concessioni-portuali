import { describe, expect, it } from "vitest";

import {
  assertSameTenant,
  canReadTenantResource,
  canWriteTenantResource,
  requireTenantAccess,
  resolveAccessibleTenantIds,
  type CurrentTenantContext,
} from "@/lib/tenant-auth";

function ctx(input?: Partial<CurrentTenantContext>): CurrentTenantContext {
  return {
    userId: "u-1",
    role: "GIURIDICO",
    isAdmin: false,
    tenantMemberships: [],
    defaultTenantId: "ente-a",
    accessibleTenantIds: ["ente-a"],
    ...input,
  };
}

describe("tenant auth helpers", () => {
  it("resolveAccessibleTenantIds returns empty for ADMIN", () => {
    const ids = resolveAccessibleTenantIds({
      role: "ADMIN",
      memberships: [{ enteId: "ente-a" }, { enteId: "ente-b" }],
    });

    expect(ids).toEqual([]);
  });

  it("resolveAccessibleTenantIds deduplicates tenant memberships", () => {
    const ids = resolveAccessibleTenantIds({
      role: "TECNICO",
      memberships: [{ enteId: "ente-a" }, { enteId: "ente-a" }, { enteId: "ente-b" }],
    });

    expect(ids.sort()).toEqual(["ente-a", "ente-b"]);
  });

  it("ADMIN bypasses tenant constraints", () => {
    const admin = ctx({ role: "ADMIN", isAdmin: true, accessibleTenantIds: [] });

    expect(canReadTenantResource(admin, "ente-other")).toBe(true);
    expect(canWriteTenantResource(admin, "ente-other")).toBe(true);
  });

  it("tenant user can access same tenant and is denied for other tenant", () => {
    const tenantUser = ctx({ role: "GIURIDICO", isAdmin: false, accessibleTenantIds: ["ente-a"] });

    expect(canReadTenantResource(tenantUser, "ente-a")).toBe(true);
    expect(canWriteTenantResource(tenantUser, "ente-a")).toBe(true);
    expect(canReadTenantResource(tenantUser, "ente-b")).toBe(false);
    expect(canWriteTenantResource(tenantUser, "ente-b")).toBe(false);
  });

  it("null enteId fallback can be allowed conservatively", () => {
    const tenantUser = ctx({ role: "TECNICO", isAdmin: false, accessibleTenantIds: ["ente-a"] });

    expect(canReadTenantResource(tenantUser, null, { allowWhenEnteMissing: true })).toBe(true);
    expect(canWriteTenantResource(tenantUser, undefined, { allowWhenEnteMissing: true })).toBe(true);
    expect(canReadTenantResource(tenantUser, null, { allowWhenEnteMissing: false })).toBe(false);
  });

  it("assertSameTenant and requireTenantAccess throw on cross-tenant access", () => {
    const tenantUser = ctx({ role: "ECONOMICO", isAdmin: false, accessibleTenantIds: ["ente-a"] });

    expect(() => assertSameTenant(tenantUser, "ente-a")).not.toThrow();
    expect(() => requireTenantAccess(tenantUser, "ente-a", { mode: "write" })).not.toThrow();
    expect(() => assertSameTenant(tenantUser, "ente-x")).toThrow("Cross-tenant access denied.");
    expect(() => requireTenantAccess(tenantUser, "ente-x", { mode: "read" })).toThrow("Tenant access denied.");
  });
});

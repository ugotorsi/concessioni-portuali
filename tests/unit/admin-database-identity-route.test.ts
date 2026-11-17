import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminWithMfa: vi.fn(),
  getDatabaseIdentityDiagnostic: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: mocks.requireAdminWithMfa,
}));
vi.mock("@/server/runtime/databaseIdentity", () => ({
  getDatabaseIdentityDiagnostic: mocks.getDatabaseIdentityDiagnostic,
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: mocks.auditSuccess,
  auditFailure: mocks.auditFailure,
}));

import { GET } from "@/app/api/admin/database-identity/route";

const unavailableIdentity = {
  neonProjectId: null,
  neonBranchId: null,
  neonEndpointId: null,
  databaseName: null,
  databaseConnected: false,
};

describe("GET /api/admin/database-identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWithMfa.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
      mfaVerified: true,
    });
    mocks.getDatabaseIdentityDiagnostic.mockResolvedValue({
      available: true,
      outcome: "MATCH",
      databaseConnected: true,
      endpointId: "ep-production",
      neonProjectId: "project-production",
      neonBranchId: "br-production",
      databaseName: "noetra",
      expectedIdentityConfigured: true,
    });
    mocks.auditSuccess.mockResolvedValue(undefined);
    mocks.auditFailure.mockResolvedValue(undefined);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", 401],
    ["ADMIN_REQUIRED", 403],
    ["MFA_VERIFICATION_REQUIRED", 403],
  ])("rejects %s before querying the database", async (error, status) => {
    mocks.requireAdminWithMfa.mockRejectedValue(new Error(error));

    const result = await GET();

    expect(result.status).toBe(status);
    expect(result.headers.get("cache-control")).toContain("no-store");
    await expect(result.json()).resolves.toEqual(unavailableIdentity);
    expect(mocks.getDatabaseIdentityDiagnostic).not.toHaveBeenCalled();
    expect(mocks.auditSuccess).not.toHaveBeenCalled();
    expect(mocks.auditFailure).not.toHaveBeenCalled();
  });

  it("returns only the active database identity after a successful audit", async () => {
    const result = await GET();

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(result.headers.get("pragma")).toBe("no-cache");
    expect(result.headers.get("expires")).toBe("0");
    expect(result.headers.get("vary")).toBe("Cookie, Authorization");
    await expect(result.json()).resolves.toEqual({
      neonProjectId: "project-production",
      neonBranchId: "br-production",
      neonEndpointId: "ep-production",
      databaseName: "noetra",
      databaseConnected: true,
    });
    expect(mocks.auditSuccess).toHaveBeenCalledWith({
      azione: "ADMIN_DATABASE_IDENTITY_READ",
      entita: "RuntimeDatabaseIdentity",
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    });
    expect(mocks.auditFailure).not.toHaveBeenCalled();
  });

  it("sanitizes unexpected authorization and query failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      mocks.requireAdminWithMfa.mockRejectedValueOnce(
        new Error("postgresql://user:secret@example.test/auth"),
      );
      const authResult = await GET();
      expect(authResult.status).toBe(503);
      await expect(authResult.json()).resolves.toEqual(unavailableIdentity);

      mocks.getDatabaseIdentityDiagnostic.mockRejectedValueOnce(
        new Error("postgresql://user:secret@example.test/query"),
      );
      const queryResult = await GET();
      expect(queryResult.status).toBe(503);
      await expect(queryResult.json()).resolves.toEqual(unavailableIdentity);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reports connection failure without identifiers and audits the failure", async () => {
    mocks.getDatabaseIdentityDiagnostic.mockResolvedValue({
      available: true,
      outcome: "NON_VERIFICABILE",
      databaseConnected: false,
      endpointId: null,
      neonProjectId: null,
      neonBranchId: null,
      databaseName: null,
      expectedIdentityConfigured: false,
    });

    const result = await GET();

    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toEqual(unavailableIdentity);
    expect(mocks.auditFailure).toHaveBeenCalledOnce();
    expect(mocks.auditSuccess).not.toHaveBeenCalled();
  });

  it("fails closed without leaking identity when the audit cannot be persisted", async () => {
    mocks.auditSuccess.mockRejectedValue(
      new Error("postgresql://user:secret@example.test/noetra"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await GET();

      expect(result.status).toBe(503);
      await expect(result.json()).resolves.toEqual(unavailableIdentity);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });
});

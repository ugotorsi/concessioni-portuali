import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const runDbReconPreviewTempMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());

const ReconConfigErrorRef = vi.hoisted(() => ({ value: class ReconConfigError extends Error {} }));
const ReconTimeoutErrorRef = vi.hoisted(() => ({ value: class ReconTimeoutError extends Error {} }));

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: auditSuccessMock,
  auditFailure: auditFailureMock,
}));

vi.mock("@/server/db-recon-preview-temp", async () => {
  const actual = await vi.importActual<typeof import("@/server/db-recon-preview-temp")>(
    "@/server/db-recon-preview-temp",
  );
  class ReconConfigError extends Error {}
  class ReconTimeoutError extends Error {}
  ReconConfigErrorRef.value = ReconConfigError;
  ReconTimeoutErrorRef.value = ReconTimeoutError;

  return {
    ...actual,
    ReconConfigError,
    ReconTimeoutError,
    runDbReconPreviewTemp: runDbReconPreviewTempMock,
  };
});

import { GET } from "@/app/api/admin/db-recon-preview-temp/route";

const ORIGINAL_ENV = { ...process.env };

describe("GET /api/admin/db-recon-preview-temp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "staging-operativo";
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234567890";

    getAuthSessionMock.mockResolvedValue({
      user: {
        id: "u-admin",
        email: "admin@demo.local",
        role: "ADMIN",
      },
    });

    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);

    runDbReconPreviewTempMock.mockResolvedValue({
      connected: true,
      currentDatabase: "concessioni_staging",
      currentSchema: "public",
      postgresVersion: "PostgreSQL 16.4",
      prismaMigrationsPresent: true,
      prismaMigrationsCount: 2,
      publicTablesCount: 10,
      tablesPresence: {
        Ente: true,
        User: true,
        Concessione: true,
        Procedimento: true,
        DecisioneProcedimento: true,
      },
      enumsPresence: {
        TipoDecisioneProcedimento: true,
        EffettoTitoloProcedimento: true,
        StatoEffettoProcedimento: true,
      },
      columnsPresence: {
        statoEffetto: true,
        effettoApplicatoAt: true,
        effectVersion: true,
      },
      decisioneProcedimentoIndexesCount: 8,
      decisioneProcedimentoConstraintsCount: 6,
      recordCounts: {
        Ente: 1,
        User: 5,
        Concessione: 3,
        Procedimento: 2,
        DecisioneProcedimento: 1,
      },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    getAuthSessionMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("returns 401 with no session even when demo mode is active", async () => {
    process.env.INVESTOR_DEMO_MODE = "true";
    getAuthSessionMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when role is not ADMIN", async () => {
    getAuthSessionMock.mockResolvedValue({
      user: {
        id: "u-1",
        email: "g@demo.local",
        role: "GIURIDICO",
      },
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("returns 403 when runtime is not preview", async () => {
    process.env.VERCEL_ENV = "production";

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when branch is not staging-operativo", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "main";

    const response = await GET();

    expect(response.status).toBe(403);
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
  });

  it("documents PR preview behavior through branch guard", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "chore/p0-e7-db-recon-preview-temp";

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain("staging-operativo");
  });

  it("returns no-store and does not leak secret-like fields", async () => {
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.environment).toBe("preview");
    expect(payload.branch).toBe("staging-operativo");
    expect(payload.commit).toBe("abc123456789");

    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("database_url");
    expect(serialized).not.toContain("direct_url");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("postgresql://");

    expect(auditSuccessMock).toHaveBeenCalledTimes(1);
    expect(auditFailureMock).not.toHaveBeenCalled();

    const auditArgs = auditSuccessMock.mock.calls[0][0];
    const auditSerialized = JSON.stringify(auditArgs).toLowerCase();
    expect(auditSerialized).not.toContain("database_url");
    expect(auditSerialized).not.toContain("direct_url");
    expect(auditSerialized).not.toContain("password");
    expect(auditSerialized).not.toContain("token");
    expect(auditSerialized).not.toContain("postgres://");
  });

  it("returns 500 for ReconConfigError with single audit event", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new ReconConfigErrorRef.value("bad"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("returns 504 for ReconTimeoutError with single audit event", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new ReconTimeoutErrorRef.value("timeout"));

    const response = await GET();

    expect(response.status).toBe(504);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });

  it("returns 500 for generic DB errors with sanitized payload", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new Error("postgresql://user:pass@host/db"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.error).toBe("DB recon failed.");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("postgresql://");
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const runDbReconPreviewTempMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const timingSafeEqualMock = vi.hoisted(() => vi.fn());

const ReconConfigErrorRef = vi.hoisted(() => ({ value: class ReconConfigError extends Error {} }));
const ReconTimeoutErrorRef = vi.hoisted(() => ({ value: class ReconTimeoutError extends Error {} }));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    timingSafeEqual: timingSafeEqualMock,
  };
});

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

import { GET, constantTimeTokenMatch } from "@/app/api/admin/db-recon-preview-temp/route";

const ORIGINAL_ENV = { ...process.env };
const TEMP_TOKEN = "temporary-preview-token-123";

function makeRequest(options?: { tokenHeader?: string; query?: string }) {
  const url = `https://example.test/api/admin/db-recon-preview-temp${options?.query ?? ""}`;
  const headers = new Headers();

  if (options?.tokenHeader !== undefined) {
    headers.set("x-db-recon-token", options.tokenHeader);
  }

  return new Request(url, {
    method: "GET",
    headers,
  });
}

describe("GET /api/admin/db-recon-preview-temp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "staging-operativo";
    process.env.VERCEL_GIT_COMMIT_SHA = "abc1234567890";
    process.env.DB_RECON_TEMP_TOKEN = TEMP_TOKEN;

    getAuthSessionMock.mockResolvedValue(null);
    timingSafeEqualMock.mockImplementation((a: Buffer, b: Buffer) => Buffer.compare(a, b) === 0);

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

  it("accepts real ADMIN session", async () => {
    getAuthSessionMock.mockResolvedValue({
      user: {
        id: "u-admin",
        email: "admin@demo.local",
        role: "ADMIN",
      },
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).toHaveBeenCalledTimes(1);

    expect(auditSuccessMock).toHaveBeenCalledTimes(1);
    const auditArgs = auditSuccessMock.mock.calls[0][0];
    expect(auditArgs.metadata.authMethod).toBe("session");
    expect(auditArgs.metadata).toEqual({ authMethod: "session" });
  });

  it("accepts correct temporary token", async () => {
    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).toHaveBeenCalledTimes(1);

    expect(auditSuccessMock).toHaveBeenCalledTimes(1);
    const auditArgs = auditSuccessMock.mock.calls[0][0];
    expect(auditArgs.metadata.authMethod).toBe("temporary-token");
    expect(auditArgs.metadata).toEqual({ authMethod: "temporary-token" });
  });

  it("rejects wrong temporary token", async () => {
    const response = await GET(makeRequest({ tokenHeader: "wrong-token" }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();

    expect(auditFailureMock).toHaveBeenCalledTimes(1);
    const auditArgs = auditFailureMock.mock.calls[0][0];
    expect(auditArgs.metadata.authMethod).toBe("temporary-token");
  });

  it("rejects when temporary token header is missing", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when DB_RECON_TEMP_TOKEN is missing", async () => {
    delete process.env.DB_RECON_TEMP_TOKEN;

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
  });

  it("rejects when DB_RECON_TEMP_TOKEN is empty", async () => {
    process.env.DB_RECON_TEMP_TOKEN = "   ";

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
  });

  it("uses constant-time comparison for temporary token", async () => {
    const mismatch = await GET(makeRequest({ tokenHeader: "wrong-token" }));
    const match = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(mismatch.status).toBe(401);
    expect(match.status).toBe(200);
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
  });

  it("does not expose token in response or audit", async () => {
    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    const payloadSerialized = JSON.stringify(payload).toLowerCase();
    expect(payloadSerialized).not.toContain(TEMP_TOKEN.toLowerCase());
    expect(payloadSerialized).not.toContain("x-db-recon-token");
    expect(payloadSerialized).not.toContain("db_recon_temp_token");

    const successAudit = auditSuccessMock.mock.calls[0][0];
    const successAuditSerialized = JSON.stringify(successAudit).toLowerCase();
    expect(successAuditSerialized).not.toContain(TEMP_TOKEN.toLowerCase());
    expect(successAuditSerialized).not.toContain("x-db-recon-token");
    expect(successAuditSerialized).not.toContain("db_recon_temp_token");
    expect(successAuditSerialized).not.toContain("sha256");
    expect(successAuditSerialized).not.toContain("length");
    expect(successAudit.metadata).toEqual({ authMethod: "temporary-token" });
  });

  it("does not include route/env/branch/commit/result in route-controlled audit metadata", async () => {
    const sessionResponse = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    expect(sessionResponse.status).toBe(200);

    const successAudit = auditSuccessMock.mock.calls[0][0];
    expect(successAudit.metadata).toEqual({ authMethod: "temporary-token" });
    expect(successAudit.metadata.route).toBeUndefined();
    expect(successAudit.metadata.environment).toBeUndefined();
    expect(successAudit.metadata.branch).toBeUndefined();
    expect(successAudit.metadata.commit).toBeUndefined();
    expect(successAudit.metadata.result).toBeUndefined();

    const unauthorized = await GET(makeRequest({ tokenHeader: "wrong-token" }));
    expect(unauthorized.status).toBe(401);

    const failureAudit = auditFailureMock.mock.calls[auditFailureMock.mock.calls.length - 1]?.[0];
    expect(failureAudit.metadata).toEqual({ authMethod: "temporary-token" });
    expect(failureAudit.metadata.route).toBeUndefined();
    expect(failureAudit.metadata.environment).toBeUndefined();
    expect(failureAudit.metadata.branch).toBeUndefined();
    expect(failureAudit.metadata.commit).toBeUndefined();
    expect(failureAudit.metadata.result).toBeUndefined();
  });

  it("does not accept token via query string", async () => {
    const response = await GET(makeRequest({ query: `?x-db-recon-token=${TEMP_TOKEN}` }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
  });

  it("always blocks production even with correct token", async () => {
    process.env.VERCEL_ENV = "production";

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it("always blocks non-staging branch even with correct token", async () => {
    process.env.VERCEL_GIT_COMMIT_REF = "feature/other";

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(runDbReconPreviewTempMock).not.toHaveBeenCalled();
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it("keeps no-store on config error", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new ReconConfigErrorRef.value("bad"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps no-store on timeout error", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new ReconTimeoutErrorRef.value("timeout"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));

    expect(response.status).toBe(504);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps sanitized generic DB error response", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new Error("postgresql://user:pass@host/db"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.error).toBe("DB recon failed.");
    expect(JSON.stringify(payload).toLowerCase()).not.toContain("postgresql://");
  });
});

describe("constantTimeTokenMatch", () => {
  it("returns true only for equal token values", () => {
    expect(constantTimeTokenMatch("abc", "abc")).toBe(true);
    expect(constantTimeTokenMatch("abc", "abd")).toBe(false);
  });
});

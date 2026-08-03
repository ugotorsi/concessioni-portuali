import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  class ReconConfigError extends Error {
    diagnosticCode: "DIRECT_URL_MISSING" | "DIRECT_URL_INVALID";

    constructor(message: string, diagnosticCode: "DIRECT_URL_MISSING" | "DIRECT_URL_INVALID" = "DIRECT_URL_INVALID") {
      super(message);
      this.diagnosticCode = diagnosticCode;
    }
  }
  class ReconTimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ReconTimeoutError";
    }
  }
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
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

function makeTechnicalError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function makeStagedError(stage: string, cause: unknown): { name: string; stage: string; cause: unknown } {
  return {
    name: "ReconStageError",
    stage,
    cause,
  };
}

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
    consoleErrorSpy.mockClear();

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
        Ente: { present: true, count: 1 },
        User: { present: true, count: 5 },
        Concessione: { present: true, count: 3 },
        Procedimento: { present: true, count: 2 },
        DecisioneProcedimento: { present: true, count: 1 },
      },
    });
  });

  it("returns 200 for empty database snapshot", async () => {
    runDbReconPreviewTempMock.mockResolvedValue({
      connected: true,
      currentDatabase: "concessioni_staging",
      currentSchema: "public",
      postgresVersion: "PostgreSQL 16.4",
      prismaMigrationsPresent: false,
      prismaMigrationsCount: null,
      publicTablesCount: 0,
      tablesPresence: {
        Ente: false,
        User: false,
        Concessione: false,
        Procedimento: false,
        DecisioneProcedimento: false,
      },
      enumsPresence: {
        TipoDecisioneProcedimento: false,
        EffettoTitoloProcedimento: false,
        StatoEffettoProcedimento: false,
      },
      columnsPresence: {
        statoEffetto: false,
        effettoApplicatoAt: false,
        effectVersion: false,
      },
      decisioneProcedimentoIndexesCount: 0,
      decisioneProcedimentoConstraintsCount: 0,
      recordCounts: {
        Ente: { present: false, count: null },
        User: { present: false, count: null },
        Concessione: { present: false, count: null },
        Procedimento: { present: false, count: null },
        DecisioneProcedimento: { present: false, count: null },
      },
    });

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(payload.publicTablesCount).toBe(0);
    expect(payload.prismaMigrationsPresent).toBe(false);
    expect(payload.recordCounts).toEqual({
      Ente: { present: false, count: null },
      User: { present: false, count: null },
      Concessione: { present: false, count: null },
      Procedimento: { present: false, count: null },
      DecisioneProcedimento: { present: false, count: null },
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
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

  it("classifies DIRECT_URL missing", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(
      new ReconConfigErrorRef.value("DIRECT_URL is missing.", "DIRECT_URL_MISSING"),
    );

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toEqual({ error: "DB recon failed.", errorCode: "DIRECT_URL_MISSING", errorStage: "UNKNOWN" });
  });

  it("classifies DIRECT_URL invalid", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(
      new ReconConfigErrorRef.value("DIRECT_URL is malformed.", "DIRECT_URL_INVALID"),
    );

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toEqual({ error: "DB recon failed.", errorCode: "DIRECT_URL_INVALID", errorStage: "UNKNOWN" });
  });

  it("classifies postgres auth error 28P01", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("28P01", "auth failed"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_AUTH_FAILED");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies postgres database not found 3D000", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("3D000", "db missing"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_DATABASE_NOT_FOUND");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies ENOTFOUND as DNS failure", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("ENOTFOUND", "dns failed"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_DNS_FAILED");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies EAI_AGAIN as DNS failure", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("EAI_AGAIN", "dns temporary failure"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_DNS_FAILED");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies ECONNREFUSED as connection refused", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("ECONNREFUSED", "conn refused"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_CONNECTION_REFUSED");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies ETIMEDOUT as timeout", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeTechnicalError("ETIMEDOUT", "timeout"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_TIMEOUT");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies application timeout as DB_TIMEOUT", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new ReconTimeoutErrorRef.value("DB recon timeout."));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toEqual({ error: "DB recon failed.", errorCode: "DB_TIMEOUT", errorStage: "UNKNOWN" });
  });

  it("classifies TLS errors", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(
      makeTechnicalError("CERT_HAS_EXPIRED", "certificate expired"),
    );

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_TLS_FAILED");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("classifies query failures", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(makeStagedError("COLUMNS", {
      message: "outer",
      cause: makeTechnicalError("XX000", "query failed"),
      name: "ReconQueryError",
    }));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_QUERY_FAILED");
    expect(payload.errorStage).toBe("COLUMNS");
  });

  it("classifies unknown failures", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new Error("unexpected"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_UNKNOWN_FAILURE");
    expect(payload.errorStage).toBe("UNKNOWN");
  });

  it("does not expose original message, stack, host, URL or credentials in payload, log or audit", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(new Error("postgresql://user:pass@db-host.internal/demo"));

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.error).toBe("DB recon failed.");
    expect(typeof payload.errorCode).toBe("string");
    expect(typeof payload.errorStage).toBe("string");
    expect(Object.keys(payload)).toEqual(["error", "errorCode", "errorStage"]);

    const payloadSerialized = JSON.stringify(payload).toLowerCase();
    expect(payloadSerialized).not.toContain("postgresql://");
    expect(payloadSerialized).not.toContain("db-host.internal");
    expect(payloadSerialized).not.toContain("user:");
    expect(payloadSerialized).not.toContain("pass");
    expect(payloadSerialized).not.toContain("stack");

    const logArg = consoleErrorSpy.mock.calls[0]?.[0];
    expect(logArg).toEqual({ event: "db_recon_failed", errorCode: payload.errorCode, errorStage: payload.errorStage });
    expect(Object.keys(logArg)).toEqual(["event", "errorCode", "errorStage"]);

    const logSerialized = JSON.stringify(logArg).toLowerCase();
    expect(logSerialized).not.toContain("postgresql://");
    expect(logSerialized).not.toContain("db-host.internal");

    const failureAudit = auditFailureMock.mock.calls[0]?.[0];
    const failureAuditSerialized = JSON.stringify(failureAudit).toLowerCase();
    expect(failureAuditSerialized).not.toContain("postgresql://");
    expect(failureAuditSerialized).not.toContain("db-host.internal");
    expect(failureAuditSerialized).not.toContain("password");
    expect(failureAuditSerialized).not.toContain("x-db-recon-token");
    expect(failureAuditSerialized).not.toContain("db_recon_temp_token");
    expect(failureAuditSerialized).not.toContain("sha256");
    expect(failureAuditSerialized).not.toContain("length");
  });

  it("does not treat sslmode warning text as tls failure", async () => {
    runDbReconPreviewTempMock.mockRejectedValue(
      new Error("SECURITY WARNING: sslmode require treated as alias for verify-full"),
    );

    const response = await GET(makeRequest({ tokenHeader: TEMP_TOKEN }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.errorCode).toBe("DB_UNKNOWN_FAILURE");
    expect(payload.errorStage).toBe("UNKNOWN");
  });
});

describe("constantTimeTokenMatch", () => {
  it("returns true only for equal token values", () => {
    expect(constantTimeTokenMatch("abc", "abc")).toBe(true);
    expect(constantTimeTokenMatch("abc", "abd")).toBe(false);
  });
});

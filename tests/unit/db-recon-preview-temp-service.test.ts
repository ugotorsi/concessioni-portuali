import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyDbReconError,
  classifyDbReconErrorStage,
  READ_ONLY_SQL,
  ReconConfigError,
  ReconTimeoutError,
  isReadOnlySql,
  runDbReconPreviewTemp,
  synthesizePostgresVersion,
} from "@/server/db-recon-preview-temp";

const ORIGINAL_ENV = { ...process.env };

function makeWorkingClientFactory(failAt?: { connect?: true; queryIndex?: number; error?: Error }) {
  let queryIndex = 0;

  const query = vi.fn(async () => {
    queryIndex += 1;
    if (failAt?.queryIndex === queryIndex) {
      throw failAt.error ?? new Error("query failed");
    }

    switch (queryIndex) {
      case 1:
        return { rows: [{ current_database: "db", current_schema: "public" }] };
      case 2:
        return { rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] };
      case 3:
        return { rows: [{ present: true }] };
      case 4:
        return { rows: [{ count: 1 }] };
      case 5:
        return { rows: [{ count: 10 }] };
      case 6:
        return { rows: [{ table_name: "Ente" }, { table_name: "User" }, { table_name: "Concessione" }, { table_name: "Procedimento" }, { table_name: "DecisioneProcedimento" }] };
      case 7:
        return { rows: [{ typname: "TipoDecisioneProcedimento" }, { typname: "EffettoTitoloProcedimento" }, { typname: "StatoEffettoProcedimento" }] };
      case 8:
        return { rows: [{ column_name: "statoEffetto" }, { column_name: "effettoApplicatoAt" }, { column_name: "effectVersion" }] };
      case 9:
        return { rows: [{ count: 8 }] };
      case 10:
        return { rows: [{ count: 6 }] };
      case 11:
        return { rows: [{ count: 1 }] };
      case 12:
        return { rows: [{ count: 2 }] };
      case 13:
        return { rows: [{ count: 3 }] };
      case 14:
        return { rows: [{ count: 4 }] };
      case 15:
        return { rows: [{ count: 5 }] };
      default:
        return { rows: [] };
    }
  });

  return vi.fn(() => ({
    connect: failAt?.connect
      ? vi.fn().mockRejectedValue(failAt.error ?? new Error("connect failed"))
      : vi.fn().mockResolvedValue(undefined),
    query,
    end: vi.fn().mockResolvedValue(undefined),
    connection: {
      stream: {
        destroy: vi.fn(),
      },
    },
  }));
}

describe("db recon preview temp service", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it("uses only read-only SQL", () => {
    for (const sql of Object.values(READ_ONLY_SQL)) {
      expect(isReadOnlySql(sql)).toBe(true);
    }
  });

  it("normalizes postgres version", () => {
    expect(synthesizePostgresVersion("PostgreSQL 16.4 on x86_64")).toBe("PostgreSQL 16.4");
    expect(synthesizePostgresVersion("unknown")).toBe("PostgreSQL");
  });

  it("fails when DIRECT_URL is missing", async () => {
    delete process.env.DIRECT_URL;

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL is undefined", async () => {
    process.env.DIRECT_URL = undefined;

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL is empty string", async () => {
    process.env.DIRECT_URL = "";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL contains only spaces", async () => {
    process.env.DIRECT_URL = "   ";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL is placeholder", async () => {
    process.env.DIRECT_URL = "[SENSITIVE]";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL protocol is not postgres", async () => {
    process.env.DIRECT_URL = "mysql://user:pass@localhost/db";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL is malformed", async () => {
    process.env.DIRECT_URL = "postgresql://bad-url";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails when DIRECT_URL has no hostname", async () => {
    const invalidUrl = "postgresql:///fake_db?sslmode=require";
    process.env.DIRECT_URL = invalidUrl;

    const connectMock = vi.fn();
    const clientFactory = vi.fn(() => ({
      connect: connectMock,
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }));

    let captured: unknown;
    try {
      await runDbReconPreviewTemp(100, { clientFactory });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ReconConfigError);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();

    const message = captured instanceof Error ? captured.message : "";
    expect(message).not.toContain(invalidUrl);
    expect(message.toLowerCase()).not.toContain("postgresql://");
    expect(message).toBe("DIRECT_URL host is missing.");
  });

  it("fails when DIRECT_URL has no database name", async () => {
    const invalidUrl = "postgresql://localhost/?sslmode=require";
    process.env.DIRECT_URL = invalidUrl;

    const connectMock = vi.fn();
    const clientFactory = vi.fn(() => ({
      connect: connectMock,
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }));

    let captured: unknown;
    try {
      await runDbReconPreviewTemp(100, { clientFactory });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ReconConfigError);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();

    const message = captured instanceof Error ? captured.message : "";
    expect(message).not.toContain(invalidUrl);
    expect(message.toLowerCase()).not.toContain("postgresql://");
    expect(message).toBe("DIRECT_URL database is missing.");
  });

  it("fails when DIRECT_URL misses sslmode", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("maps connect errors as generic errors and still closes client", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const endMock = vi.fn().mockResolvedValue(undefined);
    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockRejectedValue(new Error("connect failed")),
      query: vi.fn(),
      end: endMock,
    }));

    const error = await runDbReconPreviewTemp(100, { clientFactory }).catch((e) => e);
    expect(classifyDbReconError(error)).toBe("DB_UNKNOWN_FAILURE");
    expect(classifyDbReconErrorStage(error)).toBe("CONNECTION_PROBE");
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("maps query errors as generic errors and still closes client", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const endMock = vi.fn().mockResolvedValue(undefined);
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockRejectedValueOnce(new Error("query failed"));
    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: endMock,
    }));

    const error = await runDbReconPreviewTemp(100, { clientFactory }).catch((e) => e);
    expect(classifyDbReconError(error)).toBe("DB_QUERY_FAILED");
    expect(classifyDbReconErrorStage(error)).toBe("SERVER_IDENTITY");
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it("swallows close errors and destroys stream", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const destroyMock = vi.fn();
    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockRejectedValue(new Error("query failed")),
      end: vi.fn().mockRejectedValue(new Error("end failed")),
      connection: {
        stream: {
          destroy: destroyMock,
        },
      },
    }));

    const error = await runDbReconPreviewTemp(100, { clientFactory }).catch((e) => e);
    expect(classifyDbReconError(error)).toBe("DB_QUERY_FAILED");
    expect(classifyDbReconErrorStage(error)).toBe("CURRENT_DATABASE");
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("enforces real timeout, tears down resources, and stops further queries", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    vi.useFakeTimers();

    let rejectQuery: ((error: Error) => void) | null = null;
    const queryMock = vi.fn(
      () =>
        new Promise((_, reject) => {
          rejectQuery = reject;
        }),
    );
    const destroyMock = vi.fn(() => {
      rejectQuery?.(new Error("socket closed"));
    });
    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
      connection: {
        stream: {
          destroy: destroyMock,
        },
      },
    }));

    const recon = runDbReconPreviewTemp(50, { clientFactory });
    const observed = recon.catch((error) => error);
    await vi.advanceTimersByTimeAsync(70);

    const error = await observed;
    expect(error).toBeInstanceOf(ReconTimeoutError);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("classifies DIRECT_URL missing as sanitized code", () => {
    const error = new ReconConfigError("DIRECT_URL is missing.", "DIRECT_URL_MISSING");
    expect(classifyDbReconError(error)).toBe("DIRECT_URL_MISSING");
  });

  it("classifies ReconTimeoutError as DB_TIMEOUT", () => {
    expect(classifyDbReconError(new ReconTimeoutError("DB recon timeout."))).toBe("DB_TIMEOUT");
  });

  it("classifies DIRECT_URL invalid as sanitized code", () => {
    const error = new ReconConfigError("DIRECT_URL is malformed.", "DIRECT_URL_INVALID");
    expect(classifyDbReconError(error)).toBe("DIRECT_URL_INVALID");
  });

  it("classifies standard postgres/sql/network codes", () => {
    const auth = Object.assign(new Error("x"), { code: "28P01" });
    const dbMissing = Object.assign(new Error("x"), { code: "3D000" });
    const dns1 = Object.assign(new Error("x"), { code: "ENOTFOUND" });
    const dns2 = Object.assign(new Error("x"), { code: "EAI_AGAIN" });
    const refused = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    const timeout = Object.assign(new Error("x"), { code: "ETIMEDOUT" });

    expect(classifyDbReconError(auth)).toBe("DB_AUTH_FAILED");
    expect(classifyDbReconError(dbMissing)).toBe("DB_DATABASE_NOT_FOUND");
    expect(classifyDbReconError(dns1)).toBe("DB_DNS_FAILED");
    expect(classifyDbReconError(dns2)).toBe("DB_DNS_FAILED");
    expect(classifyDbReconError(refused)).toBe("DB_CONNECTION_REFUSED");
    expect(classifyDbReconError(timeout)).toBe("DB_TIMEOUT");
  });

  it("classifies recognized TLS errors by specific codes", () => {
    const certExpired = Object.assign(new Error("certificate verify failed"), { code: "CERT_HAS_EXPIRED" });
    const selfSignedChain = Object.assign(new Error("self signed"), { code: "SELF_SIGNED_CERT_IN_CHAIN" });
    const altName = Object.assign(new Error("hostname mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });

    expect(classifyDbReconError(certExpired)).toBe("DB_TLS_FAILED");
    expect(classifyDbReconError(selfSignedChain)).toBe("DB_TLS_FAILED");
    expect(classifyDbReconError(altName)).toBe("DB_TLS_FAILED");
  });

  it("classifies recognized TLS errors by specific certificate messages", () => {
    const verifyFirstCert = new Error("unable to verify the first certificate");
    expect(classifyDbReconError(verifyFirstCert)).toBe("DB_TLS_FAILED");
  });

  it("does not classify sslmode warning text as tls failure", () => {
    const warning = new Error("SECURITY WARNING: sslmode=require treated as alias for verify-full");
    expect(classifyDbReconError(warning)).toBe("DB_UNKNOWN_FAILURE");
  });

  it("does not classify generic ssl/tls warning-like messages as tls failure", () => {
    const sslModeRequire = new Error("sslmode=require");
    const sslWarning = new Error("SSL warning");
    const tlsConfig = new Error("TLS configuration");
    const verifyFull = new Error("use sslmode=verify-full");

    expect(classifyDbReconError(sslModeRequire)).toBe("DB_UNKNOWN_FAILURE");
    expect(classifyDbReconError(sslWarning)).toBe("DB_UNKNOWN_FAILURE");
    expect(classifyDbReconError(tlsConfig)).toBe("DB_UNKNOWN_FAILURE");
    expect(classifyDbReconError(verifyFull)).toBe("DB_UNKNOWN_FAILURE");
  });

  it("classifies unknown errors as DB_UNKNOWN_FAILURE", () => {
    expect(classifyDbReconError(new Error("unknown"))).toBe("DB_UNKNOWN_FAILURE");
  });

  it("classifies unknown errors stage fallback as UNKNOWN", () => {
    expect(classifyDbReconErrorStage(new Error("unknown"))).toBe("UNKNOWN");
  });

  it("classifies connection probe stage on connect failure", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const factory = makeWorkingClientFactory({ connect: true, error: new Error("connect") });

    const error = await runDbReconPreviewTemp(100, { clientFactory: factory }).catch((e) => e);

    expect(classifyDbReconErrorStage(error)).toBe("CONNECTION_PROBE");
  });

  it.each([
    { queryIndex: 1, stage: "CURRENT_DATABASE" },
    { queryIndex: 2, stage: "SERVER_IDENTITY" },
    { queryIndex: 3, stage: "MIGRATIONS_TABLE_CHECK" },
    { queryIndex: 4, stage: "MIGRATIONS_COUNT" },
    { queryIndex: 5, stage: "PUBLIC_TABLES" },
    { queryIndex: 6, stage: "KEY_TABLES" },
    { queryIndex: 7, stage: "ENUMS" },
    { queryIndex: 8, stage: "COLUMNS" },
    { queryIndex: 11, stage: "RECORD_COUNTS" },
  ] as const)("classifies query stage $stage", async ({ queryIndex, stage }) => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryError = Object.assign(new Error("query failed"), { code: "XX000" });
    const factory = makeWorkingClientFactory({ queryIndex, error: queryError });

    const error = await runDbReconPreviewTemp(100, { clientFactory: factory }).catch((e) => e);

    expect(classifyDbReconError(error)).toBe("DB_QUERY_FAILED");
    expect(classifyDbReconErrorStage(error)).toBe(stage);
  });

  it("classifies timeout from query as DB_TIMEOUT with stage", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const timeoutError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const factory = makeWorkingClientFactory({ queryIndex: 5, error: timeoutError });

    const error = await runDbReconPreviewTemp(100, { clientFactory: factory }).catch((e) => e);

    expect(classifyDbReconError(error)).toBe("DB_TIMEOUT");
    expect(classifyDbReconErrorStage(error)).toBe("PUBLIC_TABLES");
  });

  it("returns connected=true on empty database and skips all record counts", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockResolvedValueOnce({ rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] })
      .mockResolvedValueOnce({ rows: [{ present: false }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
    }));

    const result = await runDbReconPreviewTemp(100, { clientFactory });

    expect(result.connected).toBe(true);
    expect(result.publicTablesCount).toBe(0);
    expect(result.prismaMigrationsPresent).toBe(false);
    expect(result.prismaMigrationsCount).toBeNull();
    expect(result.recordCounts).toEqual({
      Ente: { present: false, count: null },
      User: { present: false, count: null },
      Concessione: { present: false, count: null },
      Procedimento: { present: false, count: null },
      DecisioneProcedimento: { present: false, count: null },
    });

    const countSqlCalls = queryMock.mock.calls
      .map((call) => call[0] as string)
      .filter((sql) => sql.includes("COUNT(*)::int AS count FROM public.\""));
    expect(countSqlCalls).toEqual([]);
  });

  it("sets present=true and count=0 when key table exists but is empty", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockResolvedValueOnce({ rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] })
      .mockResolvedValueOnce({ rows: [{ present: false }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "Ente" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
    }));

    const result = await runDbReconPreviewTemp(100, { clientFactory });

    expect(result.recordCounts.Ente).toEqual({ present: true, count: 0 });
    expect(result.recordCounts.User).toEqual({ present: false, count: null });
  });

  it("returns exact counts for present key tables and null for absent ones", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockResolvedValueOnce({ rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] })
      .mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "Ente" }, { table_name: "Concessione" }, { table_name: "DecisioneProcedimento" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 7 }] })
      .mockResolvedValueOnce({ rows: [{ count: 11 }] })
      .mockResolvedValueOnce({ rows: [{ count: 13 }] });

    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
    }));

    const result = await runDbReconPreviewTemp(100, { clientFactory });

    expect(result.recordCounts).toEqual({
      Ente: { present: true, count: 7 },
      User: { present: false, count: null },
      Concessione: { present: true, count: 11 },
      Procedimento: { present: false, count: null },
      DecisioneProcedimento: { present: true, count: 13 },
    });

    const countSqlCalls = queryMock.mock.calls
      .map((call) => call[0] as string)
      .filter((sql) => sql.startsWith('SELECT COUNT(*)::int AS count FROM public."'));

    expect(countSqlCalls).toEqual([
      'SELECT COUNT(*)::int AS count FROM public."Ente"',
      'SELECT COUNT(*)::int AS count FROM public."Concessione"',
      'SELECT COUNT(*)::int AS count FROM public."DecisioneProcedimento"',
    ]);
  });

  it("maps count query failure on present table to DB_QUERY_FAILED at RECORD_COUNTS", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockResolvedValueOnce({ rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] })
      .mockResolvedValueOnce({ rows: [{ present: false }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: "Ente" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockRejectedValueOnce(new Error("count failed"));

    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
    }));

    const error = await runDbReconPreviewTemp(100, { clientFactory }).catch((e) => e);

    expect(classifyDbReconError(error)).toBe("DB_QUERY_FAILED");
    expect(classifyDbReconErrorStage(error)).toBe("RECORD_COUNTS");
  });

  it("uses only static allowlisted table identifiers for dynamic count queries", async () => {
    process.env.DIRECT_URL = "postgresql://u:p@localhost:5432/db?sslmode=require";
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ current_database: "db", current_schema: "public" }] })
      .mockResolvedValueOnce({ rows: [{ server_version: "PostgreSQL 16.4 on x86_64" }] })
      .mockResolvedValueOnce({ rows: [{ present: false }] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] })
      .mockResolvedValueOnce({
        rows: [
          { table_name: "Ente" },
          { table_name: "User" },
          { table_name: "Concessione" },
          { table_name: "Procedimento" },
          { table_name: "DecisioneProcedimento" },
          { table_name: "InjectedTable" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const clientFactory = vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
    }));

    await runDbReconPreviewTemp(100, { clientFactory });

    const countSqlCalls = queryMock.mock.calls
      .map((call) => call[0] as string)
      .filter((sql) => sql.includes("SELECT COUNT(*)::int AS count FROM public."));

    expect(countSqlCalls).toEqual([
      'SELECT COUNT(*)::int AS count FROM public."Ente"',
      'SELECT COUNT(*)::int AS count FROM public."User"',
      'SELECT COUNT(*)::int AS count FROM public."Concessione"',
      'SELECT COUNT(*)::int AS count FROM public."Procedimento"',
      'SELECT COUNT(*)::int AS count FROM public."DecisioneProcedimento"',
    ]);
    expect(countSqlCalls.some((sql) => sql.includes("InjectedTable"))).toBe(false);
    expect(countSqlCalls.every((sql) => isReadOnlySql(sql))).toBe(true);
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyDbReconError,
  READ_ONLY_SQL,
  ReconConfigError,
  ReconTimeoutError,
  isReadOnlySql,
  runDbReconPreviewTemp,
  synthesizePostgresVersion,
} from "@/server/db-recon-preview-temp";

const ORIGINAL_ENV = { ...process.env };

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

  it("fails when DIRECT_URL is empty", async () => {
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

    await expect(runDbReconPreviewTemp(100, { clientFactory })).rejects.toThrow("connect failed");
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

    await expect(runDbReconPreviewTemp(100, { clientFactory })).rejects.toThrow("query failed");
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

    await expect(runDbReconPreviewTemp(100, { clientFactory })).rejects.toThrow("query failed");
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

  it("classifies recognized TLS errors", () => {
    const tls = Object.assign(new Error("certificate verify failed"), { code: "CERT_HAS_EXPIRED" });
    expect(classifyDbReconError(tls)).toBe("DB_TLS_FAILED");
  });

  it("does not classify sslmode warning text as tls failure", () => {
    const warning = new Error("SECURITY WARNING: sslmode=require treated as alias for verify-full");
    expect(classifyDbReconError(warning)).toBe("DB_UNKNOWN_FAILURE");
  });

  it("classifies unknown errors as DB_UNKNOWN_FAILURE", () => {
    expect(classifyDbReconError(new Error("unknown"))).toBe("DB_UNKNOWN_FAILURE");
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  READ_ONLY_SQL,
  ReconConfigError,
  ReconTimeoutError,
  isReadOnlySql,
  runDbReconPreviewTemp,
  synthesizePostgresVersion,
  withTimeout,
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

  it("fails fast when DIRECT_URL is missing", async () => {
    delete process.env.DIRECT_URL;

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("fails fast when DIRECT_URL is placeholder", async () => {
    process.env.DIRECT_URL = "[SENSITIVE]";

    await expect(runDbReconPreviewTemp(100)).rejects.toBeInstanceOf(ReconConfigError);
  });

  it("enforces timeout guard", async () => {
    vi.useFakeTimers();

    const pending = new Promise<void>(() => undefined);
    const wrapped = withTimeout(pending, 50, "timeout").catch((error) => error);

    await vi.advanceTimersByTimeAsync(60);
    const error = await wrapped;
    expect(error).toBeInstanceOf(ReconTimeoutError);
  });
});
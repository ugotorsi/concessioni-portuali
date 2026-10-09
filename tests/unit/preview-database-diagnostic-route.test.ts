import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

import { GET } from "@/app/api/diagnostics/preview-database/route";

const EXPECTED_DATABASE_URL =
  "postgresql://user:password@ep-wispy-breeze-ate2kt5o.c-9.us-east-1.aws.neon.tech/neondb";

describe("GET /api/diagnostics/preview-database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "e2e-unified-fascicolo-20261009");
    vi.stubEnv("DATABASE_URL", EXPECTED_DATABASE_URL);
    queryRawMock.mockResolvedValue([{ migrationCompleted: true, columnExists: true }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 204 only when the expected migration and column exist", async () => {
    const result = await GET();

    expect(result.status).toBe(204);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["VERCEL_ENV", "production"],
    ["VERCEL_GIT_COMMIT_REF", "staging-operativo"],
  ])("returns 404 outside the authorized preview scope when %s differs", async (name, value) => {
    vi.stubEnv(name, value);

    const result = await GET();

    expect(result.status).toBe(404);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it.each([
    [undefined],
    ["not-a-url"],
    ["postgresql://user:password@ep-jolly-hall-atts00ke.c-9.us-east-1.aws.neon.tech/neondb"],
  ])("returns 503 without querying for an invalid database URL: %s", async (databaseUrl) => {
    vi.stubEnv("DATABASE_URL", databaseUrl);

    const result = await GET();

    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [{ migrationCompleted: false, columnExists: true }] },
    { rows: [{ migrationCompleted: true, columnExists: false }] },
    { rows: [] },
  ])("returns 503 when the database evidence is incomplete", async ({ rows }) => {
    queryRawMock.mockResolvedValueOnce(rows);

    const result = await GET();

    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 without exposing query errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    queryRawMock.mockRejectedValueOnce(new Error("sensitive database error"));

    const result = await GET();

    expect(result.status).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    await expect(result.text()).resolves.toBe("");
    expect(consoleError).toHaveBeenCalledWith({ event: "preview_database_diagnostic_failed" });
    consoleError.mockRestore();
  });
});

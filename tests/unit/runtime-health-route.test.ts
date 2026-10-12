import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSession = vi.hoisted(() => vi.fn());
const getRuntimeHealthSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({ getAuthSession }));
vi.mock("@/server/runtime/health", () => ({ getRuntimeHealthSnapshot }));

import { GET } from "@/app/api/admin/runtime-health/route";

describe("GET /api/admin/runtime-health", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated and non-admin access", async () => {
    getAuthSession.mockResolvedValue({ user: { id: "operator-1", role: "TECNICO" } });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getRuntimeHealthSnapshot).not.toHaveBeenCalled();
  });

  it("returns a no-store snapshot to admins", async () => {
    getAuthSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    getRuntimeHealthSnapshot.mockResolvedValue({ status: "HEALTHY", databaseConnected: true, queueDepth: 0 });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ status: "HEALTHY", queueDepth: 0 });
  });

  it("uses 503 for operational degradation and sanitizes query failures", async () => {
    getAuthSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    getRuntimeHealthSnapshot.mockResolvedValueOnce({ status: "WORKER_UNAVAILABLE", databaseConnected: true });
    expect((await GET()).status).toBe(503);
    getRuntimeHealthSnapshot.mockRejectedValueOnce(new Error("postgresql://secret@example.test/db"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("postgresql://");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    } finally {
      consoleError.mockRestore();
    }
  });
});
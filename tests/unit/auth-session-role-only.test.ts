import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

import { getCurrentRole, getCurrentUser } from "@/lib/auth";

describe("auth session role only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives role only from valid session role", async () => {
    getAuthSessionMock.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    await expect(getCurrentRole()).resolves.toBe("ADMIN");

    getAuthSessionMock.mockResolvedValueOnce({ user: { role: "NOT_A_ROLE" } });
    await expect(getCurrentRole()).resolves.toBeNull();

    getAuthSessionMock.mockResolvedValueOnce(null);
    await expect(getCurrentRole()).resolves.toBeNull();
  });

  it("returns current user only when session fields are complete and role is valid", async () => {
    getAuthSessionMock.mockResolvedValueOnce({
      user: {
        id: "u-1",
        email: "admin@example.it",
        name: "Admin",
        role: "GIURIDICO",
      },
    });

    await expect(getCurrentUser()).resolves.toEqual({
      id: "u-1",
      email: "admin@example.it",
      name: "Admin",
      role: "GIURIDICO",
    });

    getAuthSessionMock.mockResolvedValueOnce({
      user: {
        id: "u-2",
        email: "demo.local@example.it",
        name: "User",
        role: "INVALID",
      },
    });

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

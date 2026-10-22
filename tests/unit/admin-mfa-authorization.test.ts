import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

import { requireAdminWithMfa } from "@/lib/auth";

describe("global AI control authorization", () => {
  beforeEach(() => {
    getAuthSessionMock.mockReset();
  });

  it("allows only an ADMIN with completed MFA", async () => {
    getAuthSessionMock.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
        mfaEnrollmentRequired: false,
        mfaVerified: true,
      },
    });

    await expect(requireAdminWithMfa()).resolves.toMatchObject({
      id: "admin-1",
      role: "ADMIN",
      mfaVerified: true,
    });
  });

  it.each([
    ["ordinary user", "GIURIDICO", true, "ADMIN_REQUIRED"],
    ["admin without MFA", "ADMIN", false, "MFA_VERIFICATION_REQUIRED"],
  ])("rejects an %s", async (_label, role, mfaVerified, error) => {
    getAuthSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.test",
        role,
        mfaEnrollmentRequired: !mfaVerified,
        mfaVerified,
      },
    });

    await expect(requireAdminWithMfa()).rejects.toThrow(error);
  });
});

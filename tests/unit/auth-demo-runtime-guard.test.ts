import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const isInvestorDemoModeMock = vi.hoisted(() => vi.fn());
const getRuntimeEnvironmentMock = vi.hoisted(() => vi.fn());
const cookieGetMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

vi.mock("@/lib/investor-demo", () => ({
  isInvestorDemoMode: isInvestorDemoModeMock,
}));

vi.mock("@/lib/runtime-environment", () => ({
  getRuntimeEnvironment: getRuntimeEnvironmentMock,
}));

import { DEMO_ROLE_COOKIE, getCurrentRole } from "@/lib/auth";

describe("getCurrentRole runtime demo guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: cookieGetMock,
    });
  });

  it("returns admin in authorized demo runtime", async () => {
    getRuntimeEnvironmentMock.mockReturnValue({ demoAuthenticationAllowed: true });
    isInvestorDemoModeMock.mockReturnValue(true);

    const role = await getCurrentRole();

    expect(role).toBe("ADMIN");
    expect(getAuthSessionMock).not.toHaveBeenCalled();
  });

  it("does not allow cookie fallback outside authorized demo runtime", async () => {
    getRuntimeEnvironmentMock.mockReturnValue({ demoAuthenticationAllowed: false });
    isInvestorDemoModeMock.mockReturnValue(false);
    getAuthSessionMock.mockResolvedValue(null);
    cookieGetMock.mockReturnValue({ value: "ADMIN" });

    const role = await getCurrentRole();

    expect(role).toBeNull();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("allows cookie fallback only in authorized demo runtime", async () => {
    getRuntimeEnvironmentMock.mockReturnValue({ demoAuthenticationAllowed: true });
    isInvestorDemoModeMock.mockReturnValue(false);
    getAuthSessionMock.mockResolvedValue(null);
    cookieGetMock.mockImplementation((name: string) => {
      if (name === DEMO_ROLE_COOKIE) {
        return { value: "TECNICO" };
      }

      return undefined;
    });

    const role = await getCurrentRole();

    expect(role).toBe("TECNICO");
  });

  it("keeps trusted session role behavior unchanged", async () => {
    getRuntimeEnvironmentMock.mockReturnValue({ demoAuthenticationAllowed: false });
    isInvestorDemoModeMock.mockReturnValue(false);
    getAuthSessionMock.mockResolvedValue({
      user: {
        role: "GIURIDICO",
      },
    });

    const role = await getCurrentRole();

    expect(role).toBe("GIURIDICO");
  });
});
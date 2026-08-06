import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => vi.fn());
const cookieDeleteMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

import * as authModule from "@/lib/auth";
import { GET } from "@/app/logout/route";

describe("no demo cookie fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      delete: cookieDeleteMock,
    });
  });

  it("does not export DEMO_ROLE_COOKIE", () => {
    expect("DEMO_ROLE_COOKIE" in authModule).toBe(false);
  });

  it("logout does not delete cp_demo_role", async () => {
    const response = await GET(new Request("https://example.test/logout"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/login");

    const deletedCookieNames = cookieDeleteMock.mock.calls.map((call) => call[0]);

    expect(deletedCookieNames).not.toContain("cp_demo_role");
    expect(deletedCookieNames).toContain("next-auth.session-token");
    expect(deletedCookieNames).toContain("__Secure-next-auth.session-token");
  });
});

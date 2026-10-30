import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getTokenMock = vi.hoisted(() => vi.fn());
const buildRateLimitKeyMock = vi.hoisted(() => vi.fn());
const checkRateLimitMock = vi.hoisted(() => vi.fn());
const getRateLimitHeadersMock = vi.hoisted(() => vi.fn());

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  buildRateLimitKey: buildRateLimitKeyMock,
  checkRateLimit: checkRateLimitMock,
  getRateLimitHeaders: getRateLimitHeadersMock,
}));

import { middleware } from "../../middleware";

function makeRequest(path: string, host = "example.test") {
  return new NextRequest(`https://${host}${path}`);
}

describe("middleware sensitive route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTokenMock.mockReset();
    buildRateLimitKeyMock.mockReturnValue("rate-limit-key");
    checkRateLimitMock.mockResolvedValue({
      allowed: true,
      limit: 25,
      remaining: 24,
      resetAt: Date.now() + 60_000,
    });
    getRateLimitHeadersMock.mockReturnValue({});
    getTokenMock.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/",
    "/login",
    "/procedimenti/procedure-1",
    "/api/admin/runtime-health",
    "/_next/static/chunks/app.js",
    "/favicon.ico",
  ])("denies non-MCP paths on the dedicated MCP host: %s", async (path) => {
    const response = await middleware(makeRequest(
      path,
      "concessioni-portuali-demo-v7-mcp-preview.vercel.app",
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    "/api/mcp",
    "/.well-known/oauth-protected-resource",
  ])("allows only the MCP boundary on the dedicated MCP host: %s", async (path) => {
    const response = await middleware(makeRequest(
      path,
      "concessioni-portuali-demo-v7-mcp-preview.vercel.app",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("does not apply the dedicated-host restriction to normal Preview or Production hosts", async () => {
    for (const host of [
      "concessioni-portuali-demo-v7-preview.vercel.app",
      "app.noetra.it",
    ]) {
      const response = await middleware(makeRequest("/login", host));
      expect(response.status).toBe(200);
    }
  });

  it("uses the same normalized secret as NextAuth when validating an existing session", async () => {
    const normalizedSecret = "a-secure-nextauth-secret-with-32-characters";
    vi.stubEnv("NEXTAUTH_SECRET", `  ${normalizedSecret}\r\n`);
    getTokenMock.mockImplementationOnce(async ({ secret }) => (
      secret === normalizedSecret
        ? { role: "ADMIN", mfaEnrollmentRequired: false, mfaVerified: true }
        : null
    ));

    const response = await middleware(makeRequest("/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      secret: normalizedSecret,
    }));
  });

  it("reads the isolated Preview session cookie issued by NextAuth", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "a-secure-nextauth-secret-with-32-characters");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    getTokenMock.mockResolvedValueOnce({
      role: "ADMIN",
      mfaEnrollmentRequired: false,
      mfaVerified: true,
    });

    const response = await middleware(makeRequest("/dashboard"));

    expect(response.status).toBe(200);
    expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      cookieName: "__Secure-noetra-preview.session-token",
    }));
  });

  it("protects the retired DB recon path like every admin route", async () => {
    const response = await middleware(makeRequest("/api/admin/db-recon-preview-temp"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when token parsing throws", async () => {
    getTokenMock.mockRejectedValueOnce(new URIError("Malformed bearer token"));

    const response = await middleware(makeRequest("/api/admin/runtime-health"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("allows the exact trusted mission route to perform bearer authentication", async () => {
    const response = await middleware(makeRequest("/api/legal-research/trusted/mission"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("allows only the exact trusted mission action route to perform bearer authentication", async () => {
    const response = await middleware(makeRequest("/api/legal-research/trusted/mission/action"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    "/api/legal-research/trusted/mission/extra",
    "/api/legal-research/trusted/mission/action/extra",
    "/api/legal-research/trusted/mission/actionx",
    "/api/legal-research/trusted/other",
  ])("keeps non-exact trusted paths protected: %s", async (path) => {
    const response = await middleware(makeRequest(path));

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe("/login");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });

  it("keeps /api/admin/db-recon-preview-temp/extra protected", async () => {
    const response = await middleware(makeRequest("/api/admin/db-recon-preview-temp/extra"));

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe("/api/admin/db-recon-preview-temp/extra");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });

  it("keeps other /api/admin/* routes protected", async () => {
    const response = await middleware(makeRequest("/api/admin/audit"));

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe("/api/admin/audit");
    expect(getTokenMock).toHaveBeenCalledTimes(1);
  });

  it("continues requiring session on normal admin routes", async () => {
    const unauthenticated = await middleware(makeRequest("/api/admin/normal"));

    expect(unauthenticated.status).toBe(307);

    getTokenMock.mockResolvedValueOnce({
      role: "ADMIN",
      mfaEnrollmentRequired: false,
      mfaVerified: true,
    });
    const authenticated = await middleware(makeRequest("/api/admin/normal"));

    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get("location")).toBeNull();
  });

  it("does not allow bypass via similar paths or query strings", async () => {
    const similarPath = await middleware(makeRequest("/api/admin/db-recon-preview-tempx"));
    expect(similarPath.status).toBe(307);

    const withQuery = await middleware(
      makeRequest("/api/admin/db-recon-preview-temp/extra?x-db-recon-token=preview-token"),
    );

    expect(withQuery.status).toBe(307);
    const location = withQuery.headers.get("location");
    expect(location).not.toBeNull();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe(
      "/api/admin/db-recon-preview-temp/extra?x-db-recon-token=preview-token",
    );
  });

  it.each([
    "/admin/runtime",
    "/audit",
    "/legal-research/assisted-verification",
    "/legal-sources/source-1/download",
    "/api/admin/runtime-health",
  ])("confines direct reserved access to MFA enrollment: %s", async (path) => {
    getTokenMock.mockResolvedValueOnce({
      role: "ADMIN",
      mfaEnrollmentRequired: true,
      mfaVerified: false,
    });

    const response = await middleware(makeRequest(path));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/mfa/enroll");
  });

  it("allows an authenticated ADMIN awaiting enrollment to open only the enrollment page", async () => {
    getTokenMock.mockResolvedValue({
      role: "ADMIN",
      mfaEnrollmentRequired: true,
      mfaVerified: false,
    });

    const enrollment = await middleware(makeRequest("/mfa/enroll"));
    expect(enrollment.status).toBe(200);
    expect(enrollment.headers.get("location")).toBeNull();

    const dashboard = await middleware(makeRequest("/dashboard"));
    expect(dashboard.status).toBe(307);
    expect(new URL(dashboard.headers.get("location")!).pathname).toBe("/mfa/enroll");
  });

  it("does not expose the enrollment page without an authenticated session", async () => {
    const response = await middleware(makeRequest("/mfa/enroll"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/mfa/enroll");
  });

  it.each([
    "/api/auth/mfa/enrollment",
    "/api/auth/signout",
  ])("leaves the required authenticated auth flow available: %s", async (path) => {
    const response = await middleware(makeRequest(path));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("redirects a fully verified ADMIN away from enrollment to the ordinary application", async () => {
    getTokenMock.mockResolvedValueOnce({
      role: "ADMIN",
      mfaEnrollmentRequired: false,
      mfaVerified: true,
    });

    const response = await middleware(makeRequest("/mfa/enroll"));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("rejects a required-role token that is neither verified nor enrolling", async () => {
    getTokenMock.mockResolvedValueOnce({
      role: "ADMIN",
      mfaEnrollmentRequired: false,
      mfaVerified: false,
    });

    const response = await middleware(makeRequest("/dashboard"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/dashboard");
  });
});

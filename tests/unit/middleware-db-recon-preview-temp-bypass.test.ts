import { beforeEach, describe, expect, it, vi } from "vitest";
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

function makeRequest(path: string) {
  return new NextRequest(`https://example.test${path}`);
}

describe("middleware DB recon temporary endpoint bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("does not redirect exact /api/admin/db-recon-preview-temp", async () => {
    const response = await middleware(makeRequest("/api/admin/db-recon-preview-temp"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
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

    getTokenMock.mockResolvedValueOnce({ role: "ADMIN" });
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
});

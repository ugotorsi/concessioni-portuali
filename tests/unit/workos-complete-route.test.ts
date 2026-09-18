import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const findUserMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: findUserMock } },
}));

import { GET } from "@/app/api/auth/workos/complete/route";
import { RESEARCH_MCP_TENANT_ID_CLAIM } from "@/server/legal-research/mcp-auth";

const issuer = "https://auth.example.workos.com";

function request(externalAuthId = "external_auth_123") {
  return new Request(
    `https://app.example.test/api/auth/workos/complete?external_auth_id=${encodeURIComponent(externalAuthId)}`,
  );
}

function localUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-local-1",
    nome: "Ada Lovelace",
    email: "ada@example.test",
    attivo: true,
    tenantMemberships: [
      { enteId: "tenant-a", ente: { nome: "Autorita A", codice: "AA" } },
      { enteId: "tenant-b", ente: { nome: "Autorita B", codice: "AB" } },
    ],
    ...overrides,
  };
}

describe("GET /api/auth/workos/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", issuer);
    vi.stubEnv("MCP_RESOURCE_URI", "https://mcp.example.test/api/mcp");
    vi.stubEnv("WORKOS_API_KEY", "workos_test_key");
    vi.stubGlobal("fetch", fetchMock);
    getCurrentUserMock.mockResolvedValue({ id: "user-local-1" });
    findUserMock.mockResolvedValue(localUser());
    fetchMock.mockResolvedValue(Response.json({ redirect_uri: `${issuer}/oauth2/authorize/resume` }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["WORKOS_AUTHKIT_ISSUER", ""],
    ["MCP_RESOURCE_URI", ""],
    ["WORKOS_API_KEY", ""],
  ])("fails closed when %s is absent", async (key, value) => {
    vi.stubEnv(key, value);
    const response = await GET(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "AUTH_UNAVAILABLE" });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["", "bad value", "../escape", "a".repeat(257)])(
    "rejects invalid external auth id %j",
    async (externalAuthId) => {
      const response = await GET(request(externalAuthId));
      expect(response.status).toBe(400);
      expect(getCurrentUserMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("redirects unauthenticated users to the existing login and preserves completion state", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const response = await GET(request("external_auth_abc"));
    const redirect = new URL(response.headers.get("location")!);
    expect(response.status).toBe(302);
    expect(redirect.pathname).toBe("/login");
    expect(redirect.searchParams.get("callbackUrl")).toBe(
      "/api/auth/workos/complete?external_auth_id=external_auth_abc",
    );
    expect(findUserMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", localUser({ attivo: false })],
    ["without membership", localUser({ tenantMemberships: [] })],
  ])("rejects a local user who is %s", async (_case, user) => {
    findUserMock.mockResolvedValue(user);
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the immutable local identity and bounded tenant consent choices", async () => {
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${issuer}/oauth2/authorize/resume`);
    expect(findUserMock).toHaveBeenCalledWith({
      where: { id: "user-local-1" },
      select: expect.any(Object),
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.workos.com/authkit/oauth2/complete", {
      method: "POST",
      headers: {
        Authorization: "Bearer workos_test_key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        external_auth_id: "external_auth_123",
        user: { id: "user-local-1", email: "ada@example.test", name: "Ada Lovelace" },
        user_consent_options: [{
          claim: RESEARCH_MCP_TENANT_ID_CLAIM,
          type: "enum",
          label: "Ente",
          choices: [
            { value: "tenant-a", label: "Autorita A (AA)" },
            { value: "tenant-b", label: "Autorita B (AB)" },
          ],
        }],
      }),
      cache: "no-store",
    });
  });

  it("maps provider HTTP and network failures to AUTH_UNAVAILABLE", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
    expect((await GET(request())).status).toBe(503);

    fetchMock.mockRejectedValueOnce(new Error("provider secret"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider secret");
  });

  it.each([
    ["missing redirect", {}],
    ["malformed redirect", { redirect_uri: "not a URL" }],
    ["insecure redirect", { redirect_uri: "http://auth.example.workos.com/resume" }],
    ["foreign redirect", { redirect_uri: "https://attacker.example/resume" }],
  ])("rejects a %s response from the provider", async (_case, body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
});

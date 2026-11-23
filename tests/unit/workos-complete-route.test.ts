import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const findUserMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: findUserMock } },
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: auditSuccessMock,
  auditFailure: auditFailureMock,
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
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(Response.json(
      { error: "invalid_api_key", error_description: "provider secret" },
      { status: 401 },
    ));
    expect((await GET(request())).status).toBe(503);
    expect(consoleError).toHaveBeenCalledWith(JSON.stringify({
      event: "workos_oauth_completion_failure",
      stage: "WORKOS_RESPONSE",
      status: 401,
      code: "invalid_api_key",
      category: "API_CREDENTIAL",
    }));
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("provider secret"));

    fetchMock.mockRejectedValueOnce(new Error("provider secret"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider secret");
  });

  it("reconciles one verified unbound WorkOS user before retrying completion", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "email_not_available" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({
        data: [{
          id: "user_01M7TEST",
          email: "ada@example.test",
          email_verified: true,
          external_id: null,
        }],
      }))
      .mockResolvedValueOnce(Response.json({ external_id: "user-local-1" }))
      .mockResolvedValueOnce(Response.json({ redirect_uri: `${issuer}/oauth2/authorize/resume` }));

    const response = await GET(request());

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${issuer}/oauth2/authorize/resume`);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe(
      "https://api.workos.com/user_management/users?email=ada%40example.test&limit=2",
    );
    expect(fetchMock.mock.calls[2]).toEqual([
      "https://api.workos.com/user_management/users/user_01M7TEST",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer workos_test_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ external_id: "user-local-1" }),
        cache: "no-store",
      },
    ]);
  });

  it("does not relink a WorkOS user already bound to another identity", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "email_not_available" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({
        data: [{
          id: "user_01M7TEST",
          email: "ada@example.test",
          email_verified: true,
          external_id: "another-user",
        }],
      }));

    expect((await GET(request())).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rebinds only with an exact permit and preserves WorkOS identity relations", async () => {
    const previousExternalId = "legacy-user-id";
    vi.stubEnv(
      "WORKOS_EXTERNAL_ID_REBIND_PERMIT",
      `user-local-1:${createHash("sha256").update(previousExternalId).digest("hex")}`,
    );
    const list = (ids: string[]) => Response.json({ data: ids.map((id) => ({ id })) });
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "email_not_available" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({
        data: [{
          id: "user_01M7TEST",
          email: "ada@example.test",
          email_verified: true,
          external_id: previousExternalId,
        }],
      }))
      .mockResolvedValueOnce(list(["membership-1"]))
      .mockResolvedValueOnce(list(["application-1"]))
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(Response.json({
        id: "user_01M7TEST",
        external_id: "user-local-1",
      }))
      .mockResolvedValueOnce(list(["membership-1"]))
      .mockResolvedValueOnce(list(["application-1"]))
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(Response.json({ redirect_uri: `${issuer}/oauth2/authorize/resume` }));

    const response = await GET(request());

    expect(response.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(auditSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "WORKOS_EXTERNAL_ID_REBIND",
      entita: "WorkosUser",
      entitaId: "user_01M7TEST",
      metadata: expect.objectContaining({
        previousExternalId,
        externalId: "user-local-1",
      }),
    }));
    expect(auditFailureMock).not.toHaveBeenCalled();
  });

  it("restores the previous binding when a WorkOS identity relation changes", async () => {
    const previousExternalId = "legacy-user-id";
    vi.stubEnv(
      "WORKOS_EXTERNAL_ID_REBIND_PERMIT",
      `user-local-1:${createHash("sha256").update(previousExternalId).digest("hex")}`,
    );
    const list = (ids: string[]) => Response.json({ data: ids.map((id) => ({ id })) });
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "email_not_available" }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({
        data: [{
          id: "user_01M7TEST",
          email: "ada@example.test",
          email_verified: true,
          external_id: previousExternalId,
        }],
      }))
      .mockResolvedValueOnce(list(["membership-1"]))
      .mockResolvedValueOnce(list(["application-1"]))
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(Response.json({
        id: "user_01M7TEST",
        external_id: "user-local-1",
      }))
      .mockResolvedValueOnce(list(["membership-1"]))
      .mockResolvedValueOnce(list(["application-changed"]))
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(Response.json({
        id: "user_01M7TEST",
        external_id: previousExternalId,
      }));

    expect((await GET(request())).status).toBe(503);
    expect(fetchMock.mock.calls[9]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ external_id: previousExternalId }),
    }));
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        reason: "POSTCONDITION_FAILED",
        rollbackSucceeded: true,
      }),
    }));
    expect(auditSuccessMock).not.toHaveBeenCalled();
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

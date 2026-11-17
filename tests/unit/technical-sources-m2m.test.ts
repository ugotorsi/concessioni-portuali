import { describe, expect, it, vi } from "vitest";

import {
  createTechnicalSourcesTokenProvider,
  isTechnicalSourcesChannelEnabled,
  readTechnicalSourcesM2MConfig,
} from "@/server/technical-sources/technical-sources-m2m";

const env = {
  TECHNICAL_SOURCES_MCP_ENABLED: "true",
  TECHNICAL_SOURCES_MCP_TOKEN_URL: "https://test.stytch.com/v1/public/project-test-00000000-0000-4000-8000-000000000001/oauth2/token",
  TECHNICAL_SOURCES_MCP_CLIENT_ID: "m2m-client-test-0a1b2c3d-0000-4000-8000-000000000001",
  TECHNICAL_SOURCES_MCP_CLIENT_SECRET: "synthetic-test-secret-not-real",
  TECHNICAL_SOURCES_MCP_SCOPE: "noetra:technical-read",
};
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("technical sources M2M token provider", () => {
  it("is disabled unless explicitly enabled and never falls back on partial configuration", () => {
    expect(readTechnicalSourcesM2MConfig({})).toBeNull();
    expect(isTechnicalSourcesChannelEnabled({ ...env, TECHNICAL_SOURCES_MCP_ENABLED: "1" })).toBe(false);
    expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_CLIENT_SECRET: "" }))
      .toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_TOKEN_URL: "http://example-123.customers.stytch.dev/t" }))
      .toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_TOKEN_URL: "https://attacker.example/token" }))
      .toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_CLIENT_ID: "connected-app-test-abc" }))
      .toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(isTechnicalSourcesChannelEnabled(env)).toBe(true);
  });

  it("refuses to request a token when disabled", async () => {
    const fetchMock = vi.fn();
    const provider = createTechnicalSourcesTokenProvider({ env: {}, fetchImpl: fetchMock });
    await expect(provider()).rejects.toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the official project token endpoint and matching test/live client environment", () => {
    for (const tokenUrl of [
      "https://test.stytch.com/v1/m2m/token",
      "https://test.stytch.com/v1/public/project-test-abc/oauth2/token?redirect=1",
      "https://test.stytch.com:8443/v1/public/project-test-abc/oauth2/token",
      "https://api.stytch.com/v1/public/project-test-abc/oauth2/token",
      "https://test.stytch.com/v1/public/project-live-abc/oauth2/token",
      "https://example-123.customers.stytch.dev/v1/oauth2/token",
    ]) {
      expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_TOKEN_URL: tokenUrl }))
        .toThrow("M2M_AUTH_NOT_CONFIGURED");
    }
    expect(() => readTechnicalSourcesM2MConfig({ ...env, TECHNICAL_SOURCES_MCP_CLIENT_ID: "m2m-client-live-abc" }))
      .toThrow("M2M_AUTH_NOT_CONFIGURED");
    expect(readTechnicalSourcesM2MConfig({
      ...env,
      TECHNICAL_SOURCES_MCP_TOKEN_URL: "https://api.stytch.com/v1/public/project-live-abc/oauth2/token",
      TECHNICAL_SOURCES_MCP_CLIENT_ID: "m2m-client-live-abc",
    })).not.toBeNull();
  });

  it("uses the Stytch JSON contract, accepts its standard response without scope and caches until near expiry", async () => {
    let now = 1_000_000;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      tokenResponse({ status_code: 200, request_id: "synthetic-request-id", access_token: jwt, token_type: "bearer", expires_in: 3600 }));
    const provider = createTechnicalSourcesTokenProvider({ env, fetchImpl: fetchMock, now: () => now });

    await expect(provider()).resolves.toBe(jwt);
    await expect(provider()).resolves.toBe(jwt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(env.TECHNICAL_SOURCES_MCP_TOKEN_URL);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: "client_credentials",
      client_id: env.TECHNICAL_SOURCES_MCP_CLIENT_ID,
      client_secret: env.TECHNICAL_SOURCES_MCP_CLIENT_SECRET,
      scope: "noetra:technical-read",
    });

    now += 3_600_000;
    await provider();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects failed or malformed token responses", async () => {
    const cases = [
      tokenResponse({ error: "invalid_client" }, 401),
      tokenResponse({ access_token: "opaque", token_type: "bearer", expires_in: 3600 }),
      tokenResponse({ access_token: jwt, token_type: "mac", expires_in: 3600 }),
      tokenResponse({ access_token: jwt, token_type: "bearer", expires_in: 3600, scope: "openid" }),
      tokenResponse({ access_token: jwt, token_type: "bearer" }),
    ];
    for (const response of cases) {
      const provider = createTechnicalSourcesTokenProvider({ env, fetchImpl: vi.fn(async () => response) });
      await expect(provider()).rejects.toThrow("M2M_TOKEN_ERROR");
    }
    const failing = createTechnicalSourcesTokenProvider({
      env,
      fetchImpl: vi.fn(async () => { throw new TypeError("redirect"); }),
    });
    await expect(failing()).rejects.toThrow("M2M_TOKEN_ERROR");
  });
});

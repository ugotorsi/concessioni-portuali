import { describe, expect, it, vi } from "vitest";

import { ResearchFascicoloAccessGrantError } from "@/server/legal-research/fascicolo-access-grant";
import type { ResearchMcpPrincipal } from "@/server/legal-research/mcp-auth";
import {
  callTrustedResearchMcp,
  TrustedResearchMcpClientError,
  TrustedResearchMcpRequestError,
  trustedResearchMcpTechnicalCode,
} from "@/server/legal-research/trusted-mcp-client";

const principal: ResearchMcpPrincipal = {
  actorId: "actor-a",
  tenantId: "tenant-a",
  claimantId: "workos:subject-a",
  permissions: ["research:read", "research:write"],
};

const call = {
  missionId: "mission-a",
  principal,
  accessToken: "workos-access-token",
  payload: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "research_get_mission", arguments: { missionId: "mission-a" } },
  },
} as const;

const env = {
  ...process.env,
  WORKOS_AUTHKIT_ISSUER: "https://auth.example.test",
  MCP_RESOURCE_URI: "https://preview.example.test/api/mcp",
};

describe("trusted research MCP client", () => {
  it("mints for the authenticated principal and transmits the grant only as an MCP header", async () => {
    const mintGrant = vi.fn(async () => ({
      grant: "fg1.signed.payload",
      expiresAt: "2026-09-23T10:30:00.000Z",
      fascicoloScopeId: "fascicolo-scope:a",
    }));
    const transport = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
    );

    const response = await callTrustedResearchMcp(call, { env, mintGrant, transport });

    expect(response.status).toBe(200);
    expect(mintGrant).toHaveBeenCalledWith({ missionId: "mission-a", principal });
    const [resourceUri, init] = transport.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(resourceUri).toBe("https://preview.example.test/api/mcp");
    expect(headers.get("authorization")).toBe("Bearer workos-access-token");
    expect(headers.get("x-concessioni-fascicolo-grant")).toBe("fg1.signed.payload");
    expect(init.body).toBe(JSON.stringify(call.payload));
    expect(String(init.body)).not.toContain("fg1.signed.payload");
    expect(await response.text()).not.toContain("fg1.signed.payload");
  });

  it("fails before minting when the access token is absent", async () => {
    const mintGrant = vi.fn();
    const transport = vi.fn();

    await expect(callTrustedResearchMcp({ ...call, accessToken: " " }, { env, mintGrant, transport }))
      .rejects.toEqual(expect.objectContaining<Partial<TrustedResearchMcpClientError>>({
        code: "MCP_ACCESS_TOKEN_REQUIRED",
      }));
    expect(mintGrant).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "http://preview.example.test/api/mcp",
    "https://preview.example.test/api/other",
  ])("rejects an absent or unsafe configured resource before minting", async (resourceUri) => {
    const mintGrant = vi.fn();
    const transport = vi.fn();

    await expect(callTrustedResearchMcp(call, {
      env: { ...env, MCP_RESOURCE_URI: resourceUri },
      mintGrant,
      transport,
    })).rejects.toEqual(expect.objectContaining({ code: "MCP_RESOURCE_URI_INVALID" }));
    expect(mintGrant).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not call MCP when mission authorization denies grant minting", async () => {
    const mintGrant = vi.fn(async () => {
      throw new ResearchFascicoloAccessGrantError("FASCICOLO_BINDING_FORBIDDEN");
    });
    const transport = vi.fn();

    await expect(callTrustedResearchMcp(call, { env, mintGrant, transport }))
      .rejects.toEqual(expect.objectContaining({ code: "FASCICOLO_BINDING_FORBIDDEN" }));
    expect(transport).not.toHaveBeenCalled();
  });

  it("classifies unexpected mint failures without exposing their message", async () => {
    const mintGrant = vi.fn(async () => { throw new Error("sensitive mint detail"); });
    const transport = vi.fn();

    await expect(callTrustedResearchMcp(call, { env, mintGrant, transport }))
      .rejects.toMatchObject<Partial<TrustedResearchMcpRequestError>>({
        phase: "MINT_GRANT",
        technicalCode: "UNKNOWN",
      });
    expect(transport).not.toHaveBeenCalled();
  });

  it("classifies request serialization failures", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(callTrustedResearchMcp({ ...call, payload: circular }, {
      env,
      mintGrant: vi.fn(async () => ({
        grant: "fg1.signed.payload",
        expiresAt: "2026-09-23T10:30:00.000Z",
        fascicoloScopeId: "fascicolo-scope:a",
      })),
      transport: vi.fn(),
    })).rejects.toMatchObject({ phase: "SERIALIZE_REQUEST", technicalCode: "TYPE_ERROR" });
  });

  it("whitelists transport error codes", async () => {
    const transport = vi.fn(async () => {
      throw new TypeError("sensitive transport detail", { cause: { code: "ENOTFOUND" } });
    });

    await expect(callTrustedResearchMcp(call, {
      env,
      mintGrant: vi.fn(async () => ({
        grant: "fg1.signed.payload",
        expiresAt: "2026-09-23T10:30:00.000Z",
        fascicoloScopeId: "fascicolo-scope:a",
      })),
      transport,
    })).rejects.toMatchObject({ phase: "INTERNAL_FETCH", technicalCode: "DNS_NOT_FOUND" });
  });

  it("checks a whitelisted cause when the direct code is unknown", () => {
    const error = Object.assign(new TypeError("sensitive transport detail", {
      cause: { code: "ECONNRESET" },
    }), { code: "NOT_WHITELISTED" });

    expect(trustedResearchMcpTechnicalCode(error)).toBe("CONNECTION_RESET");
  });

  it("recognizes only the locally verified redirect signature", () => {
    expect(trustedResearchMcpTechnicalCode(
      new TypeError("fetch failed", { cause: new Error("unexpected redirect") }),
    )).toBe("REDIRECT_REJECTED");
    expect(trustedResearchMcpTechnicalCode(new TypeError("different failure"))).toBe("TYPE_ERROR");
  });
});

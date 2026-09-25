import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyMock = vi.hoisted(() => vi.fn());
const callTrustedResearchMcpMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/legal-research/mcp-auth", () => {
  class ResearchMcpAuthError extends Error {
    constructor(
      readonly code: "AUTH_UNAVAILABLE" | "FORBIDDEN",
      readonly status: 503 | 403,
      readonly diagnosticCode?: string,
    ) {
      super(code);
    }
  }
  return {
    ResearchMcpAuthError,
    createWorkosResearchMcpPrincipalVerifier: () => ({ verify: verifyMock }),
    getResearchMcpAuthConfig: () => ({
      issuer: "https://auth.example.test",
      resource: "https://staging.example.test/api/mcp",
      jwksUri: "https://auth.example.test/oauth2/jwks",
    }),
    researchMcpAuthResponse: (_config: unknown, options: {
      status?: number;
      error?: string;
      invalidToken?: boolean;
    } = {}) => Response.json(
      { error: options.error ?? "AUTH_REQUIRED" },
      {
        status: options.status ?? 401,
        headers: options.invalidToken
          ? { "WWW-Authenticate": "Bearer error=\"invalid_token\"" }
          : undefined,
      },
    ),
  };
});

vi.mock("@/server/legal-research/fascicolo-access-grant", () => ({
  ResearchFascicoloAccessGrantError: class ResearchFascicoloAccessGrantError extends Error {
    constructor(readonly code: string, readonly diagnosticCode?: string) {
      super(code);
    }
  },
}));

vi.mock("@/server/legal-research/trusted-mcp-client", () => ({
  TrustedResearchMcpClientError: class TrustedResearchMcpClientError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  callTrustedResearchMcp: callTrustedResearchMcpMock,
}));

import { POST } from "@/app/api/legal-research/trusted/mission/route";
import { ResearchFascicoloAccessGrantError } from "@/server/legal-research/fascicolo-access-grant";
import { ResearchMcpAuthError } from "@/server/legal-research/mcp-auth";

const missionId = "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const accessToken = "secret-workos-bearer";
const principal = {
  actorId: "actor-a",
  tenantId: "tenant-a",
  claimantId: "workos:subject-a",
  permissions: ["research:read"],
};

function request(body: unknown = { missionId }, token = accessToken): Request {
  return new Request("https://staging.example.test/api/legal-research/trusted/mission", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/legal-research/trusted/mission", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(principal);
    callTrustedResearchMcpMock.mockResolvedValue(Response.json({
      jsonrpc: "2.0",
      id: "trusted-research-get-mission",
      result: { structuredContent: { missionId, status: "PENDING" } },
    }));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => warnSpy.mockRestore());

  it("derives the principal from the verifier and invokes only research_get_mission", async () => {
    const incoming = request();
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(incoming);
    expect(callTrustedResearchMcpMock).toHaveBeenCalledWith({
      missionId,
      principal,
      accessToken,
      payload: {
        jsonrpc: "2.0",
        id: "trusted-research-get-mission",
        method: "tools/call",
        params: { name: "research_get_mission", arguments: { missionId } },
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an invalid bearer before calling trusted MCP", async () => {
    verifyMock.mockResolvedValue(null);
    const response = await POST(request({ missionId }, "invalid-token"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer before calling trusted MCP", async () => {
    const incoming = new Request("https://staging.example.test/api/legal-research/trusted/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId }),
    });
    const response = await POST(incoming);

    expect(response.status).toBe(401);
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it("rejects a tenant denied by the verified local identity", async () => {
    verifyMock.mockRejectedValue(new ResearchMcpAuthError(
      "FORBIDDEN",
      403,
      "TRUSTED_READ_TENANT_ABSENT_OR_MEMBERSHIP_DENIED",
    ));
    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("TRUSTED_READ_TENANT_ABSENT_OR_MEMBERSHIP_DENIED");
  });

  it("rejects a mission outside the principal fascicolo scope", async () => {
    callTrustedResearchMcpMock.mockRejectedValue(
      new ResearchFascicoloAccessGrantError(
        "FASCICOLO_BINDING_FORBIDDEN",
        "TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED",
      ),
    );
    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(warnSpy).toHaveBeenCalledWith("TRUSTED_READ_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED");
  });

  it("logs a constant code for an upstream 403 without changing the response", async () => {
    callTrustedResearchMcpMock.mockResolvedValue(Response.json({ error: "FORBIDDEN" }, { status: 403 }));

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(warnSpy).toHaveBeenCalledWith("TRUSTED_READ_UPSTREAM_FORBIDDEN");
  });

  it("rejects actor, tenant, destination, or tool fields supplied by the client", async () => {
    const response = await POST(request({
      missionId,
      actorId: "attacker",
      tenantId: "other-tenant",
      destination: "https://attacker.example",
      tool: "research_claim_mission",
    }));

    expect(response.status).toBe(400);
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it("never exposes bearer, grant, or internal error details", async () => {
    callTrustedResearchMcpMock.mockRejectedValue(new Error(`upstream ${accessToken} fg1.secret-grant`));
    const response = await POST(request());
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).toBe('{"error":"TRUSTED_MCP_REQUEST_FAILED"}');
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain("fg1.secret-grant");
  });
});

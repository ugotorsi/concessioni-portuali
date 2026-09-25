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
  TrustedResearchMcpRequestError: class TrustedResearchMcpRequestError extends Error {
    constructor(readonly phase: string, readonly technicalCode: string) {
      super(`${phase}:${technicalCode}`);
    }
  },
  trustedResearchMcpTechnicalCode: () => "TYPE_ERROR",
  callTrustedResearchMcp: callTrustedResearchMcpMock,
}));

import { POST } from "@/app/api/legal-research/trusted/mission/action/route";
import { RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";
import { ResearchFascicoloAccessGrantError } from "@/server/legal-research/fascicolo-access-grant";

const missionId = "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const accessToken = "secret-workos-bearer";
const claimToken = "a".repeat(64);
const principal = {
  actorId: "actor-a",
  tenantId: "tenant-a",
  claimantId: "workos:subject-a",
  permissions: ["research:read", "research:write"],
};

function evidenceBundle(bundleMissionId = missionId) {
  return {
    kind: "RESEARCH_EVIDENCE_BUNDLE",
    version: RESEARCH_BRIDGE_VERSION,
    missionId: bundleMissionId,
    executionId: "execution-a",
    researchToolExecutions: [],
    authorityCandidates: [],
    citationObservations: [],
    legalResearchSuggestions: [],
    evidenceGaps: [],
    conflicts: [],
    unresolvedQuestions: [],
    suggestedFollowUpMissions: [],
    humanDecisionEscalations: [],
    completionState: "PARTIAL",
  };
}

function request(body: unknown, token = accessToken): Request {
  return new Request("https://staging.example.test/api/legal-research/trusted/mission/action", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/legal-research/trusted/mission/action", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyMock.mockResolvedValue(principal);
    callTrustedResearchMcpMock.mockResolvedValue(Response.json({ jsonrpc: "2.0", result: { ok: true } }));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => warnSpy.mockRestore());

  it.each([
    {
      input: { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000 },
      arguments: { missionId, executionId: "execution-a", leaseDurationMs: 60_000 },
    },
    {
      input: { action: "research_submit_evidence_bundle", missionId, bundle: evidenceBundle(), claimToken },
      arguments: { bundle: evidenceBundle(), claimToken },
    },
    {
      input: {
        action: "research_complete_mission", missionId, executionId: "execution-a", bundleId: "bundle-a", claimToken,
      },
      arguments: { missionId, executionId: "execution-a", bundleId: "bundle-a", claimToken },
    },
    {
      input: {
        action: "research_defer_mission", missionId, executionId: "execution-a", claimToken,
        disposition: "DEFER", reasonCode: "RESEARCH_INCOMPLETE",
      },
      arguments: {
        missionId, executionId: "execution-a", claimToken,
        disposition: "DEFER", reasonCode: "RESEARCH_INCOMPLETE",
      },
    },
  ])("maps $input.action to its exact MCP call", async ({ input, arguments: expectedArguments }) => {
    const incoming = request(input);
    const response = await POST(incoming);

    expect(response.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(incoming);
    expect(callTrustedResearchMcpMock).toHaveBeenCalledWith({
      missionId,
      principal,
      accessToken,
      payload: {
        jsonrpc: "2.0",
        id: `trusted-${input.action}`,
        method: "tools/call",
        params: { name: input.action, arguments: expectedArguments },
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects missing and invalid bearer credentials before the trusted call", async () => {
    const missing = new Request("https://staging.example.test/api/legal-research/trusted/mission/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000 }),
    });
    expect((await POST(missing)).status).toBe(401);

    verifyMock.mockResolvedValueOnce(null);
    const invalid = await POST(request(
      { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000 },
      "invalid-token",
    ));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("www-authenticate")).toContain("invalid_token");
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it.each([
    { action: "research_delete_mission", missionId },
    { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000, tenantId: "tenant-b" },
    { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000, actorId: "attacker" },
    { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000, destination: "https://attacker.test" },
    { action: "research_claim_mission", missionId, executionId: "execution-a", leaseDurationMs: 60_000, tool: "research_get_mission" },
  ])("rejects unknown actions and caller-controlled routing or identity", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it("rejects a submit whose route mission differs from the bundle mission", async () => {
    const response = await POST(request({
      action: "research_submit_evidence_bundle",
      missionId,
      bundle: evidenceBundle("research-mission:other"),
      claimToken,
    }));

    expect(response.status).toBe(400);
    expect(callTrustedResearchMcpMock).not.toHaveBeenCalled();
  });

  it("preserves fascicolo denial without exposing bearer or grant details", async () => {
    callTrustedResearchMcpMock.mockRejectedValue(new ResearchFascicoloAccessGrantError(
      "FASCICOLO_BINDING_FORBIDDEN",
      "TRUSTED_ACTION_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED",
    ));
    const response = await POST(request({
      action: "research_claim_mission",
      missionId,
      executionId: "execution-a",
      leaseDurationMs: 60_000,
    }));
    const serialized = await response.text();

    expect(response.status).toBe(403);
    expect(serialized).toBe('{"error":"FORBIDDEN"}');
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain("fg1.secret-grant");
    expect(warnSpy).toHaveBeenCalledWith("TRUSTED_ACTION_MISSION_TENANT_MISMATCH_OR_ACCESS_DENIED");
  });
});

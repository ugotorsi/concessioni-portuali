import { describe, expect, it, vi } from "vitest";

import { RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";
import { createAssistedVerificationSnapshot } from "@/server/legal-research/assisted-verification";
import {
  TrustedResearchClientError,
  TrustedResearchHttpError,
  TrustedResearchMcpError,
  createTrustedResearchHttpClient,
} from "@/server/legal-research/trusted-research-http-client";

const stagingOrigin = "https://staging.example.test";
const resource = `${stagingOrigin}/api/mcp`;
const issuer = "https://auth.example.test";
const bearer = "secret-workos-bearer";
const missionId = "research-mission:mission-a";
const claimToken = "a".repeat(64);

function mcpResult(structuredContent: unknown): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: "trusted-test",
    result: { structuredContent },
  });
}

function missionSnapshot() {
  return {
    mission: {
      kind: "RESEARCH_MISSION",
      version: RESEARCH_BRIDGE_VERSION,
      missionId,
      caseReference: { caseId: "case-a", fascicoloReference: "fascicolo-a" },
      legalIssueIds: ["issue-a"],
      legalPropositionIds: ["proposition-a"],
      referenceDate: "2026-09-25T00:00:00.000Z",
      mode: "EXACT_SOURCE_RECOVERY",
      researchQuestion: "Verify the cited authority.",
      knownAuthorities: [],
      excludedAuthorities: [],
      preferredSourceFamilies: ["CASSAZIONE"],
      missingSourceFamilies: [],
      knownCounterArguments: [],
      knownEvidenceGaps: [],
      requiredOutput: {
        authorityCandidates: true,
        citationObservations: false,
        legalResearchSuggestions: false,
        evidenceGaps: true,
        fullTextRequired: false,
      },
      budget: {
        maxTotalResearchCalls: 3,
        maxMoonlitCalls: 0,
        maxSimpliciterCalls: 0,
        maxLegalDataHunterCalls: 3,
      },
      status: "PENDING",
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["LEGAL_DATA_HUNTER"] },
    },
    operational: {
      status: "PENDING",
      stateVersion: 0,
      claimExpiresAt: null,
      activeExecutionId: null,
      completedAt: null,
      deferredAt: null,
    },
    fascicoloContext: { bounded: true },
  };
}

function client(transport: (input: string, init: RequestInit) => Promise<Response>) {
  const bearerSupplier = vi.fn(async () => bearer);
  return {
    bearerSupplier,
    value: createTrustedResearchHttpClient({
      stagingOrigin,
      issuer,
      resource,
      bearerSupplier,
      transport,
    }),
  };
}

describe("trusted research HTTP client", () => {
  it("calls only the trusted mission route with the stored WorkOS bearer", async () => {
    const transport = vi.fn(async (_input: string, _init: RequestInit) => mcpResult(missionSnapshot()));
    const { value, bearerSupplier } = client(transport);

    await expect(value.readMission(missionId)).resolves.toMatchObject({ mission: { missionId } });

    expect(bearerSupplier).toHaveBeenCalledWith({ issuer, resource });
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(url).toBe(`${stagingOrigin}/api/legal-research/trusted/mission`);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(headers.get("authorization")).toBe(`Bearer ${bearer}`);
    expect(headers.has("x-concessioni-fascicolo-grant")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ missionId });
  });

  it("rejects assisted evidence belonging to another mission", async () => {
    const transport = vi.fn(async () => mcpResult({ ...missionSnapshot(), assistedVerification: {
      recordId: "other-record", verifiedDocuments: [],
      snapshot: createAssistedVerificationSnapshot({ missionId: `research-mission:${"b".repeat(64)}`, sources: [] }),
    } }));
    await expect(client(transport).value.readMission(missionId)).rejects.toMatchObject({ code: "TRUSTED_MISSION_MISMATCH" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("maps named mutations to only the trusted mission action route", async () => {
    const transport = vi.fn(async (_input: string, _init: RequestInit) => mcpResult({
      outcome: "CLAIMED",
      missionId,
      fascicoloScopeId: "scope-a",
      executionId: "execution-a",
      leaseExpiresAt: "2026-09-25T10:15:00.000Z",
      claimToken,
    }));
    const { value } = client(transport);

    await value.claimMission({ missionId, executionId: "execution-a", leaseDurationMs: 60_000 });

    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`${stagingOrigin}/api/legal-research/trusted/mission/action`);
    expect(JSON.parse(String(init.body))).toEqual({
      action: "research_claim_mission",
      missionId,
      executionId: "execution-a",
      leaseDurationMs: 60_000,
    });
  });

  it.each([
    ["http://staging.example.test", resource, "STAGING_ORIGIN_INVALID"],
    [`${stagingOrigin}/path`, resource, "STAGING_ORIGIN_INVALID"],
    [stagingOrigin, "https://other.example.test/api/mcp", "STAGING_RESOURCE_ORIGIN_MISMATCH"],
    [stagingOrigin, `${stagingOrigin}/api/other`, "MCP_RESOURCE_URI_INVALID"],
  ])("rejects invalid staging endpoints before bearer or transport", (origin, resourceUri, code) => {
    const bearerSupplier = vi.fn();
    const transport = vi.fn();

    expect(() => createTrustedResearchHttpClient({
      stagingOrigin: origin,
      issuer,
      resource: resourceUri,
      bearerSupplier,
      transport,
    })).toThrow(expect.objectContaining<Partial<TrustedResearchClientError>>({ code }));
    expect(bearerSupplier).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps HTTP failures distinct from MCP tool failures", async () => {
    const http = client(async () => Response.json({ error: "FORBIDDEN" }, { status: 403 })).value;
    await expect(http.readMission(missionId)).rejects.toEqual(
      expect.objectContaining<Partial<TrustedResearchHttpError>>({ status: 403, code: "FORBIDDEN" }),
    );

    const mcp = client(async () => mcpResult({ error: "CLAIM_EXPIRED" })).value;
    await expect(mcp.readMission(missionId)).rejects.toEqual(
      expect.objectContaining<Partial<TrustedResearchMcpError>>({ code: "CLAIM_EXPIRED" }),
    );
  });

  it("rejects invalid action input before bearer or transport", async () => {
    const bearerSupplier = vi.fn();
    const transport = vi.fn();
    const value = createTrustedResearchHttpClient({
      stagingOrigin,
      issuer,
      resource,
      bearerSupplier,
      transport,
    });

    await expect(value.claimMission({
      missionId,
      executionId: "execution-a",
      leaseDurationMs: 999,
    })).rejects.toMatchObject({ code: "TRUSTED_ACTION_INPUT_INVALID" });
    expect(bearerSupplier).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("sanitizes bearer supplier and transport failures without logging tokens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const supplierClient = createTrustedResearchHttpClient({
      stagingOrigin,
      issuer,
      resource,
      bearerSupplier: async () => { throw new Error(`refresh failed ${bearer}`); },
      transport: vi.fn(),
    });
    await expect(supplierClient.readMission(missionId)).rejects.toMatchObject({ code: "WORKOS_BEARER_UNAVAILABLE" });

    const transportClient = client(async () => { throw new Error(`network failed ${bearer}`); }).value;
    await expect(transportClient.readMission(missionId)).rejects.toMatchObject({ code: "TRUSTED_TRANSPORT_FAILED" });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("times out a pending bearer supplier without starting HTTP transport", async () => {
    vi.useFakeTimers();
    try {
      const bearerSupplier = vi.fn(() => new Promise<string>(() => undefined));
      const transport = vi.fn();
      const value = createTrustedResearchHttpClient({
        stagingOrigin,
        issuer,
        resource,
        requestTimeoutMs: 50,
        bearerSupplier,
        transport,
      });

      const pending = value.readMission(missionId);
      const rejected = expect(pending).rejects.toMatchObject({ code: "TRUSTED_REQUEST_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;

      expect(bearerSupplier).toHaveBeenCalledOnce();
      expect(transport).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["mission", "action"] as const)("times out the trusted %s route without following redirects", async (route) => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn((_input: string, init: RequestInit) => new Promise<Response>(() => {
        expect(init.redirect).toBe("error");
      }));
      const value = createTrustedResearchHttpClient({
        stagingOrigin,
        issuer,
        resource,
        requestTimeoutMs: 50,
        bearerSupplier: async () => bearer,
        transport,
      });

      const pending = route === "mission"
        ? value.readMission(missionId)
        : value.claimMission({ missionId, executionId: "execution-a", leaseDurationMs: 60_000 });
      const rejected = expect(pending).rejects.toMatchObject({ code: "TRUSTED_REQUEST_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;

      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the timeout active while reading a response body that never ends", async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn(async (_input: string, _init: RequestInit) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"'));
        },
      })));
      const value = createTrustedResearchHttpClient({
        stagingOrigin,
        issuer,
        resource,
        requestTimeoutMs: 50,
        bearerSupplier: async () => bearer,
        transport,
      });

      const pending = value.readMission(missionId);
      const rejected = expect(pending).rejects.toMatchObject({ code: "TRUSTED_REQUEST_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;

      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0][1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createBearerOnlyProviderAdapters,
  loadTrustedMissionExecutorEnvironment,
  parseTrustedMissionExecutorArgs,
  reportTrustedMissionExecutorResult,
  runTrustedMissionExecutorCli,
} from "../../scripts/legal-research/execute-trusted-mission";
import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  type ResearchMissionInput,
} from "@/server/legal-research/bridge";
import {
  createMoonlitResearchAdapter,
  createSimpliciterResearchAdapter,
} from "@/server/legal-research/provider-research-adapters";
import type { TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";

const missionId = "research-mission:mission-a";
const stagingOrigin = "https://staging.example.test";

function researchMission(overrides: Partial<ResearchMissionInput> = {}) {
  return createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-a" },
    legalIssueIds: ["issue-a"],
    legalPropositionIds: ["proposition-a"],
    referenceDate: "2026-09-26T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "concessione demaniale marittima",
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
      maxMoonlitCalls: 2,
      maxSimpliciterCalls: 2,
      maxLegalDataHunterCalls: 2,
    },
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: ["SEMANTIC_DISCOVERY"],
      preferredToolIds: ["MOONLIT"],
    },
    ...overrides,
  });
}

function mockTrustedClient(mission: ReturnType<typeof researchMission>) {
  let completionState: "COMPLETE" | "PARTIAL" | "BUDGET_EXHAUSTED" = "PARTIAL";
  return {
    readMission: vi.fn(async () => ({
      mission,
      operational: {
        status: "PENDING" as const,
        stateVersion: 0,
        claimExpiresAt: null,
        activeExecutionId: null,
        completedAt: null,
        deferredAt: null,
      },
      fascicoloContext: {},
    })),
    claimMission: vi.fn(async ({ missionId: requestedMissionId, executionId }: {
      missionId: string;
      executionId: string;
    }) => ({
      outcome: "CLAIMED" as const,
      missionId: requestedMissionId,
      fascicoloScopeId: "scope-a",
      executionId,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      claimToken: "a".repeat(64),
    })),
    submitEvidenceBundle: vi.fn(async ({ bundle }: { bundle: { missionId: string; executionId: string; completionState: typeof completionState } }) => {
      completionState = bundle.completionState;
      return {
        outcome: "CREATED" as const,
        bundleId: "bundle-a",
        missionId: bundle.missionId,
        fascicoloScopeId: "scope-a",
        executionId: bundle.executionId,
        completionState: bundle.completionState,
      };
    }),
    completeMission: vi.fn(async ({ missionId: requestedMissionId, executionId }: {
      missionId: string;
      executionId: string;
    }) => ({
      outcome: "COMPLETED" as const,
      missionId: requestedMissionId,
      fascicoloScopeId: "scope-a",
      status: completionState === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" as const : "COMPLETED" as const,
      stateVersion: 2,
      executionId,
    })),
    deferMission: vi.fn(async ({ missionId: requestedMissionId }: { missionId: string }) => ({
      missionId: requestedMissionId,
      fascicoloScopeId: "scope-a",
      status: "DEFERRED" as const,
      stateVersion: 2,
    })),
  } as unknown as TrustedResearchHttpClient;
}

describe("trusted mission executor CLI", () => {
  it("requires the explicit execute flag", () => {
    expect(() => parseTrustedMissionExecutorArgs([
      "--mission-id", missionId,
      "--staging-origin", stagingOrigin,
    ])).toThrow(expect.objectContaining({ code: "EXPLICIT_EXECUTE_FLAG_REQUIRED" }));
  });

  it("requires an explicit mission id", () => {
    expect(() => parseTrustedMissionExecutorArgs([
      "--execute",
      "--staging-origin", stagingOrigin,
    ])).toThrow(expect.objectContaining({ code: "MISSION_ID_REQUIRED" }));
  });

  it("requires an explicit staging origin", () => {
    expect(() => parseTrustedMissionExecutorArgs([
      "--execute",
      "--mission-id", missionId,
    ])).toThrow(expect.objectContaining({ code: "STAGING_ORIGIN_REQUIRED" }));
  });

  it("rejects unknown arguments and invalid lease durations", () => {
    expect(() => parseTrustedMissionExecutorArgs([
      "--execute", "--mission-id", missionId, "--staging-origin", stagingOrigin, "--provider", "moonlit",
    ])).toThrow(expect.objectContaining({ code: "UNKNOWN_CLI_ARGUMENT" }));
    expect(() => parseTrustedMissionExecutorArgs([
      "--execute", "--mission-id", missionId, "--staging-origin", stagingOrigin, "--lease-duration-ms", "999",
    ])).toThrow(expect.objectContaining({ code: "LEASE_DURATION_INVALID" }));
  });

  it("accepts only a bounded explicit invocation", () => {
    expect(parseTrustedMissionExecutorArgs([
      "--execute",
      "--mission-id", missionId,
      "--staging-origin", stagingOrigin,
      "--lease-duration-ms", "60000",
    ])).toEqual({
      execute: true,
      missionId,
      stagingOrigin,
      leaseDurationMs: 60_000,
    });
  });

  it("loads only missing configuration from the workspace .env.local", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "trusted-executor-cli-"));
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      WORKOS_AUTHKIT_ISSUER: "https://existing-auth.example.test",
    };
    try {
      await writeFile(path.join(workspacePath, ".env.local"), [
        "WORKOS_AUTHKIT_ISSUER=https://file-auth.example.test",
        "MCP_RESOURCE_URI=https://staging.example.test/api/mcp",
        "LEGAL_DATA_HUNTER_API_KEY=fake-test-key",
        "TRUSTED_RESEARCH_HTTP_TIMEOUT_MS=2500",
      ].join("\n"), "utf8");

      loadTrustedMissionExecutorEnvironment(workspacePath, env);

      expect(env).toMatchObject({
        WORKOS_AUTHKIT_ISSUER: "https://existing-auth.example.test",
        MCP_RESOURCE_URI: "https://staging.example.test/api/mcp",
        LEGAL_DATA_HUNTER_API_KEY: "fake-test-key",
        TRUSTED_RESEARCH_HTTP_TIMEOUT_MS: "2500",
      });
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("sets a non-zero exit code for recovery without executing a mission", () => {
    const output = vi.fn();
    const processState: { exitCode?: number } = {};

    reportTrustedMissionExecutorResult({
      status: "RECOVERY_REQUIRED",
      missionId,
      executionId: "execution-a",
      callsConsumed: 0,
      blockerCodes: ["CLAIM_OUTCOME_UNCERTAIN"],
    }, output, processState);

    expect(processState.exitCode).toBe(2);
    expect(output).toHaveBeenCalledOnce();
  });

  it("registers only response-verified bearer adapters without connecting during setup", async () => {
    const moonlitTokens = vi.fn(async () => ({ access_token: "moonlit-token", token_type: "Bearer" }));
    const simpliciterTokens = vi.fn(async () => ({ access_token: "simpliciter-token", token_type: "Bearer" }));
    const providerFetch = vi.fn();

    const adapters = await createBearerOnlyProviderAdapters({
      moonlitTokenReader: { tokens: moonlitTokens },
      simpliciterTokenReader: { tokens: simpliciterTokens },
      fetch: providerFetch,
    });

    expect(adapters.map(({ provider, capability, toolName }) => ({ provider, capability, toolName })))
      .toEqual([
        { provider: "MOONLIT", capability: "SEMANTIC_DISCOVERY", toolName: "search_legal_documents" },
        { provider: "MOONLIT", capability: "KEYWORD_DISCOVERY", toolName: "search_legal_documents_by_keyword" },
        { provider: "MOONLIT", capability: "EXACT_RETRIEVAL", toolName: "get_document" },
        { provider: "SIMPLICITER", capability: "SEMANTIC_DISCOVERY", toolName: "legal_research" },
        { provider: "SIMPLICITER", capability: "EXACT_RETRIEVAL", toolName: "fetch_legal_source" },
        { provider: "SIMPLICITER", capability: "CROSS_JURISDICTION_DISCOVERY", toolName: "legal_research" },
      ]);
    expect(moonlitTokens).toHaveBeenCalledOnce();
    expect(simpliciterTokens).toHaveBeenCalledOnce();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("runs a semantic-only synthetic mission through the CLI and Moonlit adapter", async () => {
    const mission = researchMission();
    const client = mockTrustedClient(mission);
    const callTool = vi.fn(async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          result: { results: [{ identifier: "document-1", year: 2024 }] },
        }),
      }],
    }));
    const output = vi.fn();
    const processState: { exitCode?: number } = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await runTrustedMissionExecutorCli([
      "--execute", "--mission-id", mission.missionId, "--staging-origin", stagingOrigin,
    ], { NODE_ENV: "test" }, {
      loadEnvironment: vi.fn(),
      createClient: vi.fn(() => client),
      createProviderAdapters: vi.fn(async () => [createMoonlitResearchAdapter(callTool)]),
      output,
      processState,
    });

    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ status: "COMPLETED", callsConsumed: 1 });
    expect(client.claimMission).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(processState.exitCode).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("keeps an all-output adverse mission blocked before claim and provider calls", async () => {
    const base = researchMission();
    const mission = researchMission({
      requiredOutput: {
        authorityCandidates: true,
        citationObservations: true,
        legalResearchSuggestions: true,
        evidenceGaps: true,
        fullTextRequired: true,
      },
      executionPlan: {
        requiredCapabilities: ["ADVERSE_AUTHORITY_DISCOVERY"],
        preferredToolIds: ["MOONLIT", "SIMPLICITER"],
      },
      budget: base.budget,
    });
    const client = mockTrustedClient(mission);
    const moonlitCall = vi.fn();
    const simpliciterCall = vi.fn();
    const output = vi.fn();
    const processState: { exitCode?: number } = {};

    await runTrustedMissionExecutorCli([
      "--execute", "--mission-id", mission.missionId, "--staging-origin", stagingOrigin,
    ], { NODE_ENV: "test" }, {
      loadEnvironment: vi.fn(),
      createClient: vi.fn(() => client),
      createProviderAdapters: vi.fn(async () => [
        createMoonlitResearchAdapter(moonlitCall),
        createSimpliciterResearchAdapter(simpliciterCall),
      ]),
      output,
      processState,
    });

    expect(JSON.parse(output.mock.calls[0][0])).toEqual({
      status: "BLOCKED",
      missionId: mission.missionId,
      callsConsumed: 0,
      blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(moonlitCall).not.toHaveBeenCalled();
    expect(simpliciterCall).not.toHaveBeenCalled();
    expect(processState.exitCode).toBe(2);
  });
});

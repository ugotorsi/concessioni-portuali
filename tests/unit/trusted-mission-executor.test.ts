import { describe, expect, it, vi } from "vitest";

import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  type ResearchMissionInput,
} from "@/server/legal-research/bridge";
import type { TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";
import { createTrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";
import { createLiveAcceptanceMission } from "@/server/legal-research/live-acceptance-mission";
import { createTrustedMissionExecutor } from "@/server/legal-research/trusted-mission-executor";
import { verifyWithSyntheticDocuments as verifyResearchEvidence } from "./assisted-document-fixtures";
import {
  createAssistedVerificationSnapshot,
  type AssistedVerificationResult,
  type OfficialSourceEvidence,
} from "@/server/legal-research/assisted-verification";
import {
  createMoonlitExactRetrievalAdapter,
  createMoonlitKeywordResearchAdapter,
  createMoonlitResearchAdapter,
  createSimpliciterCrossJurisdictionResearchAdapter,
  createSimpliciterExactRetrievalAdapter,
  createSimpliciterResearchAdapter,
  type ProviderToolRequest,
} from "@/server/legal-research/provider-research-adapters";

const now = new Date("2026-09-25T10:00:00.000Z");
const claimToken = "a".repeat(64);

function missionInput(overrides: Partial<ResearchMissionInput> = {}): ResearchMissionInput {
  return {
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-a", fascicoloReference: "fascicolo-a" },
    legalIssueIds: ["issue-a"],
    legalPropositionIds: ["proposition-a"],
    referenceDate: "2026-09-25T00:00:00.000Z",
    mode: "EXACT_SOURCE_RECOVERY",
    researchQuestion: "Verify Cassazione civile, sez. III, n. 1234/2024.",
    knownAuthorities: [{
      authorityReferenceId: "authority-a",
      citation: "Cassazione civile, sez. III, n. 1234/2024",
    }],
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
      maxMoonlitCalls: 3,
      maxSimpliciterCalls: 3,
      maxLegalDataHunterCalls: 3,
    },
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: ["KEYWORD_DISCOVERY"],
      preferredToolIds: ["LEGAL_DATA_HUNTER"],
    },
    ...overrides,
  };
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function discovery(): Response {
  return json({ sources: [{
    source_id: "IT/Cassazione",
    data_types: ["case_law"],
    court_name: "Corte Suprema di Cassazione",
  }] });
}

function hit() {
  return {
    source: "IT/Cassazione",
    source_id: "decision-1234-2024",
    court: "Corte Suprema di Cassazione",
    authority: "Cassazione civile",
    decision_number: "1234",
    date: "2024-03-15",
    chamber: "III",
    decision_type: "SENTENZA",
    title: "Cassazione civile, sezione III, n. 1234/2024",
    url: "https://www.cortedicassazione.it/decision-1234-2024",
  };
}

function assistedSource(overrides: Partial<OfficialSourceEvidence> = {}): OfficialSourceEvidence {
  return {
    evidenceSourceId: "evidence-source-a",
    authorityId: "authority-a",
    legalSourceId: "legal-source-a",
    legalExpressionVersionId: "expression-a",
    officialIdentifier: "ECLI:EU:C:2024:1",
    sourceUrl: "https://official.example.test/authority-a",
    providerId: "OFFICIAL_SOURCE",
    accessStatus: "CONSULTABLE",
    identityVerificationStatus: "VERIFIED",
    reviewerAttestation: {
      reviewedByActorId: "legal-reviewer-a",
      reviewedAt: "2026-09-26T09:00:00.000Z",
      rationale: "Official identity and source content checked by the legal reviewer.",
    },
    termsOfUse: {
      status: "PERMITTED",
      basis: "Official public-access terms checked",
      checkedAt: "2026-09-26T09:00:00.000Z",
    },
    fullText: { available: true, contentSha256: "a".repeat(64), documentId: "document-a", fileVersionId: "file-a" },
    ...overrides,
  };
}

function assistedMission() {
  return createResearchMission(missionInput({
    mode: "ADVERSE_SEARCH",
    knownAuthorities: [],
    knownEvidenceGaps: [{ gapId: "gap-document", kind: "MISSING_DOCUMENT" }],
    requiredOutput: {
      authorityCandidates: false,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: true,
    },
    executionPlan: {
      requiredCapabilities: ["FULL_TEXT_RETRIEVAL", "CITATION_NETWORK", "ADVERSE_AUTHORITY_DISCOVERY"],
    },
  }));
}

function completeAssistedVerification(
  mission: ReturnType<typeof assistedMission>,
): AssistedVerificationResult {
  return verifyResearchEvidence({
    mission,
    sources: [
      assistedSource(),
      assistedSource({
        evidenceSourceId: "evidence-source-b",
        authorityId: "authority-b",
        legalSourceId: "legal-source-b",
        legalExpressionVersionId: "expression-b",
        officialIdentifier: "ECLI:EU:C:2020:2",
        sourceUrl: "https://official.example.test/authority-b",
        fullText: { available: false },
      }),
    ],
    citationRelation: {
      sourceAuthorityId: "authority-a",
      targetAuthorityId: "authority-b",
      evidenceSourceId: "evidence-source-a",
      documented: true,
      locator: { paragraph: "42" },
    },
    adverseReview: {
      observationSourceAuthorityId: "authority-a",
      observationTargetAuthorityId: "authority-b",
      legalPropositionId: "proposition-a",
      reviewedByActorId: "legal-reviewer-a",
      reviewedAt: "2026-09-26T10:00:00.000Z",
      evidenceSourceId: "evidence-source-a",
      rationale: "The documented treatment is adverse to the scoped proposition.",
      decision: "ADVERSE",
    },
    researchSuggestions: [{
      kind: "MISSING_ADMINISTRATIVE_DOCUMENT",
      description: "Acquire the missing administrative document from the official record.",
      rationale: "The persisted mission gap cannot be resolved from the currently verified authority alone.",
      originatingGapId: "gap-document",
      evidenceSourceId: "evidence-source-a",
      reviewedByActorId: "legal-reviewer-a",
      reviewedAt: "2026-09-26T10:00:00.000Z",
    }],
  });
}

function sequencedTransport(responses: Response[]) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected transport call");
    return response;
  });
}

function missionSnapshot(
  mission: ReturnType<typeof createResearchMission>,
  operational: Partial<{
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BUDGET_EXHAUSTED" | "DEFERRED" | "REJECTED";
    stateVersion: number;
    claimExpiresAt: string | null;
    activeExecutionId: string | null;
    completedAt: string | null;
    deferredAt: string | null;
  }> = {},
) {
  return {
    mission,
    operational: {
      status: "PENDING" as const,
      stateVersion: 0,
      claimExpiresAt: null,
      activeExecutionId: null,
      completedAt: null,
      deferredAt: null,
      ...operational,
    },
    fascicoloContext: {},
  };
}

function trustedClient(mission = createResearchMission(missionInput()), leaseExpiresAt = "2026-09-25T10:15:00.000Z") {
  let submittedCompletionState: "COMPLETE" | "PARTIAL" | "BUDGET_EXHAUSTED" = "PARTIAL";
  const client = {
    readMission: vi.fn(async () => missionSnapshot(mission)),
    claimMission: vi.fn(async () => ({
      outcome: "CLAIMED" as const,
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      executionId: "execution-a",
      leaseExpiresAt,
      claimToken,
    })),
    submitEvidenceBundle: vi.fn(async ({ bundle }) => {
      submittedCompletionState = bundle.completionState as typeof submittedCompletionState;
      return {
        outcome: "CREATED" as const,
        bundleId: "bundle-a",
        missionId: mission.missionId,
        fascicoloScopeId: "scope-a",
        executionId: "execution-a",
        completionState: bundle.completionState,
      };
    }),
    completeMission: vi.fn(async () => ({
      outcome: "COMPLETED" as const,
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      status: submittedCompletionState === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED" as const : "COMPLETED" as const,
      stateVersion: 3,
    })),
    deferMission: vi.fn(async () => ({
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      status: "DEFERRED" as const,
      stateVersion: 3,
    })),
  } as unknown as TrustedResearchHttpClient;
  return client;
}

describe("trusted mission executor", () => {
  it("has no external effects before explicit execution and requires a mission id", async () => {
    const client = trustedClient();
    const providerFactory = vi.fn();
    const transport = vi.fn();
    const executor = createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterFactory: providerFactory,
      legalDataHunterTransport: transport,
    });

    expect(client.readMission).not.toHaveBeenCalled();
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    await expect(executor.execute(" ")).rejects.toMatchObject({ code: "MISSION_ID_REQUIRED" });
    expect(client.readMission).not.toHaveBeenCalled();
  });

  it("blocks before claim when no verified provider input exists", async () => {
    const mission = createResearchMission(missionInput({ knownAuthorities: [] }));
    const client = trustedClient(mission);
    const transport = vi.fn();
    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0 });
    expect(result.blockerCodes).toContain("NO_VERIFIED_PROVIDER_INPUT");
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks unsupported required capabilities before claim", async () => {
    const mission = createResearchMission(missionInput({
      executionPlan: { requiredCapabilities: ["CITATION_NETWORK"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
    }).execute(mission.missionId);

    expect(result).toMatchObject({
      status: "BLOCKED",
      callsConsumed: 0,
      blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks semantic discovery with all outputs before claim without calling a provider", async () => {
    const mission = createResearchMission(missionInput({
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["LEGAL_DATA_HUNTER"] },
      requiredOutput: {
        authorityCandidates: true,
        citationObservations: true,
        legalResearchSuggestions: true,
        evidenceGaps: true,
        fullTextRequired: true,
      },
    }));
    const client = trustedClient(mission);
    const providerFactory = vi.fn();
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterFactory: providerFactory,
      legalDataHunterTransport: transport,
    }).execute(mission.missionId);

    expect(result).toEqual({
      status: "BLOCKED",
      missionId: mission.missionId,
      callsConsumed: 0,
      blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks adverse authority discovery before claim even when semantic adapters are available", async () => {
    const mission = createResearchMission(missionInput({
      executionPlan: {
        requiredCapabilities: ["ADVERSE_AUTHORITY_DISCOVERY"],
        preferredToolIds: ["MOONLIT", "SIMPLICITER"],
      },
    }));
    const client = trustedClient(mission);
    const moonlitCall = vi.fn();
    const simpliciterCall = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [
        createMoonlitResearchAdapter(moonlitCall),
        createSimpliciterResearchAdapter(simpliciterCall),
      ],
    }).execute(mission.missionId);

    expect(result).toMatchObject({
      status: "BLOCKED",
      callsConsumed: 0,
      blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(moonlitCall).not.toHaveBeenCalled();
    expect(simpliciterCall).not.toHaveBeenCalled();
  });

  it("keeps the original all-requirement mission blocked before claim with every verified adapter", async () => {
    const mission = createLiveAcceptanceMission("2026-09-25T00:00:00.000Z");
    const client = trustedClient(mission);
    const moonlitCall = vi.fn();
    const simpliciterCall = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [
        createMoonlitResearchAdapter(moonlitCall),
        createMoonlitKeywordResearchAdapter(moonlitCall),
        createMoonlitExactRetrievalAdapter(moonlitCall),
        createSimpliciterResearchAdapter(simpliciterCall),
        createSimpliciterExactRetrievalAdapter(simpliciterCall),
        createSimpliciterCrossJurisdictionResearchAdapter(simpliciterCall),
      ],
    }).execute(mission.missionId);

    expect(result).toEqual({
      status: "BLOCKED",
      missionId: mission.missionId,
      callsConsumed: 0,
      blockerCodes: ["REQUIRED_CAPABILITY_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(moonlitCall).not.toHaveBeenCalled();
    expect(simpliciterCall).not.toHaveBeenCalled();
  });

  it.each([
    ["full text", (value: AssistedVerificationResult) => ({ ...value, verifiedFullTexts: [] }), "REQUIRED_CAPABILITY_UNAVAILABLE"],
    ["citation", (value: AssistedVerificationResult) => ({ ...value, citationObservations: [] }), "REQUIRED_CAPABILITY_UNAVAILABLE"],
    ["suggestions", (value: AssistedVerificationResult) => ({ ...value, legalResearchSuggestions: [] }), "LEGAL_RESEARCH_SUGGESTIONS_UNSUPPORTED"],
    ["adverse review", (value: AssistedVerificationResult) => ({
      ...value,
      adverseAssessments: [],
      adverseAuthorityVerified: false,
      adverseSearchCompleted: false,
      adverseSearchState: "NOT_PERFORMED_OR_INSUFFICIENT" as const,
    }), "REQUIRED_CAPABILITY_UNAVAILABLE"],
  ] as const)("blocks before claim when persisted %s proof is missing", async (_label, omit, code) => {
    const mission = assistedMission();
    const client = trustedClient(mission);
    const verification = omit(completeAssistedVerification(mission));
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      assistedVerificationReader: vi.fn(async () => verification),
      legalDataHunterTransport: transport,
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0 });
    expect(result.blockerCodes).toContain(code);
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks before claim when the tenant-scoped verification read fails", async () => {
    const mission = assistedMission();
    const client = trustedClient(mission);

    const result = await createTrustedMissionExecutor({
      client,
      assistedVerificationReader: vi.fn(async () => {
        throw new Error("AUTHORIZATION_REQUIRED");
      }),
    }).execute(mission.missionId);

    expect(result).toEqual({
      status: "BLOCKED",
      missionId: mission.missionId,
      callsConsumed: 0,
      blockerCodes: ["ASSISTED_VERIFICATION_UNAVAILABLE"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
  });

  it("consumes authenticated mission evidence without a separate reader or caller identity", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      requiredOutput: { authorityCandidates: false, citationObservations: false, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: true },
      executionPlan: { requiredCapabilities: ["FULL_TEXT_RETRIEVAL"] },
    }));
    const assisted = createAssistedVerificationSnapshot({ missionId: mission.missionId, sources: [assistedSource()] });
    const transport = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ jsonrpc: "2.0", id: "test", result: { structuredContent: {
      ...missionSnapshot(mission), assistedVerification: { recordId: "record-a", snapshot: assisted,
        verifiedDocuments: [{ evidenceSourceId: "evidence-source-a", documentId: "document-a", fileVersionId: "file-a", contentSha256: "a".repeat(64) }],
      },
    } } }));
    const reader = createTrustedResearchHttpClient({
      stagingOrigin: "https://staging.example.test", issuer: "https://auth.example.test", resource: "https://staging.example.test/api/mcp",
      bearerSupplier: async () => "synthetic-bearer", transport,
    });
    const client = { ...trustedClient(mission), readMission: reader.readMission };
    const result = await createTrustedMissionExecutor({ client, providerAdapters: [], legalDataHunterApiKey: null,
      now: () => now, executionId: () => "execution-a",
    }).execute(mission.missionId);
    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 0 });
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.parse(String(transport.mock.calls[0][1].body))).toEqual({ missionId: mission.missionId });
    expect(new Headers(transport.mock.calls[0][1].headers).get("authorization")).toBe("Bearer synthetic-bearer");
    expect(client.claimMission).toHaveBeenCalledOnce();
  });

  it("uses each complete persisted proof without reporting provider capability", async () => {
    const mission = assistedMission();
    const client = trustedClient(mission);
    const verification = completeAssistedVerification(mission);
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      assistedVerificationReader: vi.fn(async () => verification),
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0 });
    expect(result.blockerCodes).toContain("EVIDENCE_GAPS_REMAIN");
    expect(result.blockerCodes).not.toContain("REQUIRED_CAPABILITY_UNAVAILABLE");
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(client.submitEvidenceBundle).not.toHaveBeenCalled();
  });

  it("normalizes one Moonlit semantic call after claim with provider provenance", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn(async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          result: {
            results: [{
              identifier: "moonlit-document-1",
              secondaryIdentifier: "ECLI:IT:CASS:2024:1234",
              court: "Corte di Cassazione",
              year: 2024,
              documentTypes: [{ name: "Sentenza" }],
              sources: [{ id: "cassazione", name: "Corte di Cassazione" }],
            }],
          },
        }),
      }],
    }));
    const ldhFactory = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitResearchAdapter(callTool)],
      legalDataHunterFactory: ldhFactory,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 1 });
    expect(client.claimMission).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledOnce();
    expect(ldhFactory).not.toHaveBeenCalled();
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.researchToolExecutions).toEqual([
      expect.objectContaining({
        toolId: "MOONLIT",
        providerId: "MOONLIT",
        operationType: "SEMANTIC_SEARCH",
        callsConsumed: 1,
      }),
    ]);
    expect(bundle.authorityCandidates).toEqual([
      expect.objectContaining({
        toolId: "MOONLIT",
        providerDocumentId: "moonlit-document-1",
        supportDirection: "UNKNOWN",
        fullTextAvailable: false,
      }),
    ]);
    expect(bundle.citationObservations).toEqual([]);
  });

  it("normalizes dynamic Simpliciter categories without treating text as full text", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["SIMPLICITER"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn(async () => ({
      structuredContent: {
        catalog_version: "observed-version",
        query: mission.researchQuestion,
        source_keys: ["it.case_law.cassazione"],
        payload: {
          giurisprudenza: [{ type: "case", citazione: "Cass. 1234/2024", sintesi: "not evidence" }],
        },
      },
    }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createSimpliciterResearchAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 1 });
    expect(callTool).toHaveBeenCalledOnce();
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.authorityCandidates).toEqual([
      expect.objectContaining({
        toolId: "SIMPLICITER",
        officialIdentifier: "Cass. 1234/2024",
        fullTextAvailable: false,
      }),
    ]);
    expect(bundle.authorityCandidates[0]).not.toHaveProperty("summary");
    expect(bundle.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
    expect(bundle.citationObservations).toEqual([]);
  });

  it("executes response-verified Moonlit keyword discovery without Legal Data Hunter", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["KEYWORD_DISCOVERY"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({
        success: true,
        result: { results: [{ identifier: "MNLT:IT:PUBLIC:1" }] },
      }) }],
    }));
    const ldhFactory = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitKeywordResearchAdapter(callTool)],
      legalDataHunterFactory: ldhFactory,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 1 });
    expect(callTool).toHaveBeenCalledOnce();
    expect(ldhFactory).not.toHaveBeenCalled();
    expect(vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle.researchToolExecutions[0])
      .toMatchObject({ operationType: "KEYWORD_SEARCH", callsConsumed: 1 });
  });

  it("executes Moonlit exact retrieval only from validated discovery", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [{ authorityReferenceId: "authority-a", officialIdentifier: "MNLT:UNTRUSTED" }],
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const discoveryCall = vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: [{ identifier: "MNLT:IT:PUBLIC:1" }] } }) }] }));
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({
        identifier: "MNLT:IT:PUBLIC:1",
        secondaryIdentifier: "PUBLIC-1",
        markdown: "not copied",
      }) }],
    }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitResearchAdapter(discoveryCall), createMoonlitExactRetrievalAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 2 });
    expect(discoveryCall).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith({ name: "get_document", arguments: { document_identifier: "MNLT:IT:PUBLIC:1" } });
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.authorityCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerDocumentId: "MNLT:IT:PUBLIC:1",
        retrievalMethod: "EXACT_RETRIEVAL",
        fullTextAvailable: false,
      }),
    ]));
    expect(bundle.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
  });

  it("executes Simpliciter exact retrieval from validated discovery", async () => {
    const mission = createResearchMission(missionInput({
      preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
      knownAuthorities: [{ authorityReferenceId: "authority-a", citation: "art. 2043 codice civile" }],
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["SIMPLICITER"] },
    }));
    const client = trustedClient(mission);
    const discoveryCall = vi.fn(async () => ({ structuredContent: {
      catalog_version: "test", query: mission.researchQuestion, source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [{ alias: "Art. 2043 codice civile" }] },
    } }));
    const callTool = vi.fn(async () => ({
      isError: false,
      structuredContent: {
        catalog_version: "observed-version",
        source_keys: ["it.legislation.normativa-italiana"],
        payload: {
          normativa: [{ alias: "Art. 2043 codice civile", contenuto: "not copied" }],
        },
      },
    }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createSimpliciterResearchAdapter(discoveryCall), createSimpliciterExactRetrievalAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 2 });
    expect(discoveryCall).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledOnce();
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.authorityCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "it.legislation.normativa-italiana",
        retrievalMethod: "EXACT_RETRIEVAL",
        providerReceivedText: "not copied",
        exactReferenceMatch: true,
        fullTextAvailable: false,
      }),
    ]));
    expect(bundle.authorityCandidates[0]).not.toHaveProperty("relevantPassage");
  });

  it("keeps Simpliciter article 18-bis additional when exact article 18 is present", async () => {
    const mission = createResearchMission(missionInput({
      preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["SIMPLICITER"] },
    }));
    const client = trustedClient(mission);
    const discoveryCall = vi.fn(async () => ({ structuredContent: {
      catalog_version: "607c23ddcbf6229e", query: mission.researchQuestion,
      source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [{ alias: "art. 18 legge n. 84 del 28 gennaio 1994" }] },
    } }));
    const exactCall = vi.fn(async () => ({ structuredContent: {
      catalog_version: "607c23ddcbf6229e", source_keys: ["it.legislation.normativa-italiana"],
      payload: { normativa: [
        { alias: "art. 18 legge n. 84 del 28 gennaio 1994", contenuto: "Art. 18" },
        { alias: "art. 18-bis legge n. 84 del 28 gennaio 1994", contenuto: "Art. 18-bis" },
      ] },
    } }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [
        createSimpliciterResearchAdapter(discoveryCall),
        createSimpliciterExactRetrievalAdapter(exactCall),
      ],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 2 });
    expect(exactCall).toHaveBeenCalledWith({
      name: "fetch_legal_source",
      arguments: {
        top_n: 10,
        sources: [{
          source_key: "it.legislation.normativa-italiana",
          number: "18",
          law: "legge 84/1994",
        }],
      },
    });
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.authorityCandidates.filter((candidate) => candidate.retrievalMethod === "EXACT_RETRIEVAL"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ officialIdentifier: "art. 18 legge n. 84 del 28 gennaio 1994", exactReferenceMatch: true }),
        expect.objectContaining({ officialIdentifier: "art. 18-bis legge n. 84 del 28 gennaio 1994", exactReferenceMatch: false }),
      ]));
  });

  it.each(["invalid", "empty", "budget", "mismatch"] as const)("does not retry exact dependency failure: %s", async (failure) => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [{ authorityReferenceId: "untrusted", officialIdentifier: "MNLT:TYPED" }],
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["MOONLIT"] },
      ...(failure === "budget" ? { budget: { maxTotalResearchCalls: 1, maxMoonlitCalls: 1, maxSimpliciterCalls: 0, maxLegalDataHunterCalls: 0 } } : {}),
    }));
    const client = trustedClient(mission);
    const discoveryCall = vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(failure === "invalid" ? { arbitrary: true } : {
      success: true, result: { results: failure === "empty" ? [] : [{ identifier: "MNLT:FIRST" }, { identifier: "MNLT:SECOND" }] },
    }) }] }));
    const exactCall = vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ identifier: "MNLT:SECOND" }) }] }));
    const result = await createTrustedMissionExecutor({
      client, providerAdapters: [createMoonlitResearchAdapter(discoveryCall), createMoonlitExactRetrievalAdapter(exactCall)],
      now: () => now, executionId: () => "execution-a",
    }).execute(mission.missionId);
    expect(result.status).not.toBe("COMPLETED");
    expect(discoveryCall).toHaveBeenCalledTimes(failure === "budget" ? 0 : 1);
    expect(exactCall).toHaveBeenCalledTimes(failure === "mismatch" ? 1 : 0);
    if (failure === "mismatch") {
      expect(exactCall).toHaveBeenCalledWith({ name: "get_document", arguments: { document_identifier: "MNLT:FIRST" } });
      expect(vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle.unresolvedQuestions)
        .toContain("MOONLIT:EXACT_RETRIEVAL:EXACT_RESULT_IDENTITY_MISMATCH");
    }
  });

  it("blocks exact retrieval without a provider identifier before claim", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["EXACT_RETRIEVAL"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitExactRetrievalAdapter(callTool)],
    }).execute(mission.missionId);

    expect(result).toMatchObject({
      status: "BLOCKED",
      callsConsumed: 0,
      blockerCodes: ["EXACT_DISCOVERY_DEPENDENCY_MISSING"],
    });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("executes response-verified Simpliciter cross-jurisdiction discovery with provenance gaps", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      preferredSourceFamilies: ["CASSAZIONE", "CJEU"],
      executionPlan: {
        requiredCapabilities: ["CROSS_JURISDICTION_DISCOVERY"],
        preferredToolIds: ["SIMPLICITER"],
      },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn(async () => ({
      structuredContent: {
        catalog_version: "observed-version",
        query: mission.researchQuestion,
        source_keys: ["it.case_law.cassazione", "it.legislation.normativa-italiana"],
        payload: { giurisprudenza: [{ citazione: "PUBLIC-1" }] },
      },
    }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createSimpliciterCrossJurisdictionResearchAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "DEFERRED", callsConsumed: 1 });
    expect(callTool).toHaveBeenCalledOnce();
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.authorityCandidates[0]).toMatchObject({
      providerId: "SIMPLICITER",
      retrievalMethod: "CROSS_JURISDICTION_SEARCH",
    });
    expect(bundle.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
  });

  it("shares the Moonlit budget across verified adapter operations without retrying", async () => {
    const base = missionInput();
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      budget: { ...base.budget, maxTotalResearchCalls: 3, maxMoonlitCalls: 1 },
      executionPlan: {
        requiredCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY"],
        preferredToolIds: ["MOONLIT"],
      },
    }));
    const client = trustedClient(mission);
    const semanticCall = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: [] } }) }],
    }));
    const keywordCall = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [
        createMoonlitResearchAdapter(semanticCall),
        createMoonlitKeywordResearchAdapter(keywordCall),
      ],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0, blockerCodes: ["PROVIDER_PLAN_BUDGET_INSUFFICIENT"] });
    expect(semanticCall).not.toHaveBeenCalled();
    expect(keywordCall).not.toHaveBeenCalled();
    expect(client.claimMission).not.toHaveBeenCalled();
  });

  it("enforces the Moonlit budget before attempting the provider call", async () => {
    const base = missionInput();
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      budget: { ...base.budget, maxMoonlitCalls: 0 },
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitResearchAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0, blockerCodes: ["PROVIDER_PLAN_BUDGET_INSUFFICIENT"] });
    expect(callTool).not.toHaveBeenCalled();
    expect(client.claimMission).not.toHaveBeenCalled();
  });

  it("checks the lease window before attempting a semantic provider call", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["SIMPLICITER"] },
    }));
    const client = trustedClient(mission, "2026-09-25T10:00:04.000Z");
    const callTool = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createSimpliciterResearchAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "DEFERRED", callsConsumed: 0 });
    expect(callTool).not.toHaveBeenCalled();
    const execution = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0]
      .bundle.researchToolExecutions[0];
    expect(execution.errorState).toEqual({ code: "LEASE_WINDOW_INSUFFICIENT", retryable: false });
  });

  it("counts an uncertain semantic response once and never retries it", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [],
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"], preferredToolIds: ["MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "not-json" }] }));

    const result = await createTrustedMissionExecutor({
      client,
      providerAdapters: [createMoonlitResearchAdapter(callTool)],
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "DEFERRED", callsConsumed: 1 });
    expect(callTool).toHaveBeenCalledOnce();
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.researchToolExecutions[0].errorState).toEqual({
      code: "MOONLIT_RESPONSE_UNCERTAIN",
      retryable: false,
    });
    expect(bundle.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED" }),
    ]);
  });

  it.each(["complete", "total-budget", "provider-budget", "exact-budget", "lease", "exact-lease", "uncertain-discovery", "uncertain-exact", "identity-mismatch", "ambiguous-source"] as const)(
    "uses synthetic portual candidates with source-bound planning: %s", async (scenario) => {
      const original = createLiveAcceptanceMission("2026-09-23T00:00:00.000Z");
      const mission = createResearchMission(missionInput({
        researchQuestion: original.researchQuestion, knownAuthorities: [],
        preferredSourceFamilies: original.preferredSourceFamilies,
        executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY", "EXACT_RETRIEVAL", "CROSS_JURISDICTION_DISCOVERY"],
          preferredToolIds: original.executionPlan!.preferredToolIds },
        budget: { ...original.budget,
          ...(scenario === "total-budget" ? { maxTotalResearchCalls: 5, maxMoonlitCalls: 5, maxSimpliciterCalls: 5, maxLegalDataHunterCalls: 5 } : {}),
          ...(scenario === "provider-budget" ? { maxSimpliciterCalls: 4 } : {}),
          ...(scenario === "exact-budget" ? { maxMoonlitCalls: 1 } : {}),
        },
      }));
      const client = trustedClient(mission, "2026-09-25T10:00:10.000Z");
      let clock = now;
      const semantic = vi.fn(async (request: ProviderToolRequest) => ({ structuredContent: {
        catalog_version: "synthetic-contract-fixture", query: request.arguments.query,
        source_keys: request.arguments.source_keys,
        payload: { normativa: [{ alias: "Legge 84/1994", titolo: "Riordino della legislazione portuale" }] },
      } }));
      const cross = vi.fn(async (request: ProviderToolRequest) => {
        if (scenario === "lease" && cross.mock.calls.length === 4) clock = new Date(now.getTime() + 6_000);
        return { structuredContent: { catalog_version: "synthetic-contract-fixture", query: request.arguments.query,
          source_keys: scenario === "ambiguous-source" ? ["it.case_law.cassazione", "it.legislation.normativa-italiana"] : request.arguments.source_keys,
          payload: { risultati: [{ alias: `SYNTHETIC:${String(request.arguments.source_keys)}`, titolo: "Cassazione: concessioni portuali" }] },
        } };
      });
      const moonlitDiscovery = vi.fn(async () => {
        if (scenario === "exact-lease") clock = new Date(now.getTime() + 6_000);
        return { content: [{ type: "text", text: scenario === "uncertain-discovery" ? "not-json" : JSON.stringify({
          success: true, result: { results: [{ identifier: "synthetic-moonlit-port-law-84", secondaryIdentifier: "Legge 84/1994" }] },
        }) }] };
      });
      const moonlitExact = vi.fn(async () => ({ content: [{ type: "text", text: scenario === "uncertain-exact" ? "not-json" : JSON.stringify({
        identifier: scenario === "identity-mismatch" ? "synthetic-different-document" : "synthetic-moonlit-port-law-84",
        secondaryIdentifier: "Legge 84/1994",
      }) }] }));
      const simpliciterExact = vi.fn();
      const result = await createTrustedMissionExecutor({ client, legalDataHunterApiKey: null,
        providerAdapters: [createMoonlitResearchAdapter(moonlitDiscovery), createMoonlitExactRetrievalAdapter(moonlitExact),
          createSimpliciterResearchAdapter(semantic), createSimpliciterExactRetrievalAdapter(simpliciterExact),
          createSimpliciterCrossJurisdictionResearchAdapter(cross)], now: () => clock, executionId: () => "execution-a",
      }).execute(mission.missionId);
      expect(simpliciterExact).not.toHaveBeenCalled();
      if (["total-budget", "provider-budget"].includes(scenario)) {
        expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0, blockerCodes: ["PROVIDER_PLAN_BUDGET_INSUFFICIENT"] });
        expect(client.claimMission).not.toHaveBeenCalled();
        expect(semantic).not.toHaveBeenCalled();
        expect(cross).not.toHaveBeenCalled();
        expect(moonlitDiscovery).not.toHaveBeenCalled();
        expect(moonlitExact).not.toHaveBeenCalled();
        return;
      }
      const expectedCalls = scenario === "ambiguous-source" ? 2 : ["lease", "exact-budget"].includes(scenario) ? 5
        : ["uncertain-discovery", "exact-lease"].includes(scenario) ? 6 : 7;
      expect(result.callsConsumed).toBe(expectedCalls);
      expect(semantic).toHaveBeenCalledOnce();
      expect(cross).toHaveBeenCalledTimes(scenario === "ambiguous-source" ? 1 : 4);
      expect(moonlitDiscovery).toHaveBeenCalledTimes(["ambiguous-source", "lease", "exact-budget"].includes(scenario) ? 0 : 1);
      expect(moonlitExact).toHaveBeenCalledTimes(expectedCalls === 7 ? 1 : 0);
      const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
      expect(bundle.researchToolExecutions.reduce((sum, execution) => sum + execution.callsConsumed, 0)).toBe(expectedCalls);
      expect(new Set(bundle.researchToolExecutions.map((execution) => execution.executionRecordId)).size).toBe(bundle.researchToolExecutions.length);
      if (scenario !== "complete") {
        expect(result.status).not.toBe("COMPLETED");
        expect(bundle.evidenceGaps.length).toBeGreaterThan(0);
        return;
      }
      expect(result.status).toBe("COMPLETED");
      expect(moonlitExact).toHaveBeenCalledWith({ name: "get_document", arguments: { document_identifier: "synthetic-moonlit-port-law-84" } });
      const crossExecutions = bundle.researchToolExecutions.filter((execution) => execution.operationType === "CROSS_JURISDICTION_SEARCH");
      expect(crossExecutions[0]).toMatchObject({ callsConsumed: 0,
        executionRecordId: `${bundle.researchToolExecutions[0].executionRecordId}:shared` });
      expect(crossExecutions.flatMap((execution) => execution.sourceFamiliesRequested)).toEqual(original.preferredSourceFamilies);
      for (const execution of crossExecutions) {
        expect(bundle.authorityCandidates.find((candidate) => candidate.executionRecordId === execution.executionRecordId))
          .toMatchObject({ providerId: execution.providerId, sourceFamily: execution.sourceFamiliesRequested[0] });
      }
    },
  );

  it.each(["success", "error", "uncertain"] as const)("preserves compatible provider preference without post-attempt fallback: %s", async (scenario) => {
    const mission = createResearchMission(missionInput({ knownAuthorities: [], preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
      executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY", "EXACT_RETRIEVAL"], preferredToolIds: ["SIMPLICITER", "MOONLIT"] },
    }));
    const client = trustedClient(mission);
    const semantic = vi.fn(async () => ({ structuredContent: { catalog_version: "synthetic", query: mission.researchQuestion,
      source_keys: ["it.legislation.normativa-italiana"], payload: { normativa: [{ alias: "Art. 2043 codice civile" }] },
    } }));
    const exact = vi.fn(async () => {
      if (scenario === "error") throw new Error("synthetic timeout");
      return scenario === "uncertain" ? { isError: true } : { structuredContent: { catalog_version: "synthetic",
        source_keys: ["it.legislation.normativa-italiana"], payload: { normativa: [{ alias: "Art. 2043 codice civile" }] },
      } };
    });
    const alternate = vi.fn();
    const result = await createTrustedMissionExecutor({ client, providerAdapters: [
      createMoonlitResearchAdapter(alternate), createMoonlitExactRetrievalAdapter(alternate),
      createSimpliciterResearchAdapter(semantic), createSimpliciterExactRetrievalAdapter(exact),
    ], now: () => now, executionId: () => "execution-a" }).execute(mission.missionId);
    expect(result).toMatchObject({ status: scenario === "success" ? "COMPLETED" : "DEFERRED", callsConsumed: 2 });
    expect(semantic).toHaveBeenCalledOnce();
    expect(exact).toHaveBeenCalledOnce();
    expect(alternate).not.toHaveBeenCalled();
  });

  it.each([
    ["citationObservations", "CITATION_OBSERVATIONS_UNSUPPORTED"],
    ["legalResearchSuggestions", "LEGAL_RESEARCH_SUGGESTIONS_UNSUPPORTED"],
    ["fullTextRequired", "FULL_TEXT_UNSUPPORTED"],
  ] as const)("blocks required %s output before claim", async (field, code) => {
    const base = missionInput();
    const mission = createResearchMission(missionInput({
      requiredOutput: { ...base.requiredOutput, [field]: true },
    }));
    const client = trustedClient(mission);
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BLOCKED", callsConsumed: 0, blockerCodes: [code] });
    expect(client.claimMission).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("counts discovery, resolve, and fallback as three actual calls", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "none", documents: [] }),
      json({ hits: [hit()] }),
    ]);

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BUDGET_EXHAUSTED", callsConsumed: 3, bundleId: "bundle-a" });
    expect(transport).toHaveBeenCalledTimes(3);
    const submitted = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(submitted.researchToolExecutions).toEqual([
      expect.objectContaining({ toolId: "LEGAL_DATA_HUNTER", callsConsumed: 3, resultCount: 1 }),
    ]);
    expect(submitted.authorityCandidates).toEqual([
      expect.objectContaining({
        providerDocumentId: "decision-1234-2024",
        verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
      }),
    ]);
    expect(submitted.completionState).toBe("BUDGET_EXHAUSTED");
    expect(client.completeMission).toHaveBeenCalledOnce();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it("prevents a fallback request that would exceed budget", async () => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 2,
        maxMoonlitCalls: 2,
        maxSimpliciterCalls: 2,
        maxLegalDataHunterCalls: 2,
      },
    }));
    const client = trustedClient(mission);
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "none", documents: [] }),
    ]);

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "BUDGET_EXHAUSTED", callsConsumed: 2 });
    expect(transport).toHaveBeenCalledTimes(2);
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.researchToolExecutions[0]).toMatchObject({
      callsConsumed: 2,
      errorState: { code: "BUDGET_EXHAUSTED", retryable: false },
    });
  });

  it("counts a failed provider request and submits partial evidence before defer", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    const transport = vi.fn(async () => new Response(null, { status: 503 }));

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "DEFERRED", callsConsumed: 1 });
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.completionState).toBe("PARTIAL");
    expect(bundle.researchToolExecutions[0]).toMatchObject({
      callsConsumed: 1,
      errorState: { code: "UPSTREAM_UNAVAILABLE", retryable: true },
    });
    expect(bundle.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED", targetId: "authority-a" }),
    ]);
    expect(client.deferMission).toHaveBeenCalledWith(expect.objectContaining({
      disposition: "DEFER",
      reasonCode: "RESEARCH_INCOMPLETE",
    }));
    expect(client.completeMission).not.toHaveBeenCalled();
  });

  it("preserves partial provider results as candidates plus gaps before defer", async () => {
    const mission = createResearchMission(missionInput({
      knownAuthorities: [
        { authorityReferenceId: "authority-a", citation: "Cassazione civile, sez. III, n. 1234/2024" },
        { authorityReferenceId: "authority-b", citation: "Cassazione civile, sez. III, n. 9999/2024" },
      ],
      budget: {
        maxTotalResearchCalls: 6,
        maxMoonlitCalls: 6,
        maxSimpliciterCalls: 6,
        maxLegalDataHunterCalls: 6,
      },
    }));
    const client = trustedClient(mission);
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [hit()] }),
      json({ match_type: "none", documents: [] }),
      json({ hits: [] }),
    ]);

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "DEFERRED", callsConsumed: 4 });
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.completionState).toBe("PARTIAL");
    expect(bundle.authorityCandidates).toHaveLength(1);
    expect(bundle.authorityCandidates[0].verificationState).toBe("OFFICIAL_VERIFICATION_REQUIRED");
    expect(bundle.evidenceGaps).toEqual([
      expect.objectContaining({ kind: "OFFICIAL_IDENTITY_NOT_VERIFIED", targetId: "authority-b" }),
    ]);
    expect(client.deferMission).toHaveBeenCalledOnce();
    expect(client.completeMission).not.toHaveBeenCalled();
  });

  it("stops without provider, submit, complete, or defer after an expired claim", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission, "2026-09-25T09:59:59.000Z");
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "LEASE_EXPIRED", callsConsumed: 0 });
    expect(transport).not.toHaveBeenCalled();
    expect(client.submitEvidenceBundle).not.toHaveBeenCalled();
    expect(client.completeMission).not.toHaveBeenCalled();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it("requires recovery after an uncertain claim without retrying or taking further action", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    vi.mocked(client.claimMission).mockRejectedValueOnce(new Error("timeout with sensitive details"));
    const providerFactory = vi.fn();
    const transport = vi.fn();

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterFactory: providerFactory,
      legalDataHunterTransport: transport,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toEqual({
      status: "RECOVERY_REQUIRED",
      missionId: mission.missionId,
      executionId: "execution-a",
      callsConsumed: 0,
      blockerCodes: ["CLAIM_OUTCOME_UNCERTAIN"],
    });
    expect(client.readMission).toHaveBeenCalledOnce();
    expect(client.claimMission).toHaveBeenCalledOnce();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(client.submitEvidenceBundle).not.toHaveBeenCalled();
    expect(client.completeMission).not.toHaveBeenCalled();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it("derives COMPLETE only when all declared requirements are met", async () => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 4,
        maxMoonlitCalls: 4,
        maxSimpliciterCalls: 4,
        maxLegalDataHunterCalls: 4,
      },
    }));
    const client = trustedClient(mission);
    const transport = sequencedTransport([
      discovery(),
      json({ match_type: "exact", documents: [hit()] }),
    ]);

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: transport,
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "COMPLETED", callsConsumed: 2, blockerCodes: [] });
    const bundle = vi.mocked(client.submitEvidenceBundle).mock.calls[0][0].bundle;
    expect(bundle.completionState).toBe("COMPLETE");
    expect(client.completeMission).toHaveBeenCalledOnce();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it.each([
    { missionId: "research-mission:other" },
    { executionId: "execution-other" },
    { completionState: "PARTIAL" as const },
    { fascicoloScopeId: "scope-other" },
  ])("rejects a mismatched submit response without a final mutation", async (override) => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 4,
        maxMoonlitCalls: 4,
        maxSimpliciterCalls: 4,
        maxLegalDataHunterCalls: 4,
      },
    }));
    const client = trustedClient(mission);
    vi.mocked(client.submitEvidenceBundle).mockResolvedValueOnce({
      outcome: "CREATED",
      bundleId: "bundle-a",
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      executionId: "execution-a",
      completionState: "COMPLETE",
      ...override,
    });

    await expect(createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([
        discovery(),
        json({ match_type: "exact", documents: [hit()] }),
      ]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId)).rejects.toMatchObject({ code: "SUBMISSION_RESULT_MISMATCH" });

    expect(client.completeMission).not.toHaveBeenCalled();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it("stops after an uncertain submit without retrying or finalizing", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    vi.mocked(client.submitEvidenceBundle).mockRejectedValueOnce(new Error("timeout"));

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([new Response(null, { status: 503 })]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "RECOVERY_REQUIRED", blockerCodes: ["SUBMIT_OUTCOME_UNCERTAIN"] });
    expect(client.submitEvidenceBundle).toHaveBeenCalledOnce();
    expect(client.readMission).toHaveBeenCalledTimes(2);
    expect(client.completeMission).not.toHaveBeenCalled();
    expect(client.deferMission).not.toHaveBeenCalled();
  });

  it("keeps an uncertain complete unresolved despite a compatible terminal mission state", async () => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 4,
        maxMoonlitCalls: 4,
        maxSimpliciterCalls: 4,
        maxLegalDataHunterCalls: 4,
      },
    }));
    const client = trustedClient(mission);
    vi.mocked(client.completeMission).mockRejectedValueOnce(new Error("timeout"));
    vi.mocked(client.readMission).mockResolvedValueOnce(missionSnapshot(mission)).mockResolvedValueOnce(
      missionSnapshot(mission, {
        status: "COMPLETED",
        stateVersion: 2,
        completedAt: "2026-09-25T10:01:00.000Z",
      }),
    );

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([
        discovery(),
        json({ match_type: "exact", documents: [hit()] }),
      ]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "RECOVERY_REQUIRED", blockerCodes: ["COMPLETE_OUTCOME_UNCERTAIN"] });
    expect(client.completeMission).toHaveBeenCalledOnce();
    expect(client.readMission).toHaveBeenCalledTimes(2);
  });

  it("requires recovery when an uncertain complete cannot be reconciled", async () => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 4,
        maxMoonlitCalls: 4,
        maxSimpliciterCalls: 4,
        maxLegalDataHunterCalls: 4,
      },
    }));
    const client = trustedClient(mission);
    vi.mocked(client.completeMission).mockRejectedValueOnce(new Error("timeout"));

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([
        discovery(),
        json({ match_type: "exact", documents: [hit()] }),
      ]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "RECOVERY_REQUIRED", blockerCodes: ["COMPLETE_OUTCOME_UNCERTAIN"] });
    expect(client.completeMission).toHaveBeenCalledOnce();
  });

  it("keeps an uncertain defer unresolved despite a compatible terminal mission state", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    vi.mocked(client.deferMission).mockRejectedValueOnce(new Error("timeout"));
    vi.mocked(client.readMission).mockResolvedValueOnce(missionSnapshot(mission)).mockResolvedValueOnce(
      missionSnapshot(mission, {
        status: "DEFERRED",
        stateVersion: 2,
        deferredAt: "2026-09-25T10:01:00.000Z",
      }),
    );

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([new Response(null, { status: 503 })]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "RECOVERY_REQUIRED", blockerCodes: ["DEFER_OUTCOME_UNCERTAIN"] });
    expect(client.deferMission).toHaveBeenCalledOnce();
    expect(client.readMission).toHaveBeenCalledTimes(2);
  });

  it("requires recovery when an uncertain defer cannot be reconciled", async () => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    vi.mocked(client.deferMission).mockRejectedValueOnce(new Error("timeout"));

    const result = await createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([new Response(null, { status: 503 })]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId);

    expect(result).toMatchObject({ status: "RECOVERY_REQUIRED", blockerCodes: ["DEFER_OUTCOME_UNCERTAIN"] });
    expect(client.deferMission).toHaveBeenCalledOnce();
  });

  it.each([
    { missionId: "research-mission:other" },
    { fascicoloScopeId: "scope-other" },
    { status: "PENDING" as const },
  ])("rejects a mismatched defer response", async (override) => {
    const mission = createResearchMission(missionInput());
    const client = trustedClient(mission);
    vi.mocked(client.deferMission).mockResolvedValueOnce({
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      status: "DEFERRED",
      stateVersion: 3,
      ...override,
    });

    await expect(createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([new Response(null, { status: 503 })]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId)).rejects.toMatchObject({ code: "FINAL_RESULT_MISMATCH" });

    expect(client.deferMission).toHaveBeenCalledOnce();
  });

  it.each([
    { missionId: "research-mission:other" },
    { fascicoloScopeId: "scope-other" },
    { status: "BUDGET_EXHAUSTED" as const },
  ])("rejects a mismatched complete response", async (override) => {
    const mission = createResearchMission(missionInput({
      budget: {
        maxTotalResearchCalls: 4,
        maxMoonlitCalls: 4,
        maxSimpliciterCalls: 4,
        maxLegalDataHunterCalls: 4,
      },
    }));
    const client = trustedClient(mission);
    vi.mocked(client.completeMission).mockResolvedValueOnce({
      outcome: "COMPLETED",
      missionId: mission.missionId,
      fascicoloScopeId: "scope-a",
      status: "COMPLETED",
      stateVersion: 3,
      ...override,
    });

    await expect(createTrustedMissionExecutor({
      client,
      legalDataHunterApiKey: "test-key",
      legalDataHunterTransport: sequencedTransport([
        discovery(),
        json({ match_type: "exact", documents: [hit()] }),
      ]),
      now: () => now,
      executionId: () => "execution-a",
    }).execute(mission.missionId)).rejects.toMatchObject({ code: "FINAL_RESULT_MISMATCH" });

    expect(client.completeMission).toHaveBeenCalledOnce();
  });
});

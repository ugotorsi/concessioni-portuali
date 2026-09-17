import { describe, expect, it } from "vitest";

import { createCitationObservation } from "@/server/legal-reasoning/authority-treatment";
import {
  CONFIRMED_RESEARCH_TOOL_ROLES,
  FUTURE_MCP_RESEARCH_TOOL_MAPPING,
  RESEARCH_BRIDGE_VERSION,
  assessResearchBudget,
  createAuthorityCandidate,
  createResearchMission,
  researchMissionIdentity,
  suggestNextResearchActions,
  validateResearchEvidenceBundle,
  validateResearchMission,
  type AuthorityCandidate,
  type AuthorityCandidateInput,
  type ResearchEvidenceBundle,
  type ResearchGap,
  type ResearchMission,
  type ResearchMissionInput,
  type ResearchToolExecution,
} from "@/server/legal-research/bridge";

function missionInput(overrides: Partial<ResearchMissionInput> = {}): ResearchMissionInput {
  return {
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-1", fascicoloReference: "fascicolo-2026-1" },
    legalIssueIds: ["issue-1"],
    legalPropositionIds: ["proposition-1"],
    referenceDate: "2026-09-17T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "Which authorities govern the renewal of the concession?",
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["GIUSTIZIA_AMMINISTRATIVA", "CASSAZIONE"],
    missingSourceFamilies: ["CASSAZIONE"],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: false,
    },
    budget: {
      maxTotalResearchCalls: 10,
      maxMoonlitCalls: 3,
      maxSimpliciterCalls: 4,
      maxLegalDataHunterCalls: 3,
    },
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: ["SEMANTIC_DISCOVERY", "ADVERSE_AUTHORITY_DISCOVERY"],
      preferredToolIds: ["SIMPLICITER", "MOONLIT"],
    },
    ...overrides,
  };
}

function mission(overrides: Partial<ResearchMissionInput> = {}): ResearchMission {
  return createResearchMission(missionInput(overrides));
}

function execution(overrides: Partial<ResearchToolExecution> = {}): ResearchToolExecution {
  return {
    executionRecordId: "execution-record-1",
    toolId: "SIMPLICITER",
    providerId: "conversational-executor",
    role: "LEGAL_RESEARCH_STRATEGIST",
    operationType: "SEMANTIC_SEARCH",
    researchQuery: "renewal of port concessions",
    sourceFamiliesRequested: ["GIUSTIZIA_AMMINISTRATIVA"],
    resultIdentifiersUsed: ["result-1"],
    resultCount: 1,
    callsConsumed: 1,
    ...overrides,
  };
}

function candidateInput(overrides: Partial<AuthorityCandidateInput> = {}): AuthorityCandidateInput {
  return {
    kind: "AUTHORITY_CANDIDATE",
    executionRecordId: "execution-record-1",
    toolId: "SIMPLICITER",
    providerId: "conversational-executor",
    courtOrBody: "Consiglio di Stato",
    documentType: "SENTENZA",
    number: "471",
    year: 2025,
    documentDate: "2025-01-16",
    title: "Consiglio di Stato, sentenza n. 471/2025",
    sourceUrl: "https://example.test/provider-result/471",
    providerDocumentId: "provider-document-471",
    relevantPassage: "The provider-returned relevant passage.",
    summary: "A provider-generated summary requiring verification.",
    legalPropositionId: "proposition-1",
    supportDirection: "SUPPORT",
    sourceFamily: "GIUSTIZIA_AMMINISTRATIVA",
    retrievalMethod: "SEMANTIC_SEARCH",
    fullTextAvailable: true,
    verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
    ...overrides,
  };
}

function candidate(overrides: Partial<AuthorityCandidateInput> = {}): AuthorityCandidate {
  return createAuthorityCandidate(candidateInput(overrides));
}

function bundle(
  researchMission: ResearchMission,
  overrides: Partial<ResearchEvidenceBundle> = {},
): ResearchEvidenceBundle {
  return {
    kind: "RESEARCH_EVIDENCE_BUNDLE",
    version: RESEARCH_BRIDGE_VERSION,
    missionId: researchMission.missionId,
    executionId: "bundle-execution-1",
    startedAt: "2026-09-17T10:00:00.000Z",
    completedAt: "2026-09-17T10:05:00.000Z",
    researchToolExecutions: [execution()],
    authorityCandidates: [candidate()],
    citationObservations: [],
    legalResearchSuggestions: [],
    evidenceGaps: [],
    conflicts: [],
    unresolvedQuestions: [],
    suggestedFollowUpMissions: [],
    humanDecisionEscalations: [],
    completionState: "COMPLETE",
    ...overrides,
  };
}

function codes(errors: ReturnType<typeof validateResearchEvidenceBundle>): string[] {
  return errors.map((item) => item.code);
}

describe("Block 3B.13A chat legal research bridge", () => {
  it("accepts a minimal provider-neutral discovery mission", () => {
    const value = mission();
    expect(validateResearchMission(value)).toEqual([]);
    expect(value.mode).toBe("DISCOVER_AUTHORITIES");
  });

  it.each([
    "ADVERSE_SEARCH",
    "CROSS_JURISDICTION_CHECK",
    "CITATION_EXPANSION",
  ] as const)("supports the bounded %s mode", (mode) => {
    expect(validateResearchMission(mission({ mode }))).toEqual([]);
  });

  it("derives the same mission identity from the same immutable input", () => {
    const input = missionInput();
    expect(researchMissionIdentity(input)).toBe(researchMissionIdentity(input));
    expect(createResearchMission(input).missionId).toBe(createResearchMission(input).missionId);
  });

  it("keeps mission identity stable across lifecycle status transitions", () => {
    expect(mission({ status: "PENDING" }).missionId).toBe(mission({ status: "IN_PROGRESS" }).missionId);
  });

  it("requires an explicit valid reference date and case reference", () => {
    expect(validateResearchMission(mission({ referenceDate: "not-a-date" })).map((item) => item.code))
      .toContain("INVALID_DATE");
    expect(validateResearchMission(mission({ caseReference: { caseId: "" } })).map((item) => item.code))
      .toContain("INVALID_CASE_REFERENCE");
  });

  it("rejects known and excluded authority conflicts", () => {
    const reference = { authorityReferenceId: "authority-1", citation: "Known authority" };
    expect(validateResearchMission(mission({
      knownAuthorities: [reference],
      excludedAuthorities: [reference],
    })).map((item) => item.code)).toContain("DUPLICATE_AUTHORITY_REFERENCE");
  });

  it("rejects invalid provider and total call budgets", () => {
    expect(validateResearchMission(mission({
      budget: {
        maxTotalResearchCalls: 2,
        maxMoonlitCalls: 3,
        maxSimpliciterCalls: 1,
        maxLegalDataHunterCalls: 1,
      },
    })).map((item) => item.code)).toContain("INVALID_BUDGET");
  });

  it.each([
    ["SIMPLICITER", "LEGAL_RESEARCH_STRATEGIST", "SEMANTIC_SEARCH"],
    ["MOONLIT", "CITATION_AUTHORITY_INTELLIGENCE", "CITATION_SEARCH"],
    ["LEGAL_DATA_HUNTER", "BROAD_DISCOVERY", "KEYWORD_SEARCH"],
  ] as const)("preserves %s execution provenance", (toolId, role, operationType) => {
    const researchMission = mission();
    const toolExecution = execution({ toolId, role, operationType });
    const authority = candidate({ toolId, executionRecordId: toolExecution.executionRecordId });
    const value = bundle(researchMission, {
      researchToolExecutions: [toolExecution],
      authorityCandidates: [authority],
    });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
    expect(value.researchToolExecutions[0]).toMatchObject({ toolId, role, operationType });
  });

  it("keeps a Moonlit citation result as CitationObservation only", () => {
    const researchMission = mission({ mode: "CITATION_EXPANSION" });
    const moonlitExecution = execution({
      toolId: "MOONLIT",
      role: "CITATION_AUTHORITY_INTELLIGENCE",
      operationType: "CITATION_SEARCH",
    });
    const observation = createCitationObservation({
      kind: "CITATION_OBSERVATION",
      relation: "CITES",
      sourceAuthorityId: "candidate-b",
      targetAuthorityId: "candidate-a",
      provenance: {
        evidenceSourceId: moonlitExecution.executionRecordId,
        providerId: "MOONLIT",
        observationMethod: "PROVIDER_REPORTED",
      },
    });
    const value = bundle(researchMission, {
      researchToolExecutions: [moonlitExecution],
      authorityCandidates: [],
      citationObservations: [observation],
    });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
    expect(value.citationObservations[0].relation).toBe("CITES");
    expect(value.citationObservations[0]).not.toHaveProperty("treatment");
  });

  it("rejects a duplicate citation observation", () => {
    const researchMission = mission();
    const observation = createCitationObservation({
      kind: "CITATION_OBSERVATION",
      relation: "CITES",
      sourceAuthorityId: "candidate-b",
      targetAuthorityId: "candidate-a",
      provenance: {
        evidenceSourceId: "execution-record-1",
        observationMethod: "PROVIDER_REPORTED",
      },
    });
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      citationObservations: [observation, observation],
    })))).toContain("DUPLICATE_CITATION_OBSERVATION");
  });

  it("rejects an invalid citation observation shape", () => {
    const researchMission = mission();
    const observation = createCitationObservation({
      kind: "CITATION_OBSERVATION",
      relation: "CITES",
      sourceAuthorityId: "candidate-b",
      targetAuthorityId: "candidate-a",
      provenance: {
        evidenceSourceId: "execution-record-1",
        locator: { page: 0 },
        observationMethod: "PROVIDER_REPORTED",
      },
    });
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      citationObservations: [observation],
    })))).toContain("CITATION_SHAPE_INVALID");
  });

  it("keeps candidate authority identity separate from canonical identity", () => {
    const value = candidate();
    expect(value.verificationState).toBe("OFFICIAL_VERIFICATION_REQUIRED");
    expect(value).not.toHaveProperty("legalSourceId");
    expect(value).not.toHaveProperty("legalExpressionVersionId");
    expect(value).not.toHaveProperty("canonicalKey");
  });

  it("rejects canonical fields injected into a candidate payload", () => {
    const researchMission = mission();
    const unsafe = { ...candidate(), legalSourceId: "source-1" } as AuthorityCandidate;
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      authorityCandidates: [unsafe],
    })))).toContain("CANONICAL_AUTHORITY_FIELD_FORBIDDEN");
  });

  it("requires enough candidate identity evidence", () => {
    const researchMission = mission();
    const weak = candidate({
      courtOrBody: undefined,
      documentType: undefined,
      number: undefined,
      year: undefined,
      ecli: undefined,
      celex: undefined,
      officialIdentifier: undefined,
      providerDocumentId: undefined,
    });
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      authorityCandidates: [weak],
    })))).toContain("CANDIDATE_IDENTITY_INSUFFICIENT");
  });

  it("rejects duplicate candidate IDs", () => {
    const researchMission = mission();
    const authority = candidate();
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      authorityCandidates: [authority, authority],
    })))).toContain("DUPLICATE_CANDIDATE_ID");
  });

  it("requires candidate provenance to reference a recorded execution", () => {
    const researchMission = mission();
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      authorityCandidates: [candidate({ executionRecordId: "missing" })],
    })))).toContain("UNKNOWN_EXECUTION_REFERENCE");
  });

  it.each([
    ["gap-full-text", "FULL_TEXT_NOT_VERIFIED"],
    ["gap-adverse", "NO_ADVERSE_AUTHORITY_CHECK"],
    ["gap-eu", "NO_EU_CHECK"],
    ["gap-counter", "OPEN_COUNTERARGUMENT"],
  ] as const)("represents the %s research gap", (gapId, kind) => {
    const gap: ResearchGap = { gapId, kind, targetId: "proposition-1" };
    const researchMission = mission({ knownEvidenceGaps: [gap] });
    expect(validateResearchMission(researchMission)).toEqual([]);
    expect(researchMission.knownEvidenceGaps).toContainEqual(gap);
  });

  it("deterministically proposes structured next actions from explicit gaps", () => {
    const gaps: readonly ResearchGap[] = [
      { gapId: "gap-treatment", kind: "UNRESOLVED_AUTHORITY_TREATMENT", targetId: "authority-1" },
      { gapId: "gap-eu", kind: "NO_EU_CHECK", sourceFamily: "EU_LEGISLATION" },
    ];
    const first = suggestNextResearchActions(gaps);
    expect(first).toEqual(suggestNextResearchActions(gaps));
    expect(first).toEqual([
      { gapId: "gap-eu", mode: "CROSS_JURISDICTION_CHECK", sourceFamilies: ["EU_LEGISLATION"] },
      { gapId: "gap-treatment", mode: "CITATION_EXPANSION", targetId: "authority-1", sourceFamilies: [] },
      { gapId: "gap-treatment", mode: "SUBSEQUENT_TREATMENT_SEARCH", targetId: "authority-1", sourceFamilies: [] },
    ]);
  });

  it("turns a missing document gap into a fact investigation suggestion", () => {
    expect(suggestNextResearchActions([{
      gapId: "gap-document",
      kind: "MISSING_DOCUMENT",
      targetId: "fact-1",
    }])).toEqual([{
      gapId: "gap-document",
      mode: "FACT_INVESTIGATION_SUGGESTION",
      targetId: "fact-1",
      sourceFamilies: [],
    }]);
  });

  it("preserves a legal strategy suggestion without executing an action", () => {
    const researchMission = mission({ mode: "STRATEGY_RESEARCH" });
    const value = bundle(researchMission, {
      legalResearchSuggestions: [{
        suggestionId: "suggestion-1",
        kind: "ALTERNATIVE_LEGAL_QUALIFICATION",
        description: "Consider whether the measure is a revocation rather than a forfeiture.",
      }],
    });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
    expect(value.legalResearchSuggestions[0]).not.toHaveProperty("execute");
    expect(value.legalResearchSuggestions[0]).not.toHaveProperty("action");
  });

  it("supports bounded human-decision escalation", () => {
    const researchMission = mission();
    const suggestion = {
      suggestionId: "suggestion-1",
      kind: "HUMAN_LEGAL_JUDGMENT_QUESTION" as const,
      description: "Determine whether filing is proportionate.",
    };
    const value = bundle(researchMission, {
      legalResearchSuggestions: [suggestion],
      humanDecisionEscalations: [{
        escalationId: "escalation-1",
        reason: "PROCEDURAL_STRATEGY_CHOICE",
        relatedSuggestionIds: [suggestion.suggestionId],
        state: "HUMAN_DECISION_REQUIRED",
      }],
      completionState: "HUMAN_DECISION_REQUIRED",
    });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
  });

  it("rejects escalation references to missing suggestions", () => {
    const researchMission = mission();
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      humanDecisionEscalations: [{
        escalationId: "escalation-1",
        reason: "PROFESSIONAL_JUDGMENT_REQUIRED",
        relatedSuggestionIds: ["missing"],
        state: "HUMAN_DECISION_REQUIRED",
      }],
    })))).toContain("HUMAN_ESCALATION_INVALID");
  });

  it("enforces the Moonlit call budget", () => {
    const researchMission = mission({ budget: {
      maxTotalResearchCalls: 10,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 4,
      maxLegalDataHunterCalls: 3,
    } });
    const moonlit = execution({ toolId: "MOONLIT", callsConsumed: 2 });
    expect(assessResearchBudget(researchMission.budget, [moonlit])).toMatchObject({
      moonlitCalls: 2,
      exceeded: true,
    });
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission, {
      researchToolExecutions: [moonlit],
      authorityCandidates: [],
      completionState: "BUDGET_EXHAUSTED",
    })))).toContain("BUDGET_EXCEEDED");
  });

  it("preserves partial evidence when the exact call budget is exhausted", () => {
    const researchMission = mission({ budget: {
      maxTotalResearchCalls: 1,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 1,
      maxLegalDataHunterCalls: 1,
    } });
    const value = bundle(researchMission, { completionState: "BUDGET_EXHAUSTED" });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
    expect(value.authorityCandidates).toHaveLength(1);
    expect(assessResearchBudget(researchMission.budget, value.researchToolExecutions).exhausted).toBe(true);
  });

  it("requires an exhausted bundle to declare BUDGET_EXHAUSTED", () => {
    const researchMission = mission({ budget: {
      maxTotalResearchCalls: 1,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 1,
      maxLegalDataHunterCalls: 1,
    } });
    expect(codes(validateResearchEvidenceBundle(researchMission, bundle(researchMission))))
      .toContain("BUDGET_EXHAUSTION_NOT_DECLARED");
  });

  it("rejects credential-shaped fields anywhere in mission or bundle input", () => {
    const unsafeMission = { ...mission(), apiKey: "never-store" } as ResearchMission;
    expect(validateResearchMission(unsafeMission).map((item) => item.code))
      .toContain("CREDENTIAL_FIELD_FORBIDDEN");
    const researchMission = mission();
    const unsafeBundle = { ...bundle(researchMission), accessToken: "never-store" } as ResearchEvidenceBundle;
    expect(codes(validateResearchEvidenceBundle(researchMission, unsafeBundle)))
      .toContain("CREDENTIAL_FIELD_FORBIDDEN");
    const pluralCredentialBundle = {
      ...bundle(researchMission),
      metadata: { oauth_tokens: ["never-store"] },
    } as ResearchEvidenceBundle;
    expect(codes(validateResearchEvidenceBundle(researchMission, pluralCredentialBundle)))
      .toContain("CREDENTIAL_FIELD_FORBIDDEN");
  });

  it("validates the same evidence bundle deterministically", () => {
    const researchMission = mission();
    const value = bundle(researchMission);
    expect(validateResearchEvidenceBundle(researchMission, value))
      .toEqual(validateResearchEvidenceBundle(researchMission, value));
  });

  it("does not infer truth by provider majority voting", () => {
    const candidates = [
      candidate({ supportDirection: "SUPPORT", providerId: "provider-a" }),
      candidate({ supportDirection: "SUPPORT", providerId: "provider-b", providerDocumentId: "document-b" }),
      candidate({ supportDirection: "AGAINST", providerId: "provider-c", providerDocumentId: "document-c" }),
    ];
    expect(candidates.map((item) => item.supportDirection)).toEqual(["SUPPORT", "SUPPORT", "AGAINST"]);
    expect(candidates.every((item) => item.verificationState === "OFFICIAL_VERIFICATION_REQUIRED")).toBe(true);
  });

  it("publishes orchestration roles as capabilities rather than trust rankings", () => {
    expect(CONFIRMED_RESEARCH_TOOL_ROLES.SIMPLICITER.role).toBe("LEGAL_RESEARCH_STRATEGIST");
    expect(CONFIRMED_RESEARCH_TOOL_ROLES.SIMPLICITER.sourceFamilies).toContain("CASSAZIONE");
    expect(CONFIRMED_RESEARCH_TOOL_ROLES.MOONLIT.capabilities).toContain("CITATION_NETWORK");
    expect(CONFIRMED_RESEARCH_TOOL_ROLES.LEGAL_DATA_HUNTER.role).toBe("BROAD_DISCOVERY");
    expect(CONFIRMED_RESEARCH_TOOL_ROLES).not.toHaveProperty("trustRanking");
  });

  it("maps only the bounded future MCP operations", () => {
    expect(FUTURE_MCP_RESEARCH_TOOL_MAPPING).toEqual({
      get_pending_research_missions: "getPendingResearchMissions",
      get_research_mission: "getResearchMission",
      submit_research_evidence_bundle: "submitResearchEvidenceBundle",
      reject_or_defer_research_mission: "rejectOrDeferResearchMission",
    });
  });

  it("validates follow-up mission references against the parent and explicit gaps", () => {
    const researchMission = mission();
    const gap: ResearchGap = { gapId: "gap-eu", kind: "NO_EU_CHECK" };
    const value = bundle(researchMission, {
      evidenceGaps: [gap],
      suggestedFollowUpMissions: [{
        suggestionId: "follow-up-1",
        parentMissionId: researchMission.missionId,
        mode: "CROSS_JURISDICTION_CHECK",
        legalIssueIds: ["issue-1"],
        legalPropositionIds: ["proposition-1"],
        sourceFamilies: ["EU_LEGISLATION", "CJEU"],
        originatingGapIds: [gap.gapId],
      }],
    });
    expect(validateResearchEvidenceBundle(researchMission, value)).toEqual([]);
  });
});
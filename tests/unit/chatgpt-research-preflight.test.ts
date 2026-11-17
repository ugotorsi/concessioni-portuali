import { describe, expect, it } from "vitest";

import { evaluateChatGptResearchPreflight } from "@/server/legal-research/chatgpt-research-preflight";
import { createResearchMission, RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";

function mission(executionChannel: "CHATGPT_CONNECTOR" | "SERVER_AUTONOMOUS" = "CHATGPT_CONNECTOR") {
  return createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    executionChannel,
    caseReference: { caseId: "selvara-case" },
    legalIssueIds: ["issue-1"],
    legalPropositionIds: [],
    referenceDate: "2026-10-31T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "Quali fonti sono applicabili?",
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
    missingSourceFamilies: [],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: true,
    },
    budget: {
      maxTotalResearchCalls: 6,
      maxMoonlitCalls: 2,
      maxSimpliciterCalls: 2,
      maxLegalDataHunterCalls: 2,
    },
    status: "PENDING",
  });
}

describe("Selvara ChatGPT research preflight", () => {
  it("requires only the assigned ChatGPT mission and closed autonomous gates", () => {
    expect(evaluateChatGptResearchPreflight({
      mission: mission(),
      assignedActorId: "assigned-actor",
      lifecycleStatus: "CURRENT",
      autonomousExecutionGates: {
        aiRealDataEnabled: "false",
        asyncProviderExecutionEnabled: "false",
        automaticResearchExecutionEnabled: "false",
      },
    })).toEqual({ ready: true, blockers: [] });
  });

  it("does not inspect or require autonomous provider credentials", () => {
    expect(evaluateChatGptResearchPreflight({
      mission: mission(),
      assignedActorId: "assigned-actor",
      lifecycleStatus: "CURRENT",
      autonomousExecutionGates: {},
    })).toEqual({ ready: true, blockers: [] });
  });

  it("rejects autonomous missions, open worker gates, missing assignment, and excessive budgets", () => {
    const excessive = {
      ...mission("SERVER_AUTONOMOUS"),
      budget: {
        maxTotalResearchCalls: 7,
        maxMoonlitCalls: 3,
        maxSimpliciterCalls: 2,
        maxLegalDataHunterCalls: 2,
      },
    };
    expect(evaluateChatGptResearchPreflight({
      mission: excessive,
      assignedActorId: null,
      lifecycleStatus: "HISTORICAL",
      autonomousExecutionGates: { automaticResearchExecutionEnabled: "true" },
    })).toEqual({
      ready: false,
      blockers: [
        "AUTONOMOUS_EXECUTION_GATE_OPEN",
        "MISSION_ASSIGNMENT_MISSING",
        "MISSION_BUDGET_INVALID",
        "MISSION_EXECUTION_CHANNEL_INVALID",
        "MISSION_LIFECYCLE_INVALID",
      ],
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { KnowledgeResearchMissionPlan } from "@/server/fascicolo-knowledge";
import { createResearchMission, RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";
import {
  createPeriodicLegalResearchScheduler,
  reconcilePeriodicLegalResearchMissions,
  type PeriodicLegalResearchDependencies,
  type PeriodicLegalResearchTarget,
} from "@/server/legal-research/periodic-legal-research";

function plan(procedimentoId: string, suffix: string): KnowledgeResearchMissionPlan {
  const mission = createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: procedimentoId, fascicoloReference: procedimentoId },
    legalIssueIds: [`issue-${suffix}`],
    legalPropositionIds: [],
    referenceDate: "2026-01-01T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "Quale disciplina si applica?",
    assumptionsFingerprint: suffix.repeat(64).slice(0, 64),
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
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
      maxTotalResearchCalls: 2,
      maxMoonlitCalls: 1,
      maxSimpliciterCalls: 1,
      maxLegalDataHunterCalls: 0,
    },
    status: "PENDING",
    executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"] },
  });
  return {
    questionItemId: `question-${suffix}`,
    questionSemanticKey: suffix.repeat(64).slice(0, 64),
    legalIssueItemId: `issue-${suffix}`,
    legalIssueSemanticKey: `i${suffix}`.repeat(64).slice(0, 64),
    originatingItemIds: [`fact-${suffix}`],
    priority: "HIGH",
    referenceDate: "2026-01-01",
    referenceDateBasis: {
      type: "EVENT_DATE",
      itemSemanticKey: `e${suffix}`.repeat(64).slice(0, 64),
      rationale: "Data documentata",
      userConfirmedDateSource: null,
    },
    missionFingerprint: suffix.repeat(64).slice(0, 64),
    execution: "ADMITTED",
    blockReason: null,
    mission,
  };
}

describe("periodic legal research", () => {
  it("creates independent subsequent-treatment missions for an existing fascicolo and a renewal fascicolo", async () => {
    const targets: readonly PeriodicLegalResearchTarget[] = [
      {
        tenantId: "tenant-1",
        procedimentoId: "fascicolo-originario",
        knowledgeRevisionId: "revision-originaria",
        assignedActorId: "actor-1",
        plans: [plan("fascicolo-originario", "a")],
      },
      {
        tenantId: "tenant-1",
        procedimentoId: "fascicolo-rinnovo",
        knowledgeRevisionId: "revision-rinnovo",
        assignedActorId: "actor-1",
        plans: [plan("fascicolo-rinnovo", "b")],
      },
    ];
    const reconciled: Parameters<PeriodicLegalResearchDependencies["reconcile"]>[0][] = [];
    const reconcile = vi.fn(async (input: Parameters<PeriodicLegalResearchDependencies["reconcile"]>[0]) => {
      reconciled.push(input);
    });

    const result = await reconcilePeriodicLegalResearchMissions({
      now: new Date("2026-10-12T00:00:00.000Z"),
      environment: {
        PERIODIC_LEGAL_RESEARCH_ENABLED: "true",
        PERIODIC_LEGAL_RESEARCH_INTERVAL_DAYS: "30",
      } as unknown as NodeJS.ProcessEnv,
    }, {
      listDueTargets: vi.fn(async () => targets),
      reconcile,
    });

    expect(result).toEqual({ targetCount: 2, missionCount: 2 });
    expect(reconcile).toHaveBeenCalledTimes(2);
    const [original, renewal] = reconciled;
    expect(original).toBeDefined();
    expect(renewal).toBeDefined();
    if (!original || !renewal) throw new Error("Expected both fascicolo reconciliations.");
    expect(original.procedimentoId).toBe("fascicolo-originario");
    expect(renewal.procedimentoId).toBe("fascicolo-rinnovo");
    expect(original.plans[0].mission?.caseReference.caseId).toBe("fascicolo-originario");
    expect(renewal.plans[0].mission?.caseReference.caseId).toBe("fascicolo-rinnovo");
    expect(original.plans[0].mission?.mode).toBe("SUBSEQUENT_TREATMENT_SEARCH");
    expect(renewal.plans[0].mission?.mode).toBe("SUBSEQUENT_TREATMENT_SEARCH");
    expect(original.plans[0].missionFingerprint).not.toBe(renewal.plans[0].missionFingerprint);
  });

  it("is disabled by default and throttles worker reconciliation", async () => {
    const listDueTargets = vi.fn(async () => []);
    await expect(reconcilePeriodicLegalResearchMissions({}, {
      listDueTargets,
      reconcile: vi.fn(async () => undefined),
    })).resolves.toEqual({ targetCount: 0, missionCount: 0 });
    expect(listDueTargets).not.toHaveBeenCalled();

    const reconcile = vi.fn(async () => ({ targetCount: 0, missionCount: 0 }));
    let now = new Date("2026-10-12T00:00:00.000Z");
    const scheduled = createPeriodicLegalResearchScheduler({
      now: () => now,
      reconcile,
      environment: { PERIODIC_LEGAL_RESEARCH_ENABLED: "true" } as unknown as NodeJS.ProcessEnv,
    });
    await scheduled();
    await scheduled();
    expect(reconcile).toHaveBeenCalledOnce();
    now = new Date("2026-10-12T01:00:00.000Z");
    await scheduled();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMissions, countMissions } = vi.hoisted(() => ({
  findManyMissions: vi.fn(),
  countMissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: {
      findUnique: vi.fn(async () => ({ enteId: "tenant-1" })),
      findFirst: vi.fn(async () => ({ id: "procedure-1" })),
    },
    documento: { findMany: vi.fn(async () => []) },
    documentExtractionAttempt: { findMany: vi.fn(async () => []) },
    automaticFascicoloReport: { findMany: vi.fn(async () => []) },
    structuredFascicoloReportSnapshot: { findMany: vi.fn(async () => []) },
    asyncJob: { findMany: vi.fn(async () => []) },
    researchMissionRecord: { findMany: findManyMissions, count: countMissions },
  },
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: vi.fn(async () => ({ userId: "user-1" })),
  isTenantContextConstrained: vi.fn(() => false),
  requireTenantAccess: vi.fn(),
}));

vi.mock("@/server/queries/fascicolo-knowledge", () => ({
  loadCurrentStructuredKnowledge: vi.fn(async () => null),
}));

vi.mock("@/server/fascicolo-operational-proposals", () => ({
  listOperationalProposals: vi.fn(async () => []),
}));

vi.mock("@/server/legal-research/automatic-research-policy", () => ({
  evaluateAutomaticResearchPolicy: vi.fn(() => ({ authorized: false, requirementCode: "NOT_AUTHORIZED" })),
}));

import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

describe("Lotto 3A fascicolo automatic workflow read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countMissions.mockResolvedValue(2);
    findManyMissions.mockImplementation(async (query) => {
      expect(query.where).toMatchObject({ tenantId: "tenant-1", caseId: "procedure-1" });
      expect(query.take).toBe(51);
      const currentMission = {
        id: "mission-current",
        payload: { researchQuestion: "Quale disciplina si applica?" },
        referenceDate: new Date("2026-09-01T00:00:00.000Z"),
        createdAt: new Date("2026-09-02T00:00:00.000Z"),
        updatedAt: new Date("2026-09-03T00:00:00.000Z"),
        referenceDateBasis: { type: "EVENT_DATE" },
        missionFingerprint: "a".repeat(64),
        legalIssueSemanticKey: "b".repeat(64),
        researchQuestionSemanticKey: "c".repeat(64),
        knowledgeRevisionId: "revision-current",
        firstKnowledgeRevisionId: "revision-current",
        mode: "DISCOVER_AUTHORITIES",
        status: "COMPLETED",
        primaryAdverseRequirements: [{
          adverseMission: { id: "mission-adverse", status: "PENDING", lifecycleStatus: "CURRENT" },
        }],
        questionResults: [{
          id: "result-current",
          bundleId: "bundle-current",
          candidateId: "candidate-current",
          candidateSnapshot: {
            kind: "AUTHORITY_CANDIDATE",
            candidateId: "candidate-current",
            executionRecordId: "execution-current",
            toolId: "provider-tool",
            providerId: "provider-1",
            title: "Fonte corrente",
            supportDirection: "SUPPORT",
            sourceFamily: "ITALIAN_LEGISLATION",
            retrievalMethod: "SEMANTIC_SEARCH",
            fullTextAvailable: false,
            verificationState: "OFFICIAL_VERIFICATION_REQUIRED",
          },
          supportDirection: "SUPPORTS",
          classificationSource: "PROVIDER_OUTPUT",
          classificationConfidence: null,
          classificationRationale: "Passaggio pertinente da verificare.",
          classificationReviewStatus: "AI_PROPOSED",
          coverageElementKeys: ["competenza"],
          unresolvedAspectKeys: ["decadenza"],
          researchQuestionSemanticKey: "c".repeat(64),
          sourceAssessments: [{
            id: "assessment-current",
            chainFingerprint: "d".repeat(64),
            isCurrent: true,
            retrievalState: "RESOLVED",
            textState: "FULL_TEXT",
            identityState: "VERIFIED",
            contentState: "VERIFIED",
            temporalState: "APPLICABLE",
            adverseState: "COMPLETED",
            officiality: "OFFICIAL",
            citationAnchors: [{ page: 4, paragraph: "12" }],
            blockingReasons: [],
            manualReviewRequired: false,
            manualReviewReason: null,
            usable: true,
          }],
        }, {
          id: "result-legacy",
          bundleId: "bundle-current",
          candidateId: "candidate-legacy",
          candidateSnapshot: {
            kind: "AUTHORITY_CANDIDATE", candidateId: "candidate-legacy", executionRecordId: "execution-current",
            toolId: "legacy-tool", title: "Fonte legacy", supportDirection: "SUPPORT", sourceFamily: "OTHER",
            retrievalMethod: "SEMANTIC_SEARCH", fullTextAvailable: true, verificationState: "OFFICIALLY_VERIFIED",
          },
          supportDirection: "SUPPORTS",
          classificationSource: "PROVIDER_OUTPUT",
          classificationConfidence: null,
          classificationRationale: null,
          classificationReviewStatus: "AI_PROPOSED",
          coverageElementKeys: [],
          unresolvedAspectKeys: [],
          researchQuestionSemanticKey: "c".repeat(64),
          sourceAssessments: [],
        }],
        executionAttempts: [{
          evidenceBundles: [{
            payload: {
              authorityCandidates: [{ title: "Fonte corrente", supportDirection: "SUPPORT", verificationState: "OFFICIALLY_VERIFIED" }],
              evidenceGaps: [],
              conflicts: ["Orientamento contrario da verificare"],
              legalResearchSuggestions: [{
                suggestionId: "suggestion-1",
                kind: "POSSIBLE_COUNTERARGUMENT",
                description: "Valutare l'orientamento contrario con revisione professionale.",
              }],
            },
            completionState: "COMPLETE",
          }],
        }],
      };
      if (query.where.mode === "ADVERSE_SEARCH") {
        return [{
          ...currentMission,
          id: "mission-adverse-search",
          mode: "ADVERSE_SEARCH",
          payload: { researchQuestion: "Esistono orientamenti contrari?" },
        }];
      }
      if (query.where.lifecycleStatus === "CURRENT") return [currentMission];
      return [{
        ...currentMission,
        id: "mission-historical",
        payload: { researchQuestion: "Quale disciplina si applicava nella versione precedente?" },
        status: "COMPLETED",
        primaryAdverseRequirements: [],
        questionResults: [{
          ...currentMission.questionResults[0],
          id: "result-historical",
          candidateId: "candidate-historical",
          sourceAssessments: [{
            ...currentMission.questionResults[0].sourceAssessments[0],
            id: "assessment-historical",
            isCurrent: true,
            usable: true,
          }],
        }],
      }, {
        ...currentMission,
        id: "mission-historical-empty",
        payload: { researchQuestion: "Quesito storico senza risultati" },
        status: "DEFERRED",
        primaryAdverseRequirements: [],
        questionResults: [],
        executionAttempts: [],
      }];
    });
  });

  it("keeps CURRENT and HISTORICAL mission snapshots separate, including empty historical missions", async () => {
    const model = await getFascicoloAutomaticWorkflowReadModel("procedure-1");
    expect(model?.missions).toHaveLength(1);
    expect(model?.missions[0]).toMatchObject({
      missionId: "mission-current",
      conflicts: ["Orientamento contrario da verificare"],
      suggestions: [{
        suggestionId: "suggestion-1",
        kind: "POSSIBLE_COUNTERARGUMENT",
        description: "Valutare l'orientamento contrario con revisione professionale.",
        targetId: null,
      }],
      lifecycleStatus: "CURRENT",
      resultCount: 2,
      displayedHistoricalResultCount: 1,
      coverageStatus: "PARTIAL",
      conflicting: false,
      discoveryCoverageStatus: "DISCOVERED",
      usableCoverageStatus: "USABLE",
      usableSupportsCount: 1,
      usableOpposesCount: 0,
      conflictingUsableAuthorities: false,
      adverseMission: { missionId: "mission-adverse", status: "PENDING", lifecycleStatus: "CURRENT" },
      sources: [{ title: "Fonte corrente" }],
      completionState: "COMPLETE",
    });
    expect(model?.missions[0].results.find((result) => result.resultId === "result-current")).toMatchObject({
      supportDirection: "SUPPORTS",
      sourceVerificationState: "DISCOVERED",
      classificationReviewStatus: "AI_PROPOSED",
      retrievalState: "RESOLVED",
      acquisitionState: "FULL_TEXT",
      identityVerification: "VERIFIED",
      contentVerification: "VERIFIED",
      temporalStatus: "APPLICABLE",
      adverseStatus: "COMPLETED",
      officiality: "OFFICIAL",
      usable: true,
      blockingReasons: [],
      citationAnchors: [{ page: 4, paragraph: "12" }],
      manualReviewRequired: false,
      manualReviewReason: null,
      legacySource: false,
    });
    expect(model?.missions[0].results.find((result) => result.resultId === "result-legacy")).toMatchObject({
      usable: false,
      legacySource: true,
      blockingReasons: ["LEGACY_UNVERIFIED"],
      manualReviewRequired: true,
    });
    expect(model?.missions.some((mission) => mission.missionId === "mission-historical")).toBe(false);
    expect(model?.historicalMissions).toHaveLength(2);
    expect(model?.historicalMissions[0]).toMatchObject({
      missionId: "mission-historical",
      lifecycleStatus: "HISTORICAL",
      resultCount: 1,
      adverseMission: null,
      automationRequirementCode: null,
    });
    expect(model?.historicalMissions[0].results[0]).toMatchObject({
      resultId: "result-historical",
      missionId: "mission-historical",
      usable: true,
    });
    expect(model?.historicalMissions[1]).toMatchObject({
      missionId: "mission-historical-empty",
      lifecycleStatus: "HISTORICAL",
      resultCount: 0,
      results: [],
    });
    expect(model?.historicalMissionCount).toBe(2);
    expect(model?.missionReadTruncation).toEqual({
      limitPerLifecycle: 50,
      current: false,
      historical: false,
      adverse: false,
    });
    expect(countMissions).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        caseId: "procedure-1",
        lifecycleStatus: "HISTORICAL",
        mode: { not: "ADVERSE_SEARCH" },
      },
    });
    expect(findManyMissions).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-1",
        caseId: "procedure-1",
        lifecycleStatus: "CURRENT",
        mode: { not: "ADVERSE_SEARCH" },
      },
      take: 51,
    }));
    expect(findManyMissions).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-1",
        caseId: "procedure-1",
        lifecycleStatus: "CURRENT",
        mode: "ADVERSE_SEARCH",
      },
      take: 51,
    }));
    expect(findManyMissions).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-1",
        caseId: "procedure-1",
        lifecycleStatus: "HISTORICAL",
        mode: { not: "ADVERSE_SEARCH" },
      },
      take: 51,
    }));
  });
});
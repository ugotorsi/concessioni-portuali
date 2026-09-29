import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMissions, countMissions, findManyHistoricalResults } = vi.hoisted(() => ({
  findManyMissions: vi.fn(),
  countMissions: vi.fn(),
  findManyHistoricalResults: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: vi.fn(async () => ({ concessione: { enteId: "tenant-1" } })) },
    automaticFascicoloReport: { findMany: vi.fn(async () => []) },
    structuredFascicoloReportSnapshot: { findMany: vi.fn(async () => []) },
    asyncJob: { findMany: vi.fn(async () => []) },
    researchMissionRecord: { findMany: findManyMissions, count: countMissions },
    researchQuestionResultRecord: { findMany: findManyHistoricalResults },
  },
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: vi.fn(async () => ({ userId: "user-1" })),
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
    countMissions.mockResolvedValue(1);
    findManyHistoricalResults.mockResolvedValue([{ researchQuestionSemanticKey: "c".repeat(64) }]);
    findManyMissions.mockImplementation(async (query) => {
      expect(query.where).toEqual({ tenantId: "tenant-1", caseId: "procedure-1", lifecycleStatus: "CURRENT" });
      return [{
        id: "mission-current",
        payload: { researchQuestion: "Quale disciplina si applica?" },
        referenceDate: new Date("2026-09-01T00:00:00.000Z"),
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
          sourceAssessments: [{
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
        }],
        executionAttempts: [{
          evidenceBundles: [{
            payload: {
              authorityCandidates: [{ title: "Fonte corrente", supportDirection: "SUPPORT", verificationState: "OFFICIALLY_VERIFIED" }],
              evidenceGaps: [],
              conflicts: [],
            },
            completionState: "COMPLETE",
          }],
        }],
      }];
    });
  });

  it("shows only CURRENT missions and their bundles while reporting the HISTORICAL count", async () => {
    const model = await getFascicoloAutomaticWorkflowReadModel("procedure-1");
    expect(model?.missions).toHaveLength(1);
    expect(model?.missions[0]).toMatchObject({
      missionId: "mission-current",
      lifecycleStatus: "CURRENT",
      resultCount: 2,
      historicalResultCount: 1,
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
    expect(model?.historicalMissionCount).toBe(1);
    expect(countMissions).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", caseId: "procedure-1", lifecycleStatus: "HISTORICAL" },
    });
    expect(findManyHistoricalResults).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", caseId: "procedure-1", mission: { lifecycleStatus: "HISTORICAL" } },
      select: { researchQuestionSemanticKey: true },
    });
  });
});
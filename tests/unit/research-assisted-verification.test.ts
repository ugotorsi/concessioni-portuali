import { describe, expect, it, vi } from "vitest";
import { verifyWithSyntheticDocuments as verifyResearchEvidence } from "./assisted-document-fixtures";
import { verifyResearchEvidence as verifyWithoutDocuments } from "@/server/legal-research/assisted-verification";
import { adverseSearchBasis, evaluateAdverseSearch } from "@/server/legal-research/adverse-search";
import { syntheticAdverseSearch } from "./assisted-document-fixtures";

import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
} from "@/server/legal-research/bridge";
import {
  assistedVerificationPreClaimStatus,
  type OfficialSourceEvidence,
} from "@/server/legal-research/assisted-verification";

const mission = createResearchMission({
  kind: "RESEARCH_MISSION",
  version: RESEARCH_BRIDGE_VERSION,
  caseReference: { caseId: "case-a" },
  legalIssueIds: ["issue-a"],
  legalPropositionIds: ["proposition-a"],
  referenceDate: "2026-09-26T00:00:00.000Z",
  mode: "ADVERSE_SEARCH",
  researchQuestion: "Public legal question",
  knownAuthorities: [],
  excludedAuthorities: [],
  preferredSourceFamilies: ["CJEU"],
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
    maxTotalResearchCalls: 3,
    maxMoonlitCalls: 1,
    maxSimpliciterCalls: 1,
    maxLegalDataHunterCalls: 1,
  },
  status: "PENDING",
  executionPlan: {
    requiredCapabilities: [
      "FULL_TEXT_RETRIEVAL",
      "CITATION_NETWORK",
      "ADVERSE_AUTHORITY_DISCOVERY",
    ],
  },
});

function source(overrides: Partial<OfficialSourceEvidence> = {}): OfficialSourceEvidence {
  return {
    evidenceSourceId: "evidence-source-a",
    authorityId: "authority-a",
    legalSourceId: "legal-source-a",
    legalExpressionVersionId: "expression-a",
    officialIdentifier: "ECLI:EU:C:2024:1",
    sourceUrl: "https://official.example.test/authority-a",
    sourceFamily: "CJEU",
    courtOrBody: "Court of Justice of the European Union",
    documentType: "Judgment",
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

const targetSource = source({
  evidenceSourceId: "evidence-source-b",
  authorityId: "authority-b",
  legalSourceId: "legal-source-b",
  legalExpressionVersionId: "expression-b",
  officialIdentifier: "ECLI:EU:C:2020:2",
  sourceUrl: "https://official.example.test/authority-b",
  fullText: { available: false },
});

const documentedCitation = {
  sourceAuthorityId: "authority-a",
  targetAuthorityId: "authority-b",
  evidenceSourceId: "evidence-source-a",
  documented: true,
  locator: { paragraph: "42" },
} as const;

describe("research assisted verification", () => {
  it.each(["valid", "single-not-adverse", "unreviewed", "inconclusive", "scope", "gaps", "changed-source", "changed-step", "missing-bytes", "multiple-propositions", "unexamined-source", "provider-zero", "no-candidates", "wrong-mission", "wrong-reference-date", "blank-reviewer", "future-activity"])("checks documented negative search independently: %s", scenario => {
    const sources = [source()];
    const search = syntheticAdverseSearch(mission, sources);
    const review = { reviewedByActorId: "legal-reviewer-a", reviewedAt: "2026-09-26T10:00:00.000Z", basisFingerprint: adverseSearchBasis(search, sources) };
    if (scenario === "inconclusive") search.outcome = "INCONCLUSIVE";
    if (scenario === "scope") search.jurisdictions = ["CASSAZIONE"];
    if (scenario === "gaps") search.unresolvedGaps = ["Unexamined contrary authority"];
    if (scenario === "changed-step") search.researchSteps[0].queryOrActivity += " Changed scope.";
    if (scenario === "changed-source") sources[0] = { ...sources[0], legalExpressionVersionId: "new-expression" };
    if (scenario === "unexamined-source") sources.push(source({ evidenceSourceId: "unexamined-evidence", authorityId: "unexamined-authority" }));
    if (scenario === "provider-zero") search.researchSteps = [];
    if (scenario === "no-candidates") search.candidates = [];
    if (scenario === "wrong-mission") search.missionId = "another-mission";
    if (scenario === "wrong-reference-date") search.temporalScope.referenceDate = "2025-01-01T00:00:00.000Z";
    if (scenario === "blank-reviewer") review.reviewedByActorId = "";
    if (scenario === "future-activity") {
      search.researchSteps[0].performedAt = "2099-01-01T00:00:00.000Z";
      review.basisFingerprint = adverseSearchBasis(search, sources);
    }
    const input = { mission: scenario === "multiple-propositions" ? { ...mission, legalPropositionIds: ["proposition-a", "proposition-b"] } : mission, sources, adverseSearch: scenario === "single-not-adverse" ? undefined : search,
      adverseSearchReview: scenario === "unreviewed" ? undefined : review,
      adverseReview: scenario === "single-not-adverse" ? { observationSourceAuthorityId: "authority-a", observationTargetAuthorityId: "authority-b", legalPropositionId: "proposition-a", reviewedByActorId: "legal-reviewer-a", reviewedAt: review.reviewedAt, evidenceSourceId: "evidence-source-a", rationale: "A single non-adverse candidate is not a completed search", decision: "NOT_ADVERSE" as const } : undefined };
    if (["provider-zero", "no-candidates", "blank-reviewer"].includes(scenario)) {
      expect(() => verifyResearchEvidence(input)).toThrow("INVALID_ASSISTED_VERIFICATION");
      return;
    }
    const result = scenario === "missing-bytes" ? verifyWithoutDocuments(input) : verifyResearchEvidence(input);
    expect(result.adverseAuthorityVerified).toBe(false);
    expect(result.adverseAssessments).toEqual([]);
    expect(result.adverseSearchCompleted).toBe(scenario === "valid");
    expect(result.adverseSearchState).toBe(scenario === "valid" ? "COMPLETED_NO_ADVERSE_FOUND" : scenario === "inconclusive" ? "INCONCLUSIVE" : "NOT_PERFORMED_OR_INSUFFICIENT");
    expect(result.citationObservations).toEqual([]);
    expect(result.authorityCandidates).toEqual([]);
    expect(result.evidenceGaps.some(gap => gap.kind === "UNRESOLVED_AUTHORITY_TREATMENT")).toBe(true);
    expect(assistedVerificationPreClaimStatus(mission, result).unmetRequirements.includes("CAPABILITY_ADVERSE_AUTHORITY_DISCOVERY_MISSING")).toBe(scenario !== "valid");
  });
  it("distinguishes confirmed adverse authority, missing search and inconclusive search", () => {
    const input = { mission, sources: [], verifiedDocuments: [], adverseAuthorityVerified: false };
    expect(evaluateAdverseSearch(input)).toEqual({ state: "NOT_PERFORMED_OR_INSUFFICIENT", completed: false });
    expect(evaluateAdverseSearch({ ...input, singleDecisionInconclusive: true })).toEqual({ state: "INCONCLUSIVE", completed: false });
    expect(evaluateAdverseSearch({ ...input, adverseAuthorityVerified: true })).toEqual({ state: "CONFIRMED_ADVERSE", completed: true });
  });
  it.each([["NO_EU_CHECK", "CJEU"], ["NO_CASSATION_CHECK", "CASSAZIONE"]] as const)(
    "resolves %s only with verified documents from %s for the named object", (kind, sourceFamily) => {
      const scopedMission = { ...mission, knownEvidenceGaps: [{ gapId: "jurisdiction-gap", kind, sourceFamily }] };
      const evidence = source({ sourceFamily });
      const input = { mission: scopedMission, sources: [evidence], gapResolutions: [{ gapId: "jurisdiction-gap", evidenceSourceId: evidence.evidenceSourceId, targetId: evidence.authorityId }] };
      expect(verifyResearchEvidence(input).resolvedGaps).toHaveLength(1);
      expect(verifyWithoutDocuments(input).resolvedGaps).toEqual([]);
      expect(verifyResearchEvidence({ ...input, sources: [{ ...evidence, sourceFamily: "OTHER" }] }).resolvedGaps).toEqual([]);
      expect(verifyResearchEvidence({ ...input, gapResolutions: [{ ...input.gapResolutions[0], targetId: "unrelated-authority" }] }).resolvedGaps).toEqual([]);
      expect(verifyResearchEvidence({ ...input, sources: [] }).evidenceGaps).toContainEqual(scopedMission.knownEvidenceGaps[0]);
    },
  );

  it("does not accept typed identifiers and hash without verified bytes", () => {
    const result = verifyWithoutDocuments({ mission, sources: [source(), targetSource], citationRelation: documentedCitation });
    expect(result.verifiedFullTexts).toEqual([]);
    expect(result.citationObservations).toEqual([]);
    expect(result.evidenceGaps.some((item) => item.kind === "FULL_TEXT_NOT_VERIFIED")).toBe(true);
  });

  it("resolves only the named gap for the evidenced object", () => {
    const scopedMission = { ...mission, knownEvidenceGaps: [
      { gapId: "gap-a", kind: "FULL_TEXT_NOT_VERIFIED" as const, targetId: "authority-a" },
      { gapId: "gap-b", kind: "FULL_TEXT_NOT_VERIFIED" as const, targetId: "authority-b" },
    ] };
    const result = verifyResearchEvidence({ mission: scopedMission, sources: [source()], gapResolutions: [
      { gapId: "gap-a", targetId: "authority-a", evidenceSourceId: "evidence-source-a" },
      { gapId: "gap-b", targetId: "authority-b", evidenceSourceId: "evidence-source-a" },
    ] });
    expect(result.evidenceGaps.some((item) => item.gapId === "gap-a")).toBe(false);
    expect(result.evidenceGaps.some((item) => item.gapId === "gap-b")).toBe(true);
    expect(result.resolvedGaps).toHaveLength(1);
  });
  it("keeps full text unverified when an official source is missing", () => {
    const result = verifyResearchEvidence({ mission, sources: [] });

    expect(result.verifiedFullTexts).toEqual([]);
    expect(result.evidenceGaps).toContainEqual(expect.objectContaining({ kind: "FULL_TEXT_NOT_VERIFIED" }));
    expect(result.legalResearchSuggestions).toEqual([]);
  });

  it("does not create a citation observation for an undocumented relation", () => {
    const result = verifyResearchEvidence({
      mission,
      sources: [source(), targetSource],
      citationRelation: { ...documentedCitation, documented: false },
    });

    expect(result.citationObservations).toEqual([]);
    expect(result.evidenceGaps).toContainEqual(
      expect.objectContaining({ kind: "UNRESOLVED_AUTHORITY_TREATMENT" }),
    );
    expect(result.legalResearchSuggestions).toEqual([]);
  });

  it("does not verify adverse authority when human review is absent", () => {
    const result = verifyResearchEvidence({
      mission,
      sources: [source(), targetSource],
      citationRelation: documentedCitation,
    });

    expect(result.citationObservations).toHaveLength(1);
    expect(result.authorityCandidates).toEqual([
      expect.objectContaining({
        officialIdentifier: "ECLI:EU:C:2024:1",
        verificationState: "OFFICIALLY_VERIFIED",
        supportDirection: "UNKNOWN",
        verifiedEvidence: {
          evidenceSourceId: "evidence-source-a",
          legalSourceId: "legal-source-a",
          legalExpressionVersionId: "expression-a",
          contentSha256: "a".repeat(64),
          locator: { paragraph: "42" },
          termsOfUseBasis: "Official public-access terms checked",
          termsCheckedAt: "2026-09-26T09:00:00.000Z",
          reviewedByActorId: "legal-reviewer-a",
          reviewedAt: "2026-09-26T09:00:00.000Z",
          reviewRationale: "Official identity and source content checked by the legal reviewer.",
        },
      }),
    ]);
    expect(result.adverseAssessments).toEqual([]);
    expect(result.adverseAuthorityVerified).toBe(false);
    expect(result.evidenceGaps).toContainEqual(expect.objectContaining({ kind: "NO_ADVERSE_AUTHORITY_CHECK" }));
  });

  it("verifies an adverse assessment only after a complete reasoned human review", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = verifyResearchEvidence({
      mission,
      sources: [source(), targetSource],
      citationRelation: documentedCitation,
      adverseReview: {
        observationSourceAuthorityId: "authority-a",
        observationTargetAuthorityId: "authority-b",
        legalPropositionId: "proposition-a",
        reviewedByActorId: "legal-reviewer-a",
        reviewedAt: "2026-09-26T10:00:00.000Z",
        evidenceSourceId: "evidence-source-a",
        rationale: "The verified source contradicts the identified proposition for documented reasons.",
        decision: "ADVERSE",
      },
    });

    expect(result.verifiedFullTexts).toHaveLength(1);
    expect(result.citationObservations).toHaveLength(1);
    expect(result.adverseAuthorityVerified).toBe(true);
    expect(result.adverseAssessments).toEqual([
      expect.objectContaining({
        treatment: "ADVERSE",
        origin: "HUMAN",
        reviewState: "CONFIRMED",
        scope: { kind: "LEGAL_PROPOSITION", id: "proposition-a" },
        humanReview: expect.objectContaining({
          reviewedByActorId: "legal-reviewer-a",
          evidenceSourceId: "evidence-source-a",
        }),
      }),
    ]);
    expect(result.evidenceGaps).toEqual([]);
    expect(assistedVerificationPreClaimStatus(mission, result)).toEqual({
      satisfied: false,
      unmetRequirements: ["RESEARCH_SUGGESTIONS_MISSING"],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("records an identity gap instead of a candidate when source metadata is incomplete", () => {
    const result = verifyResearchEvidence({
      mission,
      sources: [source({ courtOrBody: undefined }), targetSource],
      citationRelation: documentedCitation,
    });

    expect(result.authorityCandidates).toEqual([]);
    expect(result.evidenceGaps).toContainEqual(expect.objectContaining({
      kind: "OFFICIAL_IDENTITY_NOT_VERIFIED",
      targetId: "evidence-source-a",
    }));
  });

  it("accepts only an explicit reasoned suggestion linked to a gap and verified source", () => {
    const incompleteSource = source({ documentType: undefined });
    const initial = verifyResearchEvidence({
      mission,
      sources: [incompleteSource, targetSource],
      citationRelation: documentedCitation,
    });
    const identityGap = initial.evidenceGaps.find((item) => (
      item.kind === "OFFICIAL_IDENTITY_NOT_VERIFIED"
    ))!;
    const result = verifyResearchEvidence({
      mission,
      sources: [incompleteSource, targetSource],
      citationRelation: documentedCitation,
      researchSuggestions: [{
        kind: "MISSING_SOURCE_FAMILY",
        description: "Acquire and verify the missing document classification.",
        rationale: "The official source is verified but cannot yet be classified as an authority candidate.",
        originatingGapId: identityGap.gapId,
        evidenceSourceId: "evidence-source-a",
        reviewedByActorId: "legal-reviewer-a",
        reviewedAt: "2026-09-26T11:00:00.000Z",
      }],
    });

    expect(result.legalResearchSuggestions).toEqual([
      expect.objectContaining({
        classification: "RESEARCH_ACTION_NOT_LEGAL_CONCLUSION",
        rationale: expect.stringContaining("cannot yet be classified"),
        reviewedByActorId: "legal-reviewer-a",
        evidenceSourceIds: ["evidence-source-a"],
      }),
    ]);

    const withoutProof = verifyResearchEvidence({
      mission,
      sources: [incompleteSource, targetSource],
      citationRelation: documentedCitation,
      researchSuggestions: [{
        kind: "MISSING_SOURCE_FAMILY",
        description: "Acquire and verify the missing document classification.",
        rationale: "This suggestion points to a source without verified full text and must be rejected.",
        originatingGapId: identityGap.gapId,
        evidenceSourceId: "evidence-source-b",
        reviewedByActorId: "legal-reviewer-a",
        reviewedAt: "2026-09-26T11:00:00.000Z",
      }],
    });
    expect(withoutProof.legalResearchSuggestions).toEqual([]);
  });
});
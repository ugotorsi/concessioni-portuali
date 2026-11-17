import { describe, expect, it } from "vitest";

import {
  buildInitialVerificationCommand,
  canSubmitLegalReview,
  reviewerRequirements,
  type ReviewerVerification,
} from "@/components/legal-research/reviewer-view-model";
import { createAssistedVerificationSnapshot } from "@/server/legal-research/assisted-verification";

function verification(complete: boolean): ReviewerVerification {
  const source = {
    evidenceSourceId: "source-a",
    authorityId: "authority-a",
    legalSourceId: "legal-source-a",
    legalExpressionVersionId: "expression-a",
    officialIdentifier: "ECLI:EU:C:2024:1",
    sourceUrl: "https://official.example.test/authority-a",
    providerId: "OFFICIAL_SOURCE",
    accessStatus: "CONSULTABLE" as const,
    identityVerificationStatus: "VERIFIED" as const,
    reviewerAttestation: {
      reviewedByActorId: "legal-user-a",
      reviewedAt: "2026-09-26T09:00:00.000Z",
      rationale: "Official identity and source content checked by the legal reviewer.",
    },
    termsOfUse: {
      status: "PERMITTED" as const,
      basis: "Official terms",
      checkedAt: "2026-09-26T09:00:00.000Z",
    },
    fullText: { available: true, contentSha256: "c".repeat(64) },
  };
  return {
    recordId: "reviewed-record-a",
    snapshot: createAssistedVerificationSnapshot({
      missionId: `research-mission:${"a".repeat(64)}`,
      sources: complete ? [source] : [],
      citationRelation: complete ? {
        sourceAuthorityId: "authority-a",
        targetAuthorityId: "authority-b",
        evidenceSourceId: "source-a",
        documented: true,
        locator: { paragraph: "42" },
      } : undefined,
    }),
    result: {
      authorityCandidates: [],
      verifiedFullTexts: complete ? [{
        evidenceSourceId: "source-a",
        authorityId: "authority-a",
        legalSourceId: "legal-source-a",
        legalExpressionVersionId: "expression-a",
        officialIdentifier: "ECLI:EU:C:2024:1",
        sourceUrl: source.sourceUrl,
        providerId: source.providerId,
        contentSha256: "c".repeat(64),
        termsOfUseBasis: "Official terms",
        termsCheckedAt: "2026-09-26T09:00:00.000Z",
      }] : [],
      citationObservations: complete ? [{
        kind: "CITATION_OBSERVATION",
        id: "observation-a",
        relation: "CITES",
        sourceAuthorityId: "authority-a",
        targetAuthorityId: "authority-b",
        provenance: { evidenceSourceId: "source-a", observationMethod: "HUMAN_OBSERVATION" },
      }] : [],
      adverseAssessments: [],
      legalResearchSuggestions: [],
      evidenceGaps: complete ? [] : [{ gapId: "gap-a", kind: "FULL_TEXT_NOT_VERIFIED" }],
      adverseAuthorityVerified: false,
    },
    preClaimStatus: {
      satisfied: false,
      unmetRequirements: complete ? ["CAPABILITY_ADVERSE_AUTHORITY_DISCOVERY_MISSING"] : [
        "FULL_TEXT_UNVERIFIED",
        "EVIDENCE_GAPS_REMAIN",
      ],
    },
    fingerprint: "b".repeat(64),
    recordedByActorId: "legal-user-a",
    createdAt: "2026-09-26T10:00:00.000Z",
  };
}

describe("legal reviewer view model", () => {
  it("shows completed negative research separately from a verified adverse authority", () => {
    const reviewed = verification(false);
    const requirements = reviewerRequirements({ ...reviewed, result: { ...reviewed.result,
      adverseSearchCompleted: true, adverseSearchState: "COMPLETED_NO_ADVERSE_FOUND", adverseAuthorityVerified: false,
    } });
    expect(requirements.find(requirement => requirement.id === "ADVERSE_SEARCH")).toMatchObject({ satisfied: true, detail: expect.stringContaining("perimetro revisionato") });
    expect(requirements.find(requirement => requirement.id === "ADVERSE_AUTHORITY")?.satisfied).toBe(false);
    expect(requirements.find(requirement => requirement.id === "PRE_CLAIM")?.satisfied).toBe(false);
  });
  const sourceDraft = {
    evidenceSourceId: "source-a",
    authorityId: "authority-a",
    legalSourceId: "legal-source-a",
    legalExpressionVersionId: "expression-a",
    officialIdentifier: "ECLI:EU:C:2024:1",
    sourceUrl: "https://official.example.test/authority-a",
    sourceFamily: "CJEU" as const,
    courtOrBody: "Court of Justice of the European Union",
    documentType: "Judgment",
    contentSha256: "c".repeat(64),
    termsOfUseBasis: "Official public-access terms checked.",
    verificationRationale: "Identity and full text matched the official publication.",
  };

  it("builds a documented relation without client-controlled verification metadata", () => {
    const command = buildInitialVerificationCommand({
      missionId: `research-mission:${"a".repeat(64)}`,
      source: sourceDraft,
      includeCitationRelation: true,
      targetSource: {
        ...sourceDraft,
        evidenceSourceId: "source-b",
        authorityId: "authority-b",
        legalSourceId: "legal-source-b",
        legalExpressionVersionId: "expression-b",
        officialIdentifier: "ECLI:EU:C:2020:2",
        sourceUrl: "https://official.example.test/authority-b",
      },
      citationParagraph: "42",
    });

    expect(command).toMatchObject({
      sources: [{ evidenceSourceId: "source-a" }, { evidenceSourceId: "source-b" }],
      citationRelation: {
        sourceAuthorityId: "authority-a",
        targetAuthorityId: "authority-b",
        evidenceSourceId: "source-a",
        locator: { paragraph: "42" },
      },
    });
    expect(JSON.stringify(command)).not.toMatch(/reviewedByActorId|reviewedAt|tenantId|documented/);
  });

  it("keeps an undocumented relation out of the bootstrap command", () => {
    const command = buildInitialVerificationCommand({
      missionId: `research-mission:${"a".repeat(64)}`,
      source: sourceDraft,
      includeCitationRelation: false,
      targetSource: { ...sourceDraft, evidenceSourceId: "", authorityId: "" },
      citationParagraph: "",
    });

    expect(command).not.toHaveProperty("citationRelation");
  });

  it("rejects an incomplete official source before submission", () => {
    expect(buildInitialVerificationCommand({
      missionId: `research-mission:${"a".repeat(64)}`,
      source: { ...sourceDraft, contentSha256: "" },
      includeCitationRelation: false,
      targetSource: sourceDraft,
      citationParagraph: "",
    })).toBeNull();
  });

  it("keeps incomplete evidence visibly unsatisfied and non-submittable", () => {
    const current = verification(false);

    expect(reviewerRequirements(current).filter((item) => !item.satisfied).map((item) => item.id))
      .toEqual(["FULL_TEXT", "CITATION", "SUGGESTIONS", "HUMAN_REVIEW", "ADVERSE_SEARCH", "ADVERSE_AUTHORITY", "GAPS", "PRE_CLAIM"]);
    expect(canSubmitLegalReview(current, {
      legalPropositionId: "proposition-a",
      evidenceSourceId: "source-a",
      rationale: "Reasoned review",
    })).toBe(false);
  });

  it("enables review only for the documented relation source", () => {
    const current = verification(true);

    expect(canSubmitLegalReview(current, {
      legalPropositionId: "proposition-a",
      evidenceSourceId: "source-a",
      rationale: "Reasoned review",
    })).toBe(true);
    expect(canSubmitLegalReview(current, {
      legalPropositionId: "proposition-a",
      evidenceSourceId: "source-b",
      rationale: "Reasoned review",
    })).toBe(false);
  });

  it("never represents a human review as pre-claim completion", () => {
    const requirements = reviewerRequirements(verification(true));

    expect(requirements.find((item) => item.id === "PRE_CLAIM")).toMatchObject({
      satisfied: false,
    });
  });
});
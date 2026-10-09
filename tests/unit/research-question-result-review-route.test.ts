import { describe, expect, it, vi } from "vitest";

import type { CurrentTenantContext } from "@/lib/tenant-auth";
import {
  createQuestionResultReviewRouteHandlers,
  type QuestionResultReviewRouteDependencies,
} from "@/server/legal-research/question-result-review-route";
import type {
  ResearchQuestionResultReviewItem,
  ResearchQuestionResultSnapshot,
} from "@/server/legal-research/question-results";

function tenantContext(role: CurrentTenantContext["role"]): CurrentTenantContext {
  return {
    userId: "reviewer-1",
    role,
    isAdmin: role === "ADMIN",
    tenantMemberships: [],
    defaultTenantId: "tenant-1",
    accessibleTenantIds: ["tenant-1"],
  };
}

function reviewedSnapshot(): ResearchQuestionResultSnapshot {
  return {
    id: "result-1",
    tenantId: "tenant-1",
    caseId: "case-1",
    missionId: "mission-1",
    bundleId: "bundle-1",
    candidateId: "candidate-1",
    legalIssueSemanticKey: "i".repeat(64),
    researchQuestionSemanticKey: "q".repeat(64),
    missionFingerprint: "f".repeat(64),
    candidateSnapshot: {
      kind: "AUTHORITY_CANDIDATE",
      candidateId: "candidate-1",
      executionRecordId: "execution-1",
      toolId: "tool-1",
      title: "Fonte verificata",
      supportDirection: "UNKNOWN",
      sourceFamily: "ITALIAN_LEGISLATION",
      retrievalMethod: "EXACT_RETRIEVAL",
      fullTextAvailable: true,
      verificationState: "OFFICIALLY_VERIFIED",
    },
    supportDirection: "SUPPORTS",
    classificationSource: "HUMAN_REVIEW",
    classificationConfidence: null,
    classificationRationale: "La disposizione sostiene il punto controverso.",
    classificationReviewStatus: "HUMAN_CONFIRMED",
    coverageElementKeys: [],
    unresolvedAspectKeys: [],
  };
}

const reviewItem: ResearchQuestionResultReviewItem = {
  resultId: "result-1",
  missionId: "mission-1",
  title: "Fonte verificata",
  sourceUrl: "https://example.test/source",
  supportDirection: "SUPPORTS",
  classificationReviewStatus: "HUMAN_CONFIRMED",
  classificationRationale: "La disposizione sostiene il punto controverso.",
  sourceUsable: true,
};

function request(body: unknown): Request {
  return new Request("https://app.example.test/api/legal-research/question-results/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(role: CurrentTenantContext["role"]) {
  const review = vi.fn(async () => reviewedSnapshot());
  const list = vi.fn(async () => [reviewItem]);
  const values: QuestionResultReviewRouteDependencies = {
    getCurrentTenantContext: async () => tenantContext(role),
    reviewResearchQuestionResult: review,
    listResearchQuestionResultsForReview: list,
  };
  return { values, review, list };
}

describe("research question result review route", () => {
  it("records an explicit authorized human classification without archiving a report", async () => {
    const deps = dependencies("GIURIDICO");
    const response = await createQuestionResultReviewRouteHandlers(deps.values).POST(request({
      missionId: "mission-1",
      resultId: "result-1",
      direction: "SUPPORTS",
      rationale: "La disposizione sostiene il punto controverso.",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: reviewItem });
    expect(deps.review).toHaveBeenCalledWith({
      missionId: "mission-1",
      resultId: "result-1",
      tenantId: "tenant-1",
      direction: "SUPPORTS",
      reviewStatus: "HUMAN_CONFIRMED",
      confidence: null,
      rationale: "La disposizione sostiene il punto controverso.",
    });
    expect(deps.list).toHaveBeenCalledTimes(1);
  });

  it("denies a role that cannot validate reports", async () => {
    const deps = dependencies("OPERATORE_SOCIETA");
    const response = await createQuestionResultReviewRouteHandlers(deps.values).POST(request({
      missionId: "mission-1",
      resultId: "result-1",
      direction: "OPPOSES",
      rationale: "La disposizione contraddice il punto controverso.",
    }));

    expect(response.status).toBe(403);
    expect(deps.review).not.toHaveBeenCalled();
    expect(deps.list).not.toHaveBeenCalled();
  });

  it("requires a substantive rationale", async () => {
    const deps = dependencies("ADMIN");
    const response = await createQuestionResultReviewRouteHandlers(deps.values).POST(request({
      missionId: "mission-1",
      resultId: "result-1",
      direction: "NEUTRAL",
      rationale: "Troppo breve",
    }));

    expect(response.status).toBe(400);
    expect(deps.review).not.toHaveBeenCalled();
  });
});

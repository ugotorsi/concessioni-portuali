import { describe, expect, it } from "vitest";

import { assessLegalCompleteness } from "@/server/fascicolo-knowledge/legalCompleteness";
import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

function item(id: string, kind: StructuredKnowledgeReadItem["kind"]): StructuredKnowledgeReadItem {
  return {
    id,
    kind,
    semanticKey: id,
    contentFingerprint: id,
    normalizedText: id,
    payload: {},
    confidence: 90,
    status: "AI_PROPOSED",
    reviewVersion: 0,
    evidence: [],
  };
}

describe("legal completeness assessment", () => {
  it("distinguishes documents with no emerging issue", () => {
    expect(assessLegalCompleteness({
      legalActs: [],
      measures: [],
      contradictions: [],
      gaps: [],
      legalIssues: [],
      researchQuestions: [],
    })).toMatchObject({
      issueCoverage: "NO_ISSUES_EMERGE_FROM_DOCUMENTS",
      documentNeed: "NO_ADDITIONAL_DOCUMENT_NEED_IDENTIFIED",
      researchNeed: "NO_RESEARCH_NEED_IDENTIFIED",
    });
  });

  it("flags documented signals that were not structured as legal issues", () => {
    const assessment = assessLegalCompleteness({
      legalActs: [item("act-1", "LEGAL_ACT")],
      measures: [],
      contradictions: [{ ...item("contradiction-1", "CONTRADICTION"), contradictedItemIds: [] }],
      gaps: [item("gap-1", "GAP")],
      legalIssues: [],
      researchQuestions: [],
    });

    expect(assessment).toEqual({
      issueCoverage: "DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES",
      documentNeed: "ADDITIONAL_DOCUMENTS_REQUIRED",
      researchNeed: "ASSESSMENT_REQUIRED_BEFORE_RESEARCH",
      signalItemIds: ["act-1", "contradiction-1", "gap-1"],
      gapItemIds: ["gap-1"],
      reasonCodes: [
        "ADDITIONAL_DOCUMENTS_REQUIRED",
        "ASSESSMENT_REQUIRED_BEFORE_RESEARCH",
        "DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES",
      ],
    });
  });

  it("separates structured issues from missing research questions", () => {
    expect(assessLegalCompleteness({
      legalActs: [],
      measures: [],
      contradictions: [],
      gaps: [],
      legalIssues: [{ ...item("issue-1", "LEGAL_ISSUE"), originatingItemIds: [] }],
      researchQuestions: [],
    })).toMatchObject({
      issueCoverage: "DOCUMENTED_ISSUES_STRUCTURED",
      documentNeed: "NO_ADDITIONAL_DOCUMENT_NEED_IDENTIFIED",
      researchNeed: "RESEARCH_QUESTIONS_NOT_STRUCTURED",
    });
  });
});

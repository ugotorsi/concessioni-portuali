import type { StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

export type LegalIssueCoverage =
  | "DOCUMENTED_ISSUES_STRUCTURED"
  | "NO_ISSUES_EMERGE_FROM_DOCUMENTS"
  | "DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES";

export type LegalDocumentNeed =
  | "NO_ADDITIONAL_DOCUMENT_NEED_IDENTIFIED"
  | "ADDITIONAL_DOCUMENTS_REQUIRED";

export type LegalResearchNeed =
  | "RESEARCH_QUESTIONS_STRUCTURED"
  | "RESEARCH_QUESTIONS_NOT_STRUCTURED"
  | "ASSESSMENT_REQUIRED_BEFORE_RESEARCH"
  | "NO_RESEARCH_NEED_IDENTIFIED";

export interface LegalCompletenessAssessment {
  issueCoverage: LegalIssueCoverage;
  documentNeed: LegalDocumentNeed;
  researchNeed: LegalResearchNeed;
  signalItemIds: readonly string[];
  gapItemIds: readonly string[];
  reasonCodes: readonly string[];
}

export function assessLegalCompleteness(
  knowledge: Pick<
    StructuredKnowledgeReadModel,
    "legalActs" | "measures" | "contradictions" | "gaps" | "legalIssues" | "researchQuestions"
  >,
): LegalCompletenessAssessment {
  const signalItems = [
    ...knowledge.legalActs,
    ...knowledge.measures,
    ...knowledge.contradictions,
    ...knowledge.gaps,
  ].filter((item) => item.status !== "REJECTED");
  const legalIssues = knowledge.legalIssues.filter((item) => item.status !== "REJECTED");
  const researchQuestions = knowledge.researchQuestions.filter((item) => item.status !== "REJECTED");
  const gaps = knowledge.gaps.filter((item) => item.status !== "REJECTED");

  const issueCoverage: LegalIssueCoverage = legalIssues.length > 0
    ? "DOCUMENTED_ISSUES_STRUCTURED"
    : signalItems.length > 0
      ? "DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES"
      : "NO_ISSUES_EMERGE_FROM_DOCUMENTS";
  const documentNeed: LegalDocumentNeed = gaps.length > 0
    ? "ADDITIONAL_DOCUMENTS_REQUIRED"
    : "NO_ADDITIONAL_DOCUMENT_NEED_IDENTIFIED";
  const researchNeed: LegalResearchNeed = legalIssues.length > 0
    ? researchQuestions.length > 0
      ? "RESEARCH_QUESTIONS_STRUCTURED"
      : "RESEARCH_QUESTIONS_NOT_STRUCTURED"
    : signalItems.length > 0
      ? "ASSESSMENT_REQUIRED_BEFORE_RESEARCH"
      : "NO_RESEARCH_NEED_IDENTIFIED";

  return {
    issueCoverage,
    documentNeed,
    researchNeed,
    signalItemIds: [...new Set(signalItems.map((item) => item.id))].sort(),
    gapItemIds: gaps.map((item) => item.id).sort(),
    reasonCodes: [
      issueCoverage,
      documentNeed,
      researchNeed,
    ].sort(),
  };
}

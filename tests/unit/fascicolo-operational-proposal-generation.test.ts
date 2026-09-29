import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateOperationalProposalCandidates,
  operationalProposalCandidateSchema,
} from "@/server/fascicolo-operational-proposals";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function item(id: string, kind: string, payload: Record<string, unknown>) {
  return {
    id, kind, semanticKey: sha(id), contentFingerprint: sha(`${id}x`), normalizedText: `Testo ${id}`,
    payload, confidence: 80, status: "HUMAN_CONFIRMED" as const, reviewVersion: 1,
    evidence: [{ basisRef: "DOCUMENT_1.PAGE_1", documentoId: "document-1", documentFileVersionId: "version-1", pageNumber: 1, textSha256: sha("e") }],
  };
}

function report(): StructuredFascicoloReportPayload {
  const deadline = item("deadline-1", "DEADLINE_CANDIDATE", {
    resultingDate: { precision: "EXACT", from: "2026-10-31", to: null, originalText: null, confidence: 90 },
    ruleText: "Entro trenta giorni", calculationExplanation: "Data base più trenta giorni",
  });
  const gap = item("gap-1", "GAP", { gapType: "MISSING_DOCUMENT", description: "Titolo mancante", impact: "Verifica impedita" });
  const contradiction = { ...item("contradiction-1", "CONTRADICTION", { description: "Versioni incompatibili" }), contradictedItemIds: ["fact-1", "fact-2"] };
  return {
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1",
    tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1",
    knowledgeContractVersion: "FASCICOLO_KNOWLEDGE_V1", corpusFingerprint: sha("c"),
    knowledgeStateFingerprint: sha("k"), researchStateFingerprint: sha("r"), sourceStateFingerprint: sha("s"),
    documentedFramework: { partyRoles: [], facts: [], timeline: [], legalActs: [], measures: [], contradictions: [contradiction as never] },
    legalIssues: [{
      knowledgeItemId: "issue-1", semanticKey: sha("i"), text: "Questione", reviewStatus: "HUMAN_CONFIRMED",
      originatingItemIds: [gap.id, contradiction.id],
      questions: [{
        knowledgeItemId: "question-1", semanticKey: sha("q"), text: "Quale disciplina?", reviewStatus: "HUMAN_CONFIRMED",
        missionId: "mission-1", missionStatus: "COMPLETED", coverageStatus: "PARTIAL",
        favorableAuthorities: [], contraryAuthorities: [], nonUsableResults: [{ resultId: "result-1", title: "Fonte incompleta", direction: "SUPPORTS", reasons: ["MISSING_FULL_TEXT"] }],
        gaps: ["NO_USABLE_SOURCE"], limitations: [],
      }],
    }],
    unassignedQuestions: [], gaps: [gap as never], deadlineCandidates: [deadline as never], limitations: [],
  };
}

function generate(value = report()) {
  return generateOperationalProposalCandidates({
    tenantId: "tenant-1", procedimentoId: "procedure-1", structuredReportId: "report-1",
    structuredReportFingerprint: sha("p"), report: value,
  });
}

describe("Lotto 7 operational proposal generation", () => {
  it("derives deadline, document requirement, contradiction and source-gap proposals with structured origins", () => {
    const candidates = generate();
    expect(candidates.map((candidate) => candidate.proposalType).sort()).toEqual([
      "CRITICALITY", "CRITICALITY", "DEADLINE", "DOCUMENT_REQUIREMENT",
    ]);
    expect(candidates.find((candidate) => candidate.proposalType === "DEADLINE")?.proposedPayload).toMatchObject({
      dueDate: "2026-10-31", dueDatePrecision: "EXACT", sourceDeadlineCandidateId: "deadline-1",
    });
    expect(candidates.every((candidate) => operationalProposalCandidateSchema.safeParse(candidate).success)).toBe(true);
    expect(candidates.every((candidate) => candidate.originatingKnowledgeItemIds.length
      + candidate.originatingIssueSemanticKeys.length + candidate.originatingQuestionSemanticKeys.length
      + candidate.relevantResultIds.length > 0)).toBe(true);
  });

  it("has stable fingerprints, changes on material payload change, and rejects originless candidates", () => {
    const first = generate();
    const second = generate();
    expect(second.map((candidate) => candidate.proposalFingerprint)).toEqual(first.map((candidate) => candidate.proposalFingerprint));
    const changedReport = report();
    changedReport.deadlineCandidates[0].payload = { ...changedReport.deadlineCandidates[0].payload as object, ruleText: "Regola cambiata" } as never;
    expect(generate(changedReport).find((candidate) => candidate.proposalType === "DEADLINE")?.proposalFingerprint)
      .not.toBe(first.find((candidate) => candidate.proposalType === "DEADLINE")?.proposalFingerprint);
    expect(operationalProposalCandidateSchema.safeParse({
      ...first[0], originatingKnowledgeItemIds: [], originatingIssueSemanticKeys: [],
      originatingQuestionSemanticKeys: [], relevantResultIds: [],
    }).success).toBe(false);
  });

  it("does not generate operational proposals without supported structured origins", () => {
    const empty = report();
    empty.deadlineCandidates = [];
    empty.gaps = [];
    empty.documentedFramework.contradictions = [];
    empty.legalIssues = [];
    expect(generate(empty)).toEqual([]);
  });
});
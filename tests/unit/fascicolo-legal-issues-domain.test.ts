import { describe, expect, it } from "vitest";

import {
  fascicoloStructuredKnowledgeSchema,
  projectStructuredKnowledge,
  type KnowledgeEvidenceCandidate,
} from "@/server/fascicolo-knowledge";

const evidence: KnowledgeEvidenceCandidate = {
  provenanceType: "DOCUMENT_EXTRACTION",
  documentoId: "document-1",
  documentFileVersionId: "version-1",
  extractionAttemptId: "attempt-1",
  pageNumber: 1,
  textSha256: "a".repeat(64),
  quoteSha256: null,
  basisRef: "DOCUMENT_1.PAGE_1",
};

function knowledge(factQualifier: string | null = null) {
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1" as const,
    subjects: [],
    items: [
      {
        localId: "fact-1", kind: "FACT" as const, confidence: 90, basisRefs: [evidence.basisRef],
        payload: { normalizedStatement: "La concessione scade il 31 dicembre", subjectLocalIds: [], object: null, qualifier: factQualifier },
      },
      {
        localId: "event-1", kind: "EVENT" as const, confidence: 90, basisRefs: [evidence.basisRef],
        payload: { title: "Istanza", normalizedStatement: "Istanza presentata", date: { precision: "EXACT" as const, from: "2026-09-01", to: null, originalText: null, confidence: 100 }, subjectLocalIds: [], relatedItemLocalIds: [] },
      },
      {
        localId: "measure-1", kind: "MEASURE" as const, confidence: 90, basisRefs: [evidence.basisRef],
        payload: { documentBasisRef: evidence.basisRef, actType: "decreto", authoritySubjectLocalId: null, number: "7", date: { precision: "EXACT" as const, from: "2026-08-25", to: null, originalText: null, confidence: 100 }, title: "Decreto 7", declaredEffects: [] },
      },
      {
        localId: "gap-1", kind: "GAP" as const, confidence: 70, basisRefs: [evidence.basisRef],
        payload: { gapType: "MISSING_DOCUMENT", description: "Manca la notifica", impact: "Decorrenza incerta", relatedItemLocalIds: [] },
      },
      {
        localId: "contradiction-1", kind: "CONTRADICTION" as const, confidence: 70, basisRefs: [evidence.basisRef],
        payload: { description: "Date incompatibili", conflictingItemLocalIds: ["fact-1", "measure-1"] },
      },
    ],
    legalIssues: [
      { localId: "issue-fact", title: "Durata della concessione", normalizedIssue: "disciplina della durata", areaOfLaw: "demanio", priority: "HIGH" as const, rationale: "La scadenza richiede qualificazione", originatingItemLocalIds: ["fact-1"], confidence: 90, referenceDateBasis: null },
      { localId: "issue-measure", title: "Efficacia del decreto", normalizedIssue: "efficacia del decreto", areaOfLaw: "amministrativo", priority: "MEDIUM" as const, rationale: "Occorre verificare gli effetti", originatingItemLocalIds: ["measure-1"], confidence: 80, referenceDateBasis: null },
      { localId: "issue-record", title: "Decorrenza incerta", normalizedIssue: "decorrenza in presenza di lacune e contraddizioni", areaOfLaw: null, priority: "LOW" as const, rationale: "Il fascicolo non consente una data certa", originatingItemLocalIds: ["gap-1", "contradiction-1"], confidence: 70, referenceDateBasis: null },
    ],
    researchQuestions: [{
      localId: "question-1",
      legalIssueLocalId: "issue-fact",
      canonicalQuestion: "Quale disciplina regola la durata della concessione?",
      priority: "HIGH" as const,
      referenceDate: "2026-09-01",
      referenceDateBasis: { type: "EVENT_DATE" as const, itemLocalId: "event-1", rationale: "Data dell'istanza documentata" },
      requestedCapabilities: ["SEMANTIC_DISCOVERY" as const],
      mode: "PRIMARY" as const,
    }],
  };
}

function project(value = knowledge()) {
  return projectStructuredKnowledge({
    knowledge: fascicoloStructuredKnowledgeSchema.parse(value),
    subjectIdsByLocalId: new Map(),
    evidenceByBasisRef: new Map([[evidence.basisRef, evidence]]),
  });
}

describe("Lotto 3 legal issue and research question domain", () => {
  it("projects issues from FACT, MEASURE, GAP and CONTRADICTION with traceable evidence", () => {
    const result = project();
    const issues = result.candidates.filter((candidate) => candidate.kind === "LEGAL_ISSUE");
    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.evidence[0].documentoId === "document-1")).toBe(true);
    expect(result.relations.filter((relation) => relation.relationType === "ISSUE_DERIVED_FROM")).toHaveLength(4);
  });

  it("rejects orphan issues and questions referencing unknown issues", () => {
    const orphan = knowledge();
    orphan.legalIssues[0].originatingItemLocalIds = [];
    expect(fascicoloStructuredKnowledgeSchema.safeParse(orphan).success).toBe(false);
    const unknownIssue = knowledge();
    unknownIssue.researchQuestions[0].legalIssueLocalId = "missing-issue";
    expect(fascicoloStructuredKnowledgeSchema.safeParse(unknownIssue).success).toBe(false);
  });

  it("links a research question to its issue and explicit EVENT reference-date basis", () => {
    const result = project();
    const question = result.candidates.find((candidate) => candidate.kind === "RESEARCH_QUESTION")!;
    expect(question.structuredPayload).toMatchObject({
      referenceDate: "2026-09-01",
      referenceDateBasis: { type: "EVENT_DATE", rationale: "Data dell'istanza documentata" },
      mode: "PRIMARY",
    });
    expect(result.relations).toContainEqual(expect.objectContaining({ relationType: "QUESTION_FOR_ISSUE" }));
  });

  it("keeps issue and question semantic keys stable when material originating content changes", () => {
    const first = project(knowledge("prima qualificazione"));
    const second = project(knowledge("qualificazione aggiornata"));
    const key = (result: ReturnType<typeof projectStructuredKnowledge>, kind: string) => result.candidates.find((candidate) => candidate.kind === kind)!.semanticKey;
    expect(key(second, "LEGAL_ISSUE")).toBe(key(first, "LEGAL_ISSUE"));
    expect(key(second, "RESEARCH_QUESTION")).toBe(key(first, "RESEARCH_QUESTION"));
    const firstFact = first.candidates.find((candidate) => candidate.kind === "FACT")!;
    const secondFact = second.candidates.find((candidate) => candidate.kind === "FACT")!;
    expect(secondFact.contentFingerprint).not.toBe(firstFact.contentFingerprint);
  });
});

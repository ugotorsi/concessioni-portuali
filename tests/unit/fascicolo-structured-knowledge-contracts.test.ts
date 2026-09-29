import { describe, expect, it } from "vitest";

import { providerAnalysisPayloadV1Schema } from "@/server/ai/fascicoloAnalysis";
import {
  fascicoloStructuredKnowledgeSchema,
  knowledgeEvidenceCandidateSchema,
  lot2KnowledgeKinds,
  structuredDateSchema,
} from "@/server/fascicolo-knowledge";

const baseAnalysis = {
  summary: { text: "Sintesi documentata.", basisRefs: ["DOCUMENT_1.PAGE_1"] },
  timeline: [],
  recordedState: [],
  signals: [],
  investigativeQuestions: [],
  suggestedActivities: [],
  legalResearchQuestions: [],
};

function item(kind: typeof lot2KnowledgeKinds[number], index: number) {
  const common = { localId: `item-${index}`, kind, confidence: 80, basisRefs: ["DOCUMENT_1.PAGE_1"] };
  switch (kind) {
    case "PARTY_ROLE": return { ...common, payload: { subjectLocalId: "subject-1", role: "richiedente", context: null } };
    case "FACT": return { ...common, payload: { normalizedStatement: "Fatto documentato", subjectLocalIds: ["subject-1"], object: null, qualifier: null } };
    case "EVENT": return { ...common, payload: { title: "Evento", normalizedStatement: "Evento documentato", date: { precision: "EXACT", from: "2026-09-29", to: null, originalText: null, confidence: 90 }, subjectLocalIds: [], relatedItemLocalIds: [] } };
    case "LEGAL_ACT":
    case "MEASURE": return { ...common, payload: { documentBasisRef: "DOCUMENT_1.PAGE_1", actType: "decreto", authoritySubjectLocalId: "subject-1", number: "1", date: { precision: "YEAR", from: "2026", to: null, originalText: null, confidence: 70 }, title: "Decreto 1", declaredEffects: [] } };
    case "CONTRADICTION": return { ...common, payload: { description: "Due fatti incompatibili", conflictingItemLocalIds: ["item-1", "item-2"] } };
    case "GAP": return { ...common, payload: { gapType: "MISSING_DOCUMENT", description: "Documento mancante", impact: "Data non verificabile", relatedItemLocalIds: [] } };
    case "DEADLINE_CANDIDATE": return { ...common, payload: { deadlineType: "SUSPECTED_TERM", baseDate: null, resultingDate: null, ruleText: "Termine da verificare", calculationExplanation: null } };
  }
}

function validKnowledge() {
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
    subjects: [{
      localId: "subject-1",
      canonicalName: "Autorita Portuale",
      subjectType: "AUTHORITY",
      strongIdentifiers: [{ type: "PEC", value: "protocollo@pec.example" }],
      aliases: ["AdSP"],
    }],
    items: lot2KnowledgeKinds.map(item),
  };
}

describe("Lotto 2 structured knowledge contracts", () => {
  it("rejects incomplete document extraction provenance", () => {
    const complete = {
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      extractionAttemptId: "attempt-1",
      pageNumber: 1,
      textSha256: "a".repeat(64),
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    };
    expect(knowledgeEvidenceCandidateSchema.safeParse(complete).success).toBe(true);
    expect(knowledgeEvidenceCandidateSchema.safeParse({ ...complete, documentFileVersionId: undefined }).success).toBe(false);
    expect(knowledgeEvidenceCandidateSchema.safeParse({ ...complete, extractionAttemptId: undefined }).success).toBe(false);
  });

  it("rejects malformed document basis references", () => {
    const malformed = validKnowledge();
    malformed.items[0].basisRefs = ["DOCUMENT_1.PAGE_ONE"];
    expect(fascicoloStructuredKnowledgeSchema.safeParse(malformed).success).toBe(false);
  });

  it("keeps structured knowledge optional for backward-compatible provider output", () => {
    expect(providerAnalysisPayloadV1Schema.parse(baseAnalysis)).toEqual(baseAnalysis);
  });

  it("accepts every Lotto 2 category in the optional strict provider section", () => {
    const parsed = providerAnalysisPayloadV1Schema.parse({
      ...baseAnalysis,
      structuredKnowledge: validKnowledge(),
    });
    expect(parsed.structuredKnowledge?.items.map((entry) => entry.kind)).toEqual(lot2KnowledgeKinds);
  });

  it("rejects unknown fields, duplicate local identities, and unknown subjects", () => {
    expect(fascicoloStructuredKnowledgeSchema.safeParse({ ...validKnowledge(), unexpected: true }).success).toBe(false);
    const duplicate = validKnowledge();
    duplicate.items[1].localId = duplicate.items[0].localId;
    expect(fascicoloStructuredKnowledgeSchema.safeParse(duplicate).success).toBe(false);
    const unknownSubject = validKnowledge();
    const fact = unknownSubject.items.find((entry) => entry.kind === "FACT")!;
    if (fact.kind === "FACT") fact.payload.subjectLocalIds = ["unknown-subject"];
    expect(fascicoloStructuredKnowledgeSchema.safeParse(unknownSubject).success).toBe(false);
  });

  it("represents exact, partial, interval, uncertain, and unknown dates without inventing precision", () => {
    const values = [
      { precision: "EXACT", from: "2026-09-29", to: null, originalText: null, confidence: 100 },
      { precision: "MONTH", from: "2026-09", to: null, originalText: "settembre 2026", confidence: 80 },
      { precision: "YEAR", from: "2026", to: null, originalText: "nel 2026", confidence: 70 },
      { precision: "INTERVAL", from: "2026-09-01", to: "2026-09-30", originalText: null, confidence: 60 },
      { precision: "UNCERTAIN", from: null, to: null, originalText: "forse a settembre", confidence: 30 },
      { precision: "UNKNOWN", from: null, to: null, originalText: null, confidence: null },
    ];
    expect(values.every((value) => structuredDateSchema.safeParse(value).success)).toBe(true);
    expect(structuredDateSchema.safeParse({
      precision: "INTERVAL", from: "2026-10-01", to: "2026-09-01", originalText: null, confidence: 50,
    }).success).toBe(false);
    expect(structuredDateSchema.safeParse({
      precision: "EXACT", from: "settembre 2026", to: null, originalText: null, confidence: 50,
    }).success).toBe(false);
  });
});

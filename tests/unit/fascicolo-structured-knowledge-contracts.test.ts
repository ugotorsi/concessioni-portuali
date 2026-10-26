import { describe, expect, it } from "vitest";

import { providerAnalysisPayloadV1Schema } from "@/server/ai/fascicoloAnalysis";
import {
  fascicoloStructuredKnowledgeSchema,
  fascicoloDocumentStructuredKnowledgeSchema,
  structuredKnowledgeValidationCode,
  knowledgeEvidenceCandidateSchema,
  lot2KnowledgeKinds,
  structuredDateSchema,
} from "@/server/fascicolo-knowledge";
import {
  canonicalKnowledgeIdentitySchema,
  knowledgeSourceSpanSchema,
  persistedKnowledgeIdentitySchema,
} from "@/server/fascicolo-knowledge/contracts";

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
    case "PARTY_POSITION": return { ...common, payload: { subjectLocalId: "subject-1", positionType: "DEFENSE", normalizedStatement: "Difesa documentata", context: "controdeduzioni", relatedItemLocalIds: [] } };
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
  const items = lot2KnowledgeKinds.map(item);
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
    subjects: [{
      localId: "subject-1",
      canonicalName: "Autorita Portuale",
      subjectType: "AUTHORITY",
      strongIdentifiers: [{ type: "PEC", value: "protocollo@pec.example" }],
      aliases: ["AdSP"],
    }],
    items,
    sourceQuotes: items.map((candidate) => ({
      itemLocalId: candidate.localId,
      basisRef: "DOCUMENT_1.PAGE_1",
      quote: `Citazione autentica ${candidate.localId}`,
    })),
  };
}

function semanticIssues(knowledge: unknown) {
  const parsed = fascicoloStructuredKnowledgeSchema.safeParse(knowledge);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    code: structuredKnowledgeValidationCode(issue),
    path: issue.path.join("."),
  }));
}

function documentSemanticIssues(knowledge: unknown) {
  const parsed = fascicoloDocumentStructuredKnowledgeSchema.safeParse(knowledge);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    code: structuredKnowledgeValidationCode(issue),
    path: issue.path.join("."),
  }));
}

describe("Lotto 2 structured knowledge contracts", () => {
  it("requires server-verifiable source spans with ordered offsets", () => {
    const span = {
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      pageNumber: 1,
      startOffset: 10,
      endOffset: 24,
      quote: "Testo originale",
      textSha256: "a".repeat(64),
      quoteSha256: "b".repeat(64),
      basisRef: "DOCUMENT_1.PAGE_1",
    };
    expect(knowledgeSourceSpanSchema.safeParse(span).success).toBe(true);
    expect(knowledgeSourceSpanSchema.safeParse({ ...span, endOffset: 10 }).success).toBe(false);
    expect(knowledgeSourceSpanSchema.safeParse({ ...span, quoteSha256: null }).success).toBe(false);
  });

  it("keeps physical versions separate from verified, ambiguous, and legacy identity", () => {
    const sourceSpanFingerprint = "c".repeat(64);
    expect(canonicalKnowledgeIdentitySchema.safeParse({
      id: "identity-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      kind: "FACT",
      createdInRevisionId: "revision-1",
      creationBasis: {
        type: "SERVER_ASSIGNED_NEW",
        sourceSpanFingerprints: [sourceSpanFingerprint],
      },
    }).success).toBe(true);
    expect(persistedKnowledgeIdentitySchema.safeParse({
      physicalItemId: "item-1",
      identityId: "identity-1",
      state: "VERIFIED_NEW",
      basis: null,
    }).success).toBe(true);
    expect(persistedKnowledgeIdentitySchema.safeParse({
      physicalItemId: "item-2",
      identityId: "identity-1",
      state: "VERIFIED_CONTINUATION",
      basis: {
        type: "VERIFIED_SOURCE_SPAN_CONTINUITY",
        predecessorItemId: "item-1",
        predecessorRevisionId: "revision-1",
        sourceSpanFingerprints: [sourceSpanFingerprint],
      },
    }).success).toBe(true);
    expect(persistedKnowledgeIdentitySchema.safeParse({
      physicalItemId: "item-3",
      identityId: null,
      state: "AMBIGUOUS",
      basis: {
        type: "AMBIGUOUS_CONTINUITY",
        candidatePredecessorItemIds: ["item-1", "item-2"],
        reasonCodes: ["MULTIPLE_PREDECESSORS"],
        sourceSpanFingerprints: [sourceSpanFingerprint],
      },
    }).success).toBe(true);
    expect(persistedKnowledgeIdentitySchema.safeParse({
      physicalItemId: "legacy-1",
      identityId: null,
      state: "LEGACY_UNVERIFIED",
      basis: null,
    }).success).toBe(true);
    expect(persistedKnowledgeIdentitySchema.safeParse({
      physicalItemId: "item-4",
      identityId: "identity-1",
      state: "VERIFIED_CONTINUATION",
      basis: null,
    }).success).toBe(false);
  });

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

  it("keeps semantic descriptions separate from validated source quotation candidates", () => {
    const knowledge = validKnowledge();
    expect(fascicoloStructuredKnowledgeSchema.safeParse(knowledge).success).toBe(true);
    expect(fascicoloStructuredKnowledgeSchema.safeParse({
      ...knowledge,
      sourceQuotes: [{
        itemLocalId: "item-1",
        basisRef: "DOCUMENT_2.PAGE_1",
        quote: "Citazione fuori evidenza",
      }],
    }).success).toBe(false);
    const { sourceQuotes: _sourceQuotes, ...legacyKnowledge } = knowledge;
    expect(fascicoloStructuredKnowledgeSchema.parse(legacyKnowledge).sourceQuotes).toEqual([]);
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

  it("accepts documented proceeding identities while preserving legacy payloads", () => {
    const identified = validKnowledge();
    const fact = identified.items.find((entry) => entry.kind === "FACT")!;
    const anchor = identified.items.find((entry) => entry.kind === "LEGAL_ACT")!;
    if (fact.kind !== "FACT") throw new Error("Expected fact fixture.");
    const parsed = fascicoloStructuredKnowledgeSchema.parse({
      ...identified,
      items: identified.items.map((entry) => entry.kind === "FACT" ? {
        ...entry,
        payload: {
          ...entry.payload,
          proceedingIdentity: {
            declaredKey: "administrative-proceeding-a",
            canonicalAnchorLocalId: anchor.localId,
            kind: "ADMINISTRATIVE_ORIGINAL",
            evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
          },
        },
      } : entry),
      legalIssues: [{
        localId: "issue-1",
        title: "Disciplina transitoria",
        normalizedIssue: "Quale disciplina si applica al procedimento A?",
        areaOfLaw: "diritto amministrativo",
        priority: "HIGH",
        rationale: "La questione dipende dallo stato storico del procedimento.",
        originatingItemLocalIds: [fact.localId, anchor.localId],
        confidence: 90,
        referenceDateBasis: null,
        targetProceedingIdentity: {
          declaredKey: "administrative-proceeding-a",
          canonicalAnchorLocalId: anchor.localId,
          kind: "ADMINISTRATIVE_ORIGINAL",
          evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
        },
      }],
    });
    expect(parsed.items.find((entry) => entry.kind === "FACT")?.payload).toMatchObject({
      proceedingIdentity: { canonicalAnchorLocalId: anchor.localId },
    });
    expect(fascicoloStructuredKnowledgeSchema.safeParse(validKnowledge()).success).toBe(true);
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

  it("reports exact safe semantic codes and paths for cross-field violations", () => {
    const base = {
      ...structuredClone(validKnowledge()),
      documentInventory: [{
        localId: "document-1",
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        documentType: "provvedimento",
        documentDate: null,
        issuer: null,
        recipients: [],
        proceduralPhase: null,
        subject: "Atto principale",
        summary: "Documento materiale.",
        referencedActs: [],
        attachments: [],
        materialProfiles: ["LEGAL"],
        classification: "MATERIAL",
        rationale: "Contiene fatti rilevanti.",
        relatedItemLocalIds: ["item-3"],
      }],
      legalIssues: [{
        localId: "issue-1",
        title: "Questione",
        normalizedIssue: "Questione giuridica documentata.",
        areaOfLaw: "diritto amministrativo",
        priority: "HIGH",
        rationale: "Origina da un fatto documentato.",
        originatingItemLocalIds: ["item-3"],
        confidence: 80,
        referenceDateBasis: null,
        targetProceedingIdentity: null,
      }],
      researchQuestions: [{
        localId: "question-1",
        legalIssueLocalId: "issue-1",
        canonicalQuestion: "Quale disciplina si applica?",
        priority: "HIGH",
        referenceDate: "2026-09-29",
        referenceDateBasis: {
          type: "EVENT_DATE",
          itemLocalId: "item-3",
          rationale: "Data del fatto.",
          userConfirmedDateSource: null,
        },
        requestedCapabilities: ["SEMANTIC_DISCOVERY"],
        mode: "PRIMARY",
      }],
    };
    expect(fascicoloStructuredKnowledgeSchema.safeParse(base).success).toBe(true);

    const duplicate = structuredClone(base);
    duplicate.items[1].localId = duplicate.items[0].localId;
    expect(semanticIssues(duplicate)).toContainEqual({
      code: "DUPLICATE_ITEM_LOCAL_ID",
      path: "items",
    });

    const invalidQuote = structuredClone(base);
    invalidQuote.sourceQuotes[0].basisRef = "DOCUMENT_2.PAGE_1";
    expect(semanticIssues(invalidQuote)).toContainEqual({
      code: "INVALID_SOURCE_QUOTE_REFERENCE",
      path: "sourceQuotes.0",
    });

    const invalidOrigin = structuredClone(base);
    invalidOrigin.legalIssues[0].originatingItemLocalIds = ["item-9"];
    expect(semanticIssues(invalidOrigin)).toContainEqual({
      code: "INVALID_ISSUE_ORIGIN",
      path: "legalIssues.0.originatingItemLocalIds",
    });

    const invalidQuestion = structuredClone(base);
    invalidQuestion.researchQuestions[0].legalIssueLocalId = "issue-missing";
    invalidQuestion.researchQuestions[0].referenceDateBasis.itemLocalId = "item-missing";
    expect(semanticIssues(invalidQuestion)).toEqual(expect.arrayContaining([
      { code: "UNKNOWN_LEGAL_ISSUE", path: "researchQuestions.0.legalIssueLocalId" },
      { code: "UNKNOWN_REFERENCE_DATE_ITEM", path: "researchQuestions.0.referenceDateBasis.itemLocalId" },
    ]));

    const invalidInventory = structuredClone(base);
    invalidInventory.documentInventory[0].classification = "UNCERTAIN";
    expect(semanticIssues(invalidInventory)).toContainEqual({
      code: "UNCERTAIN_DOCUMENT_REQUIRES_GAP",
      path: "documentInventory.0.relatedItemLocalIds",
    });

    const unresolvedDependency = structuredClone(base);
    const contradiction = unresolvedDependency.items.find((entry) => (
      entry.kind === "CONTRADICTION"
    ));
    if (contradiction?.kind !== "CONTRADICTION") throw new Error("Expected contradiction.");
    contradiction.payload.conflictingItemLocalIds = ["item-missing", "item-2"];
    expect(semanticIssues(unresolvedDependency)).toContainEqual({
      code: "UNRESOLVED_REQUIRED_ITEM_REFERENCE",
      path: `items.${unresolvedDependency.items.indexOf(contradiction)}.payload`,
    });
  });

  it("aligns document-only citation and research-date rules with V7 persistence", () => {
    const base = {
      ...structuredClone(validKnowledge()),
      legalIssues: [{
        localId: "issue-1",
        title: "Questione",
        normalizedIssue: "Questione fondata sull'evento.",
        areaOfLaw: "diritto amministrativo",
        priority: "HIGH",
        rationale: "L'evento determina la data di riferimento.",
        originatingItemLocalIds: ["item-3"],
        confidence: 80,
        referenceDateBasis: null,
        targetProceedingIdentity: null,
      }],
      researchQuestions: [{
        localId: "question-1",
        legalIssueLocalId: "issue-1",
        canonicalQuestion: "Quale disciplina era vigente?",
        priority: "HIGH",
        referenceDate: "2026-09-29",
        referenceDateBasis: {
          type: "EVENT_DATE",
          itemLocalId: "item-3",
          rationale: "Data esatta dell'evento.",
          userConfirmedDateSource: null,
        },
        requestedCapabilities: ["SEMANTIC_DISCOVERY"],
        mode: "PRIMARY",
      }],
    };
    expect(fascicoloDocumentStructuredKnowledgeSchema.safeParse(base).success).toBe(true);

    const missingQuote = structuredClone(base);
    missingQuote.sourceQuotes = missingQuote.sourceQuotes.filter((quote) => (
      quote.itemLocalId !== "item-3"
    ));
    expect(documentSemanticIssues(missingQuote)).toContainEqual({
      code: "MISSING_SOURCE_QUOTE",
      path: "items.3.basisRefs",
    });

    const unsupportedBasis = structuredClone(base);
    unsupportedBasis.researchQuestions[0].referenceDateBasis.type = "FACT_DATE";
    expect(documentSemanticIssues(unsupportedBasis)).toContainEqual({
      code: "REFERENCE_DATE_BASIS_TYPE_UNSUPPORTED",
      path: "researchQuestions.0.referenceDateBasis.type",
    });

    const mismatchedDate = structuredClone(base);
    mismatchedDate.researchQuestions[0].referenceDate = "2026-09-30";
    expect(documentSemanticIssues(mismatchedDate)).toContainEqual({
      code: "REFERENCE_DATE_MISMATCH",
      path: "researchQuestions.0.referenceDate",
    });

    const unrelatedBasis = structuredClone(base);
    unrelatedBasis.legalIssues[0].originatingItemLocalIds = ["item-2"];
    expect(documentSemanticIssues(unrelatedBasis)).toContainEqual({
      code: "REFERENCE_DATE_ITEM_NOT_ISSUE_ORIGIN",
      path: "researchQuestions.0.referenceDateBasis.itemLocalId",
    });
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

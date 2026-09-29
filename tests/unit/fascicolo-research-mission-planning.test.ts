import { describe, expect, it } from "vitest";

import {
  buildKnowledgeResearchMissionPlans,
  projectStructuredKnowledge,
  type FascicoloStructuredKnowledge,
  type KnowledgeEvidenceCandidate,
  type KnowledgeRevisionSnapshot,
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

function knowledge(options: {
  basisKind?: "EVENT" | "MEASURE" | "LEGAL_ACT";
  basisType?: "EVENT_DATE" | "MEASURE_DATE" | "CHALLENGED_ACT_DATE" | "USER_CONFIRMED" | "FACT_DATE" | "APPLICATION_DATE" | "CONCESSION_PERIOD" | "UNKNOWN";
  referenceDate?: string | null;
  factQualifier?: string | null;
  questions?: number;
  mode?: "PRIMARY" | "ADVERSE";
  basisStatement?: string;
  confirmationVersion?: string;
} = {}): FascicoloStructuredKnowledge {
  const basisKind = options.basisKind ?? "EVENT";
  const basisType = options.basisType ?? "EVENT_DATE";
  const referenceDate = options.referenceDate === undefined ? "2026-09-01" : options.referenceDate;
  const count = options.questions ?? 1;
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
    subjects: [],
    items: [
      {
        localId: "fact-1", kind: "FACT", confidence: 90, basisRefs: [evidence.basisRef],
        payload: { normalizedStatement: "La concessione richiede verifica", subjectLocalIds: [], object: null, qualifier: options.factQualifier ?? null },
      },
      basisKind === "EVENT" ? {
        localId: "basis-1", kind: "EVENT", confidence: 90, basisRefs: [evidence.basisRef],
        payload: { title: "Istanza", normalizedStatement: options.basisStatement ?? "Istanza presentata", date: { precision: "EXACT", from: "2026-09-01", to: null, originalText: null, confidence: 100 }, subjectLocalIds: [], relatedItemLocalIds: [] },
      } : {
        localId: "basis-1", kind: basisKind, confidence: 90, basisRefs: [evidence.basisRef],
        payload: { documentBasisRef: evidence.basisRef, actType: "decreto", proceduralRole: basisType === "CHALLENGED_ACT_DATE" ? "CHALLENGED_ACT" as const : null, authoritySubjectLocalId: null, number: options.basisStatement ?? "7", date: { precision: "EXACT", from: "2026-09-01", to: null, originalText: null, confidence: 100 }, title: "Decreto", declaredEffects: [] },
      },
    ],
    legalIssues: [{
      localId: "issue-1", title: "Questione", normalizedIssue: "disciplina applicabile", areaOfLaw: null,
      priority: "HIGH", rationale: "Il fatto richiede qualificazione", originatingItemLocalIds: ["fact-1", "basis-1"], confidence: 90, referenceDateBasis: null,
    }],
    researchQuestions: Array.from({ length: count }, (_, index) => ({
      localId: `question-${index + 1}`,
      legalIssueLocalId: "issue-1",
      canonicalQuestion: `Quale disciplina si applica? ${index + 1}`,
      priority: index % 3 === 0 ? "HIGH" as const : index % 3 === 1 ? "MEDIUM" as const : "LOW" as const,
      referenceDate,
      referenceDateBasis: basisType === "UNKNOWN"
        ? { type: "UNKNOWN" as const, itemLocalId: null, rationale: "Data non determinabile", userConfirmedDateSource: null }
        : basisType === "USER_CONFIRMED"
          ? { type: "USER_CONFIRMED" as const, itemLocalId: null, rationale: "Data confermata", userConfirmedDateSource: { sourceId: "review-1", sourceVersion: options.confirmationVersion ?? "1", confirmedDate: referenceDate! } }
          : { type: basisType, itemLocalId: "basis-1", rationale: "Data documentata", userConfirmedDateSource: null },
      requestedCapabilities: ["SEMANTIC_DISCOVERY" as const],
      mode: options.mode ?? "PRIMARY",
    })),
  };
}

function snapshot(value: FascicoloStructuredKnowledge, rejectedQuestion = false, rejectedIssue = false): KnowledgeRevisionSnapshot {
  const projection = projectStructuredKnowledge({
    knowledge: value,
    subjectIdsByLocalId: new Map(),
    evidenceByBasisRef: new Map([[evidence.basisRef, evidence]]),
  });
  const idBySemanticKey = new Map(projection.candidates.map((candidate, index) => [candidate.semanticKey, `item-${index + 1}`]));
  return {
    id: "revision-current",
    tenantId: "tenant-1",
    procedimentoId: "procedure-1",
    corpusFingerprint: "c".repeat(64),
    contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
    status: "CURRENT",
    warnings: [],
    createdAt: new Date("2026-09-29T00:00:00Z"),
    completedAt: new Date("2026-09-29T00:00:01Z"),
    supersededAt: null,
    items: projection.candidates.map((candidate, index) => ({
      id: `item-${index + 1}`,
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      revisionId: "revision-current",
      ...candidate,
      evidence: candidate.evidence.map((item, evidenceIndex) => ({
        id: `evidence-${index}-${evidenceIndex}`,
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        itemId: `item-${index + 1}`,
        createdAt: new Date("2026-09-29T00:00:00Z"),
        ...item,
      })),
      status: (rejectedQuestion && candidate.kind === "RESEARCH_QUESTION")
        || (rejectedIssue && candidate.kind === "LEGAL_ISSUE") ? "REJECTED" as const : "AI_PROPOSED" as const,
      reviewVersion: 0,
      createdAt: new Date("2026-09-29T00:00:00Z"),
      supersededAt: null,
    })),
    relations: projection.relations.map((relation, index) => ({
      id: `relation-${index + 1}`,
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      revisionId: "revision-current",
      sourceItemId: idBySemanticKey.get(relation.sourceSemanticKey)!,
      targetItemId: idBySemanticKey.get(relation.targetSemanticKey)!,
      relationType: relation.relationType,
      confidence: null,
      createdAt: new Date("2026-09-29T00:00:00Z"),
    })),
  };
}

describe("Lotto 3 research mission planning", () => {
  it.each([
    ["EVENT_DATE", "EVENT"],
    ["MEASURE_DATE", "MEASURE"],
  ] as const)("derives referenceDate from %s", (basisType, basisKind) => {
    const plan = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType, basisKind })))[0];
    expect(plan.execution).toBe("ADMITTED");
    expect(plan.referenceDate).toBe("2026-09-01");
    expect(plan.mission?.referenceDate).toBe("2026-09-01T00:00:00.000Z");
    expect(plan.mission?.executionPlan?.requiredCapabilities).toEqual(["EXACT_RETRIEVAL", "SEMANTIC_DISCOVERY"]);
  });

  it.each([
    ["CHALLENGED_ACT_DATE", "LEGAL_ACT"],
    ["CHALLENGED_ACT_DATE", "MEASURE"],
    ["USER_CONFIRMED", "EVENT"],
  ] as const)("admits semantically verified %s", (basisType, basisKind) => {
    const plan = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType, basisKind })))[0];
    expect(plan).toMatchObject({ execution: "ADMITTED", referenceDate: "2026-09-01" });
  });

  it.each(["FACT_DATE", "APPLICATION_DATE", "CONCESSION_PERIOD"] as const)("keeps unsupported %s blocked for review", (basisType) => {
    expect(buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType })))[0])
      .toMatchObject({ execution: "BLOCKED_FOR_REVIEW", blockReason: "REFERENCE_DATE_REVIEW_REQUIRED" });
  });

  it("blocks uncertain dates without an epoch fallback", () => {
    const plan = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType: "UNKNOWN", referenceDate: null })))[0];
    expect(plan).toMatchObject({ execution: "BLOCKED_FOR_REVIEW", referenceDate: null, blockReason: "REFERENCE_DATE_REVIEW_REQUIRED", mission: null });
    expect(JSON.stringify(plan)).not.toContain("1970-01-01");
  });

  it("keeps the mission fingerprint stable for invariant assumptions", () => {
    const first = buildKnowledgeResearchMissionPlans(snapshot(knowledge()))[0];
    const second = buildKnowledgeResearchMissionPlans(snapshot(knowledge()))[0];
    expect(second.missionFingerprint).toBe(first.missionFingerprint);
  });

  it("changes the fingerprint for a material originating fact or reference date", () => {
    const original = buildKnowledgeResearchMissionPlans(snapshot(knowledge()))[0];
    const changedFact = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ factQualifier: "qualificazione aggiornata" })))[0];
    const changedDate = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ referenceDate: "2026-09-02" })))[0];
    expect(changedFact.missionFingerprint).not.toBe(original.missionFingerprint);
    expect(changedDate.missionFingerprint).not.toBe(original.missionFingerprint);
    expect(changedDate.execution).toBe("BLOCKED_FOR_REVIEW");
  });

  it("changes the fingerprint for the same date with a different operational basis type", () => {
    const measure = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisKind: "MEASURE", basisType: "MEASURE_DATE" })))[0];
    const challenged = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisKind: "MEASURE", basisType: "CHALLENGED_ACT_DATE" })))[0];
    expect(challenged.execution).toBe("ADMITTED");
    expect(challenged.missionFingerprint).not.toBe(measure.missionFingerprint);
  });

  it("changes the fingerprint for a materially different basis item on the same day", () => {
    const first = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisStatement: "Istanza originaria" })))[0];
    const second = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisStatement: "Istanza integrativa" })))[0];
    expect(second.referenceDate).toBe(first.referenceDate);
    expect(second.missionFingerprint).not.toBe(first.missionFingerprint);
  });

  it("changes the fingerprint when a USER_CONFIRMED source version changes", () => {
    const first = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType: "USER_CONFIRMED", confirmationVersion: "1" })))[0];
    const second = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ basisType: "USER_CONFIRMED", confirmationVersion: "2" })))[0];
    expect(second.missionFingerprint).not.toBe(first.missionFingerprint);
  });

  it("does not admit rejected questions or automatic ADVERSE execution", () => {
    expect(buildKnowledgeResearchMissionPlans(snapshot(knowledge(), true))[0])
      .toMatchObject({ execution: "REJECTED", mission: null });
    expect(buildKnowledgeResearchMissionPlans(snapshot(knowledge({ mode: "ADVERSE" })))[0])
      .toMatchObject({ execution: "BLOCKED_FOR_REVIEW", blockReason: "ADVERSE_NOT_AUTOMATED" });
  });

  it("blocks every question linked to a rejected issue without creating a mission", () => {
    expect(buildKnowledgeResearchMissionPlans(snapshot(knowledge(), false, true))[0])
      .toMatchObject({ execution: "BLOCKED_FOR_REVIEW", blockReason: "ISSUE_OR_ORIGIN_INVALID", mission: null });
  });

  it("admits five questions deterministically while preserving additional questions", () => {
    const plans = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ questions: 7 })));
    expect(plans).toHaveLength(7);
    expect(plans.filter((plan) => plan.execution === "ADMITTED")).toHaveLength(5);
    expect(plans.filter((plan) => plan.execution === "DEFERRED_BY_POLICY")).toHaveLength(2);
    expect(plans.slice(0, 3).map((plan) => plan.priority)).toEqual(["HIGH", "HIGH", "HIGH"]);
  });

  it("accepts an explicit execution-wave policy without changing persisted questions", () => {
    const plans = buildKnowledgeResearchMissionPlans(snapshot(knowledge({ questions: 4 })), { maxQuestionsPerWave: 2 });
    expect(plans).toHaveLength(4);
    expect(plans.filter((plan) => plan.execution === "ADMITTED")).toHaveLength(2);
  });
});

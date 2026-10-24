import { describe, expect, it } from "vitest";

import type { StructuredReportResearchResultInput } from "@/server/fascicolo-report";
import {
  mergeAutomaticApplicabilityReviews,
  produceAutomaticLegalApplicabilityReview,
  ruleResolutionFingerprint,
  verifyRuleResolutionFingerprint,
} from "@/server/legal-research/legal-applicability-producer";
import type { EvaluatedSourceResult, RuleResolutionInput, RuleResolutionResult } from "@/server/legal-rules/types";
import type { StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

const digest = (value: string) => value.repeat(64).slice(0, 64);
const documentedEvidence = [{
  basisRef: "DOCUMENT_1.PAGE_1",
  documentoId: "document-1",
  documentFileVersionId: "document-version-1",
  pageNumber: 1,
  textSha256: digest("evidence"),
}] as const;
const structuredProceedingIdentity = {
  canonicalAnchorSemanticKey: digest("a"),
  kind: "ADMINISTRATIVE_ORIGINAL",
  evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
};
const source: EvaluatedSourceResult = {
  id: "source-family-law",
  stableKey: "law-2026",
  title: "Legge 1/2026",
  documentType: "LAW",
  legalRank: "PRIMARY",
  territorialScope: "ITALY",
  sourceNumber: "1",
  sourceDate: "2026-01-01",
  issuingBody: "Legislatore",
  status: "CURRENT",
  role: "CONFORMATIVE",
  confidence: "HIGH",
  humanReviewRequired: true,
  isConformative: true,
  isExtractable: true,
  relativePath: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  applicable: true,
  exclusionReasons: [],
};
const orchestrationInput: RuleResolutionInput = {
  enteId: "tenant-a",
  referenceDate: "2026-05-01T00:00:00.000Z",
  includeHistorical: true,
  includePending: true,
};
const orchestrationResult: RuleResolutionResult = {
  applicableSources: [source],
  applicableRules: [{
    id: "rule-result-1",
    ruleId: "rule-1",
    title: "Regola concessoria",
    summary: "Regola applicabile",
    category: "CONCESSION",
    priority: 100,
    outputSeverity: "INFO",
    outcomeTitle: "Applicabile",
    outcomeSummary: "La regola coincide con i criteri documentati.",
    source: {
      id: source.id,
      stableKey: source.stableKey,
      title: source.title,
      documentType: source.documentType,
      relativePath: null,
    },
    matchedCriteria: ["enteId"],
    disclaimer: "Verifica professionale richiesta",
    humanReviewRequired: true,
  }],
  excludedByTerritory: [],
  excludedByDate: [],
  historicalSources: [],
  supersededSources: [],
  partiallySupersededSources: [],
  pendingValiditySources: [],
  draftOrOngoingSources: [],
  caseSpecificSources: [],
  potentialConflicts: [],
  missingSources: [],
  knownGaps: [],
  reasoningTrace: ["source-family-law: applicable"],
  overallConfidence: "HIGH",
  disclaimer: "Verifica professionale richiesta",
  humanReviewRequired: true,
  professionalReviewBadge: "Verifica professionale richiesta",
  evaluatedAt: "2026-05-01T10:00:00.000Z",
  totalRulesEvaluated: 1,
};
const knowledge: StructuredKnowledgeReadModel = {
  revision: {
    id: "revision-a",
    corpusFingerprint: digest("corpus"),
    contractVersion: "FASCICOLO_KNOWLEDGE_V1",
    createdAt: new Date("2026-05-01T08:00:00.000Z"),
    completedAt: new Date("2026-05-01T08:01:00.000Z"),
    warnings: [],
  },
  subjects: [],
  partyRoles: [],
  partyPositions: [],
  facts: [{
    id: "application-2024",
    kind: "FACT",
    semanticKey: digest("application-key"),
    contentFingerprint: digest("application-content"),
    normalizedText: "Istanza presentata nel 2024",
    payload: { date: { precision: "EXACT", from: "2024-06-01T00:00:00.000Z", to: "2024-06-01T00:00:00.000Z" } },
    confidence: 100,
    status: "HUMAN_CONFIRMED",
    reviewVersion: 1,
    evidence: documentedEvidence,
  }, {
    id: "pending-2026",
    kind: "FACT",
    semanticKey: digest("pending-key"),
    contentFingerprint: digest("pending-content"),
    normalizedText: "Procedimento ancora pendente",
    payload: {
      date: { precision: "EXACT", from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
      proceedingIdentity: structuredProceedingIdentity,
    },
    confidence: 100,
    status: "HUMAN_CONFIRMED",
    reviewVersion: 1,
    evidence: documentedEvidence,
  }],
  events: [{
    id: "start-2025",
    kind: "EVENT",
    semanticKey: digest("start-key"),
    contentFingerprint: digest("start-content"),
    normalizedText: "Procedimento avviato nel 2025",
    payload: {
      date: { precision: "EXACT", from: "2025-01-10T00:00:00.000Z", to: "2025-01-10T00:00:00.000Z" },
      proceedingIdentity: structuredProceedingIdentity,
    },
    confidence: 100,
    status: "HUMAN_CONFIRMED",
    reviewVersion: 1,
    evidence: documentedEvidence,
  }],
  legalActs: [],
  measures: [],
  contradictions: [],
  gaps: [],
  deadlineCandidates: [],
  legalIssues: [{
    id: "issue-a",
    kind: "LEGAL_ISSUE",
    semanticKey: digest("issue"),
    contentFingerprint: digest("issue-content"),
    normalizedText: "Quale disciplina si applica?",
    payload: { targetProceedingIdentity: structuredProceedingIdentity },
    confidence: 100,
    status: "HUMAN_CONFIRMED",
    reviewVersion: 1,
    evidence: documentedEvidence,
    originatingItemIds: ["application-2024", "pending-2026", "start-2025"],
  }],
  researchQuestions: [],
  timeline: [],
};

function researchResult(): StructuredReportResearchResultInput {
  return {
    resultId: "result-a",
    title: "Legge 1/2026",
    sourceUrl: "https://www.normattiva.it/example",
    provider: "NORMATTIVA",
    supportDirection: "SUPPORTS",
    classificationReviewStatus: "AI_PROPOSED",
    classificationRationale: "La disposizione disciplina il procedimento.",
    relevantPassage: null,
    sourceAssessment: {
      assessmentId: "assessment-a",
      chainFingerprint: digest("chain"),
      isCurrent: true,
      usable: true,
      citationAnchors: [{ section: "art. 30" }],
      blockingReasons: [],
      manualReviewRequired: false,
      manualReviewReason: null,
      sourceFamilyId: source.id,
      sourceVersionId: "version-a",
      acquisitionId: "acquisition-a",
      temporalAssessmentId: "temporal-a",
      sourceChain: {
        resultId: "result-a",
        tenantId: "tenant-a",
        caseId: "case-a",
        missionId: "mission-a",
        researchQuestionSemanticKey: digest("question"),
        missionFingerprint: digest("mission"),
        referenceDate: orchestrationInput.referenceDate!,
        referenceDateBasis: { kind: "CASE_ANALYSIS_DATE" },
        verificationVersion: "SOURCE_CHAIN_V1",
        sourceIdentityKey: "normattiva:law-1-2026",
        contentSha256: digest("official-content"),
        retrievalState: "RESOLVED",
        textState: "FULL_TEXT",
        identityState: "VERIFIED",
        contentState: "VERIFIED",
        temporalState: "APPLICABLE",
        adverseState: "NOT_REQUIRED",
        officiality: "OFFICIAL",
        citationAnchors: [{ section: "art. 30" }],
        manualReviewRequired: false,
        manualReviewReason: null,
        currentMission: true,
      },
      temporalAssessment: {
        assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
        validityState: "VALID",
        temporalWindowState: "SATISFIED",
        applicabilityState: "APPLICABLE_ON_DATE",
        reasonCodes: ["EFFECTIVE_INTERVAL_MATCH"],
        referenceDate: orchestrationInput.referenceDate!,
        effectiveInterval: { from: "2026-01-01T00:00:00.000Z", to: null },
        humanReviewRequired: false,
        confidence: "HIGH",
      },
    },
  };
}

function proposal(
  text: string,
  structuredKnowledge = knowledge,
  overrides: {
    missionId?: string;
    result?: StructuredReportResearchResultInput;
    orchestrationResult?: RuleResolutionResult;
  } = {},
) {
  return produceAutomaticLegalApplicabilityReview({
    tenantId: "tenant-a",
    knowledge: structuredKnowledge,
    missionId: overrides.missionId ?? "mission-a",
    legalIssueSemanticKey: digest("issue"),
    candidate: {
      documentType: "LAW",
      officialRelevantPassage: text,
      officialCitationReference: "art. 30",
      officialContentSha256: digest("official-content"),
    },
    result: overrides.result ?? researchResult(),
    orchestrationInput,
    orchestrationResult: overrides.orchestrationResult ?? orchestrationResult,
    actorId: "automatic-worker",
    producedAt: "2026-05-01T10:05:00.000Z",
  });
}

function knowledgeWithStatus(text: string, date: string | null): StructuredKnowledgeReadModel {
  const statusId = `status-${text}`;
  return {
    ...knowledge,
    facts: [
      knowledge.facts[0],
      {
        ...knowledge.facts[1],
        id: statusId,
        normalizedText: text,
        payload: {
          date: { precision: date ? "EXACT" : "UNCERTAIN", from: date, to: date },
          proceedingIdentity: structuredProceedingIdentity,
        },
        evidence: documentedEvidence,
      },
    ],
    legalIssues: knowledge.legalIssues.map((issue) => ({
      ...issue,
      originatingItemIds: ["application-2024", statusId, "start-2025"],
    })),
  };
}

describe("automatic legal applicability producer", () => {
  it("proposes a documented pending-proceeding exclusion with fact and rule provenance", () => {
    const review = proposal("Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.");

    expect(review).toMatchObject({
      reviewStatus: "AI_PROPOSED",
      factualApplicability: { outcome: "TO_VERIFY" },
      transitionalDiscipline: {
        status: "VERIFIED_PRESENT",
        effect: "EXCLUDES_PENDING_PROCEEDINGS",
        evidenceSourceId: "assessment-a",
      },
      ruleOrchestrator: { source: { id: source.id }, ruleMatched: true },
    });
    expect(review?.factBindings.map((binding) => binding.role)).toEqual([
      "APPLICATION_SUBMITTED",
      "PROCEEDING_STATUS",
      "PROCEEDING_STARTED",
    ]);
  });

  it.each([
    ["La disciplina regola il rilascio della concessione.", "UNAVAILABLE"],
    ["La disposizione ha efficacia retroattiva.", "VERIFIED_PRESENT"],
    ["Continua ad applicarsi il regime previgente.", "AMBIGUOUS"],
  ] as const)("classifies transitional evidence conservatively: %s", (text, status) => {
    expect(proposal(text)?.transitionalDiscipline.status).toBe(status);
  });

  it("rejects missing official text and detects tampered orchestrator evidence", () => {
    expect(produceAutomaticLegalApplicabilityReview({
      tenantId: "tenant-a",
      knowledge,
      missionId: "mission-a",
      legalIssueSemanticKey: digest("issue"),
      candidate: { documentType: "LAW", officialCitationReference: "art. 30" },
      result: researchResult(),
      orchestrationInput,
      orchestrationResult,
      actorId: "automatic-worker",
      producedAt: "2026-05-01T10:05:00.000Z",
    })).toBeNull();

    const review = proposal("La disposizione ha efficacia retroattiva.");
    expect(review).not.toBeNull();
    if (!review) return;
    expect(verifyRuleResolutionFingerprint({ review, resolution: orchestrationResult }).valid).toBe(true);
    expect(verifyRuleResolutionFingerprint({
      review,
      resolution: { ...orchestrationResult, applicableSources: [{ ...source, applicable: false }] },
    }).valid).toBe(false);
    expect(review.ruleOrchestrator.resolutionFingerprint).toBe(
      ruleResolutionFingerprint(orchestrationInput, orchestrationResult),
    );
  });

  it.each([
    ["provider text without an official passage", {
      relevantPassage: "La disposizione ha efficacia retroattiva.",
      providerReceivedText: "La disposizione ha efficacia retroattiva.",
      officialCitationReference: "art. 30",
      officialContentSha256: digest("official-content"),
    }],
    ["a mismatched citation anchor", {
      officialRelevantPassage: "La disposizione ha efficacia retroattiva.",
      officialCitationReference: "art. 99",
      officialContentSha256: digest("official-content"),
    }],
    ["a mismatched official content version", {
      officialRelevantPassage: "La disposizione ha efficacia retroattiva.",
      officialCitationReference: "art. 30",
      officialContentSha256: digest("different-content"),
    }],
  ])("does not produce a substantive proposal from %s", (_name, candidate) => {
    expect(produceAutomaticLegalApplicabilityReview({
      tenantId: "tenant-a",
      knowledge,
      missionId: "mission-a",
      legalIssueSemanticKey: digest("issue"),
      candidate: { documentType: "LAW", ...candidate },
      result: researchResult(),
      orchestrationInput,
      orchestrationResult,
      actorId: "automatic-worker",
      producedAt: "2026-05-01T10:05:00.000Z",
    })).toBeNull();
  });

  it.each([
    ["Il procedimento è concluso.", "PROCEEDING_STATUS", "COMPLETED"],
    ["Il procedimento non è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non si è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non risulta concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non è pendente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non risulta più pendente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non è più in corso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento potrebbe essere concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento dovrebbe essere concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento risulterebbe concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento non — allo stato — risulta concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Non è escluso che il procedimento sia concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è ancora pendente? No.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è concluso? No.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Se il procedimento fosse concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Qualora il procedimento fosse concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Secondo la ricorrente il procedimento è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Si ritiene che il procedimento sia concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è tutt'altro che concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è ancora pendente.", "PROCEEDING_STATUS", "PENDING"],
    ["Il procedimento risulta definitivamente concluso.", "PROCEEDING_STATUS", "COMPLETED"],
    ["È conclusa soltanto la fase istruttoria del procedimento.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Si è concluso un procedimento differente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento di appello è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento penale è ancora pendente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento relativo a una diversa istanza è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["È prevista la conclusione del procedimento.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["La conclusione del procedimento è stata rinviata.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è concluso ma è pendente il ricorso.", "PROCEEDING_STATUS", "COMPLETED"],
    ["Il procedimento amministrativo è concluso. Il ricorso è ancora pendente.", "PROCEEDING_STATUS", "COMPLETED"],
    ["Il procedimento era in corso. Ora è concluso.", "PROCEEDING_STATUS", "COMPLETED"],
    ["Il procedimento è concluso. Ora è pendente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento era in corso. Ora, secondo la ricorrente, è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è concluso. Rettifica: il procedimento è ancora pendente.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento è ancora pendente. Correzione: il procedimento è concluso.", "PROCEEDING_STATUS", "UNKNOWN"],
    ["Il procedimento risulta concluso in una data non documentata.", "PROCEEDING_STATUS", "UNKNOWN"],
  ] as const)("classifies proceeding status conservatively: %s", (text, role, value) => {
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      knowledgeWithStatus(text, "2026-02-10T00:00:00.000Z"),
    );
    const binding = review?.factBindings.find((item) => item.knowledgeItemId === `status-${text}`);
    expect(binding).toEqual(expect.objectContaining({
      role,
      ...(value ? { value } : {}),
    }));
  });

  it("does not invent a completion date when the structured fact has none", () => {
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      knowledgeWithStatus("Procedimento concluso", null),
    );
    expect(review?.factBindings.some((binding) => binding.knowledgeItemId.startsWith("status-"))).toBe(false);
  });

  it("does not assert a status without a documentary evidence link", () => {
    const undocumented = knowledgeWithStatus("Il procedimento è concluso.", "2026-02-10T00:00:00.000Z");
    const status = undocumented.facts[1];
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      { ...undocumented, facts: [undocumented.facts[0], { ...status, evidence: [] }] },
    );
    expect(review?.factBindings.find((binding) => binding.knowledgeItemId === status.id)).toBeUndefined();
  });

  it.each([
    "Il procedimento penale è stato avviato nel 2025.",
    "Il procedimento di appello è stato avviato nel 2025.",
    "Il procedimento relativo a una diversa istanza è stato avviato nel 2025.",
  ])("does not bind the start of a different proceeding: %s", (text) => {
    const eventId = `different-${text}`;
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      {
        ...knowledge,
        events: [{
          ...knowledge.events[0],
          id: eventId,
          normalizedText: text,
        }],
        legalIssues: knowledge.legalIssues.map((issue) => ({
          ...issue,
          originatingItemIds: ["application-2024", "pending-2026", eventId],
        })),
      },
    );
    expect(review?.factBindings.find((binding) => binding.knowledgeItemId === eventId)).toMatchObject({
      role: "OTHER",
    });
  });

  it("binds only facts structurally originating the legal issue", () => {
    const unrelated = {
      ...knowledge.events[0],
      id: "unrelated-proceeding-start",
      normalizedText: "Il procedimento è stato avviato nel 2024.",
    };
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      { ...knowledge, events: [...knowledge.events, unrelated] },
    );
    expect(review?.factBindings.some((binding) => binding.knowledgeItemId === unrelated.id)).toBe(false);
  });

  it("preserves distinct identities for two administrative proceedings in the same issue", () => {
    const pendingB = {
      ...knowledge.facts[1],
      id: "pending-b",
      normalizedText: "Il procedimento è ancora pendente.",
      payload: {
        ...knowledge.facts[1].payload as Record<string, unknown>,
        proceedingIdentity: {
          canonicalAnchorSemanticKey: digest("b"),
          kind: "ADMINISTRATIVE_ORIGINAL",
          evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
        },
      },
    };
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      {
        ...knowledge,
        facts: [knowledge.facts[0], pendingB],
        legalIssues: knowledge.legalIssues.map((issue) => ({
          ...issue,
          originatingItemIds: ["application-2024", "start-2025", pendingB.id],
        })),
      },
    );
    expect(review?.targetProceedingIdentity?.canonicalAnchorSemanticKey).toBe(digest("a"));
    expect(review?.factBindings.find((binding) => binding.knowledgeItemId === "start-2025")
      ?.proceedingIdentity?.canonicalAnchorSemanticKey).toBe(digest("a"));
    expect(review?.factBindings.find((binding) => binding.knowledgeItemId === pendingB.id)
      ?.proceedingIdentity?.canonicalAnchorSemanticKey).toBe(digest("b"));
  });

  it("does not verify a proceeding identity without matching documentary provenance", () => {
    const documented = knowledgeWithStatus("Il procedimento è concluso.", "2025-12-10T00:00:00.000Z");
    const status = documented.facts[1];
    const review = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
      {
        ...documented,
        facts: [
          documented.facts[0],
          {
            ...status,
            payload: {
              ...status.payload as Record<string, unknown>,
              proceedingIdentity: {
                canonicalAnchorSemanticKey: digest("a"),
                kind: "ADMINISTRATIVE_ORIGINAL",
                evidenceBasisRefs: ["DOCUMENT_9.PAGE_9"],
              },
            },
          },
        ],
      },
    );
    expect(review?.factBindings.find((binding) => binding.knowledgeItemId === status.id)
      ?.proceedingIdentity).toBeNull();
  });

  it("does not duplicate a confirmed review during an automatic rerun", () => {
    const candidate = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
    );
    expect(candidate).not.toBeNull();
    if (!candidate) return;
    const confirmed = {
      ...candidate,
      reviewStatus: "HUMAN_CONFIRMED" as const,
      reviewerAttestation: {
        reviewedByActorId: "professional-reviewer",
        reviewedAt: "2026-05-02T10:00:00.000Z",
        rationale: "Conferma professionale della medesima applicazione e della medesima base documentale.",
      },
    };
    expect(mergeAutomaticApplicabilityReviews([confirmed], [candidate])).toEqual([confirmed]);
  });

  it("keeps retries idempotent and scopes confirmations to the same application identity", () => {
    const text = "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.";
    const initial = proposal(text);
    const retry = proposal(text);
    expect(initial).not.toBeNull();
    expect(retry).not.toBeNull();
    if (!initial || !retry) return;
    expect(retry.applicationId).toBe(initial.applicationId);
    expect(mergeAutomaticApplicabilityReviews(
      mergeAutomaticApplicabilityReviews([], [initial]),
      [retry],
    )).toEqual([retry]);

    const confirmed = {
      ...initial,
      reviewStatus: "HUMAN_CONFIRMED" as const,
      reviewerAttestation: {
        reviewedByActorId: "professional-reviewer",
        reviewedAt: "2026-05-02T10:00:00.000Z",
        rationale: "Conferma professionale della medesima applicazione e della medesima base documentale.",
      },
    };
    const revisedKnowledge = {
      ...knowledge,
      revision: { ...knowledge.revision, id: "revision-b" },
    };
    const revised = proposal(text, revisedKnowledge);
    expect(revised).not.toBeNull();
    if (!revised) return;
    expect(revised.applicationId).not.toBe(confirmed.applicationId);
    expect(mergeAutomaticApplicabilityReviews([confirmed], [revised])).toEqual([confirmed, revised]);
  });

  it("preserves a confirmed review and exposes a new proposal when rule resolution changes", () => {
    const text = "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.";
    const initial = proposal(text);
    expect(initial).not.toBeNull();
    if (!initial) return;
    const confirmed = {
      ...initial,
      reviewStatus: "HUMAN_CONFIRMED" as const,
      reviewerAttestation: {
        reviewedByActorId: "professional-reviewer",
        reviewedAt: "2026-05-02T10:00:00.000Z",
        rationale: "Conferma professionale della valutazione sottoposta e delle evidenze allora disponibili.",
      },
    };
    const changedResolution: RuleResolutionResult = {
      ...orchestrationResult,
      reasoningTrace: [...orchestrationResult.reasoningTrace, "rule-1: nuova qualificazione sostanziale"],
    };
    const changed = proposal(text, knowledge, { orchestrationResult: changedResolution });
    expect(changed).not.toBeNull();
    if (!changed) return;
    expect(changed.ruleOrchestrator.resolutionFingerprint).not.toBe(
      confirmed.ruleOrchestrator.resolutionFingerprint,
    );
    expect(changed.applicationId).not.toBe(confirmed.applicationId);
    expect(mergeAutomaticApplicabilityReviews([confirmed], [changed])).toEqual([confirmed, changed]);
  });

  it("changes application identity when the source version or target anchor changes", () => {
    const text = "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.";
    const initial = proposal(text);
    const changedSourceResult = researchResult();
    if (!changedSourceResult.sourceAssessment) throw new Error("Expected source assessment fixture.");
    changedSourceResult.sourceAssessment = {
      ...changedSourceResult.sourceAssessment,
      sourceVersionId: "version-b",
    };
    const changedSource = proposal(text, knowledge, { result: changedSourceResult });
    const changedAnchorIdentity = {
      ...structuredProceedingIdentity,
      canonicalAnchorSemanticKey: digest("b"),
    };
    const changedAnchorKnowledge = {
      ...knowledge,
      facts: knowledge.facts.map((fact) => {
        if (fact.id !== "pending-2026") return fact;
        if (!fact.payload || typeof fact.payload !== "object" || Array.isArray(fact.payload)) {
          throw new Error("Expected fact payload fixture.");
        }
        return {
          ...fact,
          payload: { ...fact.payload, proceedingIdentity: changedAnchorIdentity },
        };
      }),
      events: knowledge.events.map((event) => {
        if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
          throw new Error("Expected event payload fixture.");
        }
        return {
          ...event,
          payload: { ...event.payload, proceedingIdentity: changedAnchorIdentity },
        };
      }),
      legalIssues: knowledge.legalIssues.map((issue) => ({
        ...issue,
        payload: { targetProceedingIdentity: changedAnchorIdentity },
      })),
    };
    const changedAnchor = proposal(text, changedAnchorKnowledge);
    expect(initial).not.toBeNull();
    expect(changedSource).not.toBeNull();
    expect(changedAnchor).not.toBeNull();
    expect(new Set([
      initial?.applicationId,
      changedSource?.applicationId,
      changedAnchor?.applicationId,
    ])).toHaveLength(3);
  });

  it("rejects duplicate automatic review and application identities", () => {
    const candidate = proposal(
      "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
    );
    expect(candidate).not.toBeNull();
    if (!candidate) return;
    expect(() => mergeAutomaticApplicabilityReviews([candidate, candidate], [])).toThrow(
      "DUPLICATE_LEGAL_APPLICABILITY_REVIEW_IDENTITY",
    );
    expect(() => mergeAutomaticApplicabilityReviews([], [candidate, {
      ...candidate,
      reviewId: `${candidate.reviewId}:duplicate`,
    }])).toThrow("DUPLICATE_LEGAL_APPLICABILITY_REVIEW_IDENTITY");
  });

  it.each(["UNCERTAIN", "INTERVAL", "MONTH", "YEAR"] as const)(
    "does not promote a %s date to a certain fact date",
    (precision) => {
      const uncertain = knowledgeWithStatus("Il procedimento è concluso.", "2025-12-10T00:00:00.000Z");
      const status = uncertain.facts[1];
      const review = proposal(
        "Le nuove disposizioni non si applicano ai procedimenti pendenti alla data di entrata in vigore.",
        {
          ...uncertain,
          facts: [
            uncertain.facts[0],
            {
              ...status,
              payload: {
                date: {
                  precision,
                  from: "2025-12-10T00:00:00.000Z",
                  to: "2026-02-10T00:00:00.000Z",
                },
              },
            },
          ],
        },
      );
      expect(review?.factBindings.some((binding) => binding.knowledgeItemId === status.id)).toBe(false);
    },
  );
});

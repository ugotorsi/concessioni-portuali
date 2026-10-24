import { describe, expect, it } from "vitest";

import {
  buildStructuredFascicoloReport,
  STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
  type StructuredReportMissionInput,
} from "@/server/fascicolo-report";
import {
  createAssistedVerificationSnapshot,
  type LegalApplicabilityReview,
} from "@/server/legal-research/assisted-verification";
import type { SourceChainSnapshot } from "@/server/legal-research/source-chain";
import type { TemporalAssessmentResult } from "@/server/legal-sources/temporal";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";
import { projectApplicabilityReviewHistory } from "@/server/queries/fascicolo-automatic-workflow";

const digest = (value: string) => value.repeat(64).slice(0, 64);
const proceedingIdentity = (itemId: string) => ({
  canonicalAnchorSemanticKey: digest("a"),
  kind: "ADMINISTRATIVE_ORIGINAL" as const,
  verification: "DOCUMENTED" as const,
  evidenceLinkIds: [`${itemId}-document:1:${digest(itemId)}`],
});

function knowledgeItem(
  id: string,
  kind: StructuredKnowledgeReadItem["kind"],
  date: string | null,
  text = id,
): StructuredKnowledgeReadItem {
  const procedural = id === "proceeding-2025" || id === "pending-2026";
  return {
    id,
    kind,
    semanticKey: digest(`${id}-key`),
    contentFingerprint: digest(`${id}-content`),
    normalizedText: text,
    payload: {
      date: { precision: date ? "EXACT" : "UNCERTAIN", from: date, to: date },
      ...(procedural ? {
        proceedingIdentity: {
          canonicalAnchorSemanticKey: digest("a"),
          kind: "ADMINISTRATIVE_ORIGINAL",
          evidenceBasisRefs: [`${id}.PAGE_1`],
        },
      } : {}),
    },
    confidence: date ? 100 : 40,
    status: "HUMAN_CONFIRMED",
    reviewVersion: 1,
    evidence: [{
      basisRef: `${id}.PAGE_1`,
      documentoId: `${id}-document`,
      documentFileVersionId: `${id}-version`,
      pageNumber: 1,
      textSha256: digest(id),
    }],
  };
}

function knowledge(uncertainStart = false): StructuredKnowledgeReadModel {
  const application = knowledgeItem("application-2024", "FACT", "2024-06-01T00:00:00.000Z", "Istanza presentata nel 2024");
  const start = knowledgeItem("proceeding-2025", "EVENT", uncertainStart ? null : "2025-01-10T00:00:00.000Z", "Procedimento avviato nel 2025");
  const status = knowledgeItem("pending-2026", "FACT", "2026-02-01T00:00:00.000Z", "Procedimento ancora pendente");
  const measure = knowledgeItem("measure-2026", "MEASURE", "2026-04-10T00:00:00.000Z", "Provvedimento successivo");
  const issueBase = knowledgeItem("issue-1", "LEGAL_ISSUE", null, "Disciplina applicabile");
  const issue = {
    ...issueBase,
    payload: {
      ...issueBase.payload as Record<string, unknown>,
      targetProceedingIdentity: {
        canonicalAnchorSemanticKey: digest("a"),
        kind: "ADMINISTRATIVE_ORIGINAL",
        evidenceBasisRefs: ["issue-1.PAGE_1"],
      },
    },
    originatingItemIds: [application.id, start.id, status.id],
  };
  const question = { ...knowledgeItem("question-1", "RESEARCH_QUESTION", null, "Quale regime si applica?"), legalIssueId: issue.id };
  return {
    revision: {
      id: "revision-1",
      corpusFingerprint: digest("corpus"),
      contractVersion: "FASCICOLO_KNOWLEDGE_V1",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      completedAt: new Date("2026-05-01T00:01:00.000Z"),
      warnings: [],
    },
    subjects: [],
    partyRoles: [],
    partyPositions: [],
    facts: [application, status],
    events: [start],
    legalActs: [],
    measures: [measure],
    contradictions: [],
    gaps: [],
    deadlineCandidates: [],
    legalIssues: [issue],
    researchQuestions: [question],
    timeline: [application, start, status, measure],
  };
}

function sourceChain(
  assessmentId: string,
  authorityKind: "law" | "judgment" = "law",
  overrides: Partial<SourceChainSnapshot> = {},
): SourceChainSnapshot {
  return {
    resultId: assessmentId,
    tenantId: "tenant-1",
    caseId: "case-1",
    missionId: "mission-1",
    researchQuestionSemanticKey: digest("question-1-key"),
    missionFingerprint: digest("mission"),
    referenceDate: "2026-05-01T00:00:00.000Z",
    referenceDateBasis: { kind: "CASE_ANALYSIS_DATE" },
    verificationVersion: "SOURCE_CHAIN_V1",
    sourceIdentityKey: `${authorityKind}:${assessmentId}`,
    contentSha256: digest("a"),
    retrievalState: "RESOLVED",
    textState: "FULL_TEXT",
    identityState: "VERIFIED",
    contentState: "VERIFIED",
    temporalState: "APPLICABLE",
    adverseState: "COMPLETED",
    officiality: "OFFICIAL",
    citationAnchors: [{ section: authorityKind === "law" ? "art. 30" : "massima 4" }],
    manualReviewRequired: false,
    manualReviewReason: null,
    currentMission: true,
    ...overrides,
  };
}

function temporal(caseLaw = false): TemporalAssessmentResult {
  return {
    assessmentVersion: "LEGAL_SOURCE_TEMPORAL_V1",
    validityState: "VALID",
    temporalWindowState: "SATISFIED",
    applicabilityState: caseLaw ? "REQUIRES_HUMAN_REVIEW" : "APPLICABLE_ON_DATE",
    reasonCodes: caseLaw
      ? ["CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY", "HUMAN_LEGAL_ASSESSMENT_REQUIRED"]
      : ["EFFECTIVE_INTERVAL_MATCH"],
    referenceDate: "2026-05-01T00:00:00.000Z",
    effectiveInterval: {
      from: caseLaw ? "2026-03-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
      to: null,
    },
    humanReviewRequired: caseLaw,
    confidence: "HIGH",
  };
}

function evaluatedSource(id: string) {
  return {
    id,
    stableKey: id,
    title: id,
    documentType: "LAW",
    legalRank: "PRIMARY",
    territorialScope: "ITALY",
    sourceNumber: "1",
    sourceDate: "2026-01-01",
    issuingBody: "Legislatore",
    status: "CURRENT",
    role: "CONFORMATIVE",
    confidence: "HIGH" as const,
    humanReviewRequired: true as const,
    isConformative: true,
    isExtractable: true,
    relativePath: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    applicable: true,
    exclusionReasons: [],
  };
}

function review(overrides: Partial<LegalApplicabilityReview> = {}): LegalApplicabilityReview {
  return {
    version: "LEGAL_APPLICABILITY_REVIEW_V1",
    reviewId: "review-law",
    applicationId: "application-law",
    knowledgeRevisionId: "revision-1",
    legalIssueSemanticKey: digest("issue-1-key"),
    candidateEvidenceSourceId: "assessment-law",
    candidateSourceVersionId: "source-version-law",
    candidateProvisionReference: "art. 10 legge 1/2026",
    legalAuthorityKind: "LEGISLATION",
    targetProceedingIdentity: proceedingIdentity("issue-1"),
    factBindings: [
      { knowledgeItemId: "application-2024", role: "APPLICATION_SUBMITTED" },
      { knowledgeItemId: "proceeding-2025", role: "PROCEEDING_STARTED", proceedingIdentity: proceedingIdentity("proceeding-2025") },
      { knowledgeItemId: "pending-2026", role: "PROCEEDING_STATUS", value: "PENDING", proceedingIdentity: proceedingIdentity("pending-2026") },
      { knowledgeItemId: "measure-2026", role: "CHALLENGED_ACT_ADOPTED" },
    ],
    factualApplicability: {
      outcome: "SATISFIED",
      rationale: "I fatti documentati ricadono nella fattispecie concessoria esaminata.",
      decisiveKnowledgeItemIds: ["application-2024", "proceeding-2025", "pending-2026"],
    },
    ruleOrchestrator: {
      input: { enteId: "tenant-1", referenceDate: "2026-05-01T00:00:00.000Z" },
      source: evaluatedSource("law-2026"),
      ruleMatched: true,
      resolutionFingerprint: "a".repeat(64),
    },
    normRelationship: {
      outcome: "NO_SPECIALITY_CONFLICT",
      rationale: "Non risultano conflitti con una disciplina speciale.",
      competingEvidenceSourceId: null,
    },
    transitionalDiscipline: {
      status: "VERIFIED_PRESENT",
      evidenceSourceId: "assessment-law",
      provisionReference: "art. 30 legge 1/2026",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effect: "EXCLUDES_PENDING_PROCEEDINGS",
      determiningFactRole: "PROCEEDING_STARTED",
      previousRegimeEvidenceSourceId: null,
      exceptions: [],
      interpretationRationale: "La disposizione ufficiale esclude i procedimenti pendenti alla data di entrata in vigore.",
    },
    reviewStatus: "HUMAN_CONFIRMED",
    reviewerAttestation: {
      reviewedByActorId: "reviewer-1",
      reviewedAt: "2026-05-02T10:00:00.000Z",
      rationale: "Verifica professionale della fonte, dei fatti e della disciplina transitoria completata.",
    },
    ...overrides,
  };
}

function mission(reviewOverrides: Partial<LegalApplicabilityReview> = {}, sourceOverrides: Partial<SourceChainSnapshot> = {}): StructuredReportMissionInput {
  const lawReview = review(reviewOverrides);
  return {
    missionId: "mission-1",
    missionFingerprint: digest("mission"),
    knowledgeRevisionId: "revision-1",
    legalIssueSemanticKey: digest("issue-1-key"),
    researchQuestionSemanticKey: digest("question-1-key"),
    lifecycleStatus: "CURRENT",
    status: "COMPLETED",
    question: "Quale regime si applica?",
    coverageStatus: "COMPLETE",
    sourceGaps: [],
    legalApplicabilityReviews: [{
      review: lawReview,
      recordedByActorId: lawReview.reviewerAttestation.reviewedByActorId,
      orchestratorVerification: {
        valid: true,
        source: lawReview.ruleOrchestrator.source,
        ruleMatched: lawReview.ruleOrchestrator.ruleMatched,
        resolvedSources: [lawReview.ruleOrchestrator.source],
        matchedSourceIds: [lawReview.ruleOrchestrator.source.id],
      },
    }],
    results: [{
      resultId: "result-law",
      title: "Legge 1/2026",
      sourceUrl: "https://normattiva.example/legge-1-2026",
      provider: "official-synthetic",
      supportDirection: "SUPPORTS",
      classificationReviewStatus: "HUMAN_CONFIRMED",
      classificationRationale: "Fonte normativa candidata",
      sourceAssessment: {
        assessmentId: "assessment-law",
        chainFingerprint: digest("chain"),
        isCurrent: true,
        usable: true,
        citationAnchors: [{ section: "art. 30" }],
        blockingReasons: [],
        manualReviewRequired: false,
        manualReviewReason: null,
        sourceFamilyId: "law-2026",
        sourceVersionId: "source-version-law",
        sourceChain: sourceChain("assessment-law", "law", sourceOverrides),
        temporalAssessment: temporal(),
      },
    }],
  };
}

function report(
  reviewOverrides: Partial<LegalApplicabilityReview> = {},
  sourceOverrides: Partial<SourceChainSnapshot> = {},
  uncertainStart = false,
  knowledgeOverride?: StructuredKnowledgeReadModel,
) {
  const currentKnowledge = knowledgeOverride ?? knowledge(uncertainStart);
  return buildStructuredFascicoloReport({
    tenantId: "tenant-1",
    procedimentoId: "case-1",
    knowledge: currentKnowledge,
    missions: [mission(reviewOverrides, sourceOverrides)],
    contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
  });
}

describe("offline legal applicability report pipeline", () => {
  it("carries the pending-proceeding exclusion through to the final V2 report", () => {
    const built = report();
    const application = built.payload.legalApplicability?.applications[0];

    expect(built.payload.contractVersion).toBe("STRUCTURED_FASCICOLO_REPORT_V2");
    expect(application?.assessment?.chronologicalCheck.outcome).toBe("SATISFIED");
    expect(application?.assessment?.transitionalCheck).toMatchObject({
      outcome: "NOT_SATISFIED",
      reasonCodes: ["PENDING_PROCEEDING_EXCLUDED"],
    });
    expect(application?.outcome).toBe("NOT_APPLICABLE");
    expect(application?.assessment?.decisiveFacts.map((fact) => fact.factClaimId)).toEqual([
      "application-2024",
      "pending-2026",
      "proceeding-2025",
    ]);
    expect(application?.assessment?.sourcesUsed[0].citationAnchors).toEqual([{ section: "art. 30" }]);
  });

  it("renders a documented AI proposal as preliminary and requiring professional review", () => {
    const application = report({
      reviewStatus: "AI_PROPOSED",
      reviewerAttestation: {
        reviewedByActorId: "automatic-worker",
        reviewedAt: "2026-05-01T10:00:00.000Z",
        rationale: "Proposta automatica documentata da verificare professionalmente.",
      },
    }).payload.legalApplicability?.applications[0];

    expect(application).toMatchObject({
      status: "PRELIMINARY_AI_PROPOSED",
      outcome: "NOT_APPLICABLE",
      professionalReviewRequired: true,
    });
    expect(application?.reasonCodes).toContain("PROFESSIONAL_REVIEW_REQUIRED");
  });

  it("preserves the historical confirmation and exposes a changed resolution for new review", () => {
    const currentMission = mission();
    const confirmed = currentMission.legalApplicabilityReviews![0].review;
    const changed = review({
      reviewId: "review-law-resolution-b",
      applicationId: "application-law-resolution-b",
      reviewStatus: "AI_PROPOSED",
      ruleOrchestrator: {
        ...confirmed.ruleOrchestrator,
        resolutionFingerprint: "b".repeat(64),
      },
      reviewerAttestation: {
        reviewedByActorId: "automatic-worker",
        reviewedAt: "2026-05-03T10:00:00.000Z",
        rationale: "Nuova proposta prodotta dopo una variazione sostanziale della rule resolution.",
      },
    });
    const built = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      knowledge: knowledge(),
      missions: [{
        ...currentMission,
        legalApplicabilityReviews: [
          currentMission.legalApplicabilityReviews![0],
          {
            review: changed,
            recordedByActorId: "automatic-worker",
            orchestratorVerification: {
              valid: true,
              source: changed.ruleOrchestrator.source,
              ruleMatched: changed.ruleOrchestrator.ruleMatched,
              resolvedSources: [changed.ruleOrchestrator.source],
              matchedSourceIds: [changed.ruleOrchestrator.source.id],
            },
          },
        ],
      }],
      contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
    });
    expect(built.payload.legalApplicability?.applications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        applicationId: confirmed.applicationId,
        reviewStatus: "HUMAN_CONFIRMED",
      }),
      expect.objectContaining({
        applicationId: changed.applicationId,
        status: "PRELIMINARY_AI_PROPOSED",
        reviewStatus: "AI_PROPOSED",
        professionalReviewRequired: true,
      }),
    ]));
  });

  it("keeps a negated or unproven completion non-definitive in the V2 report", () => {
    const application = report({
      factBindings: review().factBindings.map((binding) => (
        binding.role === "PROCEEDING_STATUS"
          ? { ...binding, value: "UNKNOWN" as const }
          : binding
      )),
    }).payload.legalApplicability?.applications[0];

    expect(application).toMatchObject({
      status: "TO_VERIFY",
      outcome: "TO_VERIFY",
      professionalReviewRequired: true,
    });
    expect(application?.assessment?.transitionalCheck.reasonCodes).toContain(
      "PENDING_PROCEEDING_STATUS_AT_EFFECTIVE_DATE_NOT_ESTABLISHED",
    );
  });

  it("keeps proceeding A unresolved when only proceeding B is documented as pending", () => {
      const mixedKnowledge = knowledge();
      const pendingA = mixedKnowledge.facts.find((item) => item.id === "pending-2026")!;
      const pendingB = {
        ...pendingA,
        id: "pending-b",
        normalizedText: "Il procedimento amministrativo B è ancora pendente.",
        payload: {
          ...pendingA.payload as Record<string, unknown>,
          proceedingIdentity: {
            canonicalAnchorSemanticKey: digest("b"),
            kind: "ADMINISTRATIVE_ORIGINAL",
            evidenceBasisRefs: ["pending-2026.PAGE_1"],
          },
        },
      };
      const mixedIssue = mixedKnowledge.legalIssues[0];
      const currentKnowledge = {
        ...mixedKnowledge,
        facts: mixedKnowledge.facts.map((item) => item.id === pendingA.id ? pendingB : item),
        legalIssues: [{
          ...mixedIssue,
          originatingItemIds: mixedIssue.originatingItemIds.map((id) => id === pendingA.id ? pendingB.id : id),
        }],
      };
      const application = report({
        factBindings: review().factBindings.map((binding) => (
          binding.knowledgeItemId === pendingA.id
            ? {
                ...binding,
                knowledgeItemId: pendingB.id,
                proceedingIdentity: {
                  canonicalAnchorSemanticKey: digest("b"),
                  kind: "ADMINISTRATIVE_ORIGINAL",
                  verification: "DOCUMENTED",
                  evidenceLinkIds: proceedingIdentity(pendingA.id).evidenceLinkIds,
                },
              }
            : binding
        )),
        factualApplicability: {
          ...review().factualApplicability,
          decisiveKnowledgeItemIds: review().factualApplicability.decisiveKnowledgeItemIds.map(
            (id) => id === pendingA.id ? pendingB.id : id,
          ),
        },
      }, {}, false, currentKnowledge).payload.legalApplicability?.applications[0];

      expect(application).toMatchObject({
        outcome: "TO_VERIFY",
        professionalReviewRequired: true,
      });
      expect(application?.assessment?.transitionalCheck.reasonCodes).toContain(
        "PENDING_PROCEEDING_STATUS_AT_EFFECTIVE_DATE_NOT_ESTABLISHED",
      );
    });

  it("degrades a legacy review without proceeding identity to TO_VERIFY", () => {
      const legacyKnowledge = knowledge();
      const legacyItems = (items: readonly StructuredKnowledgeReadItem[]) => items.map((item) => ({
        ...item,
        payload: item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
          ? (Object.fromEntries(Object.entries(item.payload).filter(([key]) => key !== "proceedingIdentity")) as StructuredKnowledgeReadItem["payload"])
          : item.payload,
      }));
      const legacyIssue = legacyKnowledge.legalIssues[0];
      const application = report({
        targetProceedingIdentity: undefined,
        factBindings: review().factBindings.map(({ proceedingIdentity: _identity, ...binding }) => binding),
      }, {}, false, {
        ...legacyKnowledge,
        facts: legacyItems(legacyKnowledge.facts),
        events: legacyItems(legacyKnowledge.events),
        legalIssues: [{
          ...legacyIssue,
          payload: Object.fromEntries(Object.entries(legacyIssue.payload as Record<string, unknown>)
            .filter(([key]) => key !== "targetProceedingIdentity")) as StructuredKnowledgeReadItem["payload"],
        }],
      }).payload.legalApplicability?.applications[0];

      expect(application).toMatchObject({
        outcome: "TO_VERIFY",
        professionalReviewRequired: true,
      });
      expect(application?.assessment?.transitionalCheck.reasonCodes).toContain(
        "TARGET_PROCEEDING_IDENTITY_UNVERIFIED",
      );
  });

  it("rejects a persisted proceeding identity that does not match structured knowledge", () => {
      const application = report({
        targetProceedingIdentity: {
          ...proceedingIdentity("issue-1"),
          canonicalAnchorSemanticKey: digest("f"),
        },
      }).payload.legalApplicability?.applications[0];
      expect(application).toMatchObject({
        status: "TO_VERIFY",
        outcome: "TO_VERIFY",
        assessment: null,
        reasonCodes: ["TARGET_PROCEEDING_IDENTITY_MISMATCH"],
      });
  });

  it.each([
    ["clause unavailable", { transitionalDiscipline: { status: "UNAVAILABLE", expectedProvisionReference: "art. 30", rationale: "Clausola non reperibile nella fonte acquisita." } }, {}, false, "TO_VERIFY"],
    ["uncertain proceeding date", {}, {}, true, "TO_VERIFY"],
    ["materially irrelevant source", {     ruleOrchestrator: { input: { enteId: "tenant-1", referenceDate: "2026-05-01T00:00:00.000Z" }, source: { ...evaluatedSource("law-2026"), applicable: false, exclusionReasons: ["NOT_CONFORMATIVE_SUPPORT"] }, ruleMatched: false, resolutionFingerprint: digest("rule") } }, {}, false, "NOT_APPLICABLE"],
    ["non-official source", {}, { officiality: "NON_OFFICIAL" }, false, "TO_VERIFY"],
    ["stale review", { knowledgeRevisionId: "revision-old" }, {}, false, "TO_VERIFY"],
    ["cross-tenant source", {}, { tenantId: "tenant-other" }, false, "TO_VERIFY"],
  ] as const)("%s is represented conservatively in the final report", (_name, reviewOverrides, sourceOverrides, uncertainStart, outcome) => {
    const application = report(
      reviewOverrides as Partial<LegalApplicabilityReview>,
      sourceOverrides as Partial<SourceChainSnapshot>,
      uncertainStart,
    ).payload.legalApplicability?.applications[0];
    expect(application?.outcome).toBe(outcome);
    expect(application?.status).toBe(outcome === "NOT_APPLICABLE" ? "ASSESSED" : "TO_VERIFY");
  });

  it("requires documented evidence before accepting verified absence", () => {
    const application = report({
      transitionalDiscipline: {
        status: "VERIFIED_ABSENT",
        evidenceSourceId: "assessment-law",
        absenceAttestation: {
          sourceContentSha256: digest("different"),
          reviewScope: "COMPLETE_OFFICIAL_TEXT",
          examinedProvisions: ["articoli 1-40"],
          examinedAnnexes: [],
          linkedActsChecked: [],
          reviewedByActorId: "reviewer-1",
          reviewedAt: "2026-05-02T10:00:00.000Z",
          rationale: "Esame integrale dichiarato, ma fingerprint non corrispondente alla fonte persistita.",
        },
        rationale: "Non sono state individuate disposizioni transitorie.",
      },
    }).payload.legalApplicability?.applications[0];

    expect(application?.outcome).toBe("TO_VERIFY");
    expect(application?.assessment?.transitionalCheck.reasonCodes).toContain("TRANSITIONAL_ABSENCE_NOT_ESTABLISHED");
  });

  it("handles express retroactivity, preserved previous regime and special-rule displacement distinctly", () => {
    const retroactive = report({
      transitionalDiscipline: {
        ...(review().transitionalDiscipline as Extract<LegalApplicabilityReview["transitionalDiscipline"], { status: "VERIFIED_PRESENT" }>),
        effect: "EXPRESSLY_RETROACTIVE",
      },
    }).payload.legalApplicability?.applications[0];
    const special = report({
      normRelationship: {
        outcome: "CANDIDATE_DISPLACED_BY_SPECIAL_RULE",
        rationale: "La disciplina speciale concessoria prevale sulla regola generale.",
        competingEvidenceSourceId: "assessment-law",
      },
    }).payload.legalApplicability?.applications[0];
    const previousRegime = report({
      transitionalDiscipline: {
        ...(review().transitionalDiscipline as Extract<LegalApplicabilityReview["transitionalDiscipline"], { status: "VERIFIED_PRESENT" }>),
        effect: "PRESERVES_PREVIOUS_REGIME",
        previousRegimeEvidenceSourceId: "assessment-law",
      },
    }).payload.legalApplicability?.applications[0];

    expect(retroactive?.assessment?.transitionalCheck.reasonCodes).toContain("EXPRESS_RETROACTIVITY_VERIFIED");
    expect(previousRegime?.assessment?.transitionalCheck.reasonCodes).toContain("PREVIOUS_REGIME_PRESERVED");
    expect(previousRegime?.outcome).toBe("NOT_APPLICABLE");
    expect(special?.assessment?.specialityCheck.reasonCodes).toContain("CANDIDATE_DISPLACED_BY_SPECIAL_RULE");
    expect(special?.outcome).toBe("NOT_APPLICABLE");
  });

  it("evaluates later case law separately without treating it as retroactive legislation", () => {
    const caseLawReview = review({
      reviewId: "review-case-law",
      applicationId: "application-case-law",
      legalAuthorityKind: "CASE_LAW",
      candidateProvisionReference: "Sentenza 4/2026, principio di diritto",
      transitionalDiscipline: {
        status: "UNAVAILABLE",
        expectedProvisionReference: null,
        rationale: "La sentenza sopravvenuta non costituisce una disciplina transitoria normativa.",
      },
    });
    const baseMission = mission(caseLawReview);
    const caseLawMission: StructuredReportMissionInput = {
      ...baseMission,
      legalApplicabilityReviews: [{
        review: caseLawReview,
        recordedByActorId: "reviewer-1",
        orchestratorVerification: {
          valid: true,
          source: caseLawReview.ruleOrchestrator.source,
          ruleMatched: caseLawReview.ruleOrchestrator.ruleMatched,
        },
      }],
      results: baseMission.results.map((result) => ({
        ...result,
        title: "Sentenza 4/2026",
        sourceAssessment: result.sourceAssessment ? {
          ...result.sourceAssessment,
          sourceChain: sourceChain("assessment-law", "judgment"),
          temporalAssessment: temporal(true),
        } : null,
      })),
    };
    const application = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      knowledge: knowledge(),
      missions: [caseLawMission],
      contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
    }).payload.legalApplicability?.applications[0];

    expect(application?.outcome).toBe("TO_VERIFY");
    expect(application?.assessment?.chronologicalCheck.reasonCodes).toContain("CASE_LAW_CHRONOLOGICAL_AVAILABILITY_ONLY");
    expect(application?.assessment?.transitionalCheck.reasonCodes).not.toContain("EXPRESS_RETROACTIVITY_VERIFIED");
  });

  it("preserves V1 compatibility and marks missing V2 reviews as not evaluated", () => {
    const legacy = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      knowledge: knowledge(),
      missions: [mission()],
    });
    const noReviewMission = { ...mission(), legalApplicabilityReviews: [] };
    const current = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      knowledge: knowledge(),
      missions: [noReviewMission],
      contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
    });

    expect(legacy.payload.contractVersion).toBe("STRUCTURED_FASCICOLO_REPORT_V1");
    expect(legacy.payload.legalApplicability).toBeUndefined();
    expect(current.payload.legalApplicability?.applications[0]).toMatchObject({
      status: "NOT_EVALUATED",
      outcome: "NOT_EVALUATED",
      reasonCodes: ["LEGAL_APPLICABILITY_REVIEW_MISSING"],
    });
  });

  it("reads direct and historical wrapped snapshots while preserving each review author", () => {
    const firstAi = review({
      reviewId: "review-ai-1",
      reviewStatus: "AI_PROPOSED",
      reviewerAttestation: {
        reviewedByActorId: "automatic-worker",
        reviewedAt: "2026-05-01T10:00:00.000Z",
        rationale: "Proposta automatica documentata.",
      },
    });
    const secondAi = review({
      reviewId: "review-ai-2",
      applicationId: "application-ai-2",
      reviewStatus: "AI_PROPOSED",
      reviewerAttestation: {
        reviewedByActorId: "automatic-worker",
        reviewedAt: "2026-05-01T10:01:00.000Z",
        rationale: "Seconda proposta automatica.",
      },
    });
    const confirmed = {
      ...firstAi,
      reviewStatus: "HUMAN_CONFIRMED" as const,
      reviewerAttestation: {
        reviewedByActorId: "professional-1",
        reviewedAt: "2026-05-02T10:00:00.000Z",
        rationale: "Conferma professionale.",
      },
    };
    const aiSnapshot = createAssistedVerificationSnapshot({
      missionId: "mission-1",
      sources: [],
      legalApplicabilityReviews: [firstAi, secondAi],
    });
    const humanSnapshot = createAssistedVerificationSnapshot({
      missionId: "mission-1",
      sources: [],
      legalApplicabilityReviews: [confirmed, secondAi],
    });
    const laterWorkerSnapshot = createAssistedVerificationSnapshot({
      missionId: "mission-1",
      sources: [],
      legalApplicabilityReviews: [confirmed, secondAi],
    });

    const projected = projectApplicabilityReviewHistory([
      { payload: laterWorkerSnapshot, recordedByActorId: "automatic-worker" },
      { payload: { snapshot: humanSnapshot }, recordedByActorId: "professional-1" },
      { payload: aiSnapshot, recordedByActorId: "automatic-worker" },
    ]);

    expect(projected.issues).toEqual([]);
    expect(projected.reviews.map((entry) => ({
      reviewId: entry.review.reviewId,
      reviewStatus: entry.review.reviewStatus,
      recordedByActorId: entry.recordedByActorId,
    }))).toEqual([
      {
        reviewId: "review-ai-1",
        reviewStatus: "HUMAN_CONFIRMED",
        recordedByActorId: "professional-1",
      },
      {
        reviewId: "review-ai-2",
        reviewStatus: "AI_PROPOSED",
        recordedByActorId: "automatic-worker",
      },
    ]);
  });

  it("surfaces invalid or untraceable persisted applicability reviews", () => {
    const untraceable = review({
      reviewerAttestation: {
        reviewedByActorId: "original-actor",
        reviewedAt: "2026-05-01T10:00:00.000Z",
        rationale: "Attestazione non attribuibile allo scrittore dello snapshot.",
      },
    });
    const snapshot = createAssistedVerificationSnapshot({
      missionId: "mission-1",
      sources: [],
      legalApplicabilityReviews: [untraceable],
    });

    expect(projectApplicabilityReviewHistory([
      { payload: snapshot, recordedByActorId: "different-actor" },
    ]).reviews[0]?.recordedByActorId).toBeNull();
    expect(projectApplicabilityReviewHistory([
      { payload: { unexpected: true }, recordedByActorId: "actor-1" },
    ])).toEqual({
      reviews: [],
      issues: ["PERSISTED_APPLICABILITY_REVIEW_INVALID"],
    });
  });
});

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { stableStringify } from "@/server/audit/hash";
import type { StructuredReportResearchResultInput } from "@/server/fascicolo-report";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";
import { loadCurrentStructuredKnowledge } from "@/server/queries/fascicolo-knowledge";
import { resolveApplicableLegalRules } from "@/server/legal-rules/orchestrator";
import type { EvaluatedSourceResult, RuleResolutionInput, RuleResolutionResult } from "@/server/legal-rules/types";
import type { SourceChainSnapshot } from "@/server/legal-research/source-chain";
import type { TemporalAssessmentResult } from "@/server/legal-sources/temporal";
import { documentedProceedingIdentity } from "@/server/legal-reasoning/applicability/proceeding-identity";
import { isCanonicalIdentityV3Enabled } from "@/server/fascicolo-knowledge/canonicalIntegrationGate";

import {
  createAssistedVerificationSnapshot,
  LEGAL_APPLICABILITY_REVIEW_VERSION,
  type LegalApplicabilityReview,
} from "./assisted-verification";
import {
  getLatestAssistedVerification,
  persistAssistedVerification,
} from "./persistence";

export const AUTOMATIC_LEGAL_APPLICABILITY_PRODUCER_VERSION =
  "AUTOMATIC_LEGAL_APPLICABILITY_PRODUCER_V2" as const;

type CandidateSnapshot = Readonly<{
  sourceFamily?: string;
  documentType?: string;
  relevantPassage?: string;
  providerReceivedText?: string;
  officialRelevantPassage?: string;
  officialCitationReference?: string;
  officialContentSha256?: string;
}>;

function resolutionEvidence(result: RuleResolutionResult): unknown {
  const { evaluatedAt: _evaluatedAt, ...stable } = result;
  return stable;
}

export function ruleResolutionFingerprint(
  input: RuleResolutionInput,
  result: RuleResolutionResult,
): string {
  return createHash("sha256")
    .update(stableStringify({
      producerVersion: AUTOMATIC_LEGAL_APPLICABILITY_PRODUCER_VERSION,
      input,
      result: resolutionEvidence(result),
    }), "utf8")
    .digest("hex");
}

export function verifyRuleResolutionFingerprint(input: {
  review: LegalApplicabilityReview;
  resolution: RuleResolutionResult;
}): Readonly<{
  valid: boolean;
  source: EvaluatedSourceResult | null;
  ruleMatched: boolean;
}> {
  const sources = [
    ...input.resolution.applicableSources,
    ...input.resolution.excludedByTerritory,
    ...input.resolution.excludedByDate,
    ...input.resolution.historicalSources,
    ...input.resolution.supersededSources,
    ...input.resolution.partiallySupersededSources,
    ...input.resolution.pendingValiditySources,
    ...input.resolution.draftOrOngoingSources,
    ...input.resolution.caseSpecificSources,
  ];
  const source = sources.find((item) => item.id === input.review.ruleOrchestrator.source.id) ?? null;
  const ruleMatched = source !== null && input.resolution.applicableRules.some((rule) => (
    rule.source.id === source.id
  ));
  return {
    valid: source !== null
      && ruleMatched === input.review.ruleOrchestrator.ruleMatched
      && ruleResolutionFingerprint(input.review.ruleOrchestrator.input, input.resolution)
        === input.review.ruleOrchestrator.resolutionFingerprint,
    source,
    ruleMatched,
  };
}

export function mergeAutomaticApplicabilityReviews(
  current: readonly LegalApplicabilityReview[],
  candidates: readonly LegalApplicabilityReview[],
): readonly LegalApplicabilityReview[] {
  for (const reviews of [current, candidates]) {
    if (new Set(reviews.map((review) => review.reviewId)).size !== reviews.length
      || new Set(reviews.map((review) => review.applicationId)).size !== reviews.length) {
      throw new Error("DUPLICATE_LEGAL_APPLICABILITY_REVIEW_IDENTITY");
    }
  }
  const confirmedApplicationIds = new Set(current
    .filter((review) => review.reviewStatus === "HUMAN_CONFIRMED")
    .map((review) => review.applicationId));
  const acceptedCandidates = candidates.filter((candidate) => (
    !confirmedApplicationIds.has(candidate.applicationId)
  ));
  const preserved = current.filter((review) => (
    review.reviewStatus === "HUMAN_CONFIRMED"
      || !acceptedCandidates.some((candidate) => (
        candidate.applicationId === review.applicationId
        || candidate.candidateEvidenceSourceId === review.candidateEvidenceSourceId
      ))
  ));
  return [...preserved, ...acceptedCandidates];
}

function itemDate(item: StructuredKnowledgeReadItem): string | null {
  if (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return null;
  const date = item.payload.date;
  if (!date || typeof date !== "object" || Array.isArray(date)) return null;
  if (date.precision !== "EXACT" || typeof date.from !== "string" || item.evidence.length === 0) return null;
  return date.to === null || date.to === date.from ? date.from : null;
}

type ProceedingStatusValue = "PENDING" | "COMPLETED" | "UNKNOWN";

function normalizeProceedingStatusText(text: string): string {
  return text
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/\?/g, " question ")
    .replace(/[.!;\r\n]+/g, " | ")
    .replace(/\b(?:ma|mentre)\b/g, " | ")
    .replace(/[-–—,:()[\]{}"'«»/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function proceedingStatusClauses(text: string): readonly string[] {
  return normalizeProceedingStatusText(text)
    .split("|")
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function mentionsStatusLanguage(clause: string): boolean {
  return /\b(?:conclus\w*|chius\w*|terminat\w*|definit\w*|penden\w*|in corso)\b/.test(clause);
}

function refersToDifferentProceeding(clause: string): boolean {
  return /\b(?:altro|diverso|differente)\s+procediment\w*\b/.test(clause)
    || /\bprocediment\w*\s+(?:altro|diverso|differente|penale|giurisdizionale|incidentale|d'appello|di appello)\b/.test(clause)
    || /\bprocediment\w*\s+(?:relativo|riferito)\s+(?:a|ad)\b/.test(clause)
    || /\b(?:fase|istruttori\w*)\b(?:\s+\w+){0,5}\s+\bprocediment\w*\b/.test(clause);
}

function explicitClauseProceedingStatus(clause: string): ProceedingStatusValue | null {
  if (!/\bprocediment\w*\b/.test(clause) || !mentionsStatusLanguage(clause)) return null;
  if (refersToDifferentProceeding(clause)) return "UNKNOWN";

  const subject = "(?:(?:il|questo|tale) )?procedimento(?: amministrativo)?";
  const completion = "(?:concluso|chiuso|terminato|definito)";
  const pending = "(?:pendente|in corso)";
  const completedAssertions = [
    new RegExp(`^${subject} (?:e|era|risulta) (?:definitivamente )?${completion}$`),
    new RegExp(`^${subject} si e (?:definitivamente )?${completion}$`),
    new RegExp(`^${subject} ${completion}$`),
  ];
  const pendingAssertions = [
    new RegExp(`^${subject} (?:e|era|risulta|rimane) (?:ancora )?${pending}$`),
    new RegExp(`^${subject} (?:e|era|risulta) tuttora ${pending}$`),
  ];
  if (completedAssertions.some((pattern) => pattern.test(clause))) return "COMPLETED";
  if (pendingAssertions.some((pattern) => pattern.test(clause))) return "PENDING";
  return "UNKNOWN";
}

function ellipticalClauseProceedingStatus(clause: string): ProceedingStatusValue | null {
  const prefix = "(?:(?:ora|adesso|successivamente) )?";
  if (new RegExp(`^${prefix}(?:e|risulta|si e) (?:definitivamente )?(?:concluso|chiuso|terminato|definito)$`).test(clause)) {
    return "COMPLETED";
  }
  if (new RegExp(`^${prefix}(?:e|risulta|rimane) (?:ancora )?(?:pendente|in corso)$`).test(clause)) {
    return "PENDING";
  }
  return null;
}

function proceedingStatusValue(text: string, documented: boolean): ProceedingStatusValue {
  let current: ProceedingStatusValue | null = null;
  let explicitReferent = false;
  for (const clause of proceedingStatusClauses(text)) {
    const explicit = explicitClauseProceedingStatus(clause);
    const elliptical = explicitReferent ? ellipticalClauseProceedingStatus(clause) : null;
    const ambiguousEllipsis = explicitReferent
      && explicit === null
      && elliptical === null
      && mentionsStatusLanguage(clause)
      && !/\b(?:ricorso|appello|giudizio|procediment\w*)\b/.test(clause);
    const status = explicit ?? elliptical ?? (ambiguousEllipsis ? "UNKNOWN" : null);
    if (status === null) continue;
    if (explicit !== null) explicitReferent = true;
    if (status === "UNKNOWN" || !documented) return "UNKNOWN";
    if (current === "COMPLETED" && status === "PENDING") return "UNKNOWN";
    current = status;
  }
  return current ?? "UNKNOWN";
}

function hasRelevantProceedingStart(text: string): boolean {
  return proceedingStatusClauses(text).some((clause) => {
    if (refersToDifferentProceeding(clause)) return false;
    const subject = "(?:(?:il|questo|tale) )?procedimento(?: amministrativo)?";
    return new RegExp(`^${subject} (?:e stato )?(?:avviato|iniziato|aperto)(?: (?:nel|in data|il) .+)?$`).test(clause)
      || new RegExp(`^avvio del ${subject}(?: (?:nel|in data|il) .+)?$`).test(clause);
  });
}

function factRole(item: StructuredKnowledgeReadItem): LegalApplicabilityReview["factBindings"][number]["role"] {
  const value = item.normalizedText.toLocaleLowerCase("it-IT");
  if (/(istanza|domanda).*(presentat|depositat)|presentat.*(istanza|domanda)/.test(value)) return "APPLICATION_SUBMITTED";
  if (hasRelevantProceedingStart(item.normalizedText)) return "PROCEEDING_STARTED";
  if (proceedingStatusClauses(item.normalizedText).some((clause) => (
    explicitClauseProceedingStatus(clause) !== null
  ))) {
    return "PROCEEDING_STATUS";
  }
  if (/(provvediment|decreto|ordinanza).*(adottat|emanat)|adottat.*provvediment/.test(value)) return "CHALLENGED_ACT_ADOPTED";
  if (/(concession|rapporto).*(costituit|rilasciat)|rilasciat.*concession/.test(value)) return "LEGAL_RELATIONSHIP_ESTABLISHED";
  return item.kind === "MEASURE" ? "DECISION_ADOPTED" : "OTHER";
}

function facts(
  knowledge: StructuredKnowledgeReadModel,
  legalIssueSemanticKey: string,
): LegalApplicabilityReview["factBindings"] {
  const issue = knowledge.legalIssues.find((item) => item.semanticKey === legalIssueSemanticKey);
  if (!issue) return [];
  const originatingItemIds = new Set(issue.originatingItemIds);
  const candidates = [
    ...knowledge.facts,
    ...knowledge.events,
    ...knowledge.legalActs,
    ...knowledge.measures,
  ].filter((item) => (
    item.status !== "REJECTED"
    && (!isCanonicalIdentityV3Enabled()
      || item.identityState === "VERIFIED_NEW"
      || item.identityState === "VERIFIED_CONTINUATION")
    && originatingItemIds.has(item.id)
    && itemDate(item) !== null
  ));
  return candidates.map((item) => {
    const role = factRole(item);
    return {
      knowledgeItemId: item.id,
      role,
      proceedingIdentity: documentedProceedingIdentity(item, "proceedingIdentity"),
      ...(role === "PROCEEDING_STATUS"
        ? { value: proceedingStatusValue(item.normalizedText, item.evidence.length > 0) }
        : {}),
    };
  });
}

function transitionalDiscipline(input: {
  text: string;
  assessmentId: string;
  citationReference: string;
  effectiveFrom: string;
}): LegalApplicabilityReview["transitionalDiscipline"] {
  const normalized = input.text.toLocaleLowerCase("it-IT").replace(/\s+/g, " ");
  if (/(procediment\w*\s+pendent|procediment\w*.*gia avviat)/.test(normalized)
    && /(non si applic|restano disciplinat|continua ad applicarsi)/.test(normalized)) {
    return {
      status: "VERIFIED_PRESENT",
      evidenceSourceId: input.assessmentId,
      provisionReference: input.citationReference,
      effectiveFrom: input.effectiveFrom,
      effect: "EXCLUDES_PENDING_PROCEEDINGS",
      determiningFactRole: "PROCEEDING_STARTED",
      previousRegimeEvidenceSourceId: null,
      exceptions: [],
      interpretationRationale: "Il testo ufficiale contiene un'esclusione espressa riferita ai procedimenti pendenti; proposta automatica da verificare professionalmente.",
    };
  }
  if (/\b(retroattiv|efficacia retroattiva|si applica anche ai rapporti sorti)\b/.test(normalized)) {
    return {
      status: "VERIFIED_PRESENT",
      evidenceSourceId: input.assessmentId,
      provisionReference: input.citationReference,
      effectiveFrom: input.effectiveFrom,
      effect: "EXPRESSLY_RETROACTIVE",
      determiningFactRole: "RELEVANT_CONDUCT",
      previousRegimeEvidenceSourceId: null,
      exceptions: [],
      interpretationRationale: "Il testo ufficiale contiene un richiamo espresso alla retroattivita; proposta automatica da verificare professionalmente.",
    };
  }
  if (/(continua ad applicarsi|resta applicabile|regime previgente)/.test(normalized)) {
    return {
      status: "AMBIGUOUS",
      expectedProvisionReference: input.citationReference,
      rationale: "Il testo segnala una possibile ultrattivita o conservazione del regime previgente, ma la fonte previgente non e ancora collegata.",
    };
  }
  return {
    status: "UNAVAILABLE",
    expectedProvisionReference: null,
    rationale: "Nessuna clausola transitoria e stata individuata nel passaggio ufficiale disponibile; cio non ne prova l'assenza.",
  };
}

export function produceAutomaticLegalApplicabilityReview(input: {
  tenantId: string;
  knowledge: StructuredKnowledgeReadModel;
  missionId: string;
  legalIssueSemanticKey: string;
  candidate: CandidateSnapshot;
  result: StructuredReportResearchResultInput;
  orchestrationInput: RuleResolutionInput;
  orchestrationResult: RuleResolutionResult;
  actorId: string;
  producedAt: string;
}): LegalApplicabilityReview | null {
  const assessment = input.result.sourceAssessment;
  if (!assessment?.sourceChain
    || !assessment.temporalAssessment
    || !assessment.sourceVersionId
    || !assessment.sourceFamilyId
    || assessment.sourceChain.officiality !== "OFFICIAL"
    || assessment.sourceChain.textState !== "FULL_TEXT"
    || assessment.sourceChain.identityState !== "VERIFIED"
    || assessment.sourceChain.contentState !== "VERIFIED") return null;
  const officialText = input.candidate.officialRelevantPassage;
  const citationReference = input.candidate.officialCitationReference;
  const citationMatches = citationReference?.trim()
    && assessment.sourceChain.citationAnchors.some((anchor) => anchor.section === citationReference);
  if (!officialText?.trim()
    || !citationReference?.trim()
    || !citationMatches
    || input.candidate.officialContentSha256 !== assessment.sourceChain.contentSha256) return null;
  const verification = [
    ...input.orchestrationResult.applicableSources,
    ...input.orchestrationResult.excludedByTerritory,
    ...input.orchestrationResult.excludedByDate,
    ...input.orchestrationResult.historicalSources,
    ...input.orchestrationResult.supersededSources,
    ...input.orchestrationResult.partiallySupersededSources,
    ...input.orchestrationResult.pendingValiditySources,
    ...input.orchestrationResult.draftOrOngoingSources,
    ...input.orchestrationResult.caseSpecificSources,
  ].find((source) => source.id === assessment.sourceFamilyId);
  if (!verification) return null;
  const legalIssue = input.knowledge.legalIssues.find((item) => (
    item.semanticKey === input.legalIssueSemanticKey
  ));
  if (isCanonicalIdentityV3Enabled()
    && legalIssue?.identityState !== "VERIFIED_NEW"
    && legalIssue?.identityState !== "VERIFIED_CONTINUATION") return null;
  const factBindings = facts(input.knowledge, input.legalIssueSemanticKey);
  if (factBindings.length === 0) return null;
  const targetProceedingIdentity = legalIssue
    ? documentedProceedingIdentity(legalIssue, "targetProceedingIdentity")
    : null;
  const ruleMatched = input.orchestrationResult.applicableRules.some((rule) => rule.source.id === verification.id);
  const authorityKind = /CASE|SENTEN|GIURIS/i.test(input.candidate.documentType ?? input.candidate.sourceFamily ?? "")
    ? "CASE_LAW" as const
    : "LEGISLATION" as const;
  const resolutionFingerprint = ruleResolutionFingerprint(
    input.orchestrationInput,
    input.orchestrationResult,
  );
  const applicationIdentity = createHash("sha256")
    .update(stableStringify({
      tenantId: input.tenantId,
      missionId: input.missionId,
      knowledgeRevisionId: input.knowledge.revision.id,
      legalIssueSemanticKey: input.legalIssueSemanticKey,
      targetProceedingAnchor: targetProceedingIdentity?.canonicalAnchorSemanticKey ?? null,
      sourceAssessmentId: assessment.assessmentId,
      sourceVersionId: assessment.sourceVersionId,
      provisionReference: citationReference,
      sourceChainFingerprint: assessment.chainFingerprint,
      resolutionFingerprint,
    }), "utf8")
    .digest("hex");
  return {
    version: LEGAL_APPLICABILITY_REVIEW_VERSION,
    reviewId: `automatic-review:${applicationIdentity}`,
    applicationId: `automatic-application:${applicationIdentity}`,
    knowledgeRevisionId: input.knowledge.revision.id,
    legalIssueSemanticKey: input.legalIssueSemanticKey,
    candidateEvidenceSourceId: assessment.assessmentId,
    candidateSourceVersionId: assessment.sourceVersionId,
    candidateProvisionReference: citationReference,
    legalAuthorityKind: authorityKind,
    targetProceedingIdentity,
    factBindings,
    factualApplicability: {
      outcome: "TO_VERIFY",
      rationale: "I fatti documentati sono collegati automaticamente alla fonte; la sussunzione richiede revisione professionale.",
      decisiveKnowledgeItemIds: factBindings.map((binding) => binding.knowledgeItemId),
    },
    ruleOrchestrator: {
      input: input.orchestrationInput,
      source: verification,
      ruleMatched,
      resolutionFingerprint,
    },
    normRelationship: {
      outcome: "UNRESOLVED",
      rationale: "La relazione di specialita deve essere confermata dal professionista.",
      competingEvidenceSourceId: null,
    },
    transitionalDiscipline: transitionalDiscipline({
      text: officialText,
      assessmentId: assessment.assessmentId,
      citationReference,
      effectiveFrom: assessment.temporalAssessment.effectiveInterval.from
        ?? assessment.temporalAssessment.referenceDate,
    }),
    reviewStatus: "AI_PROPOSED",
    reviewerAttestation: {
      reviewedByActorId: input.actorId,
      reviewedAt: input.producedAt,
      rationale: `Proposta preliminare prodotta da ${AUTOMATIC_LEGAL_APPLICABILITY_PRODUCER_VERSION} su fonte ufficiale verificata.`,
    },
  };
}

function jsonRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Readonly<Record<string, unknown>> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export async function produceAndPersistAutomaticLegalApplicabilityReviews(input: {
  tenantId: string;
  caseId: string;
  missionId: string;
  actorId: string;
  now?: Date;
}): Promise<readonly LegalApplicabilityReview[]> {
  const [knowledge, mission] = await Promise.all([
    loadCurrentStructuredKnowledge(input.tenantId, input.caseId),
    prisma.researchMissionRecord.findUnique({
      where: { id: input.missionId },
      select: {
        id: true,
        tenantId: true,
        caseId: true,
        legalIssueSemanticKey: true,
        researchQuestionSemanticKey: true,
        missionFingerprint: true,
        knowledgeRevisionId: true,
        referenceDate: true,
        referenceDateBasis: true,
        questionResults: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            candidateSnapshot: true,
            supportDirection: true,
            classificationReviewStatus: true,
            classificationRationale: true,
            sourceAssessments: {
              where: { isCurrent: true },
              take: 1,
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                sourceFamilyId: true,
                sourceVersionId: true,
                acquisitionId: true,
                temporalAssessmentId: true,
                chainFingerprint: true,
                sourceIdentityKey: true,
                contentSha256: true,
                retrievalState: true,
                textState: true,
                identityState: true,
                contentState: true,
                temporalState: true,
                adverseState: true,
                officiality: true,
                citationAnchors: true,
                manualReviewRequired: true,
                manualReviewReason: true,
                usable: true,
                temporalAssessment: {
                  select: {
                    assessmentVersion: true,
                    referenceDate: true,
                    validityState: true,
                    temporalWindowState: true,
                    applicabilityState: true,
                    reasonCodes: true,
                    effectiveFromSnapshot: true,
                    effectiveToSnapshot: true,
                    humanReviewRequired: true,
                    confidence: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  if (!knowledge
    || !mission
    || mission.tenantId !== input.tenantId
    || mission.caseId !== input.caseId
    || mission.knowledgeRevisionId !== knowledge.revision.id
    || !mission.legalIssueSemanticKey
    || !mission.researchQuestionSemanticKey
    || !mission.missionFingerprint) return [];
  const orchestrationInput: RuleResolutionInput = {
    enteId: input.tenantId,
    referenceDate: mission.referenceDate.toISOString(),
    includeHistorical: true,
    includePending: true,
  };
  const orchestrationResult = await resolveApplicableLegalRules(orchestrationInput);
  const producedAt = (input.now ?? new Date()).toISOString();
  const reviews = mission.questionResults.flatMap((row) => {
    const source = row.sourceAssessments[0];
    const temporal = source?.temporalAssessment;
    if (!source || !temporal) return [];
    const sourceChain: SourceChainSnapshot = {
      resultId: row.id,
      tenantId: input.tenantId,
      caseId: input.caseId,
      missionId: mission.id,
      researchQuestionSemanticKey: mission.researchQuestionSemanticKey!,
      missionFingerprint: mission.missionFingerprint!,
      referenceDate: mission.referenceDate.toISOString(),
      referenceDateBasis: mission.referenceDateBasis as Readonly<Record<string, unknown>>,
      verificationVersion: "SOURCE_CHAIN_V1",
      sourceIdentityKey: source.sourceIdentityKey,
      contentSha256: source.contentSha256,
      retrievalState: source.retrievalState,
      textState: source.textState,
      identityState: source.identityState,
      contentState: source.contentState,
      temporalState: source.temporalState,
      adverseState: source.adverseState,
      officiality: source.officiality,
      citationAnchors: jsonRecords(source.citationAnchors),
      manualReviewRequired: source.manualReviewRequired,
      manualReviewReason: source.manualReviewReason,
      currentMission: true,
    };
    const temporalAssessment = {
      assessmentVersion: temporal.assessmentVersion,
      validityState: temporal.validityState,
      temporalWindowState: temporal.temporalWindowState,
      applicabilityState: temporal.applicabilityState,
      reasonCodes: Array.isArray(temporal.reasonCodes)
        ? temporal.reasonCodes.filter((item): item is TemporalAssessmentResult["reasonCodes"][number] => typeof item === "string")
        : [],
      referenceDate: temporal.referenceDate.toISOString(),
      effectiveInterval: {
        from: temporal.effectiveFromSnapshot?.toISOString() ?? null,
        to: temporal.effectiveToSnapshot?.toISOString() ?? null,
      },
      humanReviewRequired: temporal.humanReviewRequired,
      confidence: temporal.confidence,
    } as TemporalAssessmentResult;
    const candidate = row.candidateSnapshot as CandidateSnapshot;
    const result: StructuredReportResearchResultInput = {
      resultId: row.id,
      title: candidate.officialCitationReference ?? "Fonte ufficiale",
      sourceUrl: null,
      provider: "AUTOMATIC_OFFICIAL_RESEARCH",
      supportDirection: row.supportDirection,
      classificationReviewStatus: row.classificationReviewStatus,
      classificationRationale: row.classificationRationale,
      relevantPassage: candidate.officialRelevantPassage ?? candidate.relevantPassage ?? null,
      sourceAssessment: {
        assessmentId: source.id,
        chainFingerprint: source.chainFingerprint,
        isCurrent: true,
        usable: source.usable,
        citationAnchors: jsonRecords(source.citationAnchors),
        blockingReasons: [],
        manualReviewRequired: source.manualReviewRequired,
        manualReviewReason: source.manualReviewReason,
        sourceFamilyId: source.sourceFamilyId,
        sourceVersionId: source.sourceVersionId,
        acquisitionId: source.acquisitionId,
        temporalAssessmentId: source.temporalAssessmentId,
        sourceChain,
        temporalAssessment,
      },
    };
    const review = produceAutomaticLegalApplicabilityReview({
      tenantId: input.tenantId,
      knowledge,
      missionId: mission.id,
      legalIssueSemanticKey: mission.legalIssueSemanticKey!,
      candidate,
      result,
      orchestrationInput,
      orchestrationResult,
      actorId: input.actorId,
      producedAt,
    });
    return review ? [review] : [];
  });
  if (reviews.length === 0) return [];
  const actor = { actorId: input.actorId, tenantId: input.tenantId };
  const current = await getLatestAssistedVerification(input.missionId, actor);
  await persistAssistedVerification({
    snapshot: createAssistedVerificationSnapshot({
      ...current?.snapshot,
      missionId: input.missionId,
      sources: current?.snapshot.sources ?? [],
      legalApplicabilityReviews: mergeAutomaticApplicabilityReviews(
        current?.snapshot.legalApplicabilityReviews ?? [],
        reviews,
      ),
    }),
    actor,
    expectedPreviousRecordId: current?.recordId ?? null,
  });
  return reviews;
}

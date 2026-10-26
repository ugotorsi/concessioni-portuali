import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";
import {
  assessLegalCompleteness,
  type LegalCompletenessAssessment,
} from "@/server/fascicolo-knowledge/legalCompleteness";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";
import {
  applicabilityDimensionsFromRuleOrchestrator,
  assessLegalApplicability,
  type ApplicabilityFactReference,
  type LegalApplicabilityAssessment,
  type TransitionalDiscipline,
  type VerifiedProvisionReference,
} from "@/server/legal-reasoning/applicability";
import { documentedProceedingIdentity } from "@/server/legal-reasoning/applicability/proceeding-identity";
import type { EvaluatedSourceResult } from "@/server/legal-rules/types";
import type { LegalApplicabilityReview } from "@/server/legal-research/assisted-verification";
import type { SourceChainSnapshot } from "@/server/legal-research/source-chain";
import type { TemporalAssessmentResult } from "@/server/legal-sources/temporal";

export const STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V1" as const;
export const STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V2" as const;

type JsonRecord = Readonly<Record<string, unknown>>;
type Direction = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";

function jsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export interface StructuredReportResearchResultInput {
  resultId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  supportDirection: Direction;
  classificationReviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
  classificationRationale: string | null;
  relevantPassage?: string | null;
  sourceAssessment: {
    assessmentId: string;
    chainFingerprint: string;
    isCurrent: boolean;
    usable: boolean;
    citationAnchors: readonly JsonRecord[];
    blockingReasons: readonly string[];
    manualReviewRequired: boolean;
    manualReviewReason: string | null;
    sourceFamilyId?: string | null;
    sourceVersionId?: string | null;
    acquisitionId?: string | null;
    temporalAssessmentId?: string | null;
    sourceChain?: SourceChainSnapshot;
    temporalAssessment?: TemporalAssessmentResult;
    authorityKind?: LegalApplicabilityReview["legalAuthorityKind"];
    provisionReference?: string;
  } | null;
}

export interface StructuredReportMissionInput {
  missionId: string;
  mode?: string;
  missionFingerprint: string | null;
  knowledgeRevisionId: string | null;
  researchQuestionSemanticKey: string | null;
  legalIssueSemanticKey?: string | null;
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: string;
  question: string;
  coverageStatus: string;
  sourceGaps: readonly string[];
  results: readonly StructuredReportResearchResultInput[];
  legalApplicabilityReviews?: readonly Readonly<{
    review: LegalApplicabilityReview;
    recordedByActorId: string | null;
    orchestratorVerification?: Readonly<{
      valid: boolean;
      source: LegalApplicabilityReview["ruleOrchestrator"]["source"] | null;
      ruleMatched: boolean;
      resolvedSources?: readonly EvaluatedSourceResult[];
      matchedSourceIds?: readonly string[];
    }>;
  }>[];
  legalApplicabilityReviewIssues?: readonly string[];
}

export interface StructuredReportAuthority {
  resultId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  assessmentId: string;
  sourceChainFingerprint: string;
  citationAnchors: readonly JsonRecord[];
  rationale: string | null;
}

export interface StructuredReportQuestion {
  knowledgeItemId: string;
  semanticKey: string;
  text: string;
  reviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED";
  missionId: string | null;
  missionStatus: string;
  coverageStatus: string;
  favorableAuthorities: readonly StructuredReportAuthority[];
  contraryAuthorities: readonly StructuredReportAuthority[];
  nonUsableResults: readonly {
    resultId: string;
    title: string;
    sourceUrl?: string | null;
    direction: Direction;
    rationale?: string | null;
    reasons: readonly string[];
  }[];
  gaps: readonly string[];
  limitations: readonly string[];
}

export interface StructuredReportOperationalStep {
  title: string;
  action: string;
  office: string;
  requiredDocuments: readonly string[];
  completionGate: string;
}

export interface StructuredReportOperationalAlternative {
  title: string;
  whenApplicable: string;
  practicalRoute: string;
  riskOrLimit: string;
}

export interface StructuredReportAdministrativeActDraft {
  actType: string;
  necessity: "REQUIRED_IF_PROCEEDING_STARTED" | "EVENTUAL" | "OPTIONAL";
  sequence: number;
  competentOffice: string;
  legalBasis: string;
  participationGuarantees: readonly string[];
  subsequentCommunications: readonly string[];
  templateSource: "INTERNAL_TEMPLATE_REQUIRED_IF_AVAILABLE" | "STANDARD_ADAPTABLE";
  adaptationInstructions: string;
  automaticExecutionProhibited: true;
  sections: {
    heading: string;
    subject: string;
    premises: readonly string[];
    documentedFacts: readonly string[];
    investigation: readonly string[];
    reasoning: readonly string[];
    legalReferences: readonly string[];
    operativePart: readonly string[];
    communications: readonly string[];
    signature: string;
  };
}

export interface AdministrativeActInternalTemplate {
  templateId: string;
  templateVersion: string;
  heading: string;
  sectionOrder: readonly (keyof StructuredReportAdministrativeActDraft["sections"])[];
  lockedClauses: readonly string[];
}

export interface AdaptedAdministrativeActDraft {
  originalTemplate: AdministrativeActInternalTemplate;
  adaptedSections: StructuredReportAdministrativeActDraft["sections"];
  proposedIntegrations: readonly {
    section: keyof StructuredReportAdministrativeActDraft["sections"];
    content: string | readonly string[];
  }[];
  lockedClausesPreserved: readonly string[];
  humanApprovalRequired: true;
}

export function adaptAdministrativeActToInternalTemplate(
  draft: StructuredReportAdministrativeActDraft,
  template: AdministrativeActInternalTemplate,
): AdaptedAdministrativeActDraft {
  const originalTemplate = structuredClone(template);
  const adaptedSections = {
    ...draft.sections,
    heading: template.heading,
  };
  return {
    originalTemplate,
    adaptedSections,
    proposedIntegrations: template.sectionOrder.map((section) => ({
      section,
      content: adaptedSections[section],
    })),
    lockedClausesPreserved: [...template.lockedClauses],
    humanApprovalRequired: true,
  };
}

export interface StructuredReportOperationalPlan {
  issueSemanticKey: string;
  issueText: string;
  problem: string;
  evidence: readonly string[];
  legalQualification: string;
  sourceDocumentRefs: readonly string[];
  outstandingEvidence: readonly string[];
  legalSourceStatus: "VERIFIED_SOURCES_ATTACHED" | "LEGAL_RESEARCH_REQUIRED";
  professionalStatus: "PRELIMINARY_NOT_APPROVED";
  recommendedNextStep: string;
  proposedSolution: string;
  investigationActivities: readonly string[];
  actsToForm: readonly string[];
  modelsAvailable: readonly string[];
  steps: readonly StructuredReportOperationalStep[];
  alternatives: readonly StructuredReportOperationalAlternative[];
  administrativeActs: readonly StructuredReportAdministrativeActDraft[];
  deadlineReview: string;
}

export type StructuredReportTechnicalVerificationStatus =
  | "DA_VERIFICARE_SU_FONTE_ORIGINALE"
  | "INDICATIVO_DA_VERIFICARE"
  | "RISPOSTA_VUOTA_NON_PROBATORIA";

export interface StructuredReportTechnicalSourceInput {
  recordId: string;
  missionId: string;
  toolName: string;
  questionSnapshot: string;
  verificationStatus: string;
  serviceVersion: string;
  responseDigest: string;
  retrievedAt: Date;
}

/** MCP technical/urban-planning acquisition: always non-probative, never a usable authority. */
export interface StructuredReportTechnicalSource {
  recordId: string;
  missionId: string;
  questionSemanticKey: string;
  toolName: string;
  question: string;
  verificationStatus: StructuredReportTechnicalVerificationStatus;
  probative: false;
  serviceVersion: string;
  responseDigest: string;
  retrievedAt: string;
  requiredVerification: string;
}

export interface StructuredFascicoloReportPayload {
  contractVersion: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION | typeof STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION;
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  knowledgeContractVersion: string;
  corpusFingerprint: string;
  knowledgeStateFingerprint: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
  documentedFramework: {
    partyRoles: readonly StructuredKnowledgeReadItem[];
    partyPositions?: readonly StructuredKnowledgeReadItem[];
    facts: readonly StructuredKnowledgeReadItem[];
    timeline: readonly StructuredKnowledgeReadItem[];
    legalActs: readonly StructuredKnowledgeReadItem[];
    measures: readonly StructuredKnowledgeReadItem[];
    contradictions: StructuredKnowledgeReadModel["contradictions"];
  };
  legalIssues: readonly {
    knowledgeItemId: string;
    semanticKey: string;
    text: string;
    reviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED";
    originatingItemIds: readonly string[];
    questions: readonly StructuredReportQuestion[];
  }[];
  unassignedQuestions: readonly StructuredReportQuestion[];
  gaps: readonly StructuredKnowledgeReadItem[];
  deadlineCandidates: readonly StructuredKnowledgeReadItem[];
  /** Generated for new reports; archived V1 snapshots remain readable without it. */
  professionalNarrative?: {
    status: "PRELIMINARY_DOCUMENT_BASED";
    reconstruction: readonly string[];
    chronology: readonly string[];
    titlesObligationsAndDeadlines: readonly string[];
    complianceAndAllegedBreaches: readonly string[];
    contradictionsAndEvidenceGaps: readonly string[];
    technicalAdministrativeAndLegalProfiles: readonly string[];
    favorableArguments: readonly string[];
    contraryArguments: readonly string[];
    questionsForFurtherReview: readonly string[];
    documentaryReferences: readonly string[];
    legalResearchStatus: string;
  };
  /** Additive, read-only guidance. Older archived V1 reports may omit this field. */
  operationalPlans?: readonly StructuredReportOperationalPlan[];
  /** Additive; present only when MCP acquisitions exist for CURRENT missions of this revision. */
  technicalSources?: readonly StructuredReportTechnicalSource[];
  /** Deterministic coverage check; never creates legal issues or research questions. */
  legalCompleteness?: LegalCompletenessAssessment;
  /** V2 only. V1 snapshots remain readable and are never rewritten. */
  legalApplicability?: Readonly<{
    assessmentVersion: "LEGAL_APPLICABILITY_V1";
    applications: readonly Readonly<{
      applicationId: string;
      resultId: string;
      legalIssueSemanticKey: string;
      status: "ASSESSED" | "PRELIMINARY_AI_PROPOSED" | "NOT_EVALUATED" | "TO_VERIFY";
      outcome: LegalApplicabilityAssessment["conclusion"]["outcome"] | "NOT_EVALUATED";
      reasonCodes: readonly string[];
      assessment: LegalApplicabilityAssessment | null;
      reviewStatus: LegalApplicabilityReview["reviewStatus"] | null;
      professionalReviewRequired: true;
    }>[];
    uncertainties: readonly Readonly<{
      applicationId: string;
      reasonCodes: readonly string[];
      professionalReviewRequired: true;
    }>[];
  }>;
  limitations: readonly string[];
}

export interface BuiltStructuredFascicoloReport {
  reportFingerprint: string;
  payload: StructuredFascicoloReportPayload;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function itemBasisRefs(item: StructuredKnowledgeReadItem): readonly string[] {
  return [...new Set(item.evidence.flatMap((evidence) => (
    evidence.basisRef ? [evidence.basisRef] : []
  )))].sort();
}

function narrativeLine(item: StructuredKnowledgeReadItem): string {
  const refs = itemBasisRefs(item);
  return `${item.normalizedText}${refs.length ? ` [${refs.join("; ")}]` : " [riferimento documentale non disponibile]"}`;
}

function buildProfessionalNarrative(
  knowledge: StructuredKnowledgeReadModel,
): NonNullable<StructuredFascicoloReportPayload["professionalNarrative"]> {
  const visible = (items: readonly StructuredKnowledgeReadItem[]) => (
    items.filter((item) => item.status !== "REJECTED")
  );
  const positions = visible(knowledge.partyPositions ?? []);
  const facts = visible(knowledge.facts);
  const events = visible(knowledge.events);
  const acts = visible([...knowledge.legalActs, ...knowledge.measures]);
  const deadlines = visible(knowledge.deadlineCandidates);
  const gaps = visible(knowledge.gaps);
  const issues = visible(knowledge.legalIssues);
  const questions = visible(knowledge.researchQuestions);
  const references = [...new Set([
    ...positions,
    ...facts,
    ...events,
    ...acts,
    ...deadlines,
    ...gaps,
    ...issues,
    ...questions,
  ].flatMap(itemBasisRefs))].sort();
  return {
    status: "PRELIMINARY_DOCUMENT_BASED",
    reconstruction: [
      ...knowledge.subjects.map((subject) => (
        `${subject.canonicalName}: soggetto documentale qualificato come ${subject.subjectType}.`
      )),
      ...visible(knowledge.partyRoles).map(narrativeLine),
      ...facts.map(narrativeLine),
    ],
    chronology: events.map(narrativeLine),
    titlesObligationsAndDeadlines: [...acts, ...deadlines].map(narrativeLine),
    complianceAndAllegedBreaches: positions.map((item) => (
      `Allegazione della parte, non assunta come fatto accertato: ${narrativeLine(item)}`
    )),
    contradictionsAndEvidenceGaps: [
      ...visible(knowledge.contradictions).map(narrativeLine),
      ...gaps.map(narrativeLine),
    ],
    technicalAdministrativeAndLegalProfiles: issues.map((item) => (
      `Questione preliminare ricavata dal fascicolo: ${narrativeLine(item)}`
    )),
    favorableArguments: positions
      .filter((item) => {
        const positionType = String(jsonRecord(item.payload).positionType ?? "");
        return positionType === "CLAIM" || positionType === "REQUEST";
      })
      .map((item) => `Argomento della parte da verificare: ${narrativeLine(item)}`),
    contraryArguments: positions
      .filter((item) => {
        const positionType = String(jsonRecord(item.payload).positionType ?? "");
        return positionType === "DEFENSE" || positionType === "OBJECTION";
      })
      .map((item) => `Difesa o obiezione da verificare: ${narrativeLine(item)}`),
    questionsForFurtherReview: [
      ...questions.map(narrativeLine),
      ...gaps.map((item) => `Lacuna probatoria: ${narrativeLine(item)}`),
    ],
    documentaryReferences: references,
    legalResearchStatus: "Le ricostruzioni derivano esclusivamente dai documenti. Norme e giurisprudenza non accompagnate da fonti verificate restano da ricercare e non costituiscono conclusioni giuridiche definitive.",
  };
}

function byId<T extends { id?: string; resultId?: string; missionId?: string; semanticKey?: string }>(left: T, right: T): number {
  return String(left.id ?? left.resultId ?? left.missionId ?? left.semanticKey)
    .localeCompare(String(right.id ?? right.resultId ?? right.missionId ?? right.semanticKey));
}

function normalizedItem(item: StructuredKnowledgeReadItem): StructuredKnowledgeReadItem {
  return { ...item, evidence: [...item.evidence].sort((left, right) => (
    `${left.documentoId}:${left.pageNumber}:${left.textSha256}`.localeCompare(`${right.documentoId}:${right.pageNumber}:${right.textSha256}`)
  )) };
}

function itemDate(item: StructuredKnowledgeReadItem): string | null {
  if (item.payload === null || typeof item.payload !== "object" || Array.isArray(item.payload)) return null;
  const date = item.payload.date;
  if (date === null || typeof date !== "object" || Array.isArray(date)) return null;
  if (date.precision !== "EXACT" || typeof date.from !== "string" || item.evidence.length === 0) return null;
  return date.to === null || date.to === date.from ? date.from : null;
}

function provision(
  result: StructuredReportResearchResultInput,
  reference: string,
  _authorityKind: LegalApplicabilityReview["legalAuthorityKind"],
): VerifiedProvisionReference | null {
  const assessment = result.sourceAssessment;
  if (!assessment?.sourceChain) return null;
  return {
    legalSourceId: assessment.sourceChain.sourceIdentityKey ?? assessment.assessmentId,
    legalExpressionVersionId: assessment.sourceVersionId ?? assessment.sourceChain.sourceIdentityKey ?? assessment.assessmentId,
    provisionReference: reference,
    sourceAssessment: assessment.sourceChain,
    citationAnchors: assessment.sourceChain.citationAnchors,
    provenance: {
      providerId: result.provider,
      canonicalEvidenceId: assessment.assessmentId,
      sourceUrl: result.sourceUrl,
    },
  };
}

function projectLegalApplicability(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
}): NonNullable<StructuredFascicoloReportPayload["legalApplicability"]> {
  const items = new Map([
    ...input.knowledge.facts,
    ...input.knowledge.events,
    ...input.knowledge.legalActs,
    ...input.knowledge.measures,
  ].map((item) => [item.id, item]));
  const results = new Map(input.missions.flatMap((mission) => mission.results)
    .flatMap((result) => result.sourceAssessment ? [[result.sourceAssessment.assessmentId, result] as const] : []));
  const applications: NonNullable<StructuredFascicoloReportPayload["legalApplicability"]>["applications"][number][] = [];

  for (const mission of input.missions) {
    if (mission.lifecycleStatus !== "CURRENT" || mission.knowledgeRevisionId !== input.knowledge.revision.id) continue;
    const reviewedAssessmentIds = new Set<string>();
    for (const envelope of mission.legalApplicabilityReviews ?? []) {
      const review = envelope.review;
      reviewedAssessmentIds.add(review.candidateEvidenceSourceId);
      const result = results.get(review.candidateEvidenceSourceId);
      const reasonCodes: string[] = [];
      if (!result?.sourceAssessment?.sourceChain || !result.sourceAssessment.temporalAssessment) reasonCodes.push("SOURCE_CHAIN_OR_TEMPORAL_ASSESSMENT_MISSING");
      if (result?.sourceAssessment?.sourceChain && (
        result.sourceAssessment.sourceChain.tenantId !== input.tenantId
        || result.sourceAssessment.sourceChain.caseId !== input.procedimentoId
        || result.sourceAssessment.sourceChain.missionId !== mission.missionId
      )) reasonCodes.push("SOURCE_SCOPE_MISMATCH");
      if (review.knowledgeRevisionId !== input.knowledge.revision.id) reasonCodes.push("APPLICABILITY_REVIEW_STALE");
      if (review.legalIssueSemanticKey !== mission.legalIssueSemanticKey) reasonCodes.push("LEGAL_ISSUE_SCOPE_MISMATCH");
      if (review.candidateSourceVersionId !== result?.sourceAssessment?.sourceVersionId) reasonCodes.push("SOURCE_VERSION_MISMATCH");
      if (!envelope.orchestratorVerification?.valid) reasonCodes.push("RULE_ORCHESTRATOR_EVIDENCE_UNVERIFIED");
      if (envelope.recordedByActorId === null
        || review.reviewerAttestation.reviewedByActorId !== envelope.recordedByActorId) {
        reasonCodes.push("REVIEWER_IDENTITY_MISMATCH");
      }
      const boundItems = review.factBindings.map((binding) => items.get(binding.knowledgeItemId));
      if (boundItems.some((item) => !item)) reasonCodes.push("KNOWLEDGE_FACT_REFERENCE_INVALID");
      const legalIssue = input.knowledge.legalIssues.find((item) => (
        item.semanticKey === review.legalIssueSemanticKey
      ));
      const targetProceedingIdentity = legalIssue
        ? documentedProceedingIdentity(legalIssue, "targetProceedingIdentity")
        : null;
      if (stableStringify(review.targetProceedingIdentity ?? null) !== stableStringify(targetProceedingIdentity)) {
        reasonCodes.push("TARGET_PROCEEDING_IDENTITY_MISMATCH");
      }
      if (review.factBindings.some((binding) => {
        const item = items.get(binding.knowledgeItemId);
        return item && stableStringify(binding.proceedingIdentity ?? null)
          !== stableStringify(documentedProceedingIdentity(item, "proceedingIdentity"));
      })) reasonCodes.push("PROCEEDING_FACT_IDENTITY_MISMATCH");
      if (review.factualApplicability.decisiveKnowledgeItemIds.some((id) => !items.has(id))) reasonCodes.push("DECISIVE_FACT_REFERENCE_INVALID");
      if (reasonCodes.length || !result?.sourceAssessment?.sourceChain || !result.sourceAssessment.temporalAssessment) {
        applications.push({
          applicationId: review.applicationId,
          resultId: result?.resultId ?? review.candidateEvidenceSourceId,
          legalIssueSemanticKey: review.legalIssueSemanticKey,
          status: "TO_VERIFY",
          outcome: "TO_VERIFY",
          reasonCodes: [...new Set(reasonCodes)].sort(),
          assessment: null,
          reviewStatus: review.reviewStatus,
          professionalReviewRequired: true,
        });
        continue;
      }
      const candidateProvision = provision(result, review.candidateProvisionReference, review.legalAuthorityKind);
      if (!candidateProvision) continue;
      const orchestratorVerification = envelope.orchestratorVerification!;
      const facts: ApplicabilityFactReference[] = review.factBindings.map((binding) => {
        const item = items.get(binding.knowledgeItemId)!;
        return {
          factClaimId: item.id,
          role: binding.role,
          statement: item.normalizedText,
          occurrenceDate: itemDate(item),
          certainty: itemDate(item) ? "CERTAIN" : "UNCERTAIN",
          value: binding.value,
          evidenceLinkIds: item.evidence.map((evidence) => `${evidence.documentoId}:${evidence.pageNumber}:${evidence.textSha256}`),
          proceedingIdentity: binding.proceedingIdentity ?? null,
        };
      });
      let transitionalDiscipline: TransitionalDiscipline;
      if (review.transitionalDiscipline.status === "VERIFIED_PRESENT") {
        const transitionalResult = results.get(review.transitionalDiscipline.evidenceSourceId);
        const transitionalProvision = transitionalResult && provision(
          transitionalResult,
          review.transitionalDiscipline.provisionReference,
          "LEGISLATION",
        );
        const previousResult = review.transitionalDiscipline.previousRegimeEvidenceSourceId
          ? results.get(review.transitionalDiscipline.previousRegimeEvidenceSourceId)
          : null;
        transitionalDiscipline = transitionalProvision ? {
          ...review.transitionalDiscipline,
          provision: transitionalProvision,
          previousRegimeProvision: previousResult
            ? provision(previousResult, previousResult.sourceAssessment?.provisionReference ?? "regime previgente", "LEGISLATION")
            : null,
          status: "VERIFIED_PRESENT",
        } : {
          status: "UNAVAILABLE",
          expectedProvisionReference: review.transitionalDiscipline.provisionReference,
          rationale: "La fonte della clausola transitoria non e collegata a una source-chain verificata.",
        };
      } else if (review.transitionalDiscipline.status === "VERIFIED_ABSENT") {
        const absenceResult = results.get(review.transitionalDiscipline.evidenceSourceId);
        const verificationSource = absenceResult && provision(
          absenceResult,
          review.candidateProvisionReference,
          review.legalAuthorityKind,
        );
        transitionalDiscipline = verificationSource ? {
          status: "VERIFIED_ABSENT",
          verificationSource,
          absenceAttestation: review.transitionalDiscipline.absenceAttestation,
          rationale: review.transitionalDiscipline.rationale,
        } : {
          status: "UNAVAILABLE",
          expectedProvisionReference: review.candidateProvisionReference,
          rationale: "La verifica di assenza non e collegata a una source-chain verificata.",
        };
      } else {
        transitionalDiscipline = review.transitionalDiscipline;
      }
      const assessment = assessLegalApplicability({
        applicationId: review.applicationId,
        legalAuthorityKind: review.legalAuthorityKind,
        referenceDate: result.sourceAssessment.temporalAssessment.referenceDate,
        candidateProvision,
        chronologicalAssessment: result.sourceAssessment.temporalAssessment,
        facts,
        targetProceedingIdentity: review.targetProceedingIdentity ?? null,
        ...applicabilityDimensionsFromRuleOrchestrator({
          source: orchestratorVerification.source!,
          ruleMatched: orchestratorVerification.ruleMatched,
          decisiveFactClaimIds: review.factualApplicability.decisiveKnowledgeItemIds,
        }),
        factualApplicability: {
          outcome: review.factualApplicability.outcome,
          rationale: review.factualApplicability.rationale,
          decisiveFactClaimIds: review.factualApplicability.decisiveKnowledgeItemIds,
        },
        transitionalDiscipline,
        normRelationship: {
          outcome: review.normRelationship.outcome,
          rationale: review.normRelationship.rationale,
          ...review.normRelationship.competingEvidenceSourceId ? (() => {
            const competing = results.get(review.normRelationship.competingEvidenceSourceId!);
            const competingSource = orchestratorVerification.resolvedSources?.find(
              (source) => source.id === competing?.sourceAssessment?.sourceFamilyId,
            );
            const competingProvision = competing
              ? provision(competing, competing.sourceAssessment?.provisionReference ?? "norma speciale", review.legalAuthorityKind)
              : null;
            const competingDimensions = competingSource ? applicabilityDimensionsFromRuleOrchestrator({
              source: competingSource,
              ruleMatched: orchestratorVerification.matchedSourceIds?.includes(competingSource.id) ?? false,
              decisiveFactClaimIds: review.factualApplicability.decisiveKnowledgeItemIds,
            }) : null;
            return {
              competingProvision,
              competingTerritorialApplicability: competingDimensions?.territorialApplicability,
              competingMaterialApplicability: competingDimensions?.materialApplicability,
            };
          })() : { competingProvision: null },
        },
      });
      applications.push({
        applicationId: review.applicationId,
        resultId: result.resultId,
        legalIssueSemanticKey: review.legalIssueSemanticKey,
        status: review.reviewStatus === "AI_PROPOSED"
          ? "PRELIMINARY_AI_PROPOSED"
          : assessment.conclusion.outcome === "TO_VERIFY" ? "TO_VERIFY" : "ASSESSED",
        outcome: assessment.conclusion.outcome,
        reasonCodes: review.reviewStatus === "AI_PROPOSED"
          ? [...new Set([...assessment.conclusion.reasonCodes, "PROFESSIONAL_REVIEW_REQUIRED"])].sort()
          : assessment.conclusion.reasonCodes,
        assessment,
        reviewStatus: review.reviewStatus,
        professionalReviewRequired: true,
      });
    }
    for (const result of mission.results) {
      const assessmentId = result.sourceAssessment?.assessmentId;
      if (!assessmentId || reviewedAssessmentIds.has(assessmentId)) continue;
      applications.push({
        applicationId: `not-evaluated:${mission.missionId}:${result.resultId}`,
        resultId: result.resultId,
        legalIssueSemanticKey: mission.legalIssueSemanticKey ?? mission.researchQuestionSemanticKey ?? "UNASSIGNED",
        status: "NOT_EVALUATED",
        outcome: "NOT_EVALUATED",
        reasonCodes: ["LEGAL_APPLICABILITY_REVIEW_MISSING"],
        assessment: null,
        reviewStatus: null,
        professionalReviewRequired: true,
      });
    }
    for (const issue of mission.legalApplicabilityReviewIssues ?? []) {
      applications.push({
        applicationId: `invalid-review:${mission.missionId}:${issue}`,
        resultId: mission.missionId,
        legalIssueSemanticKey: mission.legalIssueSemanticKey ?? mission.researchQuestionSemanticKey ?? "UNASSIGNED",
        status: "TO_VERIFY",
        outcome: "TO_VERIFY",
        reasonCodes: [issue],
        assessment: null,
        reviewStatus: null,
        professionalReviewRequired: true,
      });
    }
  }
  applications.sort((left, right) => left.applicationId.localeCompare(right.applicationId));
  return {
    assessmentVersion: "LEGAL_APPLICABILITY_V1",
    applications,
    uncertainties: applications.filter((application) => application.status !== "ASSESSED").map((application) => ({
      applicationId: application.applicationId,
      reasonCodes: application.reasonCodes,
      professionalReviewRequired: true as const,
    })),
  };
}

function visibleItems(items: readonly StructuredKnowledgeReadItem[]): readonly StructuredKnowledgeReadItem[] {
  return items.filter((item) => item.status !== "REJECTED").map(normalizedItem).sort(byId);
}

function authority(result: StructuredReportResearchResultInput): StructuredReportAuthority {
  const assessment = result.sourceAssessment!;
  return {
    resultId: result.resultId,
    title: result.title,
    sourceUrl: result.sourceUrl,
    provider: result.provider,
    assessmentId: assessment.assessmentId,
    sourceChainFingerprint: assessment.chainFingerprint,
    citationAnchors: [...assessment.citationAnchors],
    rationale: result.classificationRationale,
  };
}

function nonUsableReasons(result: StructuredReportResearchResultInput): readonly string[] {
  const reasons = result.sourceAssessment?.blockingReasons ?? ["MISSING_CURRENT_SOURCE_ASSESSMENT"];
  return [...new Set([
    ...reasons,
    ...(result.classificationReviewStatus === "REJECTED" ? ["CLASSIFICATION_REJECTED"] : []),
    ...(result.sourceAssessment?.citationAnchors.length ? [] : ["CITATION_ANCHOR_REQUIRED"]),
  ])].sort();
}

function projectQuestion(
  item: StructuredKnowledgeReadItem,
  missionsByQuestion: ReadonlyMap<string, StructuredReportMissionInput>,
): StructuredReportQuestion {
  const mission = missionsByQuestion.get(item.semanticKey) ?? null;
  const results = [...(mission?.results ?? [])].sort(byId);
  const usable = (result: StructuredReportResearchResultInput) => result.classificationReviewStatus !== "REJECTED"
    && result.sourceAssessment?.isCurrent === true
    && result.sourceAssessment.usable
    && result.sourceAssessment.citationAnchors.length > 0;
  const favorableAuthorities = results.filter((result) => usable(result) && result.supportDirection === "SUPPORTS").map(authority);
  const contraryAuthorities = results.filter((result) => usable(result) && result.supportDirection === "OPPOSES").map(authority);
  const nonUsableResults = results.filter((result) => !usable(result) || !["SUPPORTS", "OPPOSES"].includes(result.supportDirection))
    .map((result) => ({
      resultId: result.resultId, title: result.title, sourceUrl: result.sourceUrl,
      direction: result.supportDirection,
      rationale: result.relevantPassage ?? result.classificationRationale,
      reasons: nonUsableReasons(result),
    }));
  const gaps = [...new Set([
    ...(mission?.sourceGaps ?? []),
    ...(mission ? [] : ["CURRENT_RESEARCH_MISSION_MISSING"]),
    ...(favorableAuthorities.length + contraryAuthorities.length ? [] : ["NO_USABLE_SOURCE"]),
  ])].sort();
  const limitations = [...new Set([
    ...(item.status === "AI_PROPOSED" ? ["QUESTION_NOT_HUMAN_CONFIRMED"] : []),
    ...(mission?.status === "COMPLETED" ? [] : ["RESEARCH_NOT_COMPLETED"]),
    ...(favorableAuthorities.length > 0 && contraryAuthorities.length === 0 ? ["NO_USABLE_CONTRARY_AUTHORITY"] : []),
  ])].sort();
  return {
    knowledgeItemId: item.id,
    semanticKey: item.semanticKey,
    text: item.normalizedText,
    reviewStatus: item.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
    missionId: mission?.missionId ?? null,
    missionStatus: mission?.status ?? "NOT_STARTED",
    coverageStatus: mission?.coverageStatus ?? "NO_RESULTS",
    favorableAuthorities,
    contraryAuthorities,
    nonUsableResults,
    gaps,
    limitations,
  };
}

const TECHNICAL_VERIFICATION_STATUSES: readonly StructuredReportTechnicalVerificationStatus[] = [
  "DA_VERIFICARE_SU_FONTE_ORIGINALE",
  "INDICATIVO_DA_VERIFICARE",
  "RISPOSTA_VUOTA_NON_PROBATORIA",
];

const TECHNICAL_REQUIRED_VERIFICATION: Readonly<Record<StructuredReportTechnicalVerificationStatus, string>> = {
  DA_VERIFICARE_SU_FONTE_ORIGINALE: "Consultare la fonte originale vigente indicata e acquisirne copia o estremi verificabili prima di qualsiasi uso.",
  INDICATIVO_DA_VERIFICARE: "Esito WMS indicativo: verificare presso l'ente competente o sugli atti di pianificazione ufficiali; non attesta vincoli né conformità.",
  RISPOSTA_VUOTA_NON_PROBATORIA: "Risposta WMS vuota: non prova l'assenza di vincoli; richiedere verifica presso l'ente competente.",
};

function projectTechnicalSources(
  inputs: readonly StructuredReportTechnicalSourceInput[],
  missions: readonly StructuredReportMissionInput[],
): readonly StructuredReportTechnicalSource[] {
  const questionByMission = new Map(missions.map((mission) => [mission.missionId, mission.researchQuestionSemanticKey!]));
  return inputs
    .filter((input) => questionByMission.has(input.missionId))
    .map((input) => {
      // Unknown statuses fall back to the strictest non-probative category.
      const verificationStatus = (TECHNICAL_VERIFICATION_STATUSES as readonly string[]).includes(input.verificationStatus)
        ? input.verificationStatus as StructuredReportTechnicalVerificationStatus
        : "DA_VERIFICARE_SU_FONTE_ORIGINALE";
      return {
        recordId: input.recordId,
        missionId: input.missionId,
        questionSemanticKey: questionByMission.get(input.missionId)!,
        toolName: input.toolName,
        question: input.questionSnapshot.slice(0, 2000),
        verificationStatus,
        probative: false as const,
        serviceVersion: input.serviceVersion,
        responseDigest: input.responseDigest,
        retrievedAt: input.retrievedAt.toISOString(),
        requiredVerification: TECHNICAL_REQUIRED_VERIFICATION[verificationStatus],
      };
    })
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
}

function technicalOutstandingEvidence(sources: readonly StructuredReportTechnicalSource[]): string {
  const empty = sources.filter((source) => source.verificationStatus === "RISPOSTA_VUOTA_NON_PROBATORIA").length;
  return `Verificare sulle fonti originali gli esiti tecnico-urbanistici acquisiti tramite MCP (${sources.length}, non probatori)`
    + (empty ? `; ${empty} risposte WMS vuote non provano l'assenza di vincoli` : "")
    + ".";
}

function administrativeActDrafts(input: {
  issueText: string;
  sourceDocumentRefs: readonly string[];
  outstandingEvidence: readonly string[];
  documentedFacts: readonly string[];
}): readonly StructuredReportAdministrativeActDraft[] {
  const refs = input.sourceDocumentRefs.length
    ? input.sourceDocumentRefs.join("; ")
    : "[RIFERIMENTI DOCUMENTALI DA INSERIRE]";
  const missing = input.outstandingEvidence.length
    ? input.outstandingEvidence
    : ["[DOCUMENTAZIONE MANCANTE DA INDIVIDUARE]"];
  const common = {
    competentOffice: "[UFFICIO/AUTORITA COMPETENTE DA VERIFICARE]",
    legalBasis: "[FONDAMENTO GIURIDICO DA VERIFICARE DALL'UFFICIO]",
    participationGuarantees: [
      "Garantire accesso, partecipazione e contraddittorio nella misura applicabile al procedimento verificato.",
      "Non anticipare decadenza, revoca o sanzioni prima dell'accertamento di presupposti e competenza.",
    ],
    subsequentCommunications: [
      "[DESTINATARI E MODALITA DI COMUNICAZIONE DA VERIFICARE]",
      "Registrare esito, ricevute e adempimenti successivi senza invio automatico.",
    ],
    templateSource: "INTERNAL_TEMPLATE_REQUIRED_IF_AVAILABLE" as const,
    adaptationInstructions: "Usare prioritariamente lo schema interno dell'Ente senza modificarne l'originale; applicare queste sezioni in una copia e marcare ogni integrazione proposta. In assenza di schema interno, il presente modello standard richiede verifica dell'ufficio.",
    automaticExecutionProhibited: true as const,
  };
  const caseText = input.issueText.toLowerCase();
  const facts = input.documentedFacts.length
    ? input.documentedFacts.map((fact) => `${fact} [fonti: ${refs}]`)
    : [`Criticita documentata: ${input.issueText}. [fonti: ${refs}]`];
  const actSpecs = /canoni|pagament|tesoreria|ripiano/.test(caseText) ? [
    {
      actType: "ACQUISIZIONE_PARTITARIO_E_ATTESTAZIONE_TESORERIA",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Ricostruire per ciascuna rata importo, scadenza, pagamento, valuta, imputazione, interessi e saldo certificato.",
      investigation: ["Acquisire partitario ufficiale, quietanze analitiche, reversali e criteri di imputazione.", "Separare pagamenti documentati, importi non imputati e residui ancora da accertare."],
      operativePart: ["Disporre a [UFFICIO TESORERIA/RAGIONERIA VERIFICATO] di produrre attestazione analitica.", "Allegare una tabella rata-pagamento-imputazione-interessi-saldo e indicare i dati non verificati."],
    },
    {
      actType: "RICHIESTA_DOCUMENTI_CONTABILI_AL_CONCESSIONARIO",
      necessity: "EVENTUAL" as const,
      purpose: "Acquisire contabili, quietanze, causali e osservazioni sulla proposta di ripiano o compensazione.",
      investigation: ["Confrontare i documenti della parte con l'attestazione della Tesoreria.", ...missing.map((entry) => `Chiarire: ${entry}.`)],
      operativePart: ["Richiedere a [CONCESSIONARIO] le prove analitiche dei pagamenti e il fondamento dell'eventuale compensazione.", "Assegnare [TERMINE VERIFICATO] senza riconoscere automaticamente ripiano o compensazione."],
    },
    {
      actType: "PROVVEDIMENTO_SU_RIPIANO_O_REGOLARIZZAZIONE",
      necessity: "OPTIONAL" as const,
      purpose: "Accogliere, modificare o respingere motivatamente la proposta dopo riconciliazione e contraddittorio.",
      investigation: ["Valutare saldo certificato, sostenibilita, disciplina applicabile, interessi, garanzie e alternative.", "Dare conto delle deduzioni e delle ragioni di proporzionalita."],
      operativePart: ["[ACCOGLIERE/MODIFICARE/RESPINGERE] la proposta nei limiti consentiti dalla disciplina verificata.", "Definire rate, scadenze, interessi, decadenza dal beneficio e controlli soltanto se giuridicamente ammessi."],
    },
  ] : /portanza|struttural|sicurezza|impianto|mezzi/.test(caseText) ? [
    {
      actType: "RICHIESTA_ACCERTAMENTO_SPECIALISTICO_STRUTTURALE_E_IMPIANTISTICO",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Accertare portanza, carichi distribuiti e puntuali, stato delle opere, documentazione delle gru e conformita impiantistica.",
      investigation: ["Acquisire progetti, collaudi, classificazione delle aree, configurazioni e reazioni degli stabilizzatori.", "Formulare quesiti su fessure, copriferro, carichi ammissibili, I1 e documentazione M1/M2."],
      operativePart: ["Conferire a [TECNICO/STRUTTURA COMPETENTE] l'accertamento sui quesiti indicati.", "Vietare conclusioni di dissesto o conformita non sostenute da prove specialistiche."],
    },
    {
      actType: "DISPOSIZIONE_E_VERBALE_DI_SOPRALLUOGO_TECNICO",
      necessity: "EVENTUAL" as const,
      purpose: "Documentare stato dei luoghi, mezzi, impianti, aree di sicurezza e corrispondenza con titolo e planimetrie.",
      investigation: ["Identificare partecipanti, strumenti, fotografie originali, misure e documenti esibiti.", ...missing.map((entry) => `Verificare in sopralluogo: ${entry}.`)],
      operativePart: ["Disporre sopralluogo in data [DATA] con contraddittorio tecnico ove applicabile.", "Redigere verbale con rilievi distinti da valutazioni e raccogliere osservazioni dei presenti."],
    },
    {
      actType: "PRESCRIZIONE_TECNICA_MOTIVATA",
      necessity: "OPTIONAL" as const,
      purpose: "Imporre esclusivamente le misure tecniche risultate necessarie e proporzionate dagli accertamenti.",
      investigation: ["Individuare rischio, competenza, urgenza, misura praticabile e termine tecnicamente congruo.", "Valutare misure meno restrittive e osservazioni della parte."],
      operativePart: ["Prescrivere [MISURA TECNICA ACCERTATA] entro [TERMINE VERIFICATO].", "Programmare verifica di adempimento senza anticipare ulteriori conseguenze non istruite."],
    },
  ] : /terzi|magazzini|subconcess|affidamento/.test(caseText) ? [
    {
      actType: "RICHIESTA_DOCUMENTAZIONE_RAPPORTO_CON_OPERATORE_TERZO",
      necessity: "EVENTUAL" as const,
      purpose: "Acquisire contratto, autorizzazioni, planimetrie, turni, chiavi, custodia, personale e attivita effettivamente svolte.",
      investigation: ["Distinguere servizio, affidamento di segmento operativo, uso esclusivo di area e possibile subconcessione.", ...missing.map((entry) => `Acquisire o chiarire: ${entry}.`)],
      operativePart: ["Richiedere a [CONCESSIONARIO E OPERATORE TERZO] i documenti indicati.", "Precisare che il contratto privato non prova da solo la qualificazione pubblicistica."],
    },
    {
      actType: "VERBALE_DI_SOPRALLUOGO_SU_SPAZI_E_OPERAZIONI",
      necessity: "EVENTUAL" as const,
      purpose: "Accertare uso dei 180 m2, cartellonistica, accessi, custodia, mezzi, personale e operazioni svolte.",
      investigation: ["Confrontare M4, zona L, titolo, planimetrie e autorizzazioni.", "Registrare eventuali variazioni temporanee e fatti favorevoli alla parte."],
      operativePart: ["Eseguire sopralluogo con rilievo planimetrico e fotografico verificabile.", "Acquisire dichiarazioni senza assumerle automaticamente come fatti accertati."],
    },
    {
      actType: "COMUNICAZIONE_DI_AVVIO_E_CONTESTAZIONE_SPECIFICA",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Contestare soltanto i fatti accertati, indicare la possibile qualificazione e consentire deduzioni.",
      investigation: ["Verificare disciplina, competenza, autorizzazioni e concreta organizzazione del servizio.", "Considerare alternative, regolarizzazione consentita e archiviazione."],
      operativePart: ["Comunicare fatti, prove e possibili qualificazioni a [DESTINATARI VERIFICATI].", "Consentire memorie e documenti entro [TERMINE VERIFICATO] senza anticipare l'esito."],
    },
  ] : /ambient|drenaggio|scarico|rifiut/.test(caseText) ? [
    {
      actType: "ACQUISIZIONE_TITOLI_E_PARERE_TECNICO_AMBIENTALE",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Verificare progetto I4, separatore, collaudo, titolo allo scarico, registri rifiuti e attendibilita dei campionamenti.",
      investigation: ["Acquisire progetto approvato, titolo allo scarico, formulari, registri e catena di custodia.", "Non inferire conformita o illecito dal solo campione isolato."],
      operativePart: ["Richiedere a [UFFICIO/ENTE COMPETENTE] riscontro documentale e tecnico.", "Indicare separatamente documenti mancanti, non rinvenuti e accertati inesistenti."],
    },
    {
      actType: "DISPOSIZIONE_DI_SOPRALLUOGO_E_CAMPIONAMENTO",
      necessity: "EVENTUAL" as const,
      purpose: "Verificare opere di drenaggio, punto di scarico, contenitori e condizioni operative con metodo tracciabile.",
      investigation: ["Definire punti, metodo, catena di custodia, laboratorio e disciplina territoriale applicabile.", ...missing.map((entry) => `Verificare: ${entry}.`)],
      operativePart: ["Disporre sopralluogo e, se competente e necessario, campionamento tracciato.", "Redigere verbale e attendere esiti verificati prima di qualificare violazioni."],
    },
  ] : /traffici|moviment/.test(caseText) ? [
    {
      actType: "RELAZIONE_DI_RICONCILIAZIONE_TRAFFICI",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Riconciliare traffici dichiarati, manifesti nave, registri di scalo e trasferimenti interni.",
      investigation: ["Separare sbarco/imbarco da trasferimenti e ricondizionamenti.", "Verificare cause esterne mediante dati meteo, ordinanze e disponibilita degli ormeggi."],
      operativePart: ["Predisporre prospetto annuale con fonte, criterio di eleggibilita e scostamento.", "Evidenziare dati certificati, allegazioni e valori non verificati."],
    },
    {
      actType: "RICHIESTA_DEDUZIONI_SU_SCOSTAMENTO_TRAFFICI",
      necessity: "EVENTUAL" as const,
      purpose: "Consentire alla concessionaria di documentare cause esterne e criteri di computo.",
      investigation: ["Acquisire manifesti, registri, ordinanze, orari nave e serie statistiche confrontabili.", ...missing.map((entry) => `Chiarire: ${entry}.`)],
      operativePart: ["Comunicare lo scostamento provvisorio e i criteri utilizzati.", "Richiedere deduzioni entro [TERMINE VERIFICATO] prima di ogni valutazione conclusiva."],
    },
  ] : /formazione|efficacia|titolo|presuppost/.test(caseText) ? [
    {
      actType: "RELAZIONE_ISTRUTTORIA_SU_FORMAZIONE_ED_EFFICACIA_DEL_TITOLO",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Ricostruire avviso, offerta, comparazione, aggiudicazione, garanzia, concessione, disciplinare e consegna.",
      investigation: ["Verificare sequenza, condizioni di efficacia, allegati incorporati e atti modificativi.", "Distinguere titolo, atti presupposti e documenti privati successivi."],
      operativePart: ["Formare indice cronologico degli atti e delle condizioni adempiute o da verificare.", "Indicare gli effetti giuridici soltanto dopo verifica professionale delle fonti."],
    },
    {
      actType: "ACQUISIZIONE_ATTI_E_VERIFICA_CONDIZIONI_DI_EFFICACIA",
      necessity: "EVENTUAL" as const,
      purpose: "Acquisire originali, pubblicazioni, comunicazioni, garanzia e verbale di consegna.",
      investigation: ["Verificare autenticita, completezza, collegamenti e vigenza degli atti.", ...missing.map((entry) => `Acquisire: ${entry}.`)],
      operativePart: ["Richiedere agli uffici detentori gli originali e attestare le verifiche compiute.", "Segnalare separatamente ogni documento non valutabile o ambiguo."],
    },
  ] : [
    {
      actType: "RELAZIONE_ISTRUTTORIA_CONCLUSIVA",
      necessity: "REQUIRED_IF_PROCEEDING_STARTED" as const,
      purpose: "Ricostruire fatti, allegazioni, lacune, disciplina, alternative e proposta motivata.",
      investigation: ["Acquisire documenti e verificare competenza, termini e contraddittorio.", ...missing.map((entry) => `Chiarire: ${entry}.`)],
      operativePart: ["Proporre [ARCHIVIAZIONE/PRESCRIZIONE/ALTRO PROVVEDIMENTO VERIFICATO].", "Motivare proporzionalita, alternative e conseguenze successive."],
    },
  ];
  return actSpecs.map((spec, index) => ({
    ...common,
    actType: spec.actType,
    necessity: spec.necessity,
    sequence: index + 1,
    sections: {
      heading: "[DENOMINAZIONE ENTE] - [UFFICIO COMPETENTE] - Bozza istruttoria modificabile",
      subject: `${spec.actType.replaceAll("_", " ")} — ${input.issueText}`,
      premises: [
        `Esaminati i documenti ${refs}.`,
        `Rilevata la necessita di ${spec.purpose.toLowerCase()}`,
        "Dato atto che allegazioni, valutazioni private e documenti mancanti non sono assunti come fatti accertati.",
      ],
      documentedFacts: facts,
      investigation: spec.investigation,
      reasoning: [
        spec.purpose,
        "La soluzione deve essere necessaria, proporzionata e adottata dall'autorita competente dopo il contraddittorio applicabile.",
      ],
      legalReferences: ["[FONDAMENTO SOSTANZIALE, PROCEDIMENTALE E SULLA COMPETENZA DA VERIFICARE]"],
      operativePart: spec.operativePart,
      communications: [...common.subsequentCommunications],
      signature: "[NOME, QUALIFICA E FIRMA DEL SOGGETTO COMPETENTE]",
    },
  }));
}

function buildOperationalPlans(
  issues: StructuredFascicoloReportPayload["legalIssues"],
  knowledge: StructuredKnowledgeReadModel,
  technicalSources: readonly StructuredReportTechnicalSource[] = [],
): readonly StructuredReportOperationalPlan[] {
  const evidenceItems = [
    ...knowledge.facts, ...knowledge.legalActs, ...knowledge.measures,
    ...knowledge.events, ...knowledge.gaps, ...knowledge.deadlineCandidates,
  ].filter((item) => item.status !== "REJECTED");
  return issues.map((issue) => {
    const originIds = new Set(issue.originatingItemIds);
    const related = evidenceItems.filter((item) => originIds.has(item.id));
    const sourceDocumentRefs = [...new Set(related.flatMap((item) =>
      item.evidence
        .map((evidence) => evidence.basisRef)
        .filter((basisRef): basisRef is string => basisRef !== null)))].sort();
    const outstandingEvidence = knowledge.gaps.filter((item) =>
      item.status !== "REJECTED" && originIds.has(item.id))
      .map((item) => item.normalizedText).sort();
    const issueQuestionKeys = new Set(issue.questions.map((question) => question.semanticKey));
    const issueTechnical = technicalSources.filter((source) => issueQuestionKeys.has(source.questionSemanticKey));
    if (issueTechnical.length) {
      outstandingEvidence.push(technicalOutstandingEvidence(issueTechnical));
    }
    const sourceReady = issue.questions.length > 0 && issue.questions.every((question) =>
      question.missionStatus === "COMPLETED"
      && question.favorableAuthorities.length + question.contraryAuthorities.length > 0);
    const caseText = [issue.text, ...related.map((item) => item.normalizedText)].join(" ");
    const concernsInstallation = /container|manufatt|prefabbricat|installazion/i.test(caseText)
      && /concession|demanial|portual/i.test(caseText);
    const steps: StructuredReportOperationalStep[] = [
      {
        title: "1. Accertare i fatti e gli obblighi concessori",
        action: "L'ente concedente deve confrontare titolo e prescrizioni con lo stato dei luoghi e l'uso effettivo, distinguendo elementi provati, indizi, atti mancanti ed eventuali autorizzazioni successive. Verificare chi sia l'autorità competente per ciascun potere.",
        office: "Responsabile del procedimento e ufficio demanio dell'ente concedente; ufficio tecnico e autorità marittima secondo le competenze accertate",
        requiredDocuments: concernsInstallation
          ? ["Titolo concessorio integrale con allegati, planimetrie e modifiche", "Verbale di sopralluogo, rilievi, fotografie, dimensioni e destinazione effettiva del manufatto", "Autorizzazioni e assensi eventualmente rilasciati, anche tecnico-edilizi", "Comunicazioni e precedenti controlli dell'amministrazione"]
          : ["Titolo e prescrizioni vigenti con eventuali modifiche", "Verbali, comunicazioni e riscontri documentali", "Autorizzazioni, pagamenti e atti di controllo pertinenti alla specifica criticità"],
        completionGate: "Fatti, titoli, soggetti, competenza e possibili violazioni verificati con istruttoria documentata",
      },
      {
        title: "2. Qualificare le violazioni e valutare i procedimenti conseguenti",
        action: !sourceReady
          ? "Verificare sulle fonti vigenti le fattispecie, i presupposti, i poteri tipizzati e le competenze applicabili. Separare ogni possibile procedimento e non presumere decadenza, revoca, ripristino o sanzioni prima della verifica professionale."
          : concernsInstallation
          ? "Verificare separatamente se ricorrono i presupposti di decadenza ex art. 47 cod. nav. (in particolare lett. f per inadempimento di obblighi, lett. c solo se vi e mutamento sostanziale non autorizzato dello scopo) e di intervento sulle innovazioni abusive ex art. 54 cod. nav. Accertare l'autorità competente, incluse le distinte competenze degli artt. 48 e 54, e la normativa applicabile nel tempo."
          : "Esaminare le ipotesi di decadenza ex art. 47 cod. nav. pertinenti alla violazione, eventuali obblighi di ripristino e altri poteri tipizzati. Separare presupposti, competenze e conseguenze di ogni procedimento; non presupporre che la decadenza sia automatica.",
        office: sourceReady
          ? "Autorità concedente per l'eventuale decadenza (art. 48 cod. nav.); autorità marittima competente per gli eventuali poteri di cui all'art. 54"
          : "[UFFICIO O AUTORITA COMPETENTE DA VERIFICARE SULLE FONTI VIGENTI]",
        requiredDocuments: ["Prescrizioni e obblighi del titolo e loro contestazioni", "Testi normativi applicabili alla data dei fatti", "Precedenti amministrativi e fonti giurisprudenziali verificabili", "Documenti idonei a dimostrare gravità, durata e conseguenze della condotta"],
        completionGate: "Distinta qualificazione giuridica dei possibili procedimenti, verificata da un professionista",
      },
      {
        title: "3. Garantire contestazione e contraddittorio",
        action: sourceReady
          ? "Se sussistono presupposti sufficienti, predisporre gli atti di avvio e di contestazione di competenza dell'ente; garantire accesso, partecipazione e valutazione delle deduzioni. Per la decadenza rispettare il termine assegnato alle deduzioni dall'art. 47 cod. nav. e verificare le altre garanzie applicabili."
          : "Se sussistono presupposti sufficienti, predisporre gli atti di avvio e di contestazione dell'autorita competente; garantire accesso, partecipazione e valutazione delle deduzioni. Inserire termini e garanzie soltanto dopo la verifica delle fonti applicabili.",
        office: "Responsabile del procedimento dell'autorità effettivamente competente",
        requiredDocuments: ["Relazione istruttoria e atti probatori", "Bozza di contestazione e comunicazioni procedimentali", "Deduzioni, osservazioni e documenti del concessionario", "Verifica delle notificazioni e dei termini concretamente applicabili"],
        completionGate: "Contraddittorio effettivo e documentato; nessun provvedimento anticipato prima dell'istruttoria dovuta",
      },
      {
        title: "4. Motivare la decisione e controllarne gli effetti",
        action: "Concludere con decisione motivata sui presupposti, sulle osservazioni e sulla proporzionalità: archiviazione, eventuale misura ripristinatoria, decadenza o altra misura consentita. Distinguere poteri e autorità, pianificare l'esecuzione e documentare i successivi controlli senza automatismi.",
        office: "Organo dell'ente concedente o diversa autorità individuata dalla legge per ciascun provvedimento",
        requiredDocuments: ["Esito dell'istruttoria con confronto fra alternative", "Valutazione delle deduzioni e della proporzionalità", "Schema di provvedimento e modalità di comunicazione", "Piano di verifica degli adempimenti e degli eventuali obblighi di ripristino"],
        completionGate: "Motivazione, competenza, garanzie e verifiche professionali completate; autorizzazione umana all'adozione",
      },
    ];
    const alternatives: StructuredReportOperationalAlternative[] = concernsInstallation ? [
      {
        title: "Valutare il procedimento di decadenza (art. 47 cod. nav.)",
        whenApplicable: "Se la violazione degli obblighi concessori risulta comprovata (lett. f), oppure se e accertato un mutamento sostanziale non autorizzato dello scopo (lett. c), verificando ogni requisito della fattispecie",
        practicalRoute: "Istruire la contestazione, identificare l'autorità concedente competente ex art. 48, fissare il termine per le deduzioni, valutarle e motivare l'eventuale decadenza tenendo conto della proporzionalità.",
        riskOrLimit: "La presenza del container, da sola, non prova il mutamento sostanziale né rende automatica la decadenza. Considerare eventuali precedenti autorizzazioni o conoscenza dell'amministrazione.",
      },
      {
        title: "Valutare rimozione e ripristino per innovazione abusiva (art. 54 cod. nav.)",
        whenApplicable: "Solo quando risultano gli elementi di occupazione abusiva o di innovazione non autorizzata su demanio marittimo e il potere compete all'autorità individuata dalla legge",
        practicalRoute: "Verificare titoli e opere, trasmettere gli accertamenti all'autorità marittima competente se diversa dal concedente e valutare l'ingiunzione con termine e gli eventuali adempimenti esecutivi previsti.",
        riskOrLimit: "Il procedimento ripristinatorio e distinto dalla decadenza. Competenza, presupposti ed esecuzione non vanno presunti.",
      },
      {
        title: "Valutare prescrizioni, adeguamento o modifica autorizzabile",
        whenApplicable: "Se la disciplina e le circostanze accertate consentono legittimamente una soluzione meno incisiva, senza eludere obblighi o procedimenti dovuti",
        practicalRoute: "Definire gli adeguamenti necessari, verificare con gli uffici le autorizzazioni richieste e motivare le ragioni della scelta, indicando condizioni e controlli.",
        riskOrLimit: "Un'istanza del concessionario non sana automaticamente opere preesistenti, ne impedisce per se l'esercizio dei poteri dell'amministrazione.",
      },
      {
        title: "Archiviare la contestazione o escludere specifiche misure",
        whenApplicable: "Quando il titolo e gli atti dimostrano conformità oppure l'istruttoria non prova i presupposti della singola fattispecie",
        practicalRoute: "Dare conto dei documenti esaminati, delle deduzioni e delle ragioni per cui la decadenza, il ripristino o altri provvedimenti non risultano giuridicamente giustificati.",
        riskOrLimit: "L'archiviazione richiede istruttoria e motivazione; non equivale a convalidare opere non valutate.",
      },
      {
        title: "Verificare ulteriori illeciti e segnalazioni di competenza",
        whenApplicable: "Soltanto se emergono specifici fatti riconducibili ad ulteriori disposizioni sanzionatorie o penali",
        practicalRoute: "Qualificare gli elementi accertati, distinguere il procedimento concessorio da quelli di altre autorità e valutare i doveri di comunicazione previsti dalla legge.",
        riskOrLimit: "Non presumere responsabilità penali, sanzioni o obblighi di denuncia sulla base del solo rapporto preliminare.",
      },
    ] : [
      {
        title: "Valutare contestazione e decadenza della concessione",
        whenApplicable: "Se emergono elementi concreti di una fattispecie prevista dall'art. 47 cod. nav. e sono identificati titolo, obblighi e competenza",
        practicalRoute: "Completare gli accertamenti, individuare la specifica lettera dell'art. 47, contestare i fatti, acquisire le deduzioni e motivare l'eventuale decisione dell'ente concedente.",
        riskOrLimit: "La decadenza non è conseguenza automatica di qualsiasi irregolarità; distinguere tipicità, prova, partecipazione e proporzionalità.",
      },
      {
        title: "Valutare il ripristino, misure ripristinatorie o altri interventi",
        whenApplicable: "Se i fatti integrano presupposti di occupazione o innovazione abusiva o altra violazione con poteri amministrativi specifici",
        practicalRoute: "Verificare l'autorità competente e le norme applicabili, istruire separatamente il ripristino o le altre misure consentite.",
        riskOrLimit: "Non estendere i poteri dell'ente oltre le competenze stabilite dalla legge.",
      },
      {
        title: "Valutare adeguamento con prescrizioni e controllo",
        whenApplicable: "Quando i presupposti normativi consentono all'amministrazione una soluzione diversa da decadenza o ripristino",
        practicalRoute: "Motivare la misura, definire prescrizioni verificabili e controllare il loro adempimento senza presupporre una sanatoria.",
        riskOrLimit: "La misura alternativa non può sostituire illegittimamente provvedimenti dovuti.",
      },
      {
        title: "Archiviare motivatamente l'ipotesi di violazione",
        whenApplicable: "Se la violazione non risulta accertata o non ricorrono i presupposti del provvedimento prospettato",
        practicalRoute: "Registrare i controlli eseguiti, i riscontri e la motivazione dell'esclusione di ulteriori misure.",
        riskOrLimit: "L'archiviazione non deve precludere accertamenti futuri su fatti nuovi.",
      },
    ];
    const reportAlternatives = sourceReady ? alternatives : [
      {
        title: "Completare l'istruttoria prima di scegliere il procedimento",
        whenApplicable: "Quando prove, competenza, disciplina applicabile o consistenza dell'inadempimento non sono ancora verificate",
        practicalRoute: "Acquisire originali, riscontri d'ufficio, verbali e valutazioni tecniche; sottoporre le fonti giuridiche a verifica professionale.",
        riskOrLimit: "L'istruttoria non deve essere presentata come accertamento definitivo ne ritardare termini che l'ufficio abbia previamente verificato.",
      },
      {
        title: "Valutare contestazione, prescrizioni o altro procedimento tipizzato",
        whenApplicable: "Soltanto dopo avere verificato presupposti, competenza, disciplina e proporzionalita della misura",
        practicalRoute: "Separare i procedimenti ipotizzabili, garantire il contraddittorio e motivare la soluzione sulla base degli accertamenti.",
        riskOrLimit: "Nessuna decadenza, revoca, misura ripristinatoria o sanzione e automatica.",
      },
      {
        title: "Archiviare motivatamente la specifica criticita",
        whenApplicable: "Se l'istruttoria non conferma i fatti o i presupposti della misura ipotizzata",
        practicalRoute: "Documentare verifiche, deduzioni e ragioni dell'archiviazione, distinguendo eventuali controlli ancora aperti.",
        riskOrLimit: "L'archiviazione non equivale a convalidare fatti o titoli non esaminati.",
      },
    ];
    const recommendedNextStep = "Priorita per l'ente concedente: completare l'istruttoria su fatti, obblighi, competenza e disciplina; solo dopo valutare il procedimento e la misura proporzionata, senza automatismi.";
    const administrativeActs = administrativeActDrafts({
      issueText: issue.text,
      sourceDocumentRefs,
      outstandingEvidence,
      documentedFacts: related.map((item) => item.normalizedText),
    });
    return {
      issueSemanticKey: issue.semanticKey,
      issueText: issue.text,
      problem: issue.text,
      evidence: sourceDocumentRefs,
      legalQualification: sourceReady
        ? "Qualificazione preliminare fondata sulle fonti giuridiche verificate allegate; resta necessaria l'approvazione professionale."
        : "Ipotesi giuridiche da verificare sulle fonti vigenti: nessuna qualificazione definitiva, competenza o conseguenza e presunta.",
      sourceDocumentRefs,
      outstandingEvidence,
      legalSourceStatus: sourceReady ? "VERIFIED_SOURCES_ATTACHED" : "LEGAL_RESEARCH_REQUIRED",
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
      recommendedNextStep,
      proposedSolution: recommendedNextStep,
      investigationActivities: steps.map((step) => step.action),
      actsToForm: administrativeActs.map((act) => act.actType),
      modelsAvailable: administrativeActs.map((act) => act.actType),
      steps,
      alternatives: reportAlternatives,
      administrativeActs,
      deadlineReview: "Verificare espressamente scadenze, notifiche e termini applicabili: nessuna data processuale è determinata da questo piano.",
    };
  });
}

export function buildStructuredFascicoloReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
  technicalSources?: readonly StructuredReportTechnicalSourceInput[];
  contractVersion?: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION | typeof STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION;
}): BuiltStructuredFascicoloReport {
  const legalCompleteness = assessLegalCompleteness(input.knowledge);
  const currentMissions = input.missions.filter((mission) => mission.lifecycleStatus === "CURRENT"
    && mission.knowledgeRevisionId === input.knowledge.revision.id
    && mission.researchQuestionSemanticKey !== null).sort(byId);
  const technicalSources = projectTechnicalSources(input.technicalSources ?? [], currentMissions);
  const groupedMissions = new Map<string, StructuredReportMissionInput[]>();
  for (const mission of currentMissions) {
    const current = groupedMissions.get(mission.researchQuestionSemanticKey!) ?? [];
    current.push(mission);
    groupedMissions.set(mission.researchQuestionSemanticKey!, current);
  }
  const missionsByQuestion = new Map([...groupedMissions].map(([semanticKey, questionMissions]) => {
    const primary = questionMissions.find((mission) => mission.mode !== "ADVERSE_SEARCH") ?? questionMissions[0];
    const results = [...new Map(questionMissions.flatMap((mission) => mission.results)
      .map((result) => [result.resultId, result])).values()].sort(byId);
    return [semanticKey, {
      ...primary,
      status: questionMissions.every((mission) => mission.status === "COMPLETED") ? "COMPLETED" : primary.status,
      sourceGaps: [...new Set(questionMissions.flatMap((mission) => mission.sourceGaps))].sort(),
      results,
    }];
  }));
  const questions = visibleItems(input.knowledge.researchQuestions).map((item) => projectQuestion(item, missionsByQuestion));
  const questionById = new Map(input.knowledge.researchQuestions.map((item) => [item.id, item]));
  const legalIssues = input.knowledge.legalIssues.filter((item) => item.status !== "REJECTED").sort(byId).map((issue) => ({
    knowledgeItemId: issue.id,
    semanticKey: issue.semanticKey,
    text: issue.normalizedText,
    reviewStatus: issue.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
    originatingItemIds: [...issue.originatingItemIds].sort(),
    questions: questions.filter((question) => questionById.get(question.knowledgeItemId)?.legalIssueId === issue.id),
  }));
  const operationalSubjects = legalIssues.length > 0
    ? legalIssues
    : visibleItems(input.knowledge.gaps).map((gap) => ({
        knowledgeItemId: gap.id,
        semanticKey: gap.semanticKey,
        text: gap.normalizedText,
        reviewStatus: gap.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
        originatingItemIds: [gap.id],
        questions: [],
      }));
  const assignedQuestionIds = new Set(legalIssues.flatMap((issue) => issue.questions.map((question) => question.knowledgeItemId)));
  const knowledgeState = [
    ...input.knowledge.partyRoles, ...(input.knowledge.partyPositions ?? []), ...input.knowledge.facts, ...input.knowledge.events,
    ...input.knowledge.legalActs, ...input.knowledge.measures, ...input.knowledge.contradictions,
    ...input.knowledge.gaps, ...input.knowledge.deadlineCandidates, ...input.knowledge.legalIssues,
    ...input.knowledge.researchQuestions,
  ].filter((item) => item.status !== "REJECTED").map(normalizedItem).sort(byId);
  const researchState = currentMissions.map((mission) => ({
    missionId: mission.missionId,
    missionFingerprint: mission.missionFingerprint,
    mode: mission.mode ?? "PRIMARY",
    questionSemanticKey: mission.researchQuestionSemanticKey,
    status: mission.status,
    coverageStatus: mission.coverageStatus,
    results: [...mission.results].sort(byId).map((result) => ({
      resultId: result.resultId,
      title: result.title,
      sourceUrl: result.sourceUrl,
      provider: result.provider,
      relevantPassage: result.relevantPassage ?? null,
      direction: result.supportDirection,
      reviewStatus: result.classificationReviewStatus,
      rationale: result.classificationRationale,
    })),
  }));
  const sourceAssessmentState = currentMissions.flatMap((mission) => mission.results.map((result) => ({
    resultId: result.resultId,
    assessment: result.sourceAssessment,
  }))).sort(byId);
  const contractVersion = input.contractVersion ?? STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION;
  const sourceState = contractVersion === STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION ? {
    sourceAssessments: sourceAssessmentState,
    legalApplicabilityReviews: currentMissions.flatMap((mission) => mission.legalApplicabilityReviews ?? [])
      .map((envelope) => envelope.review)
      .sort((left, right) => left.reviewId.localeCompare(right.reviewId)),
  } : sourceAssessmentState;
  const legalApplicability = contractVersion === STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION
    ? projectLegalApplicability({ tenantId: input.tenantId, procedimentoId: input.procedimentoId, knowledge: input.knowledge, missions: currentMissions })
    : undefined;
  const payload: StructuredFascicoloReportPayload = {
    contractVersion,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: input.knowledge.revision.id,
    knowledgeContractVersion: input.knowledge.revision.contractVersion,
    corpusFingerprint: input.knowledge.revision.corpusFingerprint,
    knowledgeStateFingerprint: fingerprint(knowledgeState),
    researchStateFingerprint: fingerprint(technicalSources.length
      ? { missions: researchState, technicalSources }
      : researchState),
    sourceStateFingerprint: fingerprint(sourceState),
    documentedFramework: {
      partyRoles: visibleItems(input.knowledge.partyRoles),
      partyPositions: visibleItems(input.knowledge.partyPositions ?? []),
      facts: visibleItems(input.knowledge.facts),
      timeline: visibleItems(input.knowledge.timeline),
      legalActs: visibleItems(input.knowledge.legalActs),
      measures: visibleItems(input.knowledge.measures),
      contradictions: input.knowledge.contradictions.filter((item) => item.status !== "REJECTED").sort(byId),
    },
    legalIssues,
    unassignedQuestions: questions.filter((question) => !assignedQuestionIds.has(question.knowledgeItemId)),
    gaps: visibleItems(input.knowledge.gaps),
    deadlineCandidates: visibleItems(input.knowledge.deadlineCandidates),
    professionalNarrative: buildProfessionalNarrative(input.knowledge),
    operationalPlans: buildOperationalPlans(operationalSubjects, input.knowledge, technicalSources),
    ...(technicalSources.length ? { technicalSources } : {}),
    legalCompleteness,
    ...(legalApplicability ? { legalApplicability } : {}),
    limitations: [...new Set([
      ...input.knowledge.revision.warnings,
      ...(input.knowledge.deadlineCandidates.length ? ["DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES"] : []),
      ...(legalIssues.length ? [] : ["NO_EXPLICIT_LEGAL_ISSUES_IN_CURRENT_KNOWLEDGE"]),
      ...(questions.length ? [] : ["NO_CURRENT_RESEARCH_QUESTIONS"]),
      ...(technicalSources.length ? ["TECHNICAL_SOURCES_NOT_PROBATIVE_VERIFY_ORIGINAL"] : []),
      ...(legalCompleteness.issueCoverage === "DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_ISSUES"
        ? ["DOCUMENTED_SIGNALS_WITHOUT_STRUCTURED_LEGAL_ISSUES"]
        : []),
      ...(legalCompleteness.documentNeed === "ADDITIONAL_DOCUMENTS_REQUIRED"
        ? ["ADDITIONAL_DOCUMENTS_REQUIRED"]
        : []),
    ])].sort(),
  };
  return { reportFingerprint: fingerprint(payload), payload };
}

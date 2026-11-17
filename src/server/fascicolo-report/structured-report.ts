import { createHash } from "node:crypto";

import {
  hasProfessionalSourceClassification,
  isProfessionallyUsableSource,
  SOURCE_REVIEW_POLICY,
  UNREVIEWED_SOURCE_NOTICE,
} from "@/lib/professional-research-sources";
import { stableStringify } from "@/server/audit/hash";
import type { DocumentCoverageEntry } from "@/lib/document-coverage";
import { detectActPhase, type ActPhaseDetection } from "@/server/fascicolo-acts/templates";
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
import {
  OFFICIAL_SOURCE_RELEVANCE_LABELS,
  type OfficialSourceRelevance,
} from "@/server/legal-research/official-source-relevance";
import type { SourceChainSnapshot } from "@/server/legal-research/source-chain";
import {
  contributionBasisRefs,
  contributionCandidateIds,
  type LegalAnalysisContribution,
} from "@/server/legal-research/legal-synthesis";
import type { TemporalAssessmentResult } from "@/server/legal-sources/temporal";

import { buildIssuePath, sharedAdminActsStep, type IssuePath, type SharedActivityNeed } from "./issue-paths";
import { buildLegalApplication, extractIsoDates, type StructuredReportLegalApplication } from "./legal-application";
import { assessIssueProfile, type LegalIssueProfileAssessment } from "./legal-issue-profiles";
import { buildPortRegimeCoordination, isPortConcessionMatter, type PortRegimeCoordination } from "./port-regime";

export type { StructuredReportLegalApplication } from "./legal-application";
export type { PortRegimeCoordination } from "./port-regime";

export const STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V1" as const;
export const STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V2" as const;

type JsonRecord = Readonly<Record<string, unknown>>;
type Direction = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";

function jsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export interface StructuredReportResearchResultInput {
  resultId: string;
  missionId?: string;
  candidateId?: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  supportDirection: Direction;
  classificationSource?: "PROVIDER_OUTPUT" | "SYNTHETIC_TEST" | "HUMAN_REVIEW" | "AI_CLASSIFIER";
  classificationReviewAuditId?: string | null;
  classificationReviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
  classificationRationale: string | null;
  relevantPassage?: string | null;
  /** Outcome of the official-source relevance check; absent for results never checked. */
  officialRelevance?: OfficialSourceRelevance | null;
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
  professionalQuestionVersionId?: string | null;
  legalIssueSemanticKey?: string | null;
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: string;
  question: string;
  coverageStatus: string;
  sourceGaps: readonly string[];
  results: readonly StructuredReportResearchResultInput[];
  legalAnalysisContributions?: readonly LegalAnalysisContribution[];
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
  candidateId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  assessmentId: string;
  sourceChainFingerprint: string;
  citationAnchors: readonly JsonRecord[];
  classificationReviewAuditId?: string;
  relevantPassage?: string | null;
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
    missionId?: string;
    title: string;
    sourceUrl?: string | null;
    direction: Direction;
    rationale?: string | null;
    reasons: readonly string[];
    /** Absent in archived snapshots created before the official relevance check. */
    relevance?: NonUsableRelevance;
    relevanceNote?: string | null;
  }[];
  gaps: readonly string[];
  limitations: readonly string[];
}

export interface StructuredReportOperationalStep {
  /** Stable semantic identity; archived reports without it retain their legacy title identity. */
  activityCode?: string;
  documentCode?: string;
  necessity?: "REQUIRED" | "CONDITIONAL" | "NOT_JUSTIFIED";
  title: string;
  action: string;
  office: string;
  requiredDocuments: readonly string[];
  completionGate: string;
  draftTitle?: string;
  draftTemplate?: string;
  additionalDrafts?: readonly { documentCode: string; title: string; template: string }[];
  /** Issues served by a single shared activity hosted in this plan. */
  sharedIssueSemanticKeys?: readonly string[];
}

export interface StructuredReportSharedActivityRef {
  activityCode: string;
  hostIssueSemanticKey: string;
  hostIssueText: string;
  title: string;
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
  /** Release V2 fields: absent in reports generated before the merge. */
  problem?: string;
  evidence?: readonly string[];
  legalQualification?: string;
  sourceDocumentRefs: readonly string[];
  outstandingEvidence: readonly string[];
  legalSourceStatus: "VERIFIED_SOURCES_ATTACHED" | "LEGAL_RESEARCH_REQUIRED";
  professionalStatus: "PRELIMINARY_NOT_APPROVED";
  recommendedNextStep: string;
  proposedSolution?: string;
  investigationActivities?: readonly string[];
  actsToForm?: readonly string[];
  modelsAvailable?: readonly string[];
  steps: readonly StructuredReportOperationalStep[];
  /** Shared activities that concern this issue but are tracked in another issue's plan. */
  sharedActivityRefs?: readonly StructuredReportSharedActivityRef[];
  alternatives: readonly StructuredReportOperationalAlternative[];
  administrativeActs?: readonly StructuredReportAdministrativeActDraft[];
  deadlineReview: string;
}

export interface StructuredReportProceduralContext {
  stato: string;
  tipologia: string;
  origineProcedimento: string;
  dataAvvio: string | null;
  dataProvvedimentoFinale: string | null;
  comunicazioneAvvioInviata: boolean;
  contestazioneFormaleInviata: boolean;
  memorieRicevute: boolean;
  audizioneSvolta: boolean;
  controdeduzioniValutate: boolean;
  checklistContraddittorioCompleta: boolean;
  finalAct: {
    numeroAtto: string;
    dataAtto: string;
    motivazioneSintetica: string;
  } | null;
  concessione: {
    numeroAtto: string;
    stato: string;
    dataRilascio: string;
  } | null;
  documentTitles: readonly string[];
}

export interface StructuredReportRegulatoryApplicability {
  measure: string;
  effectiveFrom: string;
  trigger: string;
  applicability: string;
  authorityAction: string;
  deadline: string;
  officialSourceUrl: string;
}

export interface StructuredReportLegalAnalysis {
  issueSemanticKey: string;
  issueText: string;
  status: "RESEARCH_REQUIRED" | "SOURCE_VERIFICATION_REQUIRED" | "MOTIVATION_REQUIRED" | "ARGUED" | "CONTESTED";
  documentedFacts: readonly {
    statement: string;
    documentReferences: readonly string[];
  }[];
  questions: readonly string[];
  verifiedSources: readonly {
    resultId: string;
    title: string;
    sourceUrl: string | null;
    provider: string | null;
    direction: "SUPPORTS" | "OPPOSES";
    relevantPassage: string | null;
    rationale: string | null;
    citationAnchors: readonly JsonRecord[];
  }[];
  /** Candidate sources acquired but not professionally usable; absent from archived reports. */
  candidateSources?: StructuredReportQuestion["nonUsableResults"];
  applications: readonly {
    applicationId: string;
    outcome: "APPLICABLE" | "NOT_APPLICABLE" | "TO_VERIFY" | "NOT_EVALUATED";
    checks: readonly {
      criterion: string;
      outcome: "SATISFIED" | "NOT_SATISFIED" | "TO_VERIFY";
      rationale: string;
      decisiveFacts: readonly string[];
    }[];
    conclusion: string;
  }[];
  competingArguments: {
    supporting: readonly string[];
    opposing: readonly string[];
  };
  professionalReasoning: LegalAnalysisContribution | null;
  assessment: string;
  missingEvidence: readonly string[];
  recommendedActions: readonly string[];
  professionalReviewRequired: true;
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
  /** Absent in older snapshots whose source classifications cannot be assumed confirmed. */
  sourceReviewPolicy?: typeof SOURCE_REVIEW_POLICY;
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  knowledgeContractVersion: string;
  corpusFingerprint: string;
  knowledgeStateFingerprint: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
  /** Authoritative metadata used when the immutable report version was generated. */
  proceduralContext?: StructuredReportProceduralContext;
  /** Page-level reading coverage of the corpus; absent in older snapshots. */
  documentCoverage?: readonly DocumentCoverageEntry[];
  /** Corpus the coverage refers to; differs from corpusFingerprint when the analysis is not current. */
  documentCoverageCorpusFingerprint?: string;
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
    proceedingIdentity?: {
      status: string;
      action: string;
      reason: string | null;
      linkedAnchor: {
        semanticKey: string;
        kind: "LEGAL_ACT" | "MEASURE";
        text: string;
      } | null;
      evidenceBasisRefs: readonly string[];
      providerClaim: JsonRecord | null;
      candidateAnchorSemanticKeys: readonly string[];
    };
    questions: readonly StructuredReportQuestion[];
  }[];
  /** Report-only continuity check; does not create Knowledge items, missions or proposals. */
  continuityIssues?: readonly {
    profileId: "UNAUTHORIZED_OCCUPATION";
    title: string;
    question: string;
    documentedFacts: readonly {
      statement: string;
      documentReferences: readonly string[];
    }[];
    status: "CONTINUITY_REVIEW_REQUIRED";
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
  /** Additive applicability matrix. Older archived V1 reports may omit this field. */
  regulatoryApplicability?: readonly StructuredReportRegulatoryApplicability[];
  /** Additive fact-to-law application with temporal reasoning. Older archived V1 reports may omit this field. */
  legalApplication?: readonly StructuredReportLegalApplication[];
  /** Additive date-driven coordination of the port-concession regime. Older reports may omit it. */
  portRegime?: PortRegimeCoordination | null;
  /** Source-grounded issue analysis. Absent from archived snapshots created before this compiler version. */
  legalAnalyses?: readonly StructuredReportLegalAnalysis[];
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

const UNAUTHORIZED_OCCUPATION_CONTINUITY_PATTERN =
  /\b(?:ostruzion\w*|varc\w*|vie?\s+di\s+esodo|antincendio|oltre\s+il\s+perimetro|fuori\s+perimetro|are[ae]\s+estern[ae]|container)\b/i;

function buildContinuityIssues(
  knowledge: StructuredKnowledgeReadModel,
): NonNullable<StructuredFascicoloReportPayload["continuityIssues"]> {
  const evidenceItems = [
    ...knowledge.facts,
    ...knowledge.events,
    ...knowledge.contradictions,
  ].filter((item) => item.status !== "REJECTED" && UNAUTHORIZED_OCCUPATION_CONTINUITY_PATTERN.test(item.normalizedText));
  if (evidenceItems.length === 0) return [];

  const represented = knowledge.legalIssues.some((issue) => (
    UNAUTHORIZED_OCCUPATION_CONTINUITY_PATTERN.test(issue.normalizedText)
  ));
  if (represented) return [];

  return [{
    profileId: "UNAUTHORIZED_OCCUPATION",
    title: "Occupazioni temporanee di varchi di sicurezza e aree esterne al perimetro",
    question: "Quali conseguenze concessorie possono seguire a occupazioni temporanee di vie di esodo, varchi antincendio o aree esterne al perimetro, e quale rilievo assume la spontanea rimozione?",
    documentedFacts: evidenceItems.map((item) => ({
      statement: item.normalizedText,
      documentReferences: itemBasisRefs(item),
    })),
    status: "CONTINUITY_REVIEW_REQUIRED",
  }];
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
      (() => {
        const resolution = jsonRecord(jsonRecord(item.payload).targetProceedingResolution);
        const identityStatus = typeof resolution.status === "string"
          ? resolution.status === "VERIFIED"
            ? "identita del procedimento verificata"
            : `identita del procedimento incerta (${String(resolution.reason ?? resolution.status)})`
          : "identita del procedimento non classificata";
        return `Questione preliminare ricavata dal fascicolo; ${identityStatus}: ${narrativeLine(item)}`;
      })()
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
  if (!isProfessionallyUsableSource(result)) throw new Error("SOURCE_CLASSIFICATION_NOT_READY");
  const assessment = result.sourceAssessment!;
  return {
    resultId: result.resultId,
    candidateId: result.candidateId ?? result.resultId,
    title: result.title,
    sourceUrl: result.sourceUrl,
    provider: result.provider,
    assessmentId: assessment.assessmentId,
    sourceChainFingerprint: assessment.chainFingerprint,
    citationAnchors: [...assessment.citationAnchors],
    classificationReviewAuditId: result.classificationReviewAuditId!,
    relevantPassage: result.relevantPassage ?? null,
    rationale: result.classificationRationale,
  };
}

function nonUsableReasons(result: StructuredReportResearchResultInput): readonly string[] {
  const assessment = result.sourceAssessment;
  const reasons = assessment?.blockingReasons ?? [];
  const relevance = result.officialRelevance;
  return [...new Set([
    ...reasons,
    ...(!assessment?.isCurrent ? ["MISSING_CURRENT_SOURCE_ASSESSMENT"] : []),
    ...(assessment && !assessment.usable && !assessment.blockingReasons.length ? ["SOURCE_NOT_USABLE"] : []),
    ...(assessment?.manualReviewRequired ? ["MANUAL_REVIEW_REQUIRED"] : []),
    ...(result.classificationReviewStatus === "REJECTED" ? ["CLASSIFICATION_REJECTED"] : []),
    ...(result.classificationReviewStatus === "AI_PROPOSED" ? ["CLASSIFICATION_NOT_HUMAN_CONFIRMED"] : []),
    ...(result.classificationReviewStatus === "HUMAN_CONFIRMED" && !hasProfessionalSourceClassification(result)
      ? ["CLASSIFICATION_ATTESTATION_REQUIRED"] : []),
    ...(!["SUPPORTS", "OPPOSES"].includes(result.supportDirection) ? ["DIRECTION_NOT_DECISIVE"] : []),
    ...(assessment?.citationAnchors.length ? [] : ["CITATION_ANCHOR_REQUIRED"]),
    ...(relevance?.status === "NON_PERTINENTE" ? ["NOT_PERTINENT_TO_QUESTION"] : []),
    ...(relevance?.status === "NON_VERIFICABILE" ? [`OFFICIAL_SOURCE_NOT_VERIFIABLE:${relevance.reason}`] : []),
    ...(relevance?.status === "PERTINENTE_VERIFICATA" && !["SUPPORTS", "OPPOSES"].includes(result.supportDirection)
      ? ["PROFESSIONAL_DIRECTION_REVIEW_REQUIRED"] : []),
  ])].sort();
}

export type NonUsableRelevance =
  | "PERTINENTE_VERIFICATA_DA_CLASSIFICARE"
  | "NON_PERTINENTE"
  | "NON_VERIFICABILE"
  | "NON_ANCORA_VERIFICATA";

function nonUsableRelevance(result: StructuredReportResearchResultInput): NonUsableRelevance {
  switch (result.officialRelevance?.status) {
    case "PERTINENTE_VERIFICATA": return "PERTINENTE_VERIFICATA_DA_CLASSIFICARE";
    case "NON_PERTINENTE": return "NON_PERTINENTE";
    case "NON_VERIFICABILE": return "NON_VERIFICABILE";
    default: return "NON_ANCORA_VERIFICATA";
  }
}

function projectQuestion(
  item: Pick<StructuredKnowledgeReadItem, "id" | "semanticKey" | "normalizedText" | "status">,
  missionsByQuestion: ReadonlyMap<string, StructuredReportMissionInput>,
): StructuredReportQuestion {
  const mission = missionsByQuestion.get(item.semanticKey) ?? null;
  const results = [...(mission?.results ?? [])].sort(byId);
  const favorableAuthorities = results.filter((result) => isProfessionallyUsableSource(result) && result.supportDirection === "SUPPORTS").map(authority);
  const contraryAuthorities = results.filter((result) => isProfessionallyUsableSource(result) && result.supportDirection === "OPPOSES").map(authority);
  const nonUsableResults = results.filter((result) => !isProfessionallyUsableSource(result))
    .map((result) => ({
      resultId: result.resultId, missionId: result.missionId, title: result.title, sourceUrl: result.sourceUrl,
      direction: result.supportDirection,
      rationale: result.relevantPassage ?? result.classificationRationale,
      reasons: nonUsableReasons(result),
      relevance: nonUsableRelevance(result),
      relevanceNote: result.officialRelevance
        ? OFFICIAL_SOURCE_RELEVANCE_LABELS[result.officialRelevance.reason]
          + (result.officialRelevance.citation ? ` (${result.officialRelevance.citation})` : "")
        : null,
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
    ...(results.some((result) => result.classificationReviewStatus !== "REJECTED"
      && !hasProfessionalSourceClassification(result)) ? [UNREVIEWED_SOURCE_NOTICE] : []),
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

const DEFAULT_DECISION_OPTIONS = "Scegliere fra archiviazione, regolarizzazione con prescrizioni, penali se predeterminate nel titolo, ripristino o decadenza.";

const PROFILE_DECISION_OPTIONS: Record<string, string> = {
  THIRD_PARTY_USE: "Valutare archiviazione, eventuale autorizzazione preventiva per l'affidamento futuro se consentita dalla disciplina applicabile, oppure cessazione dell'uso non autorizzato ove ne ricorrano i presupposti. Non presumere che l'autorizzazione sani automaticamente la condotta pregressa. Valutare la decadenza solo dopo avere individuato e verificato la specifica fattispecie: l'art. 47, lett. e), cod. nav. richiede sostituzione abusiva nel godimento, distinta dal solo affidamento di attività; verificare anche l'art. 18, comma 11, L. 84/1994.",
  INVESTMENT_DEFAULT: "Valutare archiviazione per giustificato motivo, eventuale diffida, revisione del programma o del PEF, penali e decadenza. Prima di attribuire obblighi di notifica ad ART o applicare penali, verificare ambito e presupposti delle misure pertinenti, il bando e il titolo.",
  UNAUTHORIZED_OCCUPATION: "Scegliere fra archiviazione, variazione assentita del titolo se compatibile (art. 24 reg. nav. mar.), ingiunzione di sgombero e rimessa in pristino (art. 54 cod. nav., potere autonomo dalla decadenza), decadenza solo per inosservanza grave degli obblighi del titolo, e segnalazione all'autorità giudiziaria se ne ricorrono i presupposti.",
  FEE_PAYMENT: "Scegliere fra messa in mora e recupero del credito con interessi, imputazione dei versamenti, rateizzazione se ammessa dall'ente, escussione della garanzia se prevista dal titolo, e decadenza (art. 47, lett. d, cod. nav.) solo se è raggiunto il numero di rate omesse fissato dall'atto di concessione.",
};

function decisionDraft(issueText: string): string {
  return [
    `Oggetto: schema di decisione sulla seguente questione — ${issueText}.`,
    "Autorità e competenza da verificare: [ORGANO COMPETENTE E FONDAMENTO]. Responsabile: [RESPONSABILE].",
    "Fatti e documenti: [FATTI ACCERTATI, ALLEGAZIONI, ELEMENTI CONTRARI E RIFERIMENTI DOCUMENTALI].",
    "Disciplina applicabile: [FONTI UFFICIALI, VERSIONI E DATE RILEVANTI, PRESUPPOSTI VERIFICATI].",
    "Istruttoria e partecipazione: [GARANZIE APPLICABILI, EVENTUALI OSSERVAZIONI E LORO VALUTAZIONE].",
    "Motivazione: [VALUTAZIONE DELLE ALTERNATIVE E DELLE RAGIONI FAVOREVOLI E CONTRARIE].",
    "Esito proposto: [DECISIONE MOTIVATA E CONSEGUENZE EFFETTIVAMENTE DOVUTE]. Data e sottoscrizione: [DA INSERIRE DOPO VERIFICA].",
    "Bozza soggetta ad approvazione umana; nessuna firma, protocollazione o comunicazione automatica.",
  ].join("\n\n");
}

function profileIssuePath(
  issue: { semanticKey: string; text: string },
  profile: LegalIssueProfileAssessment,
  caseTexts: readonly string[],
): IssuePath {
  const contraddittorio = profile.elements.find((element) => element.elementId === "contraddittorio");
  return buildIssuePath({
    issueSemanticKey: issue.semanticKey,
    issueText: issue.text,
    profile,
    caseTexts,
    contested: contraddittorio?.status === "PROVEN",
    decisionOptions: PROFILE_DECISION_OPTIONS[profile.profileId] ?? DEFAULT_DECISION_OPTIONS,
    decisionDraft: decisionDraft(issue.text),
  });
}

function numberSteps(steps: readonly StructuredReportOperationalStep[]): StructuredReportOperationalStep[] {
  return steps.map((step, index) => ({ ...step, title: `${index + 1}. ${step.title.replace(/^\d+\.\s*/, "")}` }));
}

const APPLICABILITY_CHECK_LABELS = [
  ["Vigenza temporale", "chronologicalCheck"],
  ["Autenticità e utilizzabilità della fonte", "sourceVerificationCheck"],
  ["Ambito territoriale", "territorialCheck"],
  ["Ambito materiale", "materialCheck"],
  ["Presupposti fattuali", "factualCheck"],
  ["Specialità e rapporto tra norme", "specialityCheck"],
  ["Disciplina transitoria", "transitionalCheck"],
] as const;

function buildLegalAnalyses(input: {
  issues: StructuredFascicoloReportPayload["legalIssues"];
  knowledge: StructuredKnowledgeReadModel;
  applicability: StructuredFascicoloReportPayload["legalApplicability"];
  contributions: readonly LegalAnalysisContribution[];
}): readonly StructuredReportLegalAnalysis[] {
  const evidenceItems = [
    ...(input.knowledge.partyPositions ?? []),
    ...input.knowledge.facts,
    ...input.knowledge.events,
    ...input.knowledge.legalActs,
    ...input.knowledge.measures,
    ...input.knowledge.contradictions,
    ...input.knowledge.gaps,
    ...input.knowledge.deadlineCandidates,
  ].filter((item) => item.status !== "REJECTED");
  const itemById = new Map(evidenceItems.map((item) => [item.id, item]));

  return input.issues.map((issue) => {
    const related = issue.originatingItemIds
      .map((id) => itemById.get(id))
      .filter((item): item is StructuredKnowledgeReadItem => item !== undefined);
    const sources = issue.questions.flatMap((question) => [
      ...question.favorableAuthorities.map((source) => ({ ...source, direction: "SUPPORTS" as const })),
      ...question.contraryAuthorities.map((source) => ({ ...source, direction: "OPPOSES" as const })),
    ]);
    const uniqueSources = [...new Map(sources.map((source) => [source.resultId, source])).values()];
    const candidateSources = [...new Map(issue.questions
      .flatMap((question) => question.nonUsableResults)
      .filter((source) => !source.reasons.includes("CLASSIFICATION_REJECTED"))
      .map((source) => [source.resultId, source])).values()];
    const usableCandidateIds = new Set(uniqueSources.map((source) => source.candidateId));
    const relatedBasisRefs = new Set(related.flatMap(itemBasisRefs));
    const questionSemanticKeys = new Set(issue.questions.map((question) => question.semanticKey));
    const validContributions = input.contributions.filter((contribution) => (
      contribution.legalIssueSemanticKey === issue.semanticKey
      && questionSemanticKeys.has(contribution.researchQuestionSemanticKey)
      && contributionCandidateIds(contribution).every((candidateId) => usableCandidateIds.has(candidateId))
      && contributionBasisRefs(contribution).every((basisRef) => relatedBasisRefs.has(basisRef))
    )).sort((left, right) => left.contributionId.localeCompare(right.contributionId));
    const professionalReasoning = validContributions.length === 1 ? validContributions[0] : null;
    const applications = (input.applicability?.applications ?? [])
      .filter((application) => application.legalIssueSemanticKey === issue.semanticKey)
      .map((application) => {
        const assessment = application.assessment;
        return {
          applicationId: application.applicationId,
          outcome: application.outcome,
          checks: assessment ? APPLICABILITY_CHECK_LABELS.map(([criterion, key]) => {
            const check = assessment[key];
            return {
              criterion,
              outcome: check.outcome,
              rationale: check.rationale,
              decisiveFacts: check.decisiveFactClaimIds.map((id) => (
                itemById.get(id)?.normalizedText ?? id
              )),
            };
          }) : [],
          conclusion: assessment?.conclusion.rationale
            ?? "L'applicabilità della fonte non è stata ancora verificata rispetto ai fatti documentati.",
        };
      });
    const supporting = professionalReasoning?.supportingArguments.map((argument) => argument.text) ?? [];
    const opposing = professionalReasoning?.contraryArguments.map((argument) => argument.text) ?? [];
    const missingEvidence = [...new Set([
      ...related.filter((item) => item.kind === "GAP").map((item) => item.normalizedText),
      ...issue.questions.flatMap((question) => question.gaps),
      ...applications.flatMap((application) => application.checks
        .filter((check) => check.outcome === "TO_VERIFY")
        .map((check) => `${check.criterion}: ${check.rationale}`)),
    ])];
    const status: StructuredReportLegalAnalysis["status"] = uniqueSources.length === 0
      ? candidateSources.length > 0
        ? "SOURCE_VERIFICATION_REQUIRED"
        : "RESEARCH_REQUIRED"
      : professionalReasoning === null
        ? "MOTIVATION_REQUIRED"
        : professionalReasoning.contraryArguments.length > 0
          ? "CONTESTED"
          : "ARGUED";
    const assessment = uniqueSources.length === 0
      ? candidateSources.length > 0
        ? `La ricerca è stata eseguita e ha individuato ${candidateSources.length} fonti candidate. Identità, contenuto, vigenza, applicabilità temporale e classificazione professionale devono ancora essere verificati; nessuna conclusione giuridica è formulata.`
        : "La ricerca non è stata eseguita o non ha prodotto risultati; nessuna conclusione giuridica è formulata."
      : professionalReasoning?.reasonedConclusion.text
        ?? "Le fonti sono disponibili, ma non è stata acquisita una motivazione argomentata e integralmente riferita ai fatti e alle fonti verificate.";
    const recommendedActions = [...new Set([
      ...(uniqueSources.length === 0 && candidateSources.length === 0
        ? issue.questions.map((question) => `Completare la ricerca e la verifica delle fonti per il quesito: ${question.text}`)
        : []),
      ...(candidateSources.length > 0
        ? ["Verificare sulle fonti originali identità, testo integrale, vigenza alla data rilevante, applicabilità e orientamento favorevole o contrario delle fonti candidate già acquisite."]
        : []),
      ...(uniqueSources.length > 0 && professionalReasoning === null
        ? ["Acquisire dall'esecutore autorizzato una motivazione specifica che citi esclusivamente le fonti e i fatti verificati della questione."]
        : []),
      ...(professionalReasoning?.strategies.map((strategy) => `${strategy.title}: ${strategy.rationale}`) ?? []),
    ])];

    return {
      issueSemanticKey: issue.semanticKey,
      issueText: issue.text,
      status,
      documentedFacts: related
        .filter((item) => item.kind !== "GAP")
        .map((item) => ({
          statement: item.normalizedText,
          documentReferences: itemBasisRefs(item),
        })),
      questions: issue.questions.map((question) => question.text),
      verifiedSources: uniqueSources.map((source) => ({
        resultId: source.resultId,
        title: source.title,
        sourceUrl: source.sourceUrl,
        provider: source.provider,
        direction: source.direction,
        relevantPassage: source.relevantPassage ?? null,
        rationale: source.rationale,
        citationAnchors: source.citationAnchors,
      })),
      candidateSources,
      applications,
      competingArguments: { supporting, opposing },
      professionalReasoning,
      assessment,
      missingEvidence: [...new Set([
        ...missingEvidence,
        ...(professionalReasoning?.evidenceAssessment.missingEvidence ?? []),
      ])],
      recommendedActions,
      professionalReviewRequired: true,
    };
  });
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
  proceduralContext?: StructuredReportProceduralContext,
  portMatter = false,
  detectedPhase?: ActPhaseDetection,
  technicalSources: readonly StructuredReportTechnicalSource[] = [],
): readonly StructuredReportOperationalPlan[] {
  const phase = detectedPhase ?? detectActPhase({
    proceduralContext,
    documentedFramework: {
      partyRoles: knowledge.partyRoles,
      facts: knowledge.facts,
      timeline: knowledge.events,
      legalActs: knowledge.legalActs,
      measures: knowledge.measures,
      contradictions: knowledge.contradictions,
    },
  });
  const evidenceItems = [
    ...knowledge.facts, ...knowledge.legalActs, ...knowledge.measures,
    ...knowledge.events, ...knowledge.gaps, ...knowledge.deadlineCandidates,
  ].filter((item) => item.status !== "REJECTED");
  const gapIds = new Set(knowledge.gaps.map((item) => item.id));
  // Substantive facts usable as evidence for any issue; gap notices are not facts.
  const fascicoloFacts = evidenceItems.filter((item) => !gapIds.has(item.id));
  const sharedNeeds: SharedActivityNeed[] = [];
  const plans = issues.map((issue): StructuredReportOperationalPlan => {
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
    const proceedingConcluded = phase.phase === "POST_DECISION";
    const reviewPending = phase.reviewPending;
    const finalActLabel = proceduralContext?.finalAct
      ? `${proceduralContext.finalAct.numeroAtto} del ${proceduralContext.finalAct.dataAtto}`
      : "provvedimento finale";
    const postDecisionSteps: StructuredReportOperationalStep[] = [
      ...(reviewPending ? [{
        activityCode: "PORT:POST:REVIEW",
        documentCode: "RISCONTRO_RIESAME",
        necessity: "REQUIRED" as const,
        title: "1. Istruire l'istanza di riesame come procedimento distinto",
        action: `Confrontare i motivi dell'istanza con ${finalActLabel}, distinguendo fatti nuovi, errori prospettati, documenti già valutati e interesse pubblico attuale. Non riavviare né duplicare il procedimento concluso.`,
        office: "Responsabile del riesame o dell'autotutela, con supporto dell'ufficio legale e dell'ufficio concessioni",
        requiredDocuments: ["Istanza di riesame con allegati e protocollo", "Provvedimento finale e prova della comunicazione", "Indice degli atti istruttori, memorie e audizioni", "Matrice motivi del riesame - motivazione dell'atto - prova disponibile"],
        completionGate: "Ogni motivo ha ricevuto una valutazione espressa; competenza, termine, interesse pubblico e affidamento sono stati verificati",
        draftTitle: "Riscontro motivato all'istanza di riesame",
        draftTemplate: "Oggetto: istanza di riesame relativa a [TITOLO/ATTO]. Esaminata l'istanza prot. [PROTOCOLLO], l'Autorità ricostruisce separatamente ciascun motivo, i fatti nuovi e gli atti già valutati; verifica competenza, disciplina applicabile nel tempo, interesse pubblico attuale e affidamento; determina [ESITO MOTIVATO]. Campi da completare: [ORGANO COMPETENTE], [TERMINE], [MOTIVI], [DOCUMENTI], [ESITO]. Bozza soggetta ad approvazione umana; nessun invio automatico.",
      }] : []),
      {
        activityCode: "PORT:POST:FINAL_ACT_REVIEW",
        documentCode: "NOTA_TENUTA_PROVVEDIMENTO",
        necessity: "REQUIRED",
        title: reviewPending ? "2. Verificare la tenuta del provvedimento finale" : "1. Verificare la tenuta del provvedimento finale",
        action: `Riesaminare ${finalActLabel} rispetto a competenza, successione temporale delle fonti, prova dei singoli addebiti, trattamento delle regolarizzazioni, contraddittorio, proporzionalità e motivazione. Separare penali, decadenza e obblighi regolatori.`,
        office: "Ufficio concessioni con supporto legale e tecnico-contabile",
        requiredDocuments: ["Provvedimento finale e fascicolo istruttorio completo", "Titolo concessorio con PI, PEF e allegati", "Memorie, verbali di audizione e valutazione delle controdeduzioni", "Riconciliazione canoni e rettifiche contabili", "Fonti vigenti alle date dei fatti e del provvedimento"],
        completionGate: "Nota di tenuta con esito separato per ciascun addebito e valutazione delle ragioni favorevoli e contrarie all'Autorità",
        draftTitle: "Nota interna sulla tenuta del provvedimento",
        draftTemplate: "La nota verifica: (1) competenza; (2) disciplina ratione temporis; (3) fatti provati, allegazioni e lacune; (4) difese e controdeduzioni; (5) regolarizzazioni; (6) proporzionalità; (7) distinzione tra penali e decadenza; (8) motivazione. Per ogni punto indicare [ELEMENTI FAVOREVOLI], [ELEMENTI CONTRARI], [RISCHIO], [CONCLUSIONE]. Bozza soggetta ad approvazione umana.",
      },
      {
        activityCode: "PORT:POST:FOLLOW_UP",
        documentCode: "VERBALE_RICONSEGNA",
        necessity: "CONDITIONAL",
        title: reviewPending ? "3. Governare esecuzione, contenzioso e obblighi residui" : "2. Governare esecuzione, contenzioso e obblighi residui",
        action: "Programmare soltanto gli adempimenti conseguenti all'atto efficace: riconsegna e inventario, controlli tecnici, tutela patrimoniale, riconciliazione canoni, conservazione della prova e comunicazioni regolatorie effettivamente dovute.",
        office: "Ufficio demanio, area tecnica, ragioneria e ufficio legale secondo competenza",
        requiredDocuments: ["Planimetria e inventario aggiornati", "Verbali e documentazione fotografica", "Situazione contabile riconciliata", "Calendario di riconsegna e adempimenti", "Eventuali atti giudiziari o precontenziosi"],
        completionGate: "Ogni adempimento ha responsabile, data, dipendenze, documento di esito e verifica di chiusura",
        draftTitle: "Convocazione e verbale di riconsegna",
        draftTemplate: "Oggetto: riconsegna del compendio [IDENTIFICAZIONE]. Convocazione per il [DATA] alle [ORA] presso [LUOGO]. Il verbale rileva perimetro, opere, beni, stato manutentivo, utenze, chiavi, obblighi patrimoniali e riserve. Allegati: [PLANIMETRIA], [INVENTARIO], [FOTOGRAFIE], [LETTURE]. Bozza soggetta ad approvazione umana; nessuna firma, protocollazione o notifica automatica.",
      },
    ];
    const preDecisionSteps: StructuredReportOperationalStep[] = [
      {
        activityCode: "PORT:FACTS",
        necessity: "REQUIRED",
        title: "1. Accertare i fatti e gli obblighi concessori",
        action: "L'ente concedente deve confrontare titolo e prescrizioni con lo stato dei luoghi e l'uso effettivo, distinguendo elementi provati, indizi, atti mancanti ed eventuali autorizzazioni successive. Verificare chi sia l'autorità competente per ciascun potere.",
        office: "Responsabile del procedimento e ufficio demanio dell'ente concedente; ufficio tecnico e autorità marittima secondo le competenze accertate",
        requiredDocuments: concernsInstallation
          ? ["Titolo concessorio integrale con allegati, planimetrie e modifiche", "Verbale di sopralluogo, rilievi, fotografie, dimensioni e destinazione effettiva del manufatto", "Autorizzazioni e assensi eventualmente rilasciati, anche tecnico-edilizi", "Comunicazioni e precedenti controlli dell'amministrazione"]
          : ["Titolo e prescrizioni vigenti con eventuali modifiche", "Verbali, comunicazioni e riscontri documentali", "Autorizzazioni, pagamenti e atti di controllo pertinenti alla specifica criticità"],
        completionGate: "Fatti, titoli, soggetti, competenza e possibili violazioni verificati con istruttoria documentata",
      },
      {
        activityCode: "PORT:QUALIFICATION",
        necessity: "REQUIRED",
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
        activityCode: "PORT:PARTICIPATION",
        necessity: "CONDITIONAL",
        title: proceduralContext?.contestazioneFormaleInviata
          ? "3. Valutare il contraddittorio già avviato"
          : "3. Garantire contestazione e contraddittorio",
        action: proceduralContext?.contestazioneFormaleInviata
          ? "La contestazione risulta già inviata: verificare ricezione, garanzie applicabili e valutazione delle eventuali deduzioni senza duplicarla."
          : "Se sussistono presupposti sufficienti, predisporre gli atti di avvio e di contestazione di competenza dell'ente; garantire accesso, partecipazione e valutazione delle deduzioni. Per la decadenza rispettare il termine assegnato alle deduzioni dall'art. 47 cod. nav. e verificare le altre garanzie applicabili.",
        office: "Responsabile del procedimento dell'autorità effettivamente competente",
        requiredDocuments: ["Relazione istruttoria e atti probatori", "Bozza di contestazione e comunicazioni procedimentali", "Deduzioni, osservazioni e documenti del concessionario", "Verifica delle notificazioni e dei termini concretamente applicabili"],
        completionGate: "Contraddittorio effettivo e documentato; nessun provvedimento anticipato prima dell'istruttoria dovuta",
        ...(proceduralContext?.contestazioneFormaleInviata ? {} : {
          documentCode: "COMUNICAZIONE_ISTRUTTORIA",
          draftTitle: "Schema di comunicazione istruttoria",
          draftTemplate: `Oggetto: comunicazione istruttoria relativa a ${issue.text}.\n\nPredisporre solo se l'iniziativa è giustificata e non già eseguita. Indicare [FATTI E DOCUMENTI], [FONDAMENTO NORMATIVO VIGENTE], [AUTORITÀ COMPETENTE], [DESTINATARI], [GARANZIE E TERMINI VERIFICATI].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
        }),
      },
      {
        activityCode: "PORT:DECISION",
        necessity: "REQUIRED",
        title: "4. Motivare la decisione e controllarne gli effetti",
        action: "Concludere con decisione motivata sui presupposti, sulle osservazioni e sulla proporzionalità: archiviazione, eventuale misura ripristinatoria, decadenza o altra misura consentita. Distinguere poteri e autorità, pianificare l'esecuzione e documentare i successivi controlli senza automatismi.",
        office: "Organo dell'ente concedente o diversa autorità individuata dalla legge per ciascun provvedimento",
        requiredDocuments: ["Esito dell'istruttoria con confronto fra alternative", "Valutazione delle deduzioni e della proporzionalità", "Schema di provvedimento e modalità di comunicazione", "Piano di verifica degli adempimenti e degli eventuali obblighi di ripristino"],
        completionGate: "Motivazione, competenza, garanzie e verifiche professionali completate; autorizzazione umana all'adozione",
        documentCode: "SCHEMA_DECISIONE",
        draftTitle: "Schema di decisione motivata",
        draftTemplate: decisionDraft(issue.text),
      },
    ];
    const genericPreDecisionSteps: StructuredReportOperationalStep[] = [
      {
        activityCode: "GENERAL:FACTS",
        necessity: "REQUIRED",
        title: "1. Accertare fatti e documenti",
        action: "Ricostruire i fatti rilevanti e distinguere documenti acquisiti, elementi da verificare e possibili circostanze contrarie.",
        office: "Responsabile del procedimento e uffici competenti da verificare",
        requiredDocuments: ["Istanza o atto di avvio", "Documenti e riscontri pertinenti alla questione"],
        completionGate: "Fatti, documenti e lacune sono identificati e valutati dal professionista",
      },
      {
        activityCode: "GENERAL:LEGAL",
        necessity: "REQUIRED",
        title: "2. Verificare disciplina e competenza",
        action: "Individuare le fonti e la loro applicabilità temporale, i presupposti e l'autorità competente; valutare anche gli argomenti contrari.",
        office: "Ufficio competente e supporto giuridico",
        requiredDocuments: ["Fonti ufficiali vigenti alle date rilevanti", "Atti e prescrizioni pertinenti"],
        completionGate: "Disciplina, competenza e presupposti sono verificati e motivati",
      },
      {
        activityCode: "GENERAL:PARTICIPATION",
        necessity: "CONDITIONAL",
        title: "3. Valutare partecipazione e contraddittorio",
        action: "Accertare se e quali garanzie partecipative siano applicabili, evitando comunicazioni o termini non verificati.",
        office: "Responsabile del procedimento",
        requiredDocuments: ["Comunicazioni, eventuali memorie e prove della loro ricezione"],
        completionGate: "Le garanzie applicabili e le eventuali osservazioni sono verificate e documentate",
        documentCode: "COMUNICAZIONE_ISTRUTTORIA",
        draftTitle: "Schema di comunicazione istruttoria",
        draftTemplate: `Oggetto: eventuale comunicazione istruttoria relativa a ${issue.text}.\n\nPrima dell'utilizzo verificare se la comunicazione sia dovuta e non sia già stata effettuata. Indicare [DESTINATARI], [FATTI E DOCUMENTI], [FONDAMENTO NORMATIVO], [AUTORITÀ COMPETENTE], [GARANZIE E TERMINI APPLICABILI].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
      },
      {
        activityCode: "GENERAL:DECISION",
        necessity: "REQUIRED",
        title: "4. Motivare la decisione e i controlli",
        action: "Valutare le alternative consentite, motivare la decisione e individuare soltanto gli adempimenti effettivamente dovuti.",
        office: "Organo competente da verificare",
        requiredDocuments: ["Istruttoria e valutazione delle osservazioni", "Schema di decisione e riscontri pertinenti"],
        completionGate: "Competenza, motivazione, garanzie e conseguenze sono verificate dal professionista",
        documentCode: "SCHEMA_DECISIONE",
        draftTitle: "Schema di decisione motivata",
        draftTemplate: decisionDraft(issue.text),
      },
    ];
    const genericPostDecisionSteps: StructuredReportOperationalStep[] = [
      ...(reviewPending ? [{
        activityCode: "GENERAL:POST:REVIEW",
        necessity: "REQUIRED" as const,
        title: "1. Istruire l'eventuale riesame",
        action: "Esaminare separatamente i motivi dell'istanza, l'atto finale, la competenza e la disciplina applicabile.",
        office: "Ufficio competente per il riesame da verificare",
        requiredDocuments: ["Istanza e allegati", "Provvedimento finale e atti istruttori"],
        completionGate: "Ogni motivo è valutato e l'esito è motivato",
        documentCode: "RISCONTRO_RIESAME",
        draftTitle: "Schema di riscontro all'istanza di riesame",
        draftTemplate: `Oggetto: istanza di riesame relativa a ${issue.text}.\n\nIndicare [ISTANZA E PROTOCOLLO], [ATTO OGGETTO DI RIESAME], [ORGANO COMPETENTE], [MOTIVI E DOCUMENTI], [DISCIPLINA E TERMINI VERIFICATI], [VALUTAZIONE DEI MOTIVI E DEGLI ELEMENTI CONTRARI], [ESITO MOTIVATO].\n\nBozza soggetta ad approvazione umana; nessun invio automatico.`,
      }] : []),
      {
        activityCode: "GENERAL:POST:FINAL_ACT_REVIEW",
        necessity: "REQUIRED",
        title: "Verificare il provvedimento finale",
        action: "Controllare competenza, motivazione, disciplina temporale, partecipazione ed eventuali elementi contrari.",
        office: "Ufficio competente e supporto giuridico",
        requiredDocuments: ["Provvedimento finale", "Fascicolo istruttorio e comunicazioni"],
        completionGate: "La verifica motivata del provvedimento è documentata",
        documentCode: "NOTA_VERIFICA_PROVVEDIMENTO",
        draftTitle: "Nota di verifica del provvedimento",
        draftTemplate: `Oggetto: verifica del provvedimento relativo a ${issue.text}.\n\nEsaminare [ATTO E DOCUMENTI], [COMPETENZA], [FONTI E DATE], [FATTI E PRESUPPOSTI], [PARTECIPAZIONE], [ELEMENTI FAVOREVOLI E CONTRARI], [RISCHI E CONCLUSIONI MOTIVATE].\n\nNota preliminare soggetta a verifica professionale.`,
      },
      {
        activityCode: "GENERAL:POST:FOLLOW_UP",
        necessity: "CONDITIONAL",
        title: "Verificare gli adempimenti successivi",
        action: "Individuare gli effetti e gli eventuali adempimenti effettivamente dovuti, senza presumere nuove iniziative.",
        office: "Uffici competenti da verificare",
        requiredDocuments: ["Provvedimento efficace e documenti sui suoi effetti"],
        completionGate: "Gli adempimenti dovuti e i relativi esiti sono verificati",
      },
    ];
    const profile = !portMatter || proceedingConcluded ? null : assessIssueProfile({
      issueText: issue.text,
      relatedItems: related,
      fascicoloItems: fascicoloFacts,
      analysisDate: new Date(knowledge.revision.createdAt).toISOString().slice(0, 10),
      procedural: proceduralContext ? {
        contestazioneFormaleInviata: proceduralContext.contestazioneFormaleInviata ?? false,
        memorieRicevute: proceduralContext.memorieRicevute ?? false,
        controdeduzioniValutate: proceduralContext.controdeduzioniValutate ?? false,
      } : null,
    });
    const issuePath = profile ? profileIssuePath(issue, profile, [issue.text, ...related.map((item) => item.normalizedText)]) : null;
    if (issuePath && !proceedingConcluded) sharedNeeds.push(...issuePath.sharedNeeds);
    const steps = proceedingConcluded
      ? portMatter ? postDecisionSteps : genericPostDecisionSteps
      : portMatter ? issuePath ? issuePath.steps : preDecisionSteps : genericPreDecisionSteps;
    const alternatives: StructuredReportOperationalAlternative[] = !portMatter ? [
      {
        title: "Valutare le opzioni consentite dalla disciplina applicabile",
        whenApplicable: "Dopo verifica delle fonti, della competenza e dei fatti",
        practicalRoute: "Confrontare gli esiti consentiti e motivare la scelta senza attivarli automaticamente.",
        riskOrLimit: "Non presumere poteri, obblighi o termini non accertati.",
      },
      {
        title: "Escludere motivatamente iniziative non giustificate",
        whenApplicable: "Quando non risultano i presupposti della specifica iniziativa",
        practicalRoute: "Documentare gli elementi considerati e le ragioni dell'esclusione.",
        riskOrLimit: "Rivalutare la conclusione se emergono fatti o fonti nuovi.",
      },
    ] : concernsInstallation ? [
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
    // Unverified sources keep the issue-specific alternatives, preceded by an explicit instruction gate.
    const reportAlternatives = sourceReady ? alternatives : [
      {
        title: "Completare l'istruttoria prima di scegliere il procedimento",
        whenApplicable: "Quando prove, competenza, disciplina applicabile o consistenza dell'inadempimento non sono ancora verificate",
        practicalRoute: "Acquisire originali, riscontri d'ufficio, verbali e valutazioni tecniche; sottoporre le fonti giuridiche a verifica professionale.",
        riskOrLimit: "L'istruttoria non deve essere presentata come accertamento definitivo ne ritardare termini che l'ufficio abbia previamente verificato.",
      },
      ...alternatives,
    ];
    const recommendedNextStep = !portMatter
      ? proceedingConcluded
        ? "Verificare l'atto finale e l'eventuale riesame senza riavviare automaticamente il procedimento."
        : "Accertare fatti, documenti, disciplina applicabile e competenza prima di scegliere iniziative."
      : proceedingConcluded
      ? `Il procedimento risulta concluso${proceduralContext?.finalAct ? ` con l'atto ${proceduralContext.finalAct.numeroAtto}` : ""}: priorità a tenuta dell'atto, riesame, contenzioso, esecuzione e obblighi residui. Non proporre un nuovo avvio per i medesimi fatti.`
      : "Priorita per l'ente concedente: accertare gli obblighi violati e valutare tutti i procedimenti conseguenti, inclusi decadenza e ripristino quando ne ricorrano i presupposti; nessuna misura e automatica.";
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
  const shared = sharedAdminActsStep(sharedNeeds);
  const finalize = (plan: StructuredReportOperationalPlan, steps: readonly StructuredReportOperationalStep[]): StructuredReportOperationalPlan => {
    const numbered = numberSteps(steps);
    const next = numbered.find((step) => step.necessity === "REQUIRED") ?? numbered[0];
    const nextStep = `Prossimo passo: ${next?.title ?? "verificare i presupposti"}. Le misure successive dipendono dall'esito: nessuna è automatica.`;
    return {
      ...plan,
      steps: numbered,
      recommendedNextStep: nextStep,
      ...(plan.proposedSolution !== undefined ? { proposedSolution: nextStep } : {}),
      ...(plan.investigationActivities !== undefined ? { investigationActivities: numbered.map((step) => step.action) } : {}),
    };
  };
  const profiled = (plan: StructuredReportOperationalPlan) => plan.steps.some((step) => step.activityCode?.startsWith("PROFILE:"));
  if (!shared) return plans.map((plan) => profiled(plan) ? finalize(plan, plan.steps) : plan);
  const host = plans.find((plan) => plan.issueSemanticKey === shared.hostIssueSemanticKey)!;
  const served = new Set(shared.step.sharedIssueSemanticKeys);
  return plans.map((plan) => {
    if (!profiled(plan)) return plan;
    if (plan === host) {
      const steps = [...plan.steps];
      const firstRequiredVerification = steps.findIndex((step) => step.activityCode?.endsWith(":EVIDENCE") || step.activityCode?.endsWith(":MONITORING"));
      steps.splice(firstRequiredVerification >= 0 ? firstRequiredVerification + 1 : 0, 0, shared.step);
      return finalize(plan, steps);
    }
    return {
      ...finalize(plan, plan.steps),
      ...(served.has(plan.issueSemanticKey) ? {
        sharedActivityRefs: [{
          activityCode: shared.step.activityCode!,
          hostIssueSemanticKey: host.issueSemanticKey,
          hostIssueText: host.issueText,
          title: shared.step.title,
        }],
      } : {}),
    };
  });
}

const ART_242_SOURCE_URL = "https://www.autorita-trasporti.it/wp-content/uploads/2025/12/All.-A-delibera-n.-242_2025_signed.pdf";

function buildRegulatoryApplicability(
  analysisDate: string,
  context?: StructuredReportProceduralContext,
  documentedGrantDate?: string | null,
): readonly StructuredReportRegulatoryApplicability[] {
  const grantDate = context?.concessione?.dataRilascio.slice(0, 10) ?? documentedGrantDate ?? null;
  if (!grantDate || grantDate > analysisDate || analysisDate < "2026-03-01") return [];
  const preExisting = grantDate < "2026-03-01";
  const basis = context?.concessione ? "" : " Data del titolo ricavata dai documenti: confermarla collegando la concessione nel registro.";
  const applicability = (preExisting
    ? "La data del titolo non prova che fosse in essere il 1 marzo 2026. Solo accertata tale condizione verificare le misure elencate al punto iii; per aggiornamenti o revisioni valutare i presupposti del punto ii, senza presumere il perfezionamento di un'istanza. Nessuna qualificazione retroattiva delle condotte anteriori."
    : "Titolo rilasciato non prima dell'entrata in vigore: verificare l'ambito della misura 1.2, punto i, e i presupposti di ciascun adempimento.") + basis;
  const row = (
    measure: string,
    trigger: string,
    authorityAction: string,
    deadline: string,
  ): StructuredReportRegulatoryApplicability => ({
    measure,
    effectiveFrom: "1 marzo 2026",
    trigger,
    applicability,
    authorityAction: `Se la misura e i suoi presupposti sono applicabili: ${authorityAction}`,
    deadline: `${deadline} Non è una scadenza verificata del fascicolo.`,
    officialSourceUrl: ART_242_SOURCE_URL,
  });
  return [
    row("3.7", "Istanza rilevante di revisione o aggiornamento di concessione, PI o PEF.", "Vigilare sul titolo e notificare l'istanza ad ART; distinguere revisione, differimento investimenti, modifica del titolo ed estensione della durata.", "Alla ricezione o emersione dell'istanza rilevante."),
    row("3.13", "Rilascio o cambio di controllo del concessionario e condizioni concorrenziali.", "Valutare capacità e relazioni societarie; informare annualmente ART sull'applicazione della misura.", "Cadenza annuale; verificare le istruzioni operative ART."),
    row("3.18", "Monitoraggio di investimenti, obiettivi di traffico e livelli occupazionali.", "Svolgere il monitoraggio annuale e comunicarne gli esiti ad ART; valutare le penali nella misura in cui sono definite in sede di bando.", "Cadenza annuale."),
    row("3.19", "Nuove infrastrutture pubbliche che incidono sull'equilibrio concorrenziale originario.", "Valutare revisione di concessione e PEF oppure, nei casi rilevanti, revoca e nuova gara con comunicazione ad ART.", "Prima della decisione sulla revisione o sulla diversa misura."),
    row("3.20", "Istanza di estensione della durata ai sensi del D.M. 202/2022 e del D.M. 110/2023.", "Notificare l'istanza documentata ad ART e acquisire il parere vincolante sulla coerenza con il PEF.", "Parere ART entro 30 giorni dalla ricezione di tutte le informazioni necessarie."),
    row("4", "Concessione vigente di area o banchina portuale.", "Acquisire e verificare la contabilità separata secondo gli schemi regolatori.", "Coordinare con la trasmissione annuale della misura 15."),
    row("5", "Analisi annuale della struttura dei mercati portuali.", "Predisporre l'ASM, distinguendo anche i terminal industriali, e trasmetterla ad ART.", "1 marzo dell'anno successivo a quello di riferimento."),
    row("15", "Concessione vigente e obblighi informativi ART.", "Trasmettere dati generali, determinazione canoni, PEF, contabilità regolatoria e dati di performance nei formati ART.", "Prima applicazione 15.2(a): 31 marzo 2026; dati annuali: 30 giugno."),
  ];
}

export function buildStructuredFascicoloReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
  proceduralContext?: StructuredReportProceduralContext;
  documentCoverage?: { corpusFingerprint: string; entries: readonly DocumentCoverageEntry[] };
  technicalSources?: readonly StructuredReportTechnicalSourceInput[];
  contractVersion?: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION | typeof STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION;
}): BuiltStructuredFascicoloReport {
  const legalCompleteness = assessLegalCompleteness(input.knowledge);
  const currentMissions = input.missions.filter((mission) => mission.lifecycleStatus === "CURRENT"
    && (
      mission.knowledgeRevisionId === input.knowledge.revision.id
      || mission.professionalQuestionVersionId
    )
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
    const results = [...new Map(questionMissions.flatMap((mission) => mission.results.map((result) => ({
      ...result, missionId: mission.missionId,
    })))
      .map((result) => [result.resultId, result])).values()].sort(byId);
    return [semanticKey, {
      ...primary,
      status: questionMissions.every((mission) => mission.status === "COMPLETED") ? "COMPLETED" : primary.status,
      sourceGaps: [...new Set(questionMissions.flatMap((mission) => mission.sourceGaps))].sort(),
      results,
      legalAnalysisContributions: questionMissions.flatMap((mission) => (
        mission.status === "COMPLETED" ? mission.legalAnalysisContributions ?? [] : []
      )),
    }];
  }));
  const professionalQuestions = currentMissions
    .filter((mission) => mission.professionalQuestionVersionId)
    .map((mission) => projectQuestion({
      id: mission.professionalQuestionVersionId!,
      semanticKey: mission.researchQuestionSemanticKey!,
      normalizedText: mission.question,
      status: "HUMAN_CONFIRMED",
    }, new Map([[mission.researchQuestionSemanticKey!, mission]])));
  const questions = [
    ...visibleItems(input.knowledge.researchQuestions).map((item) => projectQuestion(item, missionsByQuestion)),
    ...professionalQuestions,
  ];
  const questionById = new Map(input.knowledge.researchQuestions.map((item) => [item.id, item]));
  const proceedingAnchors = new Map(
    [...input.knowledge.legalActs, ...input.knowledge.measures]
      .map((item) => [item.semanticKey, item] as const),
  );
  const legalIssues = input.knowledge.legalIssues
    .filter((item) => item.status !== "REJECTED")
    .sort(byId)
    .map((issue) => {
      const payload = jsonRecord(issue.payload);
      const identity = jsonRecord(payload.targetProceedingIdentity);
      const resolution = jsonRecord(payload.targetProceedingResolution);
      const anchorSemanticKey = typeof identity.canonicalAnchorSemanticKey === "string"
        ? identity.canonicalAnchorSemanticKey
        : null;
      const anchor = anchorSemanticKey
        ? proceedingAnchors.get(anchorSemanticKey) ?? null
        : null;
      const hasResolution = typeof resolution.status === "string";
      return {
        knowledgeItemId: issue.id,
        semanticKey: issue.semanticKey,
        text: issue.normalizedText,
        reviewStatus: issue.status as "AI_PROPOSED" | "HUMAN_CONFIRMED",
        originatingItemIds: [...issue.originatingItemIds].sort(),
        ...(hasResolution ? {
          proceedingIdentity: {
            status: String(resolution.status),
            action: String(resolution.action ?? ""),
            reason: typeof resolution.reason === "string" ? resolution.reason : null,
            linkedAnchor: anchor && (anchor.kind === "LEGAL_ACT" || anchor.kind === "MEASURE")
              ? {
                  semanticKey: anchor.semanticKey,
                  kind: anchor.kind,
                  text: anchor.normalizedText,
                }
              : null,
            evidenceBasisRefs: stringValues(identity.evidenceBasisRefs),
            providerClaim: Object.keys(jsonRecord(resolution.providerClaim)).length > 0
              ? jsonRecord(resolution.providerClaim)
              : null,
            candidateAnchorSemanticKeys: stringValues(
              resolution.candidateAnchorSemanticKeys,
            ),
          },
        } : {}),
        questions: questions.filter((question) => (
          questionById.get(question.knowledgeItemId)?.legalIssueId === issue.id
        )),
      };
    });
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
      classificationSource: result.classificationSource ?? null,
      classificationReviewAuditId: result.classificationReviewAuditId ?? null,
      reviewStatus: result.classificationReviewStatus,
      rationale: result.classificationRationale,
      ...(result.officialRelevance ? { officialRelevance: result.officialRelevance.status } : {}),
    })),
  }));
  const sourceAssessmentState = currentMissions.flatMap((mission) => mission.results.map((result) => ({
    resultId: result.resultId,
    assessment: result.sourceAssessment,
  }))).sort(byId);
  const applicationItems = [...new Map([
    ...input.knowledge.facts, ...input.knowledge.events, ...input.knowledge.legalActs,
    ...input.knowledge.measures, ...input.knowledge.timeline,
  ].map((item) => [item.id, normalizedItem(item)])).values()].sort(byId);
  const analysisDate = new Date(input.knowledge.revision.createdAt).toISOString().slice(0, 10);
  const portRegime = isPortConcessionMatter({
    tipologia: input.proceduralContext?.tipologia,
    knowledgeItems: [...applicationItems, ...visibleItems(input.knowledge.gaps)],
    issueTexts: [...legalIssues.map((issue) => issue.text), ...questions.map((question) => question.text)],
  }) ? buildPortRegimeCoordination({
      knowledgeItems: applicationItems,
      analysisDate,
      registryGrant: input.proceduralContext?.concessione ?? null,
      extractIsoDates,
    }) : null;
  const phase = detectActPhase({
    proceduralContext: input.proceduralContext,
    documentedFramework: {
      partyRoles: input.knowledge.partyRoles,
      facts: input.knowledge.facts,
      timeline: input.knowledge.events,
      legalActs: input.knowledge.legalActs,
      measures: input.knowledge.measures,
      contradictions: input.knowledge.contradictions,
    },
  });
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
  const legalAnalyses = buildLegalAnalyses({
    issues: legalIssues,
    knowledge: input.knowledge,
    applicability: legalApplicability,
    contributions: [...missionsByQuestion.values()].flatMap((mission) => (
      mission.legalAnalysisContributions ?? []
    )),
  });
  const payload: StructuredFascicoloReportPayload = {
    contractVersion,
    ...(questions.some((question) => question.favorableAuthorities.length + question.contraryAuthorities.length > 0)
      ? { sourceReviewPolicy: SOURCE_REVIEW_POLICY } : {}),
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
    proceduralContext: input.proceduralContext,
    ...(input.documentCoverage ? {
      documentCoverage: input.documentCoverage.entries,
      documentCoverageCorpusFingerprint: input.documentCoverage.corpusFingerprint,
    } : {}),
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
    continuityIssues: buildContinuityIssues(input.knowledge),
    unassignedQuestions: questions.filter((question) => !assignedQuestionIds.has(question.knowledgeItemId)),
    gaps: visibleItems(input.knowledge.gaps),
    deadlineCandidates: visibleItems(input.knowledge.deadlineCandidates),
    professionalNarrative: buildProfessionalNarrative(input.knowledge),
    operationalPlans: buildOperationalPlans(operationalSubjects, input.knowledge, input.proceduralContext, portRegime !== null, phase, technicalSources),
    regulatoryApplicability: portRegime ? buildRegulatoryApplicability(analysisDate, input.proceduralContext, portRegime.grantDate.date) : [],
    portRegime,
    legalApplication: buildLegalApplication({
      issues: legalIssues.map((issue) => {
        const toAuthority = (authority: StructuredReportAuthority) => ({
          title: authority.title, sourceUrl: authority.sourceUrl, rationale: authority.rationale,
        });
        const dedupe = (values: ReturnType<typeof toAuthority>[]) =>
          [...new Map(values.map((value) => [`${value.title}|${value.sourceUrl ?? ""}`, value])).values()];
        return {
          semanticKey: issue.semanticKey,
          text: issue.text,
          originatingItemIds: issue.originatingItemIds,
          favorableAuthorities: dedupe(issue.questions.flatMap((question) => question.favorableAuthorities.map(toAuthority))),
          contraryAuthorities: dedupe(issue.questions.flatMap((question) => question.contraryAuthorities.map(toAuthority))),
        };
      }),
      knowledgeItems: applicationItems,
      analysisDate,
      context: input.proceduralContext,
      documentedGrantDate: portRegime?.grantDate.date ?? null,
      portMatter: portRegime !== null,
      portRegime,
      documentaryPhase: { concluded: phase.phase === "POST_DECISION", reviewPending: phase.reviewPending },
    }),
    legalAnalyses,
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

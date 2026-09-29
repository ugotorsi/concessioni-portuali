import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

export const STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION = "STRUCTURED_FASCICOLO_REPORT_V1" as const;

type JsonRecord = Readonly<Record<string, unknown>>;
type Direction = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";

export interface StructuredReportResearchResultInput {
  resultId: string;
  title: string;
  sourceUrl: string | null;
  provider: string | null;
  supportDirection: Direction;
  classificationReviewStatus: "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
  classificationRationale: string | null;
  sourceAssessment: {
    assessmentId: string;
    chainFingerprint: string;
    isCurrent: boolean;
    usable: boolean;
    citationAnchors: readonly JsonRecord[];
    blockingReasons: readonly string[];
    manualReviewRequired: boolean;
    manualReviewReason: string | null;
  } | null;
}

export interface StructuredReportMissionInput {
  missionId: string;
  mode?: string;
  missionFingerprint: string | null;
  knowledgeRevisionId: string | null;
  researchQuestionSemanticKey: string | null;
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: string;
  question: string;
  coverageStatus: string;
  sourceGaps: readonly string[];
  results: readonly StructuredReportResearchResultInput[];
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
    direction: Direction;
    reasons: readonly string[];
  }[];
  gaps: readonly string[];
  limitations: readonly string[];
}

export interface StructuredFascicoloReportPayload {
  contractVersion: typeof STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION;
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
  limitations: readonly string[];
}

export interface BuiltStructuredFascicoloReport {
  reportFingerprint: string;
  payload: StructuredFascicoloReportPayload;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
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
    .map((result) => ({ resultId: result.resultId, title: result.title, direction: result.supportDirection, reasons: nonUsableReasons(result) }));
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

export function buildStructuredFascicoloReport(input: {
  tenantId: string;
  procedimentoId: string;
  knowledge: StructuredKnowledgeReadModel;
  missions: readonly StructuredReportMissionInput[];
}): BuiltStructuredFascicoloReport {
  const currentMissions = input.missions.filter((mission) => mission.lifecycleStatus === "CURRENT"
    && mission.knowledgeRevisionId === input.knowledge.revision.id
    && mission.researchQuestionSemanticKey !== null).sort(byId);
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
  const assignedQuestionIds = new Set(legalIssues.flatMap((issue) => issue.questions.map((question) => question.knowledgeItemId)));
  const knowledgeState = [
    ...input.knowledge.partyRoles, ...input.knowledge.facts, ...input.knowledge.events,
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
      direction: result.supportDirection,
      reviewStatus: result.classificationReviewStatus,
      rationale: result.classificationRationale,
    })),
  }));
  const sourceState = currentMissions.flatMap((mission) => mission.results.map((result) => ({
    resultId: result.resultId,
    assessment: result.sourceAssessment,
  }))).sort(byId);
  const payload: StructuredFascicoloReportPayload = {
    contractVersion: STRUCTURED_FASCICOLO_REPORT_CONTRACT_VERSION,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    knowledgeRevisionId: input.knowledge.revision.id,
    knowledgeContractVersion: input.knowledge.revision.contractVersion,
    corpusFingerprint: input.knowledge.revision.corpusFingerprint,
    knowledgeStateFingerprint: fingerprint(knowledgeState),
    researchStateFingerprint: fingerprint(researchState),
    sourceStateFingerprint: fingerprint(sourceState),
    documentedFramework: {
      partyRoles: visibleItems(input.knowledge.partyRoles),
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
    limitations: [...new Set([
      ...input.knowledge.revision.warnings,
      ...(input.knowledge.deadlineCandidates.length ? ["DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES"] : []),
      ...(questions.length ? [] : ["NO_CURRENT_RESEARCH_QUESTIONS"]),
    ])].sort(),
  };
  return { reportFingerprint: fingerprint(payload), payload };
}
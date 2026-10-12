import { createHash } from "node:crypto";

import { createResearchMission, RESEARCH_BRIDGE_VERSION, type ResearchCapability, type ResearchMission } from "@/server/legal-research/bridge";

import { canonicalJson } from "./canonicalization";
import type { JsonValue, KnowledgeItemReviewStatus } from "./contracts";
import type { KnowledgeRevisionSnapshot } from "./repository";

export const DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT = 5;

export interface ResearchExecutionPolicy {
  maxQuestionsPerWave: number;
}

export interface KnowledgeResearchMissionPlan {
  questionItemId: string;
  questionSemanticKey: string;
  legalIssueItemId: string;
  legalIssueSemanticKey: string;
  originatingItemIds: readonly string[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  referenceDate: string | null;
  referenceDateBasis: Readonly<{
    type: string;
    itemSemanticKey: string | null;
    rationale: string;
    userConfirmedDateSource: Readonly<{ sourceId: string; sourceVersion: string; confirmedDate: string }> | null;
  }>;
  missionFingerprint: string;
  execution: "ADMITTED" | "BLOCKED_FOR_REVIEW" | "DEFERRED_BY_POLICY" | "REJECTED";
  blockReason: string | null;
  mission: ResearchMission | null;
}

type SnapshotItem = KnowledgeRevisionSnapshot["items"][number];

function object(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function string(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function priority(value: JsonValue | undefined): "HIGH" | "MEDIUM" | "LOW" {
  return value === "HIGH" || value === "LOW" ? value : "MEDIUM";
}

const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

function dateFromBasis(item: SnapshotItem | undefined): string | null {
  if (!item) return null;
  const date = object(object(item.structuredPayload).date);
  return date.precision === "EXACT" ? string(date.from) : null;
}

function fingerprint(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function statusAllowsMission(status: KnowledgeItemReviewStatus): boolean {
  return status !== "REJECTED";
}

export function buildKnowledgeResearchMissionPlans(
  revision: KnowledgeRevisionSnapshot,
  policy: ResearchExecutionPolicy = { maxQuestionsPerWave: DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT },
): readonly KnowledgeResearchMissionPlan[] {
  if (!Number.isInteger(policy.maxQuestionsPerWave) || policy.maxQuestionsPerWave < 0) {
    throw new Error("INVALID_RESEARCH_EXECUTION_POLICY");
  }
  if (revision.status !== "CURRENT") throw new Error("KNOWLEDGE_REVISION_NOT_CURRENT");
  const itemById = new Map(revision.items.map((item) => [item.id, item]));
  const itemBySemanticKey = new Map(revision.items.map((item) => [item.semanticKey, item]));
  const issueByQuestion = new Map(revision.relations
    .filter((relation) => relation.relationType === "QUESTION_FOR_ISSUE")
    .map((relation) => [relation.sourceItemId, relation.targetItemId]));
  const originsByIssue = new Map<string, string[]>();
  for (const relation of revision.relations.filter((candidate) => candidate.relationType === "ISSUE_DERIVED_FROM")) {
    const values = originsByIssue.get(relation.sourceItemId) ?? [];
    values.push(relation.targetItemId);
    originsByIssue.set(relation.sourceItemId, values);
  }
  const candidates = revision.items.filter((item) => item.kind === "RESEARCH_QUESTION").map((question) => {
    const payload = object(question.structuredPayload);
    const issue = itemById.get(issueByQuestion.get(question.id) ?? "");
    const originIds = issue ? [...(originsByIssue.get(issue.id) ?? [])].sort() : [];
    const origins = originIds.map((id) => itemById.get(id)).filter((item): item is SnapshotItem => Boolean(item));
    const basis = object(payload.referenceDateBasis);
    const basisType = string(basis.type) ?? "UNKNOWN";
    const basisSemanticKey = string(basis.itemSemanticKey);
    const basisItem = basisSemanticKey ? itemBySemanticKey.get(basisSemanticKey) : undefined;
    const userConfirmedDateSource = object(basis.userConfirmedDateSource);
    const confirmedDate = string(userConfirmedDateSource.confirmedDate);
    const confirmationSourceId = string(userConfirmedDateSource.sourceId);
    const confirmationSourceVersion = string(userConfirmedDateSource.sourceVersion);
    const declaredDate = string(payload.referenceDate);
    const derivedDate = basisType === "USER_CONFIRMED" ? confirmedDate : dateFromBasis(basisItem);
    const mode = string(payload.mode) === "ADVERSE" ? "ADVERSE" : "PRIMARY";
    const capabilities = [...new Set([
      ...strings(payload.requestedCapabilities),
      "EXACT_RETRIEVAL",
    ])].sort() as ResearchCapability[];
    const canonicalQuestion = string(payload.canonicalQuestion) ?? question.normalizedText;
    const issueValid = issue?.kind === "LEGAL_ISSUE" && statusAllowsMission(issue.status) && origins.length === originIds.length && origins.length > 0;
    const basisLinkedToIssue = basisItem !== undefined && originIds.includes(basisItem.id);
    const basisPayload = basisItem ? object(basisItem.structuredPayload) : {};
    const basisKindValid = (basisType === "EVENT_DATE" && basisItem?.kind === "EVENT" && basisLinkedToIssue)
      || (basisType === "MEASURE_DATE" && basisItem?.kind === "MEASURE" && basisLinkedToIssue)
      || (basisType === "CHALLENGED_ACT_DATE"
        && (basisItem?.kind === "LEGAL_ACT" || basisItem?.kind === "MEASURE")
        && basisPayload.proceduralRole === "CHALLENGED_ACT" && basisLinkedToIssue)
      || (basisType === "USER_CONFIRMED" && basisItem === undefined
        && confirmationSourceId !== null && confirmationSourceVersion !== null && confirmedDate !== null);
    const dateValid = basisType !== "UNKNOWN" && basisKindValid && declaredDate !== null && declaredDate === derivedDate;
    const missionFingerprint = fingerprint({
      fingerprintVersion: "KNOWLEDGE_RESEARCH_MISSION_V2",
      canonicalQuestion,
      legalIssueSemanticKey: issue?.semanticKey ?? null,
      originatingItems: origins.map((origin) => ({
        semanticKey: origin.semanticKey,
        contentFingerprint: origin.contentFingerprint,
      })).sort((left, right) => left.semanticKey.localeCompare(right.semanticKey)),
      referenceDate: declaredDate,
      referenceDateBasis: {
        type: basisType,
        itemSemanticKey: basisSemanticKey,
        itemContentFingerprint: basisItem?.contentFingerprint ?? null,
        userConfirmedDateSource: basisType === "USER_CONFIRMED" ? {
          sourceId: confirmationSourceId,
          sourceVersion: confirmationSourceVersion,
          confirmedDate,
        } : null,
      },
      requestedCapabilities: capabilities,
      mode,
    });
    let execution: KnowledgeResearchMissionPlan["execution"] = "ADMITTED";
    let blockReason: string | null = null;
    if (!statusAllowsMission(question.status)) {
      execution = "REJECTED";
      blockReason = "QUESTION_REJECTED";
    } else if (!issueValid) {
      execution = "BLOCKED_FOR_REVIEW";
      blockReason = "ISSUE_OR_ORIGIN_INVALID";
    } else if (!dateValid) {
      execution = "BLOCKED_FOR_REVIEW";
      blockReason = "REFERENCE_DATE_REVIEW_REQUIRED";
    } else if (mode === "ADVERSE") {
      execution = "BLOCKED_FOR_REVIEW";
      blockReason = "ADVERSE_NOT_AUTOMATED";
    }
    const mission = execution === "ADMITTED" && issue && declaredDate ? createResearchMission({
      kind: "RESEARCH_MISSION",
      version: RESEARCH_BRIDGE_VERSION,
      caseReference: { caseId: revision.procedimentoId, fascicoloReference: revision.procedimentoId },
      legalIssueIds: [issue.semanticKey],
      legalPropositionIds: [],
      referenceDate: `${declaredDate}T00:00:00.000Z`,
      mode: "DISCOVER_AUTHORITIES",
      researchQuestion: canonicalQuestion,
      assumptionsFingerprint: missionFingerprint,
      knownAuthorities: [],
      excludedAuthorities: [],
      preferredSourceFamilies: ["ITALIAN_LEGISLATION", "GIUSTIZIA_AMMINISTRATIVA"],
      missingSourceFamilies: [],
      knownCounterArguments: [],
      knownEvidenceGaps: origins.filter((origin) => origin.kind === "GAP").map((origin) => ({ gapId: origin.semanticKey, kind: "MISSING_FACT_EVIDENCE" })),
      requiredOutput: { authorityCandidates: true, citationObservations: false, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: false },
      budget: { maxTotalResearchCalls: 6, maxMoonlitCalls: 2, maxSimpliciterCalls: 2, maxLegalDataHunterCalls: 2 },
      status: "PENDING",
      executionPlan: { requiredCapabilities: capabilities },
    }) : null;
    return {
      questionItemId: question.id,
      questionSemanticKey: question.semanticKey,
      legalIssueItemId: issue?.id ?? "",
      legalIssueSemanticKey: issue?.semanticKey ?? "",
      originatingItemIds: originIds,
      priority: priority(payload.priority),
      referenceDate: declaredDate,
      referenceDateBasis: {
        type: basisType,
        itemSemanticKey: basisSemanticKey,
        rationale: string(basis.rationale) ?? "",
        userConfirmedDateSource: basisType === "USER_CONFIRMED" ? {
          sourceId: confirmationSourceId!,
          sourceVersion: confirmationSourceVersion!,
          confirmedDate: confirmedDate!,
        } : null,
      },
      missionFingerprint,
      execution,
      blockReason,
      mission,
    } satisfies KnowledgeResearchMissionPlan;
  }).sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
    || left.questionSemanticKey.localeCompare(right.questionSemanticKey));
  let admitted = 0;
  return candidates.map((candidate) => {
    if (candidate.execution !== "ADMITTED") return candidate;
    admitted += 1;
    return admitted <= policy.maxQuestionsPerWave ? candidate : {
      ...candidate,
      execution: "DEFERRED_BY_POLICY" as const,
      blockReason: "EXECUTION_WAVE_LIMIT",
    };
  });
}

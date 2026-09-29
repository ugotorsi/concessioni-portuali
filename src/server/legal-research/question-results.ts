import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import type { AuthorityCandidate, AuthoritySupportDirection, ResearchMissionStatus } from "./bridge";
import { initializeDiscoveredSourceAssessment } from "./source-chain-persistence";

export type ResearchResultSupportDirection = "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED";
export type ResearchResultClassificationSource = "PROVIDER_OUTPUT" | "SYNTHETIC_TEST" | "HUMAN_REVIEW" | "AI_CLASSIFIER";
export type ResearchResultReviewStatus = "AI_PROPOSED" | "HUMAN_CONFIRMED" | "REJECTED";
export type ResearchResultSourceState = "DISCOVERED" | "ACQUIRED" | "IDENTITY_VERIFIED" | "CONTENT_VERIFIED" | "TEMPORAL_ASSESSED" | "USABLE";
export type ResearchQuestionCoverageStatus = "NOT_RESEARCHED" | "NO_RESULTS" | "RESULTS_UNASSESSED" | "PARTIAL" | "COVERED" | "CONFLICTING";
export type ResearchQuestionExecutionState = "DEFERRED" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "REJECTED";

export interface ResearchQuestionResultSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface ResearchQuestionResultContext {
  read: ResearchQuestionResultSqlExecutor;
  transaction<T>(operation: (tx: ResearchQuestionResultSqlExecutor) => Promise<T>): Promise<T>;
  initializeSourceAssessment(input: { resultId: string; candidate: AuthorityCandidate }): Promise<unknown>;
}

export interface ResearchQuestionResultSnapshot {
  id: string;
  tenantId: string;
  caseId: string;
  missionId: string;
  bundleId: string;
  candidateId: string;
  legalIssueSemanticKey: string;
  researchQuestionSemanticKey: string;
  missionFingerprint: string;
  candidateSnapshot: AuthorityCandidate;
  supportDirection: ResearchResultSupportDirection;
  classificationSource: ResearchResultClassificationSource;
  classificationConfidence: number | null;
  classificationRationale: string | null;
  classificationReviewStatus: ResearchResultReviewStatus;
  coverageElementKeys: readonly string[];
  unresolvedAspectKeys: readonly string[];
}

export interface ResearchCoverageGap {
  kind: "MISSING_ASPECT" | "INSUFFICIENT_RESULT" | "CONFLICTING_AUTHORITY" | "UNVERIFIED_SOURCE" | "MISSING_FULL_TEXT";
  key: string;
}

function executor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): ResearchQuestionResultSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
    },
  };
}

const defaultContext: ResearchQuestionResultContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
  initializeSourceAssessment: initializeDiscoveredSourceAssessment,
};

function resultId(tenantId: string, missionId: string, candidateId: string): string {
  return `qresult_${createHash("sha256").update(`${tenantId}\0${missionId}\0${candidateId}`).digest("hex")}`;
}

export function normalizeSupportDirection(value: AuthoritySupportDirection): ResearchResultSupportDirection {
  if (value === "SUPPORT") return "SUPPORTS";
  if (value === "AGAINST") return "OPPOSES";
  if (value === "QUALIFIES") return "NEUTRAL";
  return "UNASSESSED";
}

export function deriveResearchResultSourceState(candidate: AuthorityCandidate): ResearchResultSourceState {
  if (candidate.verifiedEvidence) return "CONTENT_VERIFIED";
  if (candidate.verificationState === "OFFICIALLY_VERIFIED") return "IDENTITY_VERIFIED";
  if (candidate.fullTextAvailable) return "ACQUIRED";
  return "DISCOVERED";
}

export async function persistResearchQuestionResults(input: {
  missionId: string;
  bundleId: string;
  candidates: readonly AuthorityCandidate[];
}, overrides: Partial<ResearchQuestionResultContext> = {}): Promise<readonly { id: string; outcome: "CREATED" | "REUSED" }[]> {
  const context = { ...defaultContext, ...overrides };
  const results = await context.transaction(async (tx) => {
    const mission = await tx.query<{
      tenantId: string | null;
      caseId: string;
      legalIssueSemanticKey: string | null;
      researchQuestionSemanticKey: string | null;
      missionFingerprint: string | null;
    }>(`
      SELECT "tenantId", "caseId", "legalIssueSemanticKey", "researchQuestionSemanticKey", "missionFingerprint"
      FROM "ResearchMissionRecord" WHERE "id" = $1 FOR SHARE
    `, [input.missionId]);
    const owner = mission.rows[0];
    if (!owner?.tenantId || !owner.legalIssueSemanticKey || !owner.researchQuestionSemanticKey || !owner.missionFingerprint) return [];
    const results: { id: string; outcome: "CREATED" | "REUSED" }[] = [];
    for (const candidate of input.candidates) {
      const id = resultId(owner.tenantId, input.missionId, candidate.candidateId);
      const rationale = (candidate.relevantPassage ?? candidate.summary ?? null)?.slice(0, 2000) ?? null;
      const coverageElementKeys = candidate.legalPropositionId ? [candidate.legalPropositionId] : [];
      const inserted = await tx.query<{ id: string }>(`
        INSERT INTO "ResearchQuestionResultRecord" (
          "id", "tenantId", "caseId", "missionId", "bundleId", "candidateId",
          "legalIssueSemanticKey", "researchQuestionSemanticKey", "missionFingerprint",
          "providerId", "toolId", "candidateSnapshot", "supportDirection",
          "classificationSource", "classificationRationale", "coverageElementKeys"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
          $13::"ResearchResultSupportDirection", 'PROVIDER_OUTPUT', $14, $15::text[])
        ON CONFLICT ("tenantId", "missionId", "candidateId") DO NOTHING
        RETURNING "id"
      `, [id, owner.tenantId, owner.caseId, input.missionId, input.bundleId, candidate.candidateId,
        owner.legalIssueSemanticKey, owner.researchQuestionSemanticKey, owner.missionFingerprint,
        candidate.providerId ?? null, candidate.toolId, JSON.stringify(candidate),
        normalizeSupportDirection(candidate.supportDirection), rationale, coverageElementKeys]);
      results.push({ id, outcome: inserted.rows.length === 1 ? "CREATED" : "REUSED" });
    }
    return results;
  });
  for (const [index, result] of results.entries()) {
    await context.initializeSourceAssessment({ resultId: result.id, candidate: input.candidates[index] });
  }
  return results;
}

export async function reviewResearchQuestionResult(input: {
  resultId: string;
  tenantId: string;
  direction: ResearchResultSupportDirection;
  reviewStatus: "HUMAN_CONFIRMED" | "REJECTED";
  confidence: number | null;
  rationale: string;
}, overrides: Partial<ResearchQuestionResultContext> = {}): Promise<ResearchQuestionResultSnapshot> {
  if (input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) throw new Error("INVALID_CLASSIFICATION_CONFIDENCE");
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const updated = await tx.query<ResearchQuestionResultSnapshot>(`
      UPDATE "ResearchQuestionResultRecord"
      SET "supportDirection" = $3::"ResearchResultSupportDirection",
          "classificationSource" = 'HUMAN_REVIEW',
          "classificationConfidence" = $4,
          "classificationRationale" = $5,
          "classificationReviewStatus" = $6::"ResearchResultReviewStatus",
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1 AND "tenantId" = $2
      RETURNING *
    `, [input.resultId, input.tenantId, input.direction, input.confidence, input.rationale.slice(0, 2000), input.reviewStatus]);
    if (!updated.rows[0]) throw new Error("RESEARCH_QUESTION_RESULT_NOT_FOUND");
    return updated.rows[0];
  });
}

function executionState(status: ResearchMissionStatus): ResearchQuestionExecutionState {
  if (status === "DEFERRED") return "DEFERRED";
  if (status === "PENDING") return "PENDING";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "REJECTED") return "REJECTED";
  return "INCOMPLETE";
}

export function deriveResearchQuestionCoverage(input: {
  missionStatus: ResearchMissionStatus;
  results: readonly Pick<ResearchQuestionResultSnapshot, "candidateId" | "candidateSnapshot" | "supportDirection" | "classificationReviewStatus" | "coverageElementKeys" | "unresolvedAspectKeys">[];
  evidenceGapKeys?: readonly string[];
}): {
  executionState: ResearchQuestionExecutionState;
  status: ResearchQuestionCoverageStatus;
  conflicting: boolean;
  coveredElementKeys: readonly string[];
  gaps: readonly ResearchCoverageGap[];
} {
  const state = executionState(input.missionStatus);
  if (["DEFERRED", "PENDING", "IN_PROGRESS"].includes(state)) {
    return { executionState: state, status: "NOT_RESEARCHED", conflicting: false, coveredElementKeys: [], gaps: [] };
  }
  if (input.results.length === 0) {
    return { executionState: state, status: "NO_RESULTS", conflicting: false, coveredElementKeys: [], gaps: [] };
  }
  const effective = input.results.filter((result) => result.classificationReviewStatus !== "REJECTED");
  const directions = new Set(effective.map((result) => result.supportDirection));
  const conflicting = directions.has("SUPPORTS") && directions.has("OPPOSES");
  const gaps: ResearchCoverageGap[] = [
    ...(input.evidenceGapKeys ?? []).map((key) => ({ kind: "INSUFFICIENT_RESULT" as const, key })),
    ...effective.flatMap((result) => result.unresolvedAspectKeys.map((key) => ({ kind: "MISSING_ASPECT" as const, key }))),
    ...effective.filter((result) => deriveResearchResultSourceState(result.candidateSnapshot) === "DISCOVERED")
      .map((result) => ({ kind: "UNVERIFIED_SOURCE" as const, key: result.candidateId })),
    ...effective.filter((result) => !result.candidateSnapshot.fullTextAvailable)
      .map((result) => ({ kind: "MISSING_FULL_TEXT" as const, key: result.candidateId })),
    ...(conflicting ? [{ kind: "CONFLICTING_AUTHORITY" as const, key: "SUPPORTS_OPPOSES" }] : []),
  ];
  const coveredElementKeys = [...new Set(effective.flatMap((result) => result.coverageElementKeys))].sort();
  const allUnassessed = effective.length === 0 || effective.every((result) => result.supportDirection === "UNASSESSED");
  const status: ResearchQuestionCoverageStatus = conflicting
    ? "CONFLICTING"
    : allUnassessed
      ? "RESULTS_UNASSESSED"
      : gaps.length > 0 || directions.has("INCONCLUSIVE") || directions.has("UNASSESSED")
        ? "PARTIAL"
        : "COVERED";
  return { executionState: state, status, conflicting, coveredElementKeys, gaps };
}
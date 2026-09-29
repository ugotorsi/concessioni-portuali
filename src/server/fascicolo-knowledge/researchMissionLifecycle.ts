import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import type { ResearchMission, ResearchMissionStatus } from "@/server/legal-research/bridge";

import { canonicalJson } from "./canonicalization";
import type { JsonValue } from "./contracts";
import type { KnowledgeResearchMissionPlan } from "./researchMissionPlanning";

export interface ResearchMissionLifecycleSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface ResearchMissionLifecycleContext {
  read: ResearchMissionLifecycleSqlExecutor;
  transaction<T>(operation: (tx: ResearchMissionLifecycleSqlExecutor) => Promise<T>): Promise<T>;
}

export interface KnowledgeMissionLifecycleResult {
  missionId: string;
  missionFingerprint: string;
  questionSemanticKey: string;
  outcome: "CREATED" | "REUSED";
  lifecycleStatus: "CURRENT";
  operationalStatus: ResearchMissionStatus;
}

export interface DeferredKnowledgeMissionAdmission {
  missionId: string;
  questionSemanticKey: string;
  mission: ResearchMission;
}

function executor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): ResearchMissionLifecycleSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
    },
  };
}

const defaultContext: ResearchMissionLifecycleContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
};

function payloadFingerprint(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export async function reconcileKnowledgeResearchMissions(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  plans: readonly KnowledgeResearchMissionPlan[];
}, overrides: Partial<ResearchMissionLifecycleContext> = {}): Promise<readonly KnowledgeMissionLifecycleResult[]> {
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const revision = await tx.query<{ id: string }>(`
      SELECT "id" FROM "FascicoloKnowledgeRevision"
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "status" = 'CURRENT'
      FOR UPDATE
    `, [input.knowledgeRevisionId, input.tenantId, input.procedimentoId]);
    if (revision.rows.length !== 1) throw new Error("KNOWLEDGE_REVISION_NOT_CURRENT");
    const executablePlans = input.plans.filter((plan) => plan.mission !== null
      && (plan.execution === "ADMITTED" || plan.execution === "DEFERRED_BY_POLICY"));
    const results: KnowledgeMissionLifecycleResult[] = [];
    const currentMissionIds: string[] = [];
    for (const plan of executablePlans) {
      const mission = plan.mission!;
      const existing = await tx.query<{ id: string; status: ResearchMissionStatus }>(`
        SELECT "id", "status" FROM "ResearchMissionRecord"
        WHERE "tenantId" = $1 AND "caseId" = $2 AND "missionFingerprint" = $3
        FOR UPDATE
      `, [input.tenantId, input.procedimentoId, plan.missionFingerprint]);
      let outcome: "CREATED" | "REUSED";
      let missionId: string;
      let operationalStatus: ResearchMissionStatus;
      if (existing.rows[0]) {
        missionId = existing.rows[0].id;
        outcome = "REUSED";
        operationalStatus = existing.rows[0].status;
        await tx.query(`
          UPDATE "ResearchMissionRecord"
          SET "knowledgeRevisionId" = $4,
              "legalIssueSemanticKey" = $5,
              "researchQuestionSemanticKey" = $6,
              "referenceDateBasis" = $7::jsonb,
              "lifecycleStatus" = 'CURRENT'
          WHERE "id" = $1 AND "tenantId" = $2 AND "caseId" = $3
        `, [missionId, input.tenantId, input.procedimentoId, input.knowledgeRevisionId,
          plan.legalIssueSemanticKey, plan.questionSemanticKey, JSON.stringify(plan.referenceDateBasis)]);
      } else {
        missionId = mission.missionId;
        outcome = "CREATED";
        operationalStatus = plan.execution === "DEFERRED_BY_POLICY" ? "DEFERRED" : "PENDING";
        await tx.query(`
          INSERT INTO "ResearchMissionRecord" (
            "id", "tenantId", "contractVersion", "caseId", "fascicoloReference", "referenceDate", "mode",
            "payload", "payloadFingerprint", "missionFingerprint", "knowledgeRevisionId",
            "firstKnowledgeRevisionId", "legalIssueSemanticKey", "researchQuestionSemanticKey",
            "referenceDateBasis", "lifecycleStatus", "status"
          ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb, $9, $10, $11, $11, $12, $13, $14::jsonb, 'CURRENT', $15::"ResearchMissionStatus")
        `, [missionId, input.tenantId, mission.version, input.procedimentoId,
          mission.caseReference.fascicoloReference ?? null, mission.referenceDate, mission.mode,
          JSON.stringify(mission), payloadFingerprint(mission as unknown as JsonValue), plan.missionFingerprint,
          input.knowledgeRevisionId, plan.legalIssueSemanticKey, plan.questionSemanticKey,
          JSON.stringify(plan.referenceDateBasis), operationalStatus]);
      }
      currentMissionIds.push(missionId);
      results.push({
        missionId,
        missionFingerprint: plan.missionFingerprint,
        questionSemanticKey: plan.questionSemanticKey,
        outcome,
        lifecycleStatus: "CURRENT",
        operationalStatus,
      });
    }
    await tx.query(`
      UPDATE "ResearchMissionRecord"
      SET "lifecycleStatus" = 'HISTORICAL'
      WHERE "tenantId" = $1 AND "caseId" = $2
        AND "researchQuestionSemanticKey" IS NOT NULL
        AND "lifecycleStatus" = 'CURRENT'
        AND NOT ("id" = ANY($3::text[]))
    `, [input.tenantId, input.procedimentoId, currentMissionIds]);
    return results;
  });
}

export async function admitDeferredKnowledgeResearchMissionWave(input: {
  tenantId: string;
  procedimentoId: string;
  limit?: number;
}, overrides: Partial<ResearchMissionLifecycleContext> = {}): Promise<readonly DeferredKnowledgeMissionAdmission[]> {
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("INVALID_RESEARCH_EXECUTION_POLICY");
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const selected = await tx.query<{ id: string; researchQuestionSemanticKey: string; payload: JsonValue }>(`
      SELECT "id", "researchQuestionSemanticKey", "payload"
      FROM "ResearchMissionRecord"
      WHERE "tenantId" = $1 AND "caseId" = $2
        AND "lifecycleStatus" = 'CURRENT' AND "status" = 'DEFERRED'
        AND "researchQuestionSemanticKey" IS NOT NULL
      ORDER BY "researchQuestionSemanticKey", "id"
      FOR UPDATE
      LIMIT $3
    `, [input.tenantId, input.procedimentoId, limit]);
    const admitted: DeferredKnowledgeMissionAdmission[] = [];
    for (const row of selected.rows) {
      const updated = await tx.query<{ id: string }>(`
        UPDATE "ResearchMissionRecord" SET "status" = 'PENDING'
        WHERE "id" = $1 AND "tenantId" = $2 AND "caseId" = $3
          AND "lifecycleStatus" = 'CURRENT' AND "status" = 'DEFERRED'
        RETURNING "id"
      `, [row.id, input.tenantId, input.procedimentoId]);
      if (updated.rows.length === 1) admitted.push({
        missionId: row.id,
        questionSemanticKey: row.researchQuestionSemanticKey,
        mission: row.payload as unknown as ResearchMission,
      });
    }
    return admitted;
  });
}

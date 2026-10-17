import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import {
  createResearchMission,
  validateResearchMission,
  type ResearchBudget,
  type ResearchMission,
  type ResearchMissionInput,
} from "@/server/legal-research/bridge";

import { canonicalJson } from "./canonicalization";
import type { JsonValue } from "./contracts";

export type ResearchMissionVersioningErrorCode =
  | "ASSIGNED_ACTOR_REQUIRED"
  | "BUDGET_UNCHANGED"
  | "KNOWLEDGE_REVISION_NOT_CURRENT"
  | "MISSION_ALREADY_SUPERSEDED"
  | "MISSION_NOT_FOUND"
  | "MISSION_NOT_VERSIONABLE"
  | "MISSION_VERSION_CONFLICT"
  | "MISSION_VERSION_INVALID"
  | "TENANT_ACCESS_DENIED";

export class ResearchMissionVersioningError extends Error {
  constructor(readonly code: ResearchMissionVersioningErrorCode) {
    super(code);
    this.name = "ResearchMissionVersioningError";
  }
}

interface MissionVersionAuditInput {
  azione: string;
  entita: string;
  entitaId: string;
  enteId: string;
  esito: "SUCCESS";
  metadata: Prisma.InputJsonValue;
  actor: {
    userId: string;
    userEmail: string | null;
    userRole: string;
  };
}

export interface ResearchMissionVersioningSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  audit(input: MissionVersionAuditInput): Promise<void>;
}

export interface ResearchMissionVersioningContext {
  transaction<T>(operation: (tx: ResearchMissionVersioningSqlExecutor) => Promise<T>): Promise<T>;
}

export interface VersionResearchMissionResult {
  outcome: "CREATED" | "REUSED";
  previousMissionId: string;
  mission: ResearchMission;
  tenantId: string;
  assignedActorId: string;
  knowledgeRevisionId: string;
  missionFingerprint: string;
  researchQuestionSemanticKey: string;
}

interface MissionVersionSource {
  id: string;
  tenantId: string | null;
  assignedActorId: string | null;
  contractVersion: string;
  caseId: string;
  fascicoloReference: string | null;
  referenceDate: Date;
  mode: string;
  payload: ResearchMission;
  payloadFingerprint: string;
  missionFingerprint: string | null;
  knowledgeRevisionId: string | null;
  firstKnowledgeRevisionId: string | null;
  legalIssueSemanticKey: string | null;
  researchQuestionSemanticKey: string | null;
  referenceDateBasis: JsonValue | null;
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: string;
  knowledgeRevisionStatus: string | null;
}

function sqlExecutor(tx: Prisma.TransactionClient): ResearchMissionVersioningSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await tx.$queryRawUnsafe<T[]>(sql, ...params) };
    },
    async audit(input) {
      await createAuditLogInTransaction(tx, input);
    },
  };
}

const defaultContext: ResearchMissionVersioningContext = {
  transaction: (operation) => runSerializableTransactionWithRetry(
    (tx) => operation(sqlExecutor(tx)),
  ),
};

function payloadFingerprint(value: ResearchMission): string {
  return createHash("sha256")
    .update(canonicalJson(value as unknown as JsonValue), "utf8")
    .digest("hex");
}

function sameBudget(left: ResearchBudget, right: ResearchBudget): boolean {
  return left.maxTotalResearchCalls === right.maxTotalResearchCalls
    && left.maxMoonlitCalls === right.maxMoonlitCalls
    && left.maxSimpliciterCalls === right.maxSimpliciterCalls
    && left.maxLegalDataHunterCalls === right.maxLegalDataHunterCalls;
}

function missionInput(mission: ResearchMission): ResearchMissionInput {
  const { missionId: _missionId, ...input } = mission;
  return input;
}

function assertVersionableSource(source: MissionVersionSource): asserts source is MissionVersionSource & {
  tenantId: string;
  assignedActorId: string;
  missionFingerprint: string;
  knowledgeRevisionId: string;
  legalIssueSemanticKey: string;
  researchQuestionSemanticKey: string;
} {
  if (!source.tenantId
    || !source.missionFingerprint
    || !source.knowledgeRevisionId
    || !source.legalIssueSemanticKey
    || !source.researchQuestionSemanticKey
    || source.payload.missionId !== source.id
    || source.payloadFingerprint !== payloadFingerprint(source.payload)
    || validateResearchMission(source.payload).length > 0) {
    throw new ResearchMissionVersioningError("MISSION_NOT_VERSIONABLE");
  }
  if (!source.assignedActorId) {
    throw new ResearchMissionVersioningError("ASSIGNED_ACTOR_REQUIRED");
  }
  if (source.knowledgeRevisionStatus !== "CURRENT") {
    throw new ResearchMissionVersioningError("KNOWLEDGE_REVISION_NOT_CURRENT");
  }
}

export async function versionResearchMissionBudget(input: {
  sourceMissionId: string;
  budget: ResearchBudget;
  reason: string;
  actor: {
    userId: string;
    userEmail: string | null;
    userRole: "ADMIN";
  };
}, overrides: Partial<ResearchMissionVersioningContext> = {}): Promise<VersionResearchMissionResult> {
  const sourceMissionId = input.sourceMissionId.trim();
  const reason = input.reason.trim();
  if (!sourceMissionId || sourceMissionId.length > 96 || reason.length < 20 || reason.length > 1000) {
    throw new ResearchMissionVersioningError("MISSION_VERSION_INVALID");
  }
  const context = { ...defaultContext, ...overrides };
  return context.transaction(async (tx) => {
    const sourceResult = await tx.query<MissionVersionSource>(`
      SELECT mission.*, revision."status" AS "knowledgeRevisionStatus"
      FROM "ResearchMissionRecord" AS mission
      LEFT JOIN "FascicoloKnowledgeRevision" AS revision
        ON revision."id" = mission."knowledgeRevisionId"
        AND revision."tenantId" = mission."tenantId"
        AND revision."procedimentoId" = mission."caseId"
      WHERE mission."id" = $1
      FOR UPDATE OF mission
    `, [sourceMissionId]);
    const source = sourceResult.rows[0];
    if (!source) throw new ResearchMissionVersioningError("MISSION_NOT_FOUND");
    assertVersionableSource(source);
    const authorization = await tx.query<{ authorized: boolean }>(`
      SELECT TRUE AS "authorized"
      FROM "User" AS actor
      INNER JOIN "TenantMembership" AS membership
        ON membership."userId" = actor."id"
        AND membership."enteId" = $2
      WHERE actor."id" = $1
        AND actor."attivo" = TRUE
        AND actor."ruolo" = 'ADMIN'
      LIMIT 1
    `, [input.actor.userId, source.tenantId]);
    if (authorization.rows.length !== 1) {
      throw new ResearchMissionVersioningError("TENANT_ACCESS_DENIED");
    }

    const mission = createResearchMission({
      ...missionInput(source.payload),
      budget: input.budget,
      status: "PENDING",
    });
    if (validateResearchMission(mission).length > 0) {
      throw new ResearchMissionVersioningError("MISSION_VERSION_INVALID");
    }
    if (sameBudget(source.payload.budget, input.budget)) {
      throw new ResearchMissionVersioningError("BUDGET_UNCHANGED");
    }
    const fingerprint = payloadFingerprint(mission);

    if (source.lifecycleStatus === "HISTORICAL") {
      const current = await tx.query<{
        id: string;
        payloadFingerprint: string;
        payload: ResearchMission;
      }>(`
        SELECT "id", "payloadFingerprint", "payload"
        FROM "ResearchMissionRecord"
        WHERE "tenantId" = $1 AND "caseId" = $2 AND "missionFingerprint" = $3
          AND "lifecycleStatus" = 'CURRENT'
        FOR UPDATE
      `, [source.tenantId, source.caseId, source.missionFingerprint]);
      const existing = current.rows[0];
      if (!existing
        || existing.id !== mission.missionId
        || existing.payloadFingerprint !== fingerprint
        || existing.payload.missionId !== mission.missionId) {
        throw new ResearchMissionVersioningError("MISSION_ALREADY_SUPERSEDED");
      }
      return {
        outcome: "REUSED",
        previousMissionId: source.id,
        mission,
        tenantId: source.tenantId,
        assignedActorId: source.assignedActorId,
        knowledgeRevisionId: source.knowledgeRevisionId,
        missionFingerprint: source.missionFingerprint,
        researchQuestionSemanticKey: source.researchQuestionSemanticKey,
      };
    }
    if (source.status !== "PENDING") {
      throw new ResearchMissionVersioningError("MISSION_NOT_VERSIONABLE");
    }

    const historical = await tx.query<{ id: string }>(`
      UPDATE "ResearchMissionRecord"
      SET "lifecycleStatus" = 'HISTORICAL', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1 AND "lifecycleStatus" = 'CURRENT' AND "status" = 'PENDING'
      RETURNING "id"
    `, [source.id]);
    if (historical.rows.length !== 1) {
      throw new ResearchMissionVersioningError("MISSION_VERSION_CONFLICT");
    }

    const created = await tx.query<{ id: string }>(`
      INSERT INTO "ResearchMissionRecord" (
        "id", "tenantId", "assignedActorId", "contractVersion", "caseId",
        "fascicoloReference", "referenceDate", "mode", "payload", "payloadFingerprint",
        "missionFingerprint", "knowledgeRevisionId", "firstKnowledgeRevisionId",
        "legalIssueSemanticKey", "researchQuestionSemanticKey", "referenceDateBasis",
        "lifecycleStatus", "status", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13,
        $14, $15, $16::jsonb, 'CURRENT', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `, [
      mission.missionId,
      source.tenantId,
      source.assignedActorId,
      mission.version,
      source.caseId,
      source.fascicoloReference,
      source.referenceDate,
      source.mode,
      JSON.stringify(mission),
      fingerprint,
      source.missionFingerprint,
      source.knowledgeRevisionId,
      source.firstKnowledgeRevisionId ?? source.knowledgeRevisionId,
      source.legalIssueSemanticKey,
      source.researchQuestionSemanticKey,
      JSON.stringify(source.referenceDateBasis),
    ]);
    if (created.rows.length !== 1) {
      throw new ResearchMissionVersioningError("MISSION_VERSION_CONFLICT");
    }

    await tx.audit({
      azione: "RESEARCH_MISSION_BUDGET_VERSION_CREATED",
      entita: "ResearchMissionRecord",
      entitaId: mission.missionId,
      enteId: source.tenantId,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        previousMissionId: source.id,
        missionId: mission.missionId,
        procedimentoId: source.caseId,
        knowledgeRevisionId: source.knowledgeRevisionId,
        researchQuestionSemanticKey: source.researchQuestionSemanticKey,
        missionFingerprint: source.missionFingerprint,
        previousBudget: source.payload.budget,
        newBudget: mission.budget,
        reason,
      },
    });

    return {
      outcome: "CREATED",
      previousMissionId: source.id,
      mission,
      tenantId: source.tenantId,
      assignedActorId: source.assignedActorId,
      knowledgeRevisionId: source.knowledgeRevisionId,
      missionFingerprint: source.missionFingerprint,
      researchQuestionSemanticKey: source.researchQuestionSemanticKey,
    };
  });
}

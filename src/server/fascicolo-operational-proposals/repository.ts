import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import type { JsonValue } from "@/server/fascicolo-knowledge";
import { ACTIVITY_LOCK_NAMESPACE } from "@/server/fascicolo-operational-activities/model";
import { readFascicoloDocumentCorpusInTransaction } from "@/server/queries/fascicolo-document-corpus";

import { operationalProposalCandidateSchema, type OperationalProposalCandidate } from "./contracts";
import {
  proposalReconciliationFingerprint,
  proposalReconciliationStates,
  reconciliationProposalStateSchema,
  type ReconciliationProposalState,
} from "./reconciliation-state";

export interface OperationalProposalSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  audit(input: OperationalProposalAuditInput): Promise<unknown>;
  readCorpusFingerprint(scope: { tenantId: string; procedimentoId: string; concessioneId: string | null }): Promise<string | null>;
}

export interface OperationalProposalAuditInput {
  azione: string;
  entitaId: string | null;
  enteId: string;
  concessioneId: string | null;
  metadata: JsonValue;
  actor: { actorId: string | null; actorEmail: string | null; actorRole: string };
}

export interface OperationalProposalRepositoryContext {
  read: OperationalProposalSqlExecutor;
  transaction<T>(operation: (tx: OperationalProposalSqlExecutor) => Promise<T>): Promise<T>;
  now?: () => Date;
}

// ActivityLog.userId references User: system actors are recorded by role and metadata, never as user ids.
export function toActivityLogAuditActor(input: Pick<OperationalProposalAuditInput, "actor" | "metadata">): {
  actor: { userId: string | null; userEmail: string | null; userRole: string };
  metadata: JsonValue;
} {
  if (input.actor.actorRole === "SYSTEM") {
    const base = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : { value: input.metadata };
    return {
      actor: { userId: null, userEmail: null, userRole: "SYSTEM" },
      metadata: { ...base, systemActorId: input.actor.actorId },
    };
  }
  return {
    actor: { userId: input.actor.actorId, userEmail: input.actor.actorEmail, userRole: input.actor.actorRole },
    metadata: input.metadata,
  };
}

function executor(client: Prisma.TransactionClient): OperationalProposalSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
    },
    readCorpusFingerprint: async (scope) => (await readFascicoloDocumentCorpusInTransaction(scope, client))?.corpusFingerprint ?? null,
    audit: (input) => {
      const mapped = toActivityLogAuditActor(input);
      return createAuditLogInTransaction(client, {
        azione: input.azione,
        entita: "FascicoloOperationalProposal",
        entitaId: input.entitaId,
        enteId: input.enteId,
        concessioneId: input.concessioneId,
        esito: "SUCCESS",
        metadata: mapped.metadata as Prisma.InputJsonValue,
        actor: mapped.actor,
      });
    },
  };
}

const defaultContext: OperationalProposalRepositoryContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
};

export type OperationalProposalStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "AMENDED_AND_APPROVED" | "MATERIALIZED" | "SUPERSEDED" | "STALE";

export interface OperationalProposalRecord extends Omit<OperationalProposalCandidate, "structuredReportId"> {
  id: string;
  structuredReportId: string | null;
  status: OperationalProposalStatus;
  approvedPayload: JsonValue | null;
  reviewVersion: number;
  reviewedAt: Date | null;
  reviewedByActorId: string | null;
  reviewedByEmail: string | null;
  reviewedByRole: string | null;
  reviewNote: string | null;
  materializedAt: Date | null;
  materializedEntityType: string | null;
  materializedEntityId: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OperationalProposalRepositoryError extends Error {
  constructor(readonly code:
    | "AUTHORITY_MISMATCH"
    | "CURRENT_INPUT_REQUIRED"
    | "STALE_PREVIEW"
    | "RECONCILIATION_NOT_FOUND"
    | "RECONCILIATION_ALREADY_REVERSED"
    | "RECONCILIATION_CHANGED"
    | "RECONCILIATION_INVALID"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_NOT_REVIEWABLE"
    | "STALE_REVIEW_VERSION"
    | "INVALID_AMENDMENT"
    | "PROPOSAL_NOT_APPROVED"
    | "MANUAL_ACTION_REQUIRED"
    | "CONCESSION_REQUIRED_FOR_MATERIALIZATION"
    | "UNSUPPORTED_MATERIALIZATION"
    | "DEADLINE_EXACT_DATE_REQUIRED"
    | "SUBJECT_NOT_FOUND"
    | "SUBJECT_IDENTIFIER_CONFLICT"
    | "SUBJECT_MERGE_NOT_AUTOMATIC") {
    super(code);
    this.name = "OperationalProposalRepositoryError";
  }
}

function context(overrides: Partial<OperationalProposalRepositoryContext>): OperationalProposalRepositoryContext {
  return { ...defaultContext, ...overrides };
}

function deterministicId(prefix: string, identity: string): string {
  return `${prefix}_${createHash("sha256").update(identity).digest("hex")}`.slice(0, 96);
}

// A procedimento without a concession is a valid living fascicolo; a linked concession must belong to the same tenant.
async function assertAuthority(tx: OperationalProposalSqlExecutor, tenantId: string, procedimentoId: string): Promise<{ concessioneId: string | null }> {
  const result = await tx.query<{ concessioneId: string | null }>(`
    SELECT p."concessioneId" FROM "Procedimento" p
    LEFT JOIN "Concessione" c ON c."id" = p."concessioneId"
    WHERE p."id" = $1
      AND p."enteId" = $2
      AND (p."concessioneId" IS NULL OR c."enteId" = $2)
  `, [procedimentoId, tenantId]);
  if (!result.rows[0]) throw new OperationalProposalRepositoryError("AUTHORITY_MISMATCH");
  return result.rows[0];
}

async function assertReadAuthority(
  tx: OperationalProposalSqlExecutor,
  tenantId: string,
  procedimentoId: string,
): Promise<void> {
  const result = await tx.query<{ id: string }>(`
    SELECT p."id" FROM "Procedimento" p
    LEFT JOIN "Concessione" c ON c."id" = p."concessioneId"
    WHERE p."id" = $1
      AND p."enteId" = $2
      AND (p."concessioneId" IS NULL OR c."enteId" = $2)
  `, [procedimentoId, tenantId]);
  if (!result.rows[0]) throw new OperationalProposalRepositoryError("AUTHORITY_MISMATCH");
}

async function assertProposalCurrent(tx: OperationalProposalSqlExecutor, proposal: OperationalProposalRecord): Promise<void> {
  if (proposal.supersededAt || !proposal.structuredReportId) {
    throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");
  }
  const result = await tx.query<{ id: string }>(`
    SELECT r."id"
    FROM "FascicoloKnowledgeRevision" r
    JOIN "StructuredFascicoloReportSnapshot" s
      ON s."tenantId" = r."tenantId" AND s."procedimentoId" = r."procedimentoId"
      AND s."knowledgeRevisionId" = r."id"
    WHERE r."id" = $1 AND r."tenantId" = $2 AND r."procedimentoId" = $3 AND r."status" = 'CURRENT'
      AND s."id" = $4 AND s."reportFingerprint" = $5 AND s."status" = 'CURRENT'
    FOR SHARE OF r, s
  `, [proposal.knowledgeRevisionId, proposal.tenantId, proposal.procedimentoId,
    proposal.structuredReportId, proposal.structuredReportFingerprint]);
  if (!result.rows[0]) throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");
}

async function reconciliationStates(
  tx: OperationalProposalSqlExecutor,
  tenantId: string,
  procedimentoId: string,
  lock: boolean,
): Promise<ReconciliationProposalState[]> {
  const rows = await tx.query<Pick<OperationalProposalRecord,
    "id" | "proposalFingerprint" | "status" | "reviewVersion" | "supersededAt" | "updatedAt">>(`
    SELECT "id","proposalFingerprint","status","reviewVersion","supersededAt","updatedAt"
    FROM "FascicoloOperationalProposal"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2
    ORDER BY "id"
    ${lock ? "FOR UPDATE" : ""}
  `, [tenantId, procedimentoId]);
  return proposalReconciliationStates(rows.rows);
}

export async function reconcileOperationalProposals(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  structuredReportId: string;
  structuredReportFingerprint: string;
  expectedCorpusFingerprint: string;
  expectedPreviewFingerprint: string;
  candidates: readonly OperationalProposalCandidate[];
  actor?: OperationalProposalAuditInput["actor"];
}, overrides: Partial<OperationalProposalRepositoryContext> = {}): Promise<{
  reconciliationId: string;
  created: number;
  reused: number;
  stale: number;
  proposals: readonly OperationalProposalRecord[];
}> {
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedCorpusFingerprint);
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedPreviewFingerprint);
  const parsed = input.candidates.map((candidate) => operationalProposalCandidateSchema.parse(candidate));
  const candidates = [...new Map(parsed.map((candidate) => [candidate.proposalFingerprint, candidate])).values()];
  if (candidates.some((candidate) => candidate.tenantId !== input.tenantId
    || candidate.procedimentoId !== input.procedimentoId
    || candidate.knowledgeRevisionId !== input.knowledgeRevisionId
    || candidate.structuredReportId !== input.structuredReportId
    || candidate.structuredReportFingerprint !== input.structuredReportFingerprint)) {
    throw new OperationalProposalRepositoryError("AUTHORITY_MISMATCH");
  }
  const ctx = context(overrides);
  const reconciliationId = `reconciliation_${randomUUID()}`;
  return ctx.transaction(async (tx) => {
    await tx.query(`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(hashtext($1), hashtext($2))
    `, [ACTIVITY_LOCK_NAMESPACE, `${input.tenantId}::${input.procedimentoId}`]);
    const { concessioneId } = await assertAuthority(tx, input.tenantId, input.procedimentoId);
    const current = await tx.query<{ revisionId: string; reportFingerprint: string; revisionCorpus: string; reportCorpus: string }>(`
      SELECT r."id" AS "revisionId", s."reportFingerprint",
        r."corpusFingerprint" AS "revisionCorpus", s."corpusFingerprint" AS "reportCorpus"
      FROM "FascicoloKnowledgeRevision" r
      JOIN "StructuredFascicoloReportSnapshot" s
        ON s."tenantId" = r."tenantId" AND s."procedimentoId" = r."procedimentoId"
      WHERE r."id" = $1 AND r."tenantId" = $2 AND r."procedimentoId" = $3 AND r."status" = 'CURRENT'
        AND s."id" = $4 AND s."knowledgeRevisionId" = r."id"
        AND s."reportFingerprint" = $5 AND s."status" = 'CURRENT'
      FOR SHARE OF r, s
    `, [input.knowledgeRevisionId, input.tenantId, input.procedimentoId, input.structuredReportId, input.structuredReportFingerprint]);
    if (!current.rows[0]) throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");

    const fingerprints = candidates.map((candidate) => candidate.proposalFingerprint);
    const corpusFingerprint = await tx.readCorpusFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId, concessioneId,
    });
    if (corpusFingerprint !== input.expectedCorpusFingerprint
      || current.rows[0].revisionCorpus !== corpusFingerprint || current.rows[0].reportCorpus !== corpusFingerprint) {
      throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");
    }
    const before = await reconciliationStates(tx, input.tenantId, input.procedimentoId, true);
    const beforeFingerprint = proposalReconciliationFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId,
      reportFingerprint: input.structuredReportFingerprint, candidateFingerprints: fingerprints, states: before,
    });
    if (beforeFingerprint !== input.expectedPreviewFingerprint) {
      throw new OperationalProposalRepositoryError("STALE_PREVIEW");
    }
    const stale = await tx.query<{ id: string }>(`
      UPDATE "FascicoloOperationalProposal"
      SET "status" = 'STALE'::"FascicoloOperationalProposalStatus", "supersededAt" = $4, "updatedAt" = $4
      WHERE "tenantId" = $1 AND "procedimentoId" = $2
        AND "status" = 'PROPOSED'
        AND NOT ("proposalFingerprint" = ANY($3::text[]))
      RETURNING "id"
    `, [input.tenantId, input.procedimentoId, fingerprints, (ctx.now ?? (() => new Date()))()]);
    const approvalsNeedingReview = await tx.query<{ id: string }>(`
      UPDATE "FascicoloOperationalProposal"
      SET "supersededAt" = $4, "updatedAt" = $4
      WHERE "tenantId" = $1 AND "procedimentoId" = $2
        AND "status" IN ('APPROVED','AMENDED_AND_APPROVED') AND "supersededAt" IS NULL
        AND NOT ("proposalFingerprint" = ANY($3::text[]))
      RETURNING "id"
    `, [input.tenantId, input.procedimentoId, fingerprints, (ctx.now ?? (() => new Date()))()]);
    await tx.query(`
      UPDATE "FascicoloOperationalProposal"
      SET "supersededAt" = NULL, "updatedAt" = $4
      WHERE "tenantId" = $1 AND "procedimentoId" = $2
        AND "status" IN ('APPROVED','AMENDED_AND_APPROVED') AND "supersededAt" IS NOT NULL
        AND "proposalFingerprint" = ANY($3::text[])
    `, [input.tenantId, input.procedimentoId, fingerprints, (ctx.now ?? (() => new Date()))()]);
    const reactivated = await tx.query<{ id: string }>(`
      UPDATE "FascicoloOperationalProposal"
      SET "status" = 'PROPOSED'::"FascicoloOperationalProposalStatus", "supersededAt" = NULL, "updatedAt" = $4
      WHERE "tenantId" = $1 AND "procedimentoId" = $2
        AND "status" = 'STALE' AND "reviewVersion" = 0
        AND "proposalFingerprint" = ANY($3::text[])
      RETURNING "id"
    `, [input.tenantId, input.procedimentoId, fingerprints, (ctx.now ?? (() => new Date()))()]);
    let created = 0;
    for (const candidate of candidates) {
      const inserted = await tx.query<{ id: string }>(`
        INSERT INTO "FascicoloOperationalProposal" (
          "id","tenantId","procedimentoId","knowledgeRevisionId","structuredReportId",
          "structuredReportFingerprint","policyVersion","proposalType","status","title","description",
          "proposedPayload","originatingKnowledgeItemIds","originatingIssueSemanticKeys",
          "originatingQuestionSemanticKeys","relevantResultIds","rationale","confidence",
          "proposalFingerprint","warningCodes","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"FascicoloOperationalProposalType",'PROPOSED',$9,$10,
          $11::jsonb,$12::text[],$13::text[],$14::text[],$15::text[],$16,$17,$18,$19::text[],
          CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT ("tenantId","procedimentoId","proposalFingerprint") DO NOTHING RETURNING "id"
      `, [deterministicId("operational_proposal", candidate.proposalFingerprint), candidate.tenantId,
        candidate.procedimentoId, candidate.knowledgeRevisionId, candidate.structuredReportId,
        candidate.structuredReportFingerprint, candidate.policyVersion, candidate.proposalType,
        candidate.title, candidate.description, JSON.stringify(candidate.proposedPayload),
        candidate.originatingKnowledgeItemIds, candidate.originatingIssueSemanticKeys,
        candidate.originatingQuestionSemanticKeys, candidate.relevantResultIds, candidate.rationale,
        candidate.confidence, candidate.proposalFingerprint, candidate.warningCodes]);
      created += inserted.rows.length;
    }
    const proposals = await tx.query<OperationalProposalRecord>(`
      SELECT * FROM "FascicoloOperationalProposal"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "proposalFingerprint" = ANY($3::text[])
      ORDER BY "proposalFingerprint"
    `, [input.tenantId, input.procedimentoId, fingerprints]);
    const after = await reconciliationStates(tx, input.tenantId, input.procedimentoId, false);
    const afterFingerprint = proposalReconciliationFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId,
      reportFingerprint: input.structuredReportFingerprint, candidateFingerprints: fingerprints, states: after,
    });
    await tx.audit({
      azione: "OPERATIONAL_PROPOSALS_RECONCILED",
      entitaId: reconciliationId,
      enteId: input.tenantId,
      concessioneId,
      metadata: {
        schema: "OPERATIONAL_PROPOSALS_RECONCILIATION_V1",
        procedimentoId: input.procedimentoId,
        knowledgeRevisionId: input.knowledgeRevisionId,
        reportFingerprint: input.structuredReportFingerprint,
        candidateFingerprints: fingerprints,
        before, after, beforeFingerprint, afterFingerprint,
        created, reused: candidates.length - created, stale: stale.rows.length,
        reactivated: reactivated.rows.length, approvalsNeedingReview: approvalsNeedingReview.rows.length,
      },
      actor: input.actor ?? { actorId: null, actorEmail: null, actorRole: "SYSTEM" },
    });
    return { reconciliationId, created, reused: candidates.length - created, stale: stale.rows.length + approvalsNeedingReview.rows.length, proposals: proposals.rows };
  });
}

const reconciliationAuditSchema = z.object({
  schema: z.literal("OPERATIONAL_PROPOSALS_RECONCILIATION_V1"),
  procedimentoId: z.string().min(1),
  reportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  candidateFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  before: z.array(reconciliationProposalStateSchema),
  after: z.array(reconciliationProposalStateSchema),
  beforeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  afterFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough();

function validatedReconciliationAudit(metadata: unknown, tenantId: string, procedimentoId: string) {
  const parsed = reconciliationAuditSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.procedimentoId !== procedimentoId) {
    throw new OperationalProposalRepositoryError("RECONCILIATION_INVALID");
  }
  const snapshot = parsed.data;
  const fingerprint = (states: readonly ReconciliationProposalState[]) => proposalReconciliationFingerprint({
    tenantId, procedimentoId, reportFingerprint: snapshot.reportFingerprint,
    candidateFingerprints: snapshot.candidateFingerprints, states,
  });
  const before = new Map(snapshot.before.map((item) => [item.id, item]));
  const after = new Map(snapshot.after.map((item) => [item.id, item]));
  if (before.size !== snapshot.before.length || after.size !== snapshot.after.length
    || snapshot.beforeFingerprint !== fingerprint(snapshot.before) || snapshot.afterFingerprint !== fingerprint(snapshot.after)
    || [...before.values()].some((item) => {
      const current = after.get(item.id);
      if (!current || current.proposalFingerprint !== item.proposalFingerprint || current.reviewVersion !== item.reviewVersion) return true;
      if (item.status === "PROPOSED" && current.status === "STALE") return current.supersededAt === null;
      if (item.status === "STALE" && current.status === "PROPOSED") {
        return item.reviewVersion !== 0 || current.supersededAt !== null;
      }
      if (item.status !== current.status) return true;
      return !["APPROVED", "AMENDED_AND_APPROVED"].includes(item.status)
        && item.supersededAt !== current.supersededAt;
    })
    || [...after.values()].some((item) => !before.has(item.id)
      && (item.status !== "PROPOSED" || item.reviewVersion !== 0 || item.supersededAt !== null))) {
    throw new OperationalProposalRepositoryError("RECONCILIATION_INVALID");
  }
  return snapshot;
}

export async function reverseOperationalProposalReconciliation(input: {
  tenantId: string;
  procedimentoId: string;
  reconciliationId: string;
  expectedAfterFingerprint: string;
  note: string;
  actor: { actorId: string; actorEmail: string | null; actorRole: string };
}, overrides: Partial<OperationalProposalRepositoryContext> = {}): Promise<{
  restored: number;
  retainedAsHistory: number;
}> {
  z.string().regex(/^reconciliation_[0-9a-f-]{36}$/).parse(input.reconciliationId);
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedAfterFingerprint);
  z.string().trim().min(3).max(4_000).parse(input.note);
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    await tx.query(`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(hashtext($1), hashtext($2))
    `, [ACTIVITY_LOCK_NAMESPACE, `${input.tenantId}::${input.procedimentoId}`]);
    const { concessioneId } = await assertAuthority(tx, input.tenantId, input.procedimentoId);
    const event = await tx.query<{ metadata: unknown }>(`
      SELECT "metadata" FROM "ActivityLog"
      WHERE "enteId" = $1 AND "entita" = 'FascicoloOperationalProposal'
        AND "entitaId" = $2 AND "azione" = 'OPERATIONAL_PROPOSALS_RECONCILED'
        AND "esito" = 'SUCCESS' AND "metadata" ->> 'procedimentoId' = $3
    `, [input.tenantId, input.reconciliationId, input.procedimentoId]);
    if (event.rows.length !== 1) throw new OperationalProposalRepositoryError("RECONCILIATION_NOT_FOUND");
    const previousReversal = await tx.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM "ActivityLog"
        WHERE "enteId" = $1 AND "entita" = 'FascicoloOperationalProposal'
          AND "entitaId" = $2 AND "azione" = 'OPERATIONAL_PROPOSALS_RECONCILIATION_REVERSED'
          AND "esito" = 'SUCCESS' AND "metadata" ->> 'procedimentoId' = $3
      ) AS "exists"
    `, [input.tenantId, input.reconciliationId, input.procedimentoId]);
    if (previousReversal.rows[0]?.exists) {
      throw new OperationalProposalRepositoryError("RECONCILIATION_ALREADY_REVERSED");
    }
    const snapshot = validatedReconciliationAudit(event.rows[0].metadata, input.tenantId, input.procedimentoId);
    if (snapshot.afterFingerprint !== input.expectedAfterFingerprint) {
      throw new OperationalProposalRepositoryError("RECONCILIATION_CHANGED");
    }
    const current = await reconciliationStates(tx, input.tenantId, input.procedimentoId, true);
    const currentFingerprint = proposalReconciliationFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId,
      reportFingerprint: snapshot.reportFingerprint, candidateFingerprints: snapshot.candidateFingerprints, states: current,
    });
    if (currentFingerprint !== snapshot.afterFingerprint) {
      throw new OperationalProposalRepositoryError("RECONCILIATION_CHANGED");
    }

    const before = new Map(snapshot.before.map((item) => [item.id, item]));
    const now = (ctx.now ?? (() => new Date()))();
    let restored = 0;
    let retainedAsHistory = 0;
    for (const after of snapshot.after) {
      const original = before.get(after.id);
      if (!original) {
        await tx.query(`
          UPDATE "FascicoloOperationalProposal"
          SET "status" = 'STALE'::"FascicoloOperationalProposalStatus", "supersededAt" = $4, "updatedAt" = $4
          WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "id" = $3
        `, [input.tenantId, input.procedimentoId, after.id, now]);
        retainedAsHistory += 1;
      } else if (original.status !== after.status || original.supersededAt !== after.supersededAt) {
        await tx.query(`
          UPDATE "FascicoloOperationalProposal"
          SET "status" = $4::"FascicoloOperationalProposalStatus", "supersededAt" = $5::timestamptz, "updatedAt" = $6
          WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "id" = $3
        `, [input.tenantId, input.procedimentoId, after.id, original.status, original.supersededAt, now]);
        restored += 1;
      }
    }
    const compensated = await reconciliationStates(tx, input.tenantId, input.procedimentoId, false);
    const compensatedFingerprint = proposalReconciliationFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId,
      reportFingerprint: snapshot.reportFingerprint, candidateFingerprints: snapshot.candidateFingerprints, states: compensated,
    });
    await tx.audit({
      azione: "OPERATIONAL_PROPOSALS_RECONCILIATION_REVERSED",
      entitaId: input.reconciliationId,
      enteId: input.tenantId,
      concessioneId,
      metadata: {
        procedimentoId: input.procedimentoId, note: input.note.trim(), originalBeforeFingerprint: snapshot.beforeFingerprint,
        originalAfterFingerprint: snapshot.afterFingerprint, compensatedFingerprint, compensated, restored, retainedAsHistory,
      },
      actor: input.actor,
    });
    return { restored, retainedAsHistory };
  });
}

export interface ProposalReconciliationSummary {
  reconciliationId: string;
  createdAt: Date;
  afterFingerprint: string;
  state: "AVAILABLE" | "CHANGED" | "REVERSED";
}

export async function listProposalReconciliations(input: {
  tenantId: string;
  procedimentoId: string;
}, overrides: Partial<OperationalProposalRepositoryContext> = {}): Promise<readonly ProposalReconciliationSummary[]> {
  const ctx = context(overrides);
  await assertReadAuthority(ctx.read, input.tenantId, input.procedimentoId);
  const [events, current] = await Promise.all([
    ctx.read.query<{ reconciliationId: string; metadata: unknown; createdAt: Date; reversed: boolean }>(`
      SELECT a."entitaId" AS "reconciliationId", a."metadata", a."createdAt",
        EXISTS (
          SELECT 1 FROM "ActivityLog" r WHERE r."enteId" = a."enteId" AND r."entita" = a."entita"
            AND r."entitaId" = a."entitaId" AND r."azione" = 'OPERATIONAL_PROPOSALS_RECONCILIATION_REVERSED'
            AND r."esito" = 'SUCCESS' AND r."metadata" ->> 'procedimentoId' = $2
        ) AS "reversed"
      FROM "ActivityLog" a
      WHERE a."enteId" = $1 AND a."entita" = 'FascicoloOperationalProposal'
        AND a."azione" = 'OPERATIONAL_PROPOSALS_RECONCILED' AND a."esito" = 'SUCCESS'
        AND a."metadata" ->> 'procedimentoId' = $2
        AND a."metadata" ->> 'schema' = 'OPERATIONAL_PROPOSALS_RECONCILIATION_V1'
      ORDER BY a."createdAt" DESC, a."id" DESC LIMIT 5
    `, [input.tenantId, input.procedimentoId]),
    reconciliationStates(ctx.read, input.tenantId, input.procedimentoId, false),
  ]);
  return events.rows.map((event) => {
    const snapshot = validatedReconciliationAudit(event.metadata, input.tenantId, input.procedimentoId);
    const currentFingerprint = proposalReconciliationFingerprint({
      tenantId: input.tenantId, procedimentoId: input.procedimentoId,
      reportFingerprint: snapshot.reportFingerprint, candidateFingerprints: snapshot.candidateFingerprints, states: current,
    });
    return {
      reconciliationId: event.reconciliationId,
      createdAt: event.createdAt,
      afterFingerprint: snapshot.afterFingerprint,
      state: event.reversed ? "REVERSED" as const
        : currentFingerprint === snapshot.afterFingerprint ? "AVAILABLE" as const : "CHANGED" as const,
    };
  });
}

const reviewInputSchema = z.object({
  tenantId: z.string().trim().min(1),
  procedimentoId: z.string().trim().min(1),
  proposalId: z.string().trim().min(1),
  action: z.enum(["APPROVE", "REJECT", "AMEND_AND_APPROVE"]),
  expectedReviewVersion: z.number().int().nonnegative(),
  approvedPayload: z.unknown().optional(),
  reviewNote: z.string().trim().max(10_000).nullable().optional(),
  actor: z.object({ actorId: z.string().trim().min(1), actorEmail: z.string().email().nullable(), actorRole: z.string().trim().min(1) }),
}).strict();

export async function reviewOperationalProposal(
  rawInput: z.input<typeof reviewInputSchema>,
  overrides: Partial<OperationalProposalRepositoryContext> = {},
): Promise<OperationalProposalRecord> {
  const input = reviewInputSchema.parse(rawInput);
  if (input.action === "AMEND_AND_APPROVE" && input.approvedPayload === undefined) {
    throw new OperationalProposalRepositoryError("INVALID_AMENDMENT");
  }
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const { concessioneId } = await assertAuthority(tx, input.tenantId, input.procedimentoId);
    const current = await tx.query<OperationalProposalRecord>(`
      SELECT * FROM "FascicoloOperationalProposal"
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 FOR UPDATE
    `, [input.proposalId, input.tenantId, input.procedimentoId]);
    const proposal = current.rows[0];
    if (!proposal) throw new OperationalProposalRepositoryError("PROPOSAL_NOT_FOUND");
    if (proposal.status !== "PROPOSED") {
      throw new OperationalProposalRepositoryError("PROPOSAL_NOT_REVIEWABLE");
    }
    if (proposal.reviewVersion !== input.expectedReviewVersion) {
      throw new OperationalProposalRepositoryError("STALE_REVIEW_VERSION");
    }
    if (input.action !== "REJECT") await assertProposalCurrent(tx, proposal);
    const nextStatus: OperationalProposalStatus = input.action === "REJECT" ? "REJECTED"
      : input.action === "AMEND_AND_APPROVE" ? "AMENDED_AND_APPROVED" : "APPROVED";
    const approvedPayload = input.action === "REJECT" ? null
      : input.action === "AMEND_AND_APPROVE" ? input.approvedPayload as JsonValue : proposal.proposedPayload;
    const reviewVersion = proposal.reviewVersion + 1;
    const now = (ctx.now ?? (() => new Date()))();
    const updated = await tx.query<OperationalProposalRecord>(`
      UPDATE "FascicoloOperationalProposal"
      SET "status" = $4::"FascicoloOperationalProposalStatus", "approvedPayload" = $5::jsonb,
        "reviewVersion" = $6, "reviewedAt" = $7, "reviewedByActorId" = $8,
        "reviewedByEmail" = $9, "reviewedByRole" = $10, "reviewNote" = $11,
        "supersededAt" = NULL, "updatedAt" = $7
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "reviewVersion" = $12
      RETURNING *
    `, [proposal.id, input.tenantId, input.procedimentoId, nextStatus,
      approvedPayload === null ? null : JSON.stringify(approvedPayload), reviewVersion, now,
      input.actor.actorId, input.actor.actorEmail, input.actor.actorRole, input.reviewNote ?? null,
      input.expectedReviewVersion]);
    if (!updated.rows[0]) throw new OperationalProposalRepositoryError("STALE_REVIEW_VERSION");
    await tx.query(`
      INSERT INTO "FascicoloOperationalProposalReviewEvent" (
        "id","tenantId","procedimentoId","proposalId","action","previousStatus","nextStatus",
        "reviewVersion","proposedPayload","approvedPayload","actorId","actorEmail","actorRole","reviewNote","createdAt"
      ) VALUES ($1,$2,$3,$4,$5::"FascicoloOperationalProposalReviewAction",
        $6::"FascicoloOperationalProposalStatus",$7::"FascicoloOperationalProposalStatus",
        $8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
    `, [deterministicId("proposal_review", `${proposal.id}:${reviewVersion}`), input.tenantId,
      input.procedimentoId, proposal.id, input.action, proposal.status, nextStatus, reviewVersion,
      JSON.stringify(proposal.proposedPayload), approvedPayload === null ? null : JSON.stringify(approvedPayload),
      input.actor.actorId, input.actor.actorEmail, input.actor.actorRole, input.reviewNote ?? null, now]);
    await tx.audit({
      azione: `OPERATIONAL_PROPOSAL_${input.action}`,
      entitaId: proposal.id,
      enteId: input.tenantId,
      concessioneId,
      metadata: { procedimentoId: input.procedimentoId, previousStatus: proposal.status, nextStatus, reviewVersion },
      actor: input.actor,
    });
    return updated.rows[0];
  });
}

const deadlinePayloadSchema = z.object({
  title: z.string().trim().min(1),
  dueDate: z.string().date(),
  dueDatePrecision: z.literal("EXACT"),
  tipologia: z.enum(["CONCESSIONE", "PAGAMENTO_CANONE", "POLIZZA", "CAUZIONE", "FIDEIUSSIONE", "VERIFICA_PERIODICA", "SOPRALLUOGO", "TERMINE_ADEMPIMENTO", "TERMINE_PROCEDIMENTALE", "ALTRO"]),
  preavvisoGiorni: z.number().int().min(0).max(3650),
}).passthrough();

const criticalityPayloadSchema = z.object({
  severity: z.enum(["BASSA", "MEDIA", "ALTA", "URGENTE"]),
  category: z.enum(["GIURIDICA", "TECNICA", "ECONOMICA", "DOCUMENTALE", "MANUTENTIVA", "SICUREZZA", "OCCUPAZIONE_DIFFORME", "USO_NON_CONFORME", "MOROSITA", "RISCHIO_DECADENZA", "RISCHIO_REVOCA", "ALTRO"]),
  description: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
}).passthrough();

async function materializeTarget(tx: OperationalProposalSqlExecutor, proposal: OperationalProposalRecord, concessioneId: string): Promise<{ entityType: string; entityId: string }> {
  const payload = proposal.approvedPayload;
  if (proposal.proposalType === "DEADLINE") {
    const parsed = deadlinePayloadSchema.safeParse(payload);
    if (!parsed.success) throw new OperationalProposalRepositoryError("DEADLINE_EXACT_DATE_REQUIRED");
    const entityId = deterministicId("scadenza", proposal.id);
    await tx.query(`
      INSERT INTO "Scadenza" ("id","concessioneId","tipologia","dataScadenza","preavvisoGiorni","stato","descrizione","updatedAt")
      VALUES ($1,$2,$3::"TipologiaScadenza",$4::timestamptz,$5,'APERTA',$6,CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING
    `, [entityId, concessioneId, parsed.data.tipologia, `${parsed.data.dueDate}T00:00:00.000Z`,
      parsed.data.preavvisoGiorni, parsed.data.title]);
    return { entityType: "Scadenza", entityId };
  }
  if (proposal.proposalType === "CRITICALITY") {
    const parsed = criticalityPayloadSchema.parse(payload) as {
      severity: "BASSA" | "MEDIA" | "ALTA" | "URGENTE";
      category: string;
      description: string;
      rationale: string;
    };
    const entityId = deterministicId("criticita", proposal.id);
    await tx.query(`
      INSERT INTO "Criticita" ("id","concessioneId","tipologia","gravita","fonte","descrizione","azioneConsigliata","stato","dataUltimoAggiornamento","updatedAt")
      VALUES ($1,$2,$3::"TipologiaCriticita",$4::"GravitaCriticita",'ALERT_AUTOMATICO',$5,$6,'APERTA',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING
    `, [entityId, concessioneId, parsed.category, parsed.severity,
      parsed.description, parsed.rationale]);
    return { entityType: "Criticita", entityId };
  }
  if (proposal.proposalType === "SUBJECT_UPDATE") {
    const subjectPayload = z.object({
      action: z.enum(["ADD_ALIAS", "ADD_STRONG_IDENTIFIER", "MERGE"]),
      subjectId: z.string().min(1),
      alias: z.string().trim().min(1).max(512).optional(),
      identifierType: z.string().trim().min(1).max(64).optional(),
      identifierValue: z.string().trim().min(1).max(512).optional(),
    }).passthrough().parse(payload);
    if (subjectPayload.action === "MERGE") throw new OperationalProposalRepositoryError("SUBJECT_MERGE_NOT_AUTOMATIC");
    const subject = await tx.query<{ id: string; aliases: unknown }>(`
      SELECT "id","aliases" FROM "FascicoloSubject" WHERE "id"=$1 AND "tenantId"=$2 AND "mergedIntoId" IS NULL FOR UPDATE
    `, [subjectPayload.subjectId, proposal.tenantId]);
    if (!subject.rows[0]) throw new OperationalProposalRepositoryError("SUBJECT_NOT_FOUND");
    if (subjectPayload.action === "ADD_STRONG_IDENTIFIER") {
      const conflict = await tx.query<{ id: string }>(`
        SELECT "id" FROM "FascicoloSubjectIdentifier"
        WHERE "tenantId"=$1 AND "identifierType"=$2 AND "normalizedValue"=$3 AND "subjectId"<>$4
      `, [proposal.tenantId, subjectPayload.identifierType, subjectPayload.identifierValue?.toLocaleLowerCase("it-IT"), subjectPayload.subjectId]);
      if (conflict.rows[0]) throw new OperationalProposalRepositoryError("SUBJECT_IDENTIFIER_CONFLICT");
      throw new OperationalProposalRepositoryError("MANUAL_ACTION_REQUIRED");
    }
    const aliases = Array.isArray(subject.rows[0].aliases) ? subject.rows[0].aliases.filter((value): value is string => typeof value === "string") : [];
    const alias = subjectPayload.alias!;
    await tx.query(`UPDATE "FascicoloSubject" SET "aliases"=$3::jsonb WHERE "id"=$1 AND "tenantId"=$2`, [subjectPayload.subjectId, proposal.tenantId, JSON.stringify([...new Set([...aliases, alias])].sort())]);
    return { entityType: "FascicoloSubjectAlias", entityId: `${subjectPayload.subjectId}:${alias}` };
  }
  throw new OperationalProposalRepositoryError("UNSUPPORTED_MATERIALIZATION");
}

export async function materializeOperationalProposal(input: {
  tenantId: string;
  procedimentoId: string;
  proposalId: string;
  actor: { actorId: string; actorEmail: string | null; actorRole: string };
}, overrides: Partial<OperationalProposalRepositoryContext> = {}): Promise<{
  outcome: "MATERIALIZED" | "REUSED";
  entityType: string;
  entityId: string;
}> {
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const { concessioneId } = await assertAuthority(tx, input.tenantId, input.procedimentoId);
    if (!concessioneId) throw new OperationalProposalRepositoryError("AUTHORITY_MISMATCH");
    const current = await tx.query<OperationalProposalRecord>(`
      SELECT * FROM "FascicoloOperationalProposal"
      WHERE "id"=$1 AND "tenantId"=$2 AND "procedimentoId"=$3 FOR UPDATE
    `, [input.proposalId, input.tenantId, input.procedimentoId]);
    const proposal = current.rows[0];
    if (!proposal) throw new OperationalProposalRepositoryError("PROPOSAL_NOT_FOUND");
    const existing = await tx.query<{ entityType: string; entityId: string }>(`
      SELECT "entityType","entityId" FROM "FascicoloOperationalProposalMaterialization"
      WHERE "proposalId"=$1 AND "tenantId"=$2 AND "procedimentoId"=$3
    `, [proposal.id, input.tenantId, input.procedimentoId]);
    if (existing.rows[0]) {
      await tx.audit({
        azione: "OPERATIONAL_PROPOSAL_MATERIALIZATION_REUSED",
        entitaId: proposal.id,
        enteId: input.tenantId,
        concessioneId,
        metadata: { procedimentoId: input.procedimentoId, ...existing.rows[0] },
        actor: input.actor,
      });
      return { outcome: "REUSED", ...existing.rows[0] };
    }
    if (!(["APPROVED", "AMENDED_AND_APPROVED"] as OperationalProposalStatus[]).includes(proposal.status)) {
      throw new OperationalProposalRepositoryError("PROPOSAL_NOT_APPROVED");
    }
    await assertProposalCurrent(tx, proposal);
    if (proposal.warningCodes.includes("MANUAL_ACTION_REQUIRED")
      || (["DOCUMENT_REQUIREMENT", "CHECKLIST_ITEM", "ACTIVITY", "NOTE"] as const).includes(proposal.proposalType as never)) {
      throw new OperationalProposalRepositoryError("MANUAL_ACTION_REQUIRED");
    }
    // Scadenza and Criticita require a concession at schema level.
    if (!concessioneId) throw new OperationalProposalRepositoryError("CONCESSION_REQUIRED_FOR_MATERIALIZATION");
    const target = await materializeTarget(tx, proposal, concessioneId);
    const now = (ctx.now ?? (() => new Date()))();
    await tx.query(`
      INSERT INTO "FascicoloOperationalProposalMaterialization" ("id","tenantId","procedimentoId","proposalId","entityType","entityId","createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [deterministicId("proposal_materialization", proposal.id), input.tenantId, input.procedimentoId,
      proposal.id, target.entityType, target.entityId, now]);
    const updated = await tx.query<{ id: string }>(`
      UPDATE "FascicoloOperationalProposal"
      SET "status"='MATERIALIZED',"materializedAt"=$4,"materializedEntityType"=$5,
        "materializedEntityId"=$6,"updatedAt"=$4
      WHERE "id"=$1 AND "tenantId"=$2 AND "procedimentoId"=$3
        AND "status" IN ('APPROVED','AMENDED_AND_APPROVED') RETURNING "id"
    `, [proposal.id, input.tenantId, input.procedimentoId, now, target.entityType, target.entityId]);
    if (!updated.rows[0]) throw new OperationalProposalRepositoryError("PROPOSAL_NOT_APPROVED");
    await tx.audit({
      azione: "OPERATIONAL_PROPOSAL_MATERIALIZED",
      entitaId: proposal.id,
      enteId: input.tenantId,
      concessioneId,
      metadata: { procedimentoId: input.procedimentoId, ...target },
      actor: input.actor,
    });
    return { outcome: "MATERIALIZED", ...target };
  });
}

export async function listOperationalProposals(input: {
  tenantId: string;
  procedimentoId: string;
}, overrides: Partial<OperationalProposalRepositoryContext> = {}): Promise<readonly (OperationalProposalRecord & { reviewEvents: readonly unknown[] })[]> {
  const ctx = context(overrides);
  await assertReadAuthority(ctx.read, input.tenantId, input.procedimentoId);
  const [proposals, events] = await Promise.all([
    ctx.read.query<OperationalProposalRecord>(`
      SELECT * FROM "FascicoloOperationalProposal" WHERE "tenantId"=$1 AND "procedimentoId"=$2
      ORDER BY "createdAt" DESC,"id" DESC
    `, [input.tenantId, input.procedimentoId]),
    ctx.read.query<Record<string, unknown> & { proposalId: string }>(`
      SELECT * FROM "FascicoloOperationalProposalReviewEvent" WHERE "tenantId"=$1 AND "procedimentoId"=$2
      ORDER BY "createdAt","id"
    `, [input.tenantId, input.procedimentoId]),
  ]);
  return proposals.rows.map((proposal) => ({
    ...proposal,
    reviewEvents: events.rows.filter((event) => event.proposalId === proposal.id),
  }));
}
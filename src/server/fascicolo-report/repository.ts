import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import type { BuiltStructuredFascicoloReport, StructuredFascicoloReportPayload } from "./structured-report";

export interface StructuredReportSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface StructuredReportRepositoryContext {
  read: StructuredReportSqlExecutor;
  transaction<T>(operation: (tx: StructuredReportSqlExecutor) => Promise<T>): Promise<T>;
  now?: () => Date;
}

function executor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): StructuredReportSqlExecutor {
  return { async query<T>(sql: string, params: readonly unknown[] = []) { return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) }; } };
}

const defaultContext: StructuredReportRepositoryContext = {
  read: executor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(executor(tx))),
};

export type StructuredReportSnapshotStatus = "CURRENT" | "STALE" | "SUPERSEDED";

export interface StructuredReportSnapshotRecord {
  id: string;
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  contractVersion: string;
  reportFingerprint: string;
  corpusFingerprint: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
  status: StructuredReportSnapshotStatus;
  payload: StructuredFascicoloReportPayload;
  warnings: readonly string[];
  staleReasons: readonly string[];
  supersededBySnapshotId: string | null;
  generatedAt: Date;
}

export class StructuredReportRepositoryError extends Error {
  constructor(readonly code: "INVALID_FINGERPRINT" | "AUTHORITY_MISMATCH" | "KNOWLEDGE_NOT_CURRENT") {
    super(code);
    this.name = "StructuredReportRepositoryError";
  }
}

function reportId(fingerprint: string): string {
  return `structured_report_${fingerprint}`.slice(0, 96);
}

function fingerprint(payload: StructuredFascicoloReportPayload): string {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

function context(overrides: Partial<StructuredReportRepositoryContext>): StructuredReportRepositoryContext {
  return { ...defaultContext, ...overrides };
}

export async function persistStructuredFascicoloReport(
  report: BuiltStructuredFascicoloReport,
  overrides: Partial<StructuredReportRepositoryContext> = {},
): Promise<{ outcome: "CREATED" | "REUSED"; snapshot: StructuredReportSnapshotRecord }> {
  if (fingerprint(report.payload) !== report.reportFingerprint) {
    throw new StructuredReportRepositoryError("INVALID_FINGERPRINT");
  }
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const authority = await tx.query<{ revisionId: string; corpusFingerprint: string }>(`
      SELECT r."id" AS "revisionId", r."corpusFingerprint"
      FROM "Procedimento" p
      JOIN "FascicoloKnowledgeRevision" r ON r."procedimentoId" = p."id" AND r."tenantId" = p."enteId"
      WHERE p."id" = $1 AND p."enteId" = $2 AND r."id" = $3 AND r."status" = 'CURRENT'
      FOR UPDATE OF r
    `, [report.payload.procedimentoId, report.payload.tenantId, report.payload.knowledgeRevisionId]);
    const currentRevision = authority.rows[0];
    if (!currentRevision) throw new StructuredReportRepositoryError("KNOWLEDGE_NOT_CURRENT");
    if (currentRevision.corpusFingerprint !== report.payload.corpusFingerprint) {
      throw new StructuredReportRepositoryError("AUTHORITY_MISMATCH");
    }
    const existing = await tx.query<StructuredReportSnapshotRecord>(`
      SELECT * FROM "StructuredFascicoloReportSnapshot" WHERE "reportFingerprint" = $1
    `, [report.reportFingerprint]);
    if (existing.rows[0]) return { outcome: "REUSED", snapshot: existing.rows[0] };

    const id = reportId(report.reportFingerprint);
    await tx.query(`
      UPDATE "StructuredFascicoloReportSnapshot"
      SET "status" = 'STALE', "staleReasons" = ARRAY['SUPERSEDED_BY_MATERIAL_CHANGE']::TEXT[]
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'CURRENT'
    `, [report.payload.tenantId, report.payload.procedimentoId]);
    const inserted = await tx.query<StructuredReportSnapshotRecord>(`
      INSERT INTO "StructuredFascicoloReportSnapshot" (
        "id", "tenantId", "procedimentoId", "knowledgeRevisionId", "contractVersion",
        "reportFingerprint", "corpusFingerprint", "researchStateFingerprint", "sourceStateFingerprint",
        "status", "payload", "warnings", "generatedAt"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CURRENT',$10::jsonb,$11::jsonb,$12)
      RETURNING *
    `, [id, report.payload.tenantId, report.payload.procedimentoId, report.payload.knowledgeRevisionId,
      report.payload.contractVersion, report.reportFingerprint, report.payload.corpusFingerprint,
      report.payload.researchStateFingerprint, report.payload.sourceStateFingerprint,
      JSON.stringify(report.payload), JSON.stringify(report.payload.limitations),
      (ctx.now ?? (() => new Date()))()]);
    await tx.query(`
      UPDATE "StructuredFascicoloReportSnapshot"
      SET "status" = 'SUPERSEDED', "supersededBySnapshotId" = $3
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "id" <> $3
        AND "supersededBySnapshotId" IS NULL AND "status" = 'STALE'
    `, [report.payload.tenantId, report.payload.procedimentoId, id]);
    return { outcome: "CREATED", snapshot: inserted.rows[0] };
  });
}

export async function markCurrentStructuredReportStale(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  researchStateFingerprint: string;
  sourceStateFingerprint: string;
}, overrides: Partial<StructuredReportRepositoryContext> = {}): Promise<readonly string[]> {
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    const current = await tx.query<Pick<StructuredReportSnapshotRecord,
      "id" | "knowledgeRevisionId" | "researchStateFingerprint" | "sourceStateFingerprint">>(`
      SELECT "id", "knowledgeRevisionId", "researchStateFingerprint", "sourceStateFingerprint"
      FROM "StructuredFascicoloReportSnapshot"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'CURRENT'
      FOR UPDATE
    `, [input.tenantId, input.procedimentoId]);
    const snapshot = current.rows[0];
    if (!snapshot) return [];
    const reasons = [
      ...(snapshot.knowledgeRevisionId === input.knowledgeRevisionId ? [] : ["KNOWLEDGE_REVISION_CHANGED"]),
      ...(snapshot.researchStateFingerprint === input.researchStateFingerprint ? [] : ["RESEARCH_STATE_CHANGED"]),
      ...(snapshot.sourceStateFingerprint === input.sourceStateFingerprint ? [] : ["SOURCE_STATE_CHANGED"]),
    ];
    if (reasons.length) {
      await tx.query(`
        UPDATE "StructuredFascicoloReportSnapshot" SET "status" = 'STALE', "staleReasons" = $2::TEXT[]
        WHERE "id" = $1 AND "tenantId" = $3 AND "procedimentoId" = $4 AND "status" = 'CURRENT'
      `, [snapshot.id, reasons, input.tenantId, input.procedimentoId]);
    }
    return reasons;
  });
}

export async function listStructuredFascicoloReportSnapshots(input: {
  tenantId: string;
  procedimentoId: string;
}, overrides: Partial<StructuredReportRepositoryContext> = {}): Promise<readonly StructuredReportSnapshotRecord[]> {
  const result = await context(overrides).read.query<StructuredReportSnapshotRecord>(`
    SELECT * FROM "StructuredFascicoloReportSnapshot"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2
    ORDER BY "generatedAt" DESC, "id" DESC
  `, [input.tenantId, input.procedimentoId]);
  return result.rows;
}
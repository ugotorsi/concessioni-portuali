import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

export interface FascicoloAnalysisEvaluationPermit {
  permitRef: string;
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  operation: string;
  testCaseId: string;
  maxCostAmount: number;
  authorizedByUserId: string;
  expiresAt: Date;
  consumedByJobId: string | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export class FascicoloAnalysisEvaluationPermitError extends Error {
  constructor(readonly code:
    | "EVALUATION_PERMIT_NOT_FOUND"
    | "EVALUATION_PERMIT_NOT_AUTHORIZED"
    | "EVALUATION_PERMIT_CONFLICT"
    | "EVALUATION_PERMIT_INVALID"
    | "EVALUATION_PERMIT_ALREADY_CONSUMED") {
    super(code);
    this.name = "FascicoloAnalysisEvaluationPermitError";
  }
}

interface PermitRow {
  permitRef: string;
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  operation: string;
  testCaseId: string;
  maxCostAmount: string;
  authorizedByUserId: string;
  expiresAt: Date;
  consumedByJobId: string | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

function permit(row: PermitRow): FascicoloAnalysisEvaluationPermit {
  return { ...row, maxCostAmount: Number(row.maxCostAmount) };
}

export async function persistFascicoloAnalysisEvaluationPermit(input: {
  permitRef: string;
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  operation: string;
  testCaseId: string;
  maxCostAmount: number;
  authorizedByUserId: string;
  expiresAt: Date;
}): Promise<{ outcome: "CREATED" | "REUSED"; permit: FascicoloAnalysisEvaluationPermit }> {
  return prisma.$transaction(async (tx) => {
    const authorizer = await tx.$queryRaw<Array<{ id: string; email: string; ruolo: string }>>`
      SELECT u."id",u."email",u."ruolo"::text
      FROM "User" u
      INNER JOIN "Procedimento" p ON p."id"=${input.procedimentoId}
      WHERE u."id"=${input.authorizedByUserId} AND u."attivo"=true
        AND u."ruolo"='ADMIN' AND p."enteId"=${input.tenantId}
      FOR SHARE
    `;
    if (authorizer.length !== 1) {
      throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_NOT_AUTHORIZED");
    }
    const existing = await tx.$queryRaw<PermitRow[]>`
      SELECT "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
        "operation","testCaseId","maxCostAmount"::text,"authorizedByUserId","expiresAt",
        "consumedByJobId","consumedAt","revokedAt"
      FROM "FascicoloAnalysisEvaluationPermit"
      WHERE "permitRef"=${input.permitRef} OR "evaluationId"=${input.evaluationId}
      FOR UPDATE
    `;
    if (existing.length > 1) {
      throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_CONFLICT");
    }
    if (existing.length === 1) {
      const current = permit(existing[0]);
      if (current.permitRef !== input.permitRef
        || current.evaluationId !== input.evaluationId
        || current.tenantId !== input.tenantId
        || current.procedimentoId !== input.procedimentoId
        || current.corpusFingerprint !== input.corpusFingerprint
        || current.operation !== input.operation
        || current.testCaseId !== input.testCaseId
        || current.maxCostAmount !== input.maxCostAmount
        || current.authorizedByUserId !== input.authorizedByUserId
        || current.expiresAt.getTime() !== input.expiresAt.getTime()) {
        throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_CONFLICT");
      }
      return { outcome: "REUSED", permit: current };
    }
    const inserted = await tx.$queryRaw<PermitRow[]>`
      INSERT INTO "FascicoloAnalysisEvaluationPermit" (
        "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
        "operation","testCaseId","maxCostAmount","authorizedByUserId","expiresAt"
      ) VALUES (
        ${input.permitRef},${input.evaluationId},${input.tenantId},${input.procedimentoId},
        ${input.corpusFingerprint},${input.operation},${input.testCaseId},
        ${input.maxCostAmount.toFixed(6)}::numeric,${input.authorizedByUserId},${input.expiresAt}
      )
      RETURNING "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
        "operation","testCaseId","maxCostAmount"::text,"authorizedByUserId","expiresAt",
        "consumedByJobId","consumedAt","revokedAt"
    `;
    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_ANALYSIS_EVALUATION_AUTHORIZED",
      entita: "FascicoloAnalysisEvaluationPermit",
      entitaId: input.permitRef,
      enteId: input.tenantId,
      esito: "SUCCESS",
      actor: {
        userId: authorizer[0].id,
        userEmail: authorizer[0].email,
        userRole: authorizer[0].ruolo,
      },
      metadata: {
        evaluationId: input.evaluationId,
        procedimentoId: input.procedimentoId,
        corpusFingerprint: input.corpusFingerprint,
        operation: input.operation,
        testCaseId: input.testCaseId,
        maxCostAmount: input.maxCostAmount,
        expiresAt: input.expiresAt.toISOString(),
      },
    });
    return { outcome: "CREATED", permit: permit(inserted[0]) };
  });
}

export async function loadFascicoloAnalysisEvaluationPermit(
  permitRef: string,
): Promise<FascicoloAnalysisEvaluationPermit | null> {
  const rows = await prisma.$queryRaw<PermitRow[]>`
    SELECT "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
      "operation","testCaseId","maxCostAmount"::text,"authorizedByUserId","expiresAt",
      "consumedByJobId","consumedAt","revokedAt"
    FROM "FascicoloAnalysisEvaluationPermit"
    WHERE "permitRef"=${permitRef}
  `;
  return rows[0] ? permit(rows[0]) : null;
}

export async function consumeFascicoloAnalysisEvaluationPermit(input: {
  permitRef: string;
  evaluationId: string;
  jobId: string;
}): Promise<FascicoloAnalysisEvaluationPermit> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<PermitRow[]>`
      SELECT "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
        "operation","testCaseId","maxCostAmount"::text,"authorizedByUserId","expiresAt",
        "consumedByJobId","consumedAt","revokedAt"
      FROM "FascicoloAnalysisEvaluationPermit"
      WHERE "permitRef"=${input.permitRef}
      FOR UPDATE
    `;
    const current = rows[0] ? permit(rows[0]) : null;
    if (!current) throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_NOT_FOUND");
    if (current.evaluationId !== input.evaluationId
      || current.revokedAt
      || current.expiresAt <= new Date()) {
      throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_INVALID");
    }
    if (current.consumedByJobId && current.consumedByJobId !== input.jobId) {
      throw new FascicoloAnalysisEvaluationPermitError("EVALUATION_PERMIT_ALREADY_CONSUMED");
    }
    if (!current.consumedByJobId) {
      await tx.$executeRaw`
        UPDATE "FascicoloAnalysisEvaluationPermit"
        SET "consumedByJobId"=${input.jobId},"consumedAt"=CURRENT_TIMESTAMP
        WHERE "permitRef"=${input.permitRef} AND "consumedByJobId" IS NULL
      `;
      await createAuditLogInTransaction(tx, {
        azione: "FASCICOLO_ANALYSIS_EVALUATION_PERMIT_CONSUMED",
        entita: "FascicoloAnalysisEvaluationPermit",
        entitaId: input.permitRef,
        enteId: current.tenantId,
        esito: "SUCCESS",
        actor: { userId: null, userRole: "SYSTEM" },
        metadata: {
          evaluationId: input.evaluationId,
          procedimentoId: current.procedimentoId,
          jobId: input.jobId,
        },
      });
    }
    return {
      ...current,
      consumedByJobId: input.jobId,
      consumedAt: current.consumedAt ?? new Date(),
    };
  });
}

export interface FascicoloAnalysisEvaluationArtifactInput {
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  jobId: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  authorizationRef: string;
  testCaseId: string;
  corpusFingerprint: string;
  contractVersion: string;
  inputFingerprint: string;
  outputFingerprint: string;
  providerOutput: unknown;
  provenance: unknown;
  comparison: unknown;
  maxCostAmount: number;
}

export interface EvaluationSqlExecutor {
  readonly prismaTransaction?: Prisma.TransactionClient;
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface FascicoloAnalysisEvaluationRepositoryContext {
  transaction<T>(operation: (tx: EvaluationSqlExecutor) => Promise<T>): Promise<T>;
  audit(
    tx: EvaluationSqlExecutor,
    input: FascicoloAnalysisEvaluationArtifactInput,
  ): Promise<void>;
}

const defaultContext: FascicoloAnalysisEvaluationRepositoryContext = {
  transaction: (operation) => prisma.$transaction((tx) => operation({
    prismaTransaction: tx,
    query: async <T>(sql: string, params: readonly unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<T[]>(sql, ...params),
    }),
  })),
  audit: async (executor, input) => {
    if (!executor.prismaTransaction) throw new Error("EVALUATION_AUDIT_TRANSACTION_UNAVAILABLE");
    await createAuditLogInTransaction(executor.prismaTransaction, {
      azione: "FASCICOLO_ANALYSIS_EVALUATION_PERSISTED",
      entita: "FascicoloAnalysisEvaluationArtifact",
      entitaId: input.evaluationId,
      enteId: input.tenantId,
      esito: "SUCCESS",
      actor: {
        userId: null,
        userEmail: input.actorEmail,
        userRole: input.actorRole,
      },
      metadata: {
        actorId: input.actorId,
        procedimentoId: input.procedimentoId,
        jobId: input.jobId,
        authorizationRef: input.authorizationRef,
        testCaseId: input.testCaseId,
        corpusFingerprint: input.corpusFingerprint,
        inputFingerprint: input.inputFingerprint,
        outputFingerprint: input.outputFingerprint,
        maxCostAmount: input.maxCostAmount,
      },
    });
  },
};

export class FascicoloAnalysisEvaluationRepositoryError extends Error {
  constructor(readonly code: "EVALUATION_CONFLICT" | "EVALUATION_SCOPE_MISMATCH") {
    super(code);
    this.name = "FascicoloAnalysisEvaluationRepositoryError";
  }
}

interface ExistingEvaluation {
  evaluationId: string;
  tenantId: string;
  procedimentoId: string;
  jobId: string;
  inputFingerprint: string;
  outputFingerprint: string;
}

export async function persistFascicoloAnalysisEvaluationArtifact(
  input: FascicoloAnalysisEvaluationArtifactInput,
  context: FascicoloAnalysisEvaluationRepositoryContext = defaultContext,
): Promise<{ outcome: "CREATED" | "REUSED"; evaluationId: string }> {
  return context.transaction(async (tx) => {
    const authorizedScope = await tx.query<{ procedimentoId: string }>(`
      SELECT p."id" AS "procedimentoId"
      FROM "Procedimento" p
      INNER JOIN "AsyncJob" j ON j."id"=$3
      INNER JOIN "FascicoloAnalysisEvaluationPermit" permit ON permit."permitRef"=$4
      WHERE p."id"=$2 AND p."enteId"=$1
        AND j."tenantId"=$1 AND j."procedimentoId"=$2
        AND permit."evaluationId"=$5
        AND permit."tenantId"=$1 AND permit."procedimentoId"=$2
        AND permit."corpusFingerprint"=$6 AND permit."testCaseId"=$7
        AND permit."maxCostAmount"=$8::numeric
        AND permit."consumedByJobId"=$3 AND permit."consumedAt" IS NOT NULL
        AND permit."revokedAt" IS NULL
      FOR SHARE
    `, [
      input.tenantId,
      input.procedimentoId,
      input.jobId,
      input.authorizationRef,
      input.evaluationId,
      input.corpusFingerprint,
      input.testCaseId,
      input.maxCostAmount.toFixed(6),
    ]);
    if (authorizedScope.rows.length !== 1) {
      throw new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_SCOPE_MISMATCH");
    }
    const existing = await tx.query<ExistingEvaluation>(`
      SELECT "evaluationId","tenantId","procedimentoId","jobId","inputFingerprint","outputFingerprint"
      FROM "FascicoloAnalysisEvaluationArtifact"
      WHERE "evaluationId"=$1 OR "jobId"=$2
      FOR UPDATE
    `, [input.evaluationId, input.jobId]);
    if (existing.rows.length > 1) {
      throw new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_CONFLICT");
    }
    if (existing.rows.length === 1) {
      const artifact = existing.rows[0];
      if (artifact.tenantId !== input.tenantId || artifact.procedimentoId !== input.procedimentoId) {
        throw new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_SCOPE_MISMATCH");
      }
      if (artifact.evaluationId !== input.evaluationId
        || artifact.jobId !== input.jobId
        || artifact.inputFingerprint !== input.inputFingerprint
        || artifact.outputFingerprint !== input.outputFingerprint) {
        throw new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_CONFLICT");
      }
      return { outcome: "REUSED", evaluationId: artifact.evaluationId };
    }
    await tx.query(`
      INSERT INTO "FascicoloAnalysisEvaluationArtifact" (
        "evaluationId","tenantId","procedimentoId","jobId","authorizationRef","testCaseId",
        "corpusFingerprint","contractVersion","inputFingerprint","outputFingerprint",
        "providerOutput","provenance","comparison","maxCostAmount"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::numeric)
    `, [
      input.evaluationId,
      input.tenantId,
      input.procedimentoId,
      input.jobId,
      input.authorizationRef,
      input.testCaseId,
      input.corpusFingerprint,
      input.contractVersion,
      input.inputFingerprint,
      input.outputFingerprint,
      JSON.stringify(input.providerOutput),
      JSON.stringify(input.provenance),
      JSON.stringify(input.comparison),
      input.maxCostAmount.toFixed(6),
    ]);
    await context.audit(tx, input);
    return { outcome: "CREATED", evaluationId: input.evaluationId };
  });
}

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

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
      WHERE p."id"=$2 AND p."enteId"=$1
        AND j."tenantId"=$1 AND j."procedimentoId"=$2
      FOR SHARE
    `, [input.tenantId, input.procedimentoId, input.jobId]);
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

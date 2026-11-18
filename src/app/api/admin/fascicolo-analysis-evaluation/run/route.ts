import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { getAuthSession } from "@/lib/next-auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext } from "@/lib/tenant-auth";
import {
  runFascicoloAnalysisEvaluationJobById,
  type FascicoloAnalysisEvaluationDependencies,
} from "@/server/ai/fascicoloAnalysisEvaluation";
import {
  assertAuthorizedStagingFascicoloEvaluationEnvironment,
  assertStagingFascicoloEvaluationMutationRequest,
  createStagingFascicoloEvaluationAnalyze,
  runStagingFascicoloEvaluationOnce,
  STAGING_FASCICOLO_EVALUATION,
  STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE,
  stagingFascicoloEvaluationRunRequestSchema,
  StagingFascicoloEvaluationError,
  verifyStagingFascicoloEvaluationCsrfToken,
  type StagingFascicoloEvaluationExecution,
} from "@/server/ai/fascicoloAnalysisEvaluationStaging";
import { getFascicoloDocumentCorpusForTenant } from "@/server/queries/fascicolo-document-corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getMfaAuthenticatedUser() {
  const [session, user] = await Promise.all([getAuthSession(), getCurrentUser()]);
  if (!session?.user?.id
    || session.user.mfaEnrollmentRequired === true
    || !user
    || user.id !== session.user.id) {
    return null;
  }
  return user;
}

async function loadExecution(jobId: string): Promise<StagingFascicoloEvaluationExecution | null> {
  const rows = await prisma.$queryRaw<Array<StagingFascicoloEvaluationExecution & {
    maxCostAmountText: string;
    artifactCount: bigint;
    reservationCount: bigint;
  }>>`
    SELECT j."id" AS "jobId",j."status"::text,j."attemptCount",j."maxAttempts",
      j."tenantId",j."procedimentoId",j."operation",j."correlationId",j."policyDecisionRef",
      p."permitRef",p."evaluationId",p."corpusFingerprint",p."testCaseId",
      p."maxCostAmount"::text AS "maxCostAmountText",p."expiresAt",p."consumedByJobId",
      p."revokedAt",
      (SELECT COUNT(*) FROM "FascicoloAnalysisEvaluationArtifact" a
        WHERE a."evaluationId"=p."evaluationId") AS "artifactCount",
      (SELECT COUNT(*) FROM "RuntimeCostReservation" r
        WHERE r."jobId"=j."id") AS "reservationCount"
    FROM "AsyncJob" j
    INNER JOIN "FascicoloAnalysisEvaluationPermit" p
      ON p."permitRef"=j."policyDecisionRef"
    WHERE j."id"=${jobId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    maxCostAmount: Number(row.maxCostAmountText),
    artifactCount: Number(row.artifactCount),
    reservationCount: Number(row.reservationCount),
  };
}

async function hasBudgetHeadroom(input: {
  tenantId: string;
  procedimentoId: string;
  amount: number;
}): Promise<boolean> {
  const policies = await prisma.$queryRaw<Array<{
    scope: string;
    hardCapAmount: string;
    spentAmount: string;
  }>>`
    SELECT p."scope"::text,p."hardCapAmount"::text,
      COALESCE(SUM(
        CASE WHEN r."status"='SETTLED' THEN r."actualAmount" ELSE r."reservedAmount" END
      ),0)::text AS "spentAmount"
    FROM "RuntimeBudgetPolicy" p
    LEFT JOIN "RuntimeCostReservation" r
      ON r."currency"=p."currency"
      AND r."createdAt">=CURRENT_TIMESTAMP-(p."windowSeconds"*INTERVAL '1 second')
      AND r."status" IN ('RESERVED','SETTLED')
      AND (r."status"='SETTLED' OR r."expiresAt">CURRENT_TIMESTAMP)
      AND (
        p."scope"='GLOBAL'
        OR (p."scope"='TENANT' AND r."tenantId"=${input.tenantId})
        OR (p."scope"='PROCEDIMENTO'
          AND r."tenantId"=${input.tenantId}
          AND r."procedimentoId"=${input.procedimentoId})
      )
    WHERE p."enabled"=true
      AND p."currency"='EUR'
      AND p."effectiveFrom"<=CURRENT_TIMESTAMP
      AND (
        p."scope"='GLOBAL'
        OR (p."scope"='TENANT' AND p."tenantId"=${input.tenantId})
        OR (p."scope"='PROCEDIMENTO'
          AND p."tenantId"=${input.tenantId}
          AND p."procedimentoId"=${input.procedimentoId})
      )
    GROUP BY p."id",p."scope",p."hardCapAmount"
  `;
  const requiredScopes = ["GLOBAL", "TENANT", "PROCEDIMENTO"];
  return requiredScopes.every((scope) => policies.some((policy) => policy.scope === scope))
    && policies.every((policy) =>
      Number(policy.spentAmount) + input.amount <= Number(policy.hardCapAmount)
      && (policy.scope !== "PROCEDIMENTO" || Number(policy.hardCapAmount) === 1));
}

const dependencies = {
  getAuthenticatedUser: getMfaAuthenticatedUser,
  getCurrentTenantContext,
  loadExecution,
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  hasBudgetHeadroom,
  runJob(input: {
    jobId: string;
    analyze: FascicoloAnalysisEvaluationDependencies["analyze"];
  }) {
    return runFascicoloAnalysisEvaluationJobById({
      jobId: input.jobId,
      dependencies: { analyze: input.analyze },
    });
  },
  now: () => new Date(),
};

export async function POST(request: Request): Promise<Response> {
  try {
    assertAuthorizedStagingFascicoloEvaluationEnvironment();
  } catch {
    return json({ error: "NOT_FOUND" }, 404);
  }
  try {
    assertStagingFascicoloEvaluationMutationRequest(request);
  } catch {
    return json({ error: "UNTRUSTED_REQUEST" }, 403);
  }
  const actor = await getMfaAuthenticatedUser();
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
  if (actor.role !== "ADMIN") return json({ error: "FORBIDDEN" }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const input = stagingFascicoloEvaluationRunRequestSchema.safeParse(body);
  if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return json({ error: "AUTH_CONFIGURATION_INVALID" }, 503);
  if (process.env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED?.trim().toLowerCase() === "true") {
    return json({ error: "AUTOMATIC_RESEARCH_NOT_DISABLED" }, 503);
  }
  const cookieStore = await cookies();
  try {
    if (request.headers.get("x-csrf-token") !== input.data.csrfToken) {
      throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
    }
    verifyStagingFascicoloEvaluationCsrfToken({
      actorId: actor.id,
      secret,
      headerToken: input.data.csrfToken,
      cookieToken: cookieStore.get(STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE)?.value ?? null,
    });
    const analyze = createStagingFascicoloEvaluationAnalyze();
    const result = await runStagingFascicoloEvaluationOnce({
      jobId: input.data.jobId,
      analyze,
      dependencies,
    });
    return json({
      jobId: input.data.jobId,
      outcome: result.outcome,
    }, 200);
  } catch (error) {
    if (error instanceof StagingFascicoloEvaluationError) {
      const status = error.code.includes("AUTHENTICATION") ? 401
        : error.code.includes("ADMIN") || error.code.includes("TENANT") ? 403
          : error.code.includes("ENVIRONMENT") ? 404
            : error.code.includes("CONFIGURATION") || error.code.includes("TIMEOUT") ? 503
              : 409;
      return json({ error: error.code }, status);
    }
    console.error({ event: "staging_fascicolo_evaluation_run_failed" });
    return json({ error: "EVALUATION_RUN_FAILED" }, 500);
  } finally {
    cookieStore.delete(STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE);
  }
}

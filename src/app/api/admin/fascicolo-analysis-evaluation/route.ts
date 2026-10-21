import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  admitFascicoloAnalysisEvaluation,
  authorizeFascicoloAnalysisEvaluation,
} from "@/server/ai/fascicoloAnalysisEvaluation";
import type { FascicoloAnalysisEvaluationPermit } from "@/server/ai/fascicoloAnalysisEvaluationRepository";
import {
  assertAuthorizedStagingFascicoloEvaluationEnvironment,
  assertStagingFascicoloEvaluationMutationRequest,
  authorizeAndAdmitStagingFascicoloEvaluation,
  createStagingFascicoloEvaluationCsrfToken,
  STAGING_FASCICOLO_EVALUATION,
  STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE,
  stagingFascicoloEvaluationRequestSchema,
  StagingFascicoloEvaluationError,
  verifyStagingFascicoloEvaluationCsrfToken,
} from "@/server/ai/fascicoloAnalysisEvaluationStaging";
import { getFascicoloDocumentCorpusForTenant } from "@/server/queries/fascicolo-document-corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function environmentAvailable(): boolean {
  try {
    assertAuthorizedStagingFascicoloEvaluationEnvironment();
    return true;
  } catch {
    return false;
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

function permit(row: PermitRow | undefined): FascicoloAnalysisEvaluationPermit | null {
  if (!row) return null;
  return {
    ...row,
    maxCostAmount: Number(row.maxCostAmount),
  };
}

const dependencies = {
  getCurrentUser,
  getCurrentTenantContext,
  loadCorpus: getFascicoloDocumentCorpusForTenant,
  async loadPermitByEvaluationId(evaluationId: string) {
    const rows = await prisma.$queryRaw<PermitRow[]>`
      SELECT "permitRef","evaluationId","tenantId","procedimentoId","corpusFingerprint",
        "operation","testCaseId","maxCostAmount"::text,"authorizedByUserId","expiresAt",
        "consumedByJobId","consumedAt","revokedAt"
      FROM "FascicoloAnalysisEvaluationPermit"
      WHERE "evaluationId"=${evaluationId}
    `;
    return permit(rows[0]);
  },
  loadJob(jobId: string) {
    return prisma.asyncJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        operation: true,
        tenantId: true,
        procedimentoId: true,
        correlationId: true,
      },
    });
  },
  authorize: authorizeFascicoloAnalysisEvaluation,
  admit: admitFascicoloAnalysisEvaluation,
  now: () => new Date(),
};

export async function GET(): Promise<Response> {
  if (!environmentAvailable()) return json({ error: "NOT_FOUND" }, 404);
  const actor = await getCurrentUser();
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
  if (actor.role !== "ADMIN") return json({ error: "FORBIDDEN" }, 403);
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return json({ error: "AUTH_REQUIRED" }, 401);
  try {
    requireTenantAccess(tenantContext, STAGING_FASCICOLO_EVALUATION.tenantId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  } catch {
    return json({ error: "FORBIDDEN" }, 403);
  }
  const corpus = await getFascicoloDocumentCorpusForTenant({
    tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
    procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
  });
  if (!corpus
    || corpus.tenantId !== STAGING_FASCICOLO_EVALUATION.tenantId
    || corpus.procedimentoId !== STAGING_FASCICOLO_EVALUATION.procedimentoId
    || corpus.availability !== "READY"
    || corpus.documentCount !== 8
    || corpus.availableDocumentCount !== 8
    || corpus.corpusFingerprint !== STAGING_FASCICOLO_EVALUATION.corpusFingerprint) {
    return json({ error: "CORPUS_NOT_READY" }, 409);
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return json({ error: "AUTH_CONFIGURATION_INVALID" }, 503);
  const csrfToken = createStagingFascicoloEvaluationCsrfToken({
    actorId: actor.id,
    secret,
  });
  const cookieStore = await cookies();
  cookieStore.set(STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE, csrfToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/",
    maxAge: 10 * 60,
  });
  const existingRows = await prisma.$queryRaw<Array<{
    consumedByJobId: string | null;
    expiresAt: Date;
  }>>`
    SELECT "consumedByJobId","expiresAt"
    FROM "FascicoloAnalysisEvaluationPermit"
    WHERE "evaluationId"=${STAGING_FASCICOLO_EVALUATION.evaluationId}
  `;
  const existing = existingRows[0];
  return json({
    csrfToken,
    evaluation: {
      evaluationId: STAGING_FASCICOLO_EVALUATION.evaluationId,
      tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
      procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
      corpusFingerprint: STAGING_FASCICOLO_EVALUATION.corpusFingerprint,
      documentCount: corpus.documentCount,
      maxCostAmount: 0.5,
    },
    state: existing
      ? {
          status: existing.consumedByJobId ? "ADMITTED" : "AUTHORIZED",
          jobId: existing.consumedByJobId,
          expiresAt: existing.expiresAt.toISOString(),
        }
      : { status: "READY", jobId: null, expiresAt: null },
  }, 200);
}

export async function POST(request: Request): Promise<Response> {
  if (!environmentAvailable()) return json({ error: "NOT_FOUND" }, 404);
  try {
    assertStagingFascicoloEvaluationMutationRequest(request);
  } catch {
    return json({ error: "UNTRUSTED_REQUEST" }, 403);
  }
  const actor = await getCurrentUser();
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
  if (actor.role !== "ADMIN") return json({ error: "FORBIDDEN" }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const input = stagingFascicoloEvaluationRequestSchema.safeParse(body);
  if (!input.success) return json({ error: "INVALID_REQUEST" }, 400);
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return json({ error: "AUTH_CONFIGURATION_INVALID" }, 503);
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
    const result = await authorizeAndAdmitStagingFascicoloEvaluation({
      dependencies,
    });
    return json({
      ...result,
      providerExecuted: false,
    }, result.admissionOutcome === "CREATED" ? 201 : 200);
  } catch (error) {
    if (error instanceof StagingFascicoloEvaluationError) {
      const status = error.code.includes("AUTHENTICATION") ? 401
        : error.code.includes("ADMIN") || error.code.includes("TENANT") ? 403
          : error.code.includes("CORPUS") || error.code.includes("CONFLICT") ? 409
            : error.code.includes("ENVIRONMENT") ? 404
              : 400;
      return json({ error: error.code }, status);
    }
    console.error({ event: "staging_fascicolo_evaluation_admission_failed" });
    return json({ error: "EVALUATION_ADMISSION_FAILED" }, 500);
  } finally {
    cookieStore.delete(STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE);
  }
}

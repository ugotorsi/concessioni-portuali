import { NextResponse } from "next/server";
import { z } from "zod";

import { canValidateReport } from "@/lib/auth";
import {
  canReadTenantResource,
  canWriteTenantResource,
  getCurrentTenantContext,
} from "@/lib/tenant-auth";
import {
  listResearchQuestionResultsForReview,
  reviewResearchQuestionResult,
} from "@/server/legal-research/question-results";

const missionIdSchema = z.string().trim().min(1).max(96);
const resultIdSchema = z.string().trim().min(1).max(96);
const reviewSchema = z.object({
  missionId: missionIdSchema,
  resultId: resultIdSchema,
  direction: z.enum(["SUPPORTS", "OPPOSES", "NEUTRAL"]),
  rationale: z.string().trim().min(20).max(2_000),
}).strict();

export type QuestionResultReviewRouteDependencies = Readonly<{
  getCurrentTenantContext: typeof getCurrentTenantContext;
  listResearchQuestionResultsForReview: typeof listResearchQuestionResultsForReview;
  reviewResearchQuestionResult: typeof reviewResearchQuestionResult;
}>;

const defaultDependencies: QuestionResultReviewRouteDependencies = {
  getCurrentTenantContext,
  listResearchQuestionResultsForReview,
  reviewResearchQuestionResult,
};

function jsonError(error: string, status: number): Response {
  return NextResponse.json({ error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorizedTenant(
  mode: "read" | "write",
  dependencies: QuestionResultReviewRouteDependencies,
): Promise<{ tenantId: string } | { response: Response }> {
  const context = await dependencies.getCurrentTenantContext();
  if (!context) return { response: jsonError("AUTH_REQUIRED", 401) };
  if (!canValidateReport(context.role) || !context.defaultTenantId) {
    return { response: jsonError("FORBIDDEN", 403) };
  }
  const allowed = mode === "write"
    ? canWriteTenantResource(context, context.defaultTenantId, { allowWhenEnteMissing: false })
    : canReadTenantResource(context, context.defaultTenantId, { allowWhenEnteMissing: false });
  return allowed
    ? { tenantId: context.defaultTenantId }
    : { response: jsonError("FORBIDDEN", 403) };
}

async function getHandler(
  request: Request,
  dependencies: QuestionResultReviewRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedTenant("read", dependencies);
  if ("response" in authorization) return authorization.response;
  const missionId = missionIdSchema.safeParse(new URL(request.url).searchParams.get("missionId"));
  if (!missionId.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const results = await dependencies.listResearchQuestionResultsForReview({
      missionId: missionId.data,
      tenantId: authorization.tenantId,
    });
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("QUESTION_RESULT_REVIEW_UNAVAILABLE", 500);
  }
}

async function postHandler(
  request: Request,
  dependencies: QuestionResultReviewRouteDependencies,
): Promise<Response> {
  const authorization = await authorizedTenant("write", dependencies);
  if ("response" in authorization) return authorization.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_REQUEST", 400);
  }
  const input = reviewSchema.safeParse(body);
  if (!input.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const reviewed = await dependencies.reviewResearchQuestionResult({
      resultId: input.data.resultId,
      tenantId: authorization.tenantId,
      missionId: input.data.missionId,
      direction: input.data.direction,
      reviewStatus: "HUMAN_CONFIRMED",
      confidence: null,
      rationale: input.data.rationale,
    });
    const [result] = await dependencies.listResearchQuestionResultsForReview({
      missionId: input.data.missionId,
      tenantId: authorization.tenantId,
    }).then((results) => results.filter((item) => item.resultId === reviewed.id));
    if (!result) return jsonError("QUESTION_RESULT_REVIEW_UNAVAILABLE", 500);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "RESEARCH_QUESTION_RESULT_NOT_FOUND") {
      return jsonError("NOT_FOUND", 404);
    }
    if (error instanceof Error && error.message === "INVALID_CLASSIFICATION_RATIONALE") {
      return jsonError("INVALID_REQUEST", 400);
    }
    return jsonError("QUESTION_RESULT_REVIEW_UNAVAILABLE", 500);
  }
}

export function createQuestionResultReviewRouteHandlers(
  dependencies: QuestionResultReviewRouteDependencies = defaultDependencies,
) {
  return {
    GET: (request: Request) => getHandler(request, dependencies),
    POST: (request: Request) => postHandler(request, dependencies),
  };
}

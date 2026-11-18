import { isTrustedJsonMutation, untrustedMutationResponse } from "@/lib/request-security";
import { createQuestionResultReviewRouteHandlers } from "@/server/legal-research/question-result-review-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createQuestionResultReviewRouteHandlers();

export const GET = handlers.GET;

export async function POST(request: Request) {
  return isTrustedJsonMutation(request) ? handlers.POST(request) : untrustedMutationResponse();
}

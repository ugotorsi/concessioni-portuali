import { createAssistedVerificationRouteHandlers } from "@/server/legal-research/assisted-verification-route";
import { isTrustedJsonMutation, untrustedMutationResponse } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createAssistedVerificationRouteHandlers();

export const GET = handlers.GET;

export async function PUT(request: Request) {
	return isTrustedJsonMutation(request) ? handlers.PUT(request) : untrustedMutationResponse();
}

export async function PATCH(request: Request) {
	return isTrustedJsonMutation(request) ? handlers.PATCH(request) : untrustedMutationResponse();
}

export async function POST(request: Request) {
	return isTrustedJsonMutation(request) ? handlers.POST(request) : untrustedMutationResponse();
}

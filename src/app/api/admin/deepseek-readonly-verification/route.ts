import { requireAdminWithMfa } from "@/lib/auth";
import { verifyAiProviderConnection } from "@/server/ai/providerConnection";
import {
  assertDeepSeekReadOnlyVerificationRequest,
  DEEPSEEK_READONLY_VERIFICATION_PATH,
  isTrustedDeepSeekReadOnlyVerificationMutation,
} from "@/server/ai/deepSeekReadOnlyVerificationDeployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertDeepSeekReadOnlyVerificationRequest({
      env: process.env,
      requestHost: request.headers.get("x-forwarded-host")
        ?? request.headers.get("host"),
    });
  } catch {
    return response({ error: "NOT_FOUND" }, 404);
  }
  if (!isTrustedDeepSeekReadOnlyVerificationMutation({
    env: process.env,
    request,
  })) {
    return response({ error: "UNTRUSTED_REQUEST" }, 403);
  }
  let currentUser;
  try {
    currentUser = await requireAdminWithMfa();
  } catch (error) {
    if (error instanceof Error && [
      "AUTHENTICATION_REQUIRED",
      "ADMIN_REQUIRED",
      "MFA_VERIFICATION_REQUIRED",
    ].includes(error.message)) {
      return response({ error: "AUTH_REQUIRED" }, 401);
    }
    throw error;
  }
  const formData = await request.formData();
  if (formData.get("confirmation") !== "VERIFY_DEEPSEEK_READONLY") {
    return response({ error: "INVALID_CONFIRMATION" }, 400);
  }
  await verifyAiProviderConnection({
    provider: "DEEPSEEK",
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: "ADMIN",
    },
  });
  return Response.redirect(
    new URL(DEEPSEEK_READONLY_VERIFICATION_PATH, request.url),
    303,
  );
}

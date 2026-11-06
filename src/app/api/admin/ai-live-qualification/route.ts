import { cookies } from "next/headers";

import { requireAdminWithMfa } from "@/lib/auth";
import {
  liveQualificationPreflight,
  runLiveSyntheticQualification,
} from "@/server/ai/qualification/liveSyntheticQualification";
import {
  assertLiveQualificationEnvironment,
  assertLiveQualificationMutationRequest,
  createLiveQualificationCsrfToken,
  LIVE_QUALIFICATION_CSRF_COOKIE,
  liveQualificationRunRequestSchema,
  LiveQualificationSecurityError,
  verifyLiveQualificationCsrfToken,
} from "@/server/ai/qualification/liveSyntheticQualificationSecurity";
import {
  liveQualificationDeploymentHost,
} from "@/server/ai/qualification/liveSyntheticQualificationDeployment";
import {
  createLiveQualificationRunStore,
} from "@/server/ai/qualification/liveSyntheticQualificationStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function storeFromEnvironment() {
  return createLiveQualificationRunStore({
    url:
      process.env.NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_URL ?? "",
    token:
      process.env.NOETRA_LIVE_QUALIFICATION_REDIS_KV_REST_API_TOKEN ?? "",
  });
}

function environmentAvailable(request: Request): boolean {
  try {
    assertLiveQualificationEnvironment({
      requestHost: request.headers.get("host"),
    });
    return true;
  } catch (error) {
    if (error instanceof LiveQualificationSecurityError) {
      console.error("LIVE_QUALIFICATION_ENVIRONMENT_REJECTED", {
        check: error.environmentCheck ?? "UNKNOWN",
      });
      return false;
    }
    throw error;
  }
}

async function adminWithMfa() {
  try {
    return await requireAdminWithMfa();
  } catch (error) {
    if (error instanceof Error && [
      "AUTHENTICATION_REQUIRED",
      "ADMIN_REQUIRED",
      "MFA_VERIFICATION_REQUIRED",
    ].includes(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!environmentAvailable(request)) return json({ error: "NOT_FOUND" }, 404);
  const actor = await adminWithMfa();
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
  const secret = process.env.NEXTAUTH_SECRET;
  const deploymentHost = liveQualificationDeploymentHost(process.env);
  if (!secret || !deploymentHost) {
    return json({ error: "CONFIGURATION_INVALID" }, 503);
  }
  try {
    const state = await storeFromEnvironment().read();
    const csrfToken = createLiveQualificationCsrfToken({
      actorId: actor.id,
      deploymentHost,
      secret,
    });
    const cookieStore = await cookies();
    cookieStore.set(LIVE_QUALIFICATION_CSRF_COOKIE, csrfToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/",
      maxAge: 10 * 60,
    });
    return json({
      authorizationId: "GH_ISSUE_70_2026_11_05",
      syntheticCase: "SYN-001",
      authentication: {
        databaseScope: "SHARED_PRODUCTION_DATABASE",
        mfaEnrollmentAllowed: false,
        reads: [
          "User credentials and MFA state during login",
          "User active, role, lock, MFA and password version during session validation",
        ],
        writes: [
          "User login counters and lastLoginAt",
          "ActivityLog authentication events",
        ],
      },
      coordinationStore: {
        scope: "DEDICATED_ISSUE_70_UPSTASH_RESOURCE",
        resourceId:
          process.env.NOETRA_LIVE_QUALIFICATION_REDIS_RESOURCE_ID ?? null,
        sharedWithProductionRateLimit: false,
      },
      preflight: liveQualificationPreflight(),
      state,
      csrfToken,
    }, 200);
  } catch {
    return json({ error: "QUALIFICATION_STORE_UNAVAILABLE" }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!environmentAvailable(request)) return json({ error: "NOT_FOUND" }, 404);
  try {
    assertLiveQualificationMutationRequest(request);
  } catch {
    return json({ error: "UNTRUSTED_REQUEST" }, 403);
  }
  const actor = await adminWithMfa();
  if (!actor) return json({ error: "AUTH_REQUIRED" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_REQUEST" }, 400);
  }
  const parsed = liveQualificationRunRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "INVALID_REQUEST" }, 400);
  const secret = process.env.NEXTAUTH_SECRET;
  const deploymentHost = liveQualificationDeploymentHost(process.env);
  if (!secret || !deploymentHost) {
    return json({ error: "CONFIGURATION_INVALID" }, 503);
  }
  const cookieStore = await cookies();
  try {
    if (request.headers.get("x-csrf-token") !== parsed.data.csrfToken) {
      throw new LiveQualificationSecurityError(
        "LIVE_QUALIFICATION_CSRF_INVALID",
      );
    }
    verifyLiveQualificationCsrfToken({
      actorId: actor.id,
      deploymentHost,
      secret,
      headerToken: parsed.data.csrfToken,
      cookieToken: cookieStore.get(LIVE_QUALIFICATION_CSRF_COOKIE)?.value ?? null,
    });
    const result = await runLiveSyntheticQualification({
      environment: {
        AI_ANTHROPIC_API_KEY: process.env.AI_ANTHROPIC_API_KEY,
        AI_DEEPSEEK_API_KEY: process.env.AI_DEEPSEEK_API_KEY,
      },
      store: storeFromEnvironment(),
    });
    return json(result, 200);
  } catch (error) {
    if (error instanceof LiveQualificationSecurityError) {
      return json({ error: error.code }, 403);
    }
    if (error instanceof Error
      && error.message === "LIVE_QUALIFICATION_ALREADY_RESERVED") {
      return json({ error: error.message }, 409);
    }
    if (error instanceof Error && /^LIVE_QUALIFICATION_[A-Z0-9_]+$/
      .test(error.message)) {
      return json({ error: error.message }, 503);
    }
    return json({ error: "LIVE_QUALIFICATION_FAILED" }, 503);
  } finally {
    cookieStore.delete(LIVE_QUALIFICATION_CSRF_COOKIE);
  }
}

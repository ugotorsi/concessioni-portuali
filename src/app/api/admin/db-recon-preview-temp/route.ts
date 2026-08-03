import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

import { getAuthSession } from "@/lib/next-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  EXPECTED_BRANCH,
  EXPECTED_PREVIEW_ENV,
  ReconConfigError,
  ReconTimeoutError,
  runDbReconPreviewTemp,
} from "@/server/db-recon-preview-temp";

export const runtime = "nodejs";

const RECON_ACTION = "DB_RECON_PREVIEW_TEMP_ACCESS";
const RECON_ENTITY = "AdminDbReconPreviewTemp";
const TEMP_TOKEN_HEADER = "x-db-recon-token";
type ReconAuthMethod = "session" | "temporary-token";

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

function getCommitShaShort(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null;
  if (!sha || sha.length < 7) {
    return null;
  }

  return sha.slice(0, 12);
}

function getAuditMetadata(
  result: string,
  environment: string | null,
  branch: string | null,
  authMethod?: ReconAuthMethod,
) {
  const metadata: {
    route: string;
    environment: string | null;
    branch: string | null;
    commit: string | null;
    result: string;
    authMethod?: ReconAuthMethod;
  } = {
    route: "/api/admin/db-recon-preview-temp",
    environment,
    branch,
    commit: getCommitShaShort(),
    result,
  };

  if (authMethod) {
    metadata.authMethod = authMethod;
  }

  return metadata;
}

async function auditRouteSuccess(
  user: { id?: string; email?: string | null; role?: string | null },
  environment: string | null,
  branch: string | null,
  authMethod: ReconAuthMethod,
) {
  await auditSuccess({
    azione: RECON_ACTION,
    entita: RECON_ENTITY,
    actor: {
      userId: user.id ?? null,
      userEmail: user.email ?? null,
      userRole: user.role ?? null,
    },
    metadata: getAuditMetadata("SUCCESS", environment, branch, authMethod),
  }).catch(() => undefined);
}

async function auditRouteFailure(
  result: string,
  user: { id?: string; email?: string | null; role?: string | null } | null,
  environment: string | null,
  branch: string | null,
  authMethod?: ReconAuthMethod,
) {
  await auditFailure({
    azione: RECON_ACTION,
    entita: RECON_ENTITY,
    actor: {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      userRole: user?.role ?? null,
    },
    metadata: getAuditMetadata(result, environment, branch, authMethod),
  }).catch(() => undefined);
}

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimeTokenMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digestToken(provided), digestToken(expected));
}

export async function GET(request: Request) {
  const environment = process.env.VERCEL_ENV ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  if (environment !== EXPECTED_PREVIEW_ENV) {
    await auditRouteFailure("FORBIDDEN_ENVIRONMENT", null, environment, branch);
    return forbidden("Endpoint available only in preview environment.");
  }

  // Intentional behavior: PR preview deployments run with their PR branch ref,
  // so this endpoint remains unavailable until code is merged into staging-operativo.
  if (branch !== EXPECTED_BRANCH) {
    await auditRouteFailure("FORBIDDEN_BRANCH", null, environment, branch);
    return forbidden("Endpoint available only on staging-operativo branch.");
  }

  const session = await getAuthSession();
  const sessionUser = session?.user;
  const role = typeof sessionUser?.role === "string" ? sessionUser.role : null;
  const hasRealAdminSession = Boolean(sessionUser?.id && sessionUser.email && role === "ADMIN");

  let authMethod: ReconAuthMethod | null = null;
  if (hasRealAdminSession) {
    authMethod = "session";
  } else {
    const expectedToken = process.env.DB_RECON_TEMP_TOKEN;
    const providedToken = request.headers.get(TEMP_TOKEN_HEADER);

    if (expectedToken === undefined || expectedToken.trim().length === 0) {
      await auditRouteFailure(
        "UNAUTHENTICATED",
        sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
        environment,
        branch,
        "temporary-token",
      );
      return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    if (!providedToken || !constantTimeTokenMatch(providedToken, expectedToken)) {
      await auditRouteFailure(
        "UNAUTHENTICATED",
        sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
        environment,
        branch,
        "temporary-token",
      );
      return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    authMethod = "temporary-token";
  }

  if (!authMethod) {
    await auditRouteFailure(
      "UNAUTHENTICATED",
      sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
      environment,
      branch,
    );
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const recon = await runDbReconPreviewTemp();
    await auditRouteSuccess(
      { id: sessionUser?.id, email: sessionUser?.email, role },
      environment,
      branch,
      authMethod,
    );

    return NextResponse.json(
      {
        ...recon,
        environment,
        branch,
        commit: getCommitShaShort(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof ReconConfigError) {
      await auditRouteFailure(
        "CONFIG_ERROR",
        sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
        environment,
        branch,
        authMethod,
      );
      return NextResponse.json(
        { error: "Runtime configuration for DB recon is invalid." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error instanceof ReconTimeoutError) {
      await auditRouteFailure(
        "TIMEOUT",
        sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
        environment,
        branch,
        authMethod,
      );
      return NextResponse.json(
        { error: "DB recon timeout." },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    await auditRouteFailure(
      "DB_ERROR",
      sessionUser ? { id: sessionUser.id, email: sessionUser.email, role } : null,
      environment,
      branch,
      authMethod,
    );

    return NextResponse.json(
      { error: "DB recon failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
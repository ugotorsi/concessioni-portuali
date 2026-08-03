import { NextResponse } from "next/server";

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

function getAuditMetadata(result: string, environment: string | null, branch: string | null) {
  return {
    route: "/api/admin/db-recon-preview-temp",
    environment,
    branch,
    commit: getCommitShaShort(),
    result,
  };
}

async function auditRouteSuccess(user: { id?: string; email?: string | null; role?: string | null }, environment: string | null, branch: string | null) {
  await auditSuccess({
    azione: RECON_ACTION,
    entita: RECON_ENTITY,
    actor: {
      userId: user.id ?? null,
      userEmail: user.email ?? null,
      userRole: user.role ?? null,
    },
    metadata: getAuditMetadata("SUCCESS", environment, branch),
  }).catch(() => undefined);
}

async function auditRouteFailure(
  result: string,
  user: { id?: string; email?: string | null; role?: string | null } | null,
  environment: string | null,
  branch: string | null,
) {
  await auditFailure({
    azione: RECON_ACTION,
    entita: RECON_ENTITY,
    actor: {
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      userRole: user?.role ?? null,
    },
    metadata: getAuditMetadata(result, environment, branch),
  }).catch(() => undefined);
}

export async function GET() {
  const session = await getAuthSession();
  const environment = process.env.VERCEL_ENV ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  if (!session?.user?.id || !session.user.email) {
    await auditRouteFailure("UNAUTHENTICATED", null, environment, branch);
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const role = typeof session.user.role === "string" ? session.user.role : null;

  if (role !== "ADMIN") {
    await auditRouteFailure(
      "FORBIDDEN_ROLE",
      { id: session.user.id, email: session.user.email, role },
      environment,
      branch,
    );
    return forbidden("Forbidden.");
  }

  if (environment !== EXPECTED_PREVIEW_ENV) {
    await auditRouteFailure(
      "FORBIDDEN_ENVIRONMENT",
      { id: session.user.id, email: session.user.email, role },
      environment,
      branch,
    );
    return forbidden("Endpoint available only in preview environment.");
  }

  // Intentional behavior: PR preview deployments run with their PR branch ref,
  // so this endpoint remains unavailable until code is merged into staging-operativo.
  if (branch !== EXPECTED_BRANCH) {
    await auditRouteFailure(
      "FORBIDDEN_BRANCH",
      { id: session.user.id, email: session.user.email, role },
      environment,
      branch,
    );
    return forbidden("Endpoint available only on staging-operativo branch.");
  }

  try {
    const recon = await runDbReconPreviewTemp();
    await auditRouteSuccess(
      { id: session.user.id, email: session.user.email, role },
      environment,
      branch,
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
        { id: session.user.id, email: session.user.email, role },
        environment,
        branch,
      );
      return NextResponse.json(
        { error: "Runtime configuration for DB recon is invalid." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error instanceof ReconTimeoutError) {
      await auditRouteFailure(
        "TIMEOUT",
        { id: session.user.id, email: session.user.email, role },
        environment,
        branch,
      );
      return NextResponse.json(
        { error: "DB recon timeout." },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    await auditRouteFailure(
      "DB_ERROR",
      { id: session.user.id, email: session.user.email, role },
      environment,
      branch,
    );

    return NextResponse.json(
      { error: "DB recon failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
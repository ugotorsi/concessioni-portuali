import { NextResponse } from "next/server";

import { getCurrentRole } from "@/lib/auth";
import {
  EXPECTED_BRANCH,
  EXPECTED_PREVIEW_ENV,
  ReconConfigError,
  ReconTimeoutError,
  runDbReconPreviewTemp,
} from "@/server/db-recon-preview-temp";

export const runtime = "nodejs";

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

export async function GET() {
  const role = await getCurrentRole();
  if (!role) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  if (role !== "ADMIN") {
    return forbidden("Forbidden.");
  }

  const environment = process.env.VERCEL_ENV ?? null;
  if (environment !== EXPECTED_PREVIEW_ENV) {
    return forbidden("Endpoint available only in preview environment.");
  }

  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;
  if (branch !== EXPECTED_BRANCH) {
    return forbidden("Endpoint available only on staging-operativo branch.");
  }

  try {
    const recon = await runDbReconPreviewTemp();

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
      return NextResponse.json(
        { error: "Runtime configuration for DB recon is invalid." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (error instanceof ReconTimeoutError) {
      return NextResponse.json(
        { error: "DB recon timeout." },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { error: "DB recon failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
import { NextRequest, NextResponse } from "next/server";

import { canViewNormativa, getCurrentRole } from "@/lib/auth";
import { getLegalSources } from "@/server/legal-rules/queries";

function parsePositiveInt(input: string | null, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const role = await getCurrentRole();
  if (!role) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canViewNormativa(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(url.searchParams.get("pageSize"), 20);

  const result = await getLegalSources({
    page,
    pageSize,
    search: url.searchParams.get("search") ?? undefined,
    sourceType: url.searchParams.get("sourceType") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  return NextResponse.json(result);
}

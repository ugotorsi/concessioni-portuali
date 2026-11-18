import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/next-auth";
import { getRuntimeHealthSnapshot } from "@/server/runtime/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });
  }
  try {
    const snapshot = await getRuntimeHealthSnapshot();
    return NextResponse.json(snapshot, {
      status: snapshot.status === "HEALTHY" ? 200 : 503,
      headers: NO_STORE,
    });
  } catch (error) {
    console.error({
      event: "runtime_health_query_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({
      status: "DEGRADED",
      databaseConnected: false,
      error: "Runtime health unavailable.",
    }, { status: 503, headers: NO_STORE });
  }
}
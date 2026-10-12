import { NextResponse } from "next/server";

import { isTrustedJsonMutation, untrustedMutationResponse } from "@/lib/request-security";
import { completeDirectDocumentUpload } from "@/server/documents/directUploadService";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedJsonMutation(request)) return untrustedMutationResponse();
  try {
    const result = await completeDirectDocumentUpload(await request.json());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossibile confermare l'upload." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

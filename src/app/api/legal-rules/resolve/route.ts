import { NextResponse } from "next/server";
import { z } from "zod";

import { canViewNormativa, getCurrentRole } from "@/lib/auth";
import { resolveApplicableLegalRules } from "@/server/legal-rules/orchestrator";

const inputSchema = z.object({
  enteId: z.string().optional().nullable(),
  portCode: z.string().optional(),
  concessionVertical: z.string().optional(),
  concessionObjectType: z.string().optional(),
  attivita: z.string().optional(),
  awardingProcedureType: z.string().optional(),
  feeRegime: z.string().optional(),
  comparativeProcedureStatus: z.string().optional(),
  rilevanzaArt47: z.boolean().optional(),
  letteraArt47: z.string().optional(),
  hasMorosita: z.boolean().optional(),
  polizzaValida: z.boolean().optional(),
});

export async function POST(request: Request) {
  const role = await getCurrentRole();
  if (!role) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (!canViewNormativa(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation error.",
        details: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  const result = await resolveApplicableLegalRules(parsed.data);
  return NextResponse.json(result);
}

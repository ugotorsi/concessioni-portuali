import { NextResponse } from "next/server";
import { z } from "zod";

import { canViewNormativa, getCurrentRole } from "@/lib/auth";
import { OrchestrationInputError, resolveApplicableLegalRules } from "@/server/legal-rules/orchestrator";

const inputSchema = z.object({
  enteId: z.string().optional().nullable(),
  referenceDate: z.string().date().optional(),
  authorityKey: z.string().min(2).optional(),
  authorityId: z.string().min(3).optional(),
  portKey: z.string().min(2).optional(),
  portId: z.string().min(3).optional(),
  portArea: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  institution: z.string().min(1).optional(),
  procedureType: z.string().min(1).optional(),
  titleType: z.string().min(1).optional(),
  includeHistorical: z.boolean().optional(),
  includePending: z.boolean().optional(),
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
}).superRefine((value, ctx) => {
  if (value.portKey && !value.authorityKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "authorityKey is required when portKey is provided.",
      path: ["authorityKey"],
    });
  }
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

  try {
    const result = await resolveApplicableLegalRules(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OrchestrationInputError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: "Unable to resolve legal sources." }, { status: 500 });
  }
}

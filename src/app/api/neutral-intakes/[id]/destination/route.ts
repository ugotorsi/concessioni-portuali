import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  establishNeutralIntakeDestination,
  NeutralIntakeDestinationConflictError,
  NeutralIntakeDestinationHandoffError,
} from "@/server/intake/neutralIntakeDestination";
import { NeutralIntakeHandoffConflictError } from "@/server/intake/classification/handoff";

export const runtime = "nodejs";

const identifier = z.string().trim().min(1).max(256);
const inputSchema = z.object({ procedimentoId: identifier }).strict();
const authoritySource = "HUMAN_REVIEW_ASSIGNMENT" as const;

function jsonError(error: string, status: number, retryable?: boolean) {
  return NextResponse.json(
    retryable === undefined ? { error } : { error, retryable },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  if (!canManageProcedimenti(user.role)) return jsonError("Forbidden.", 403);

  const neutralIntakeId = identifier.safeParse((await context.params).id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request.", 400);
  }
  const input = inputSchema.safeParse(body);
  if (!neutralIntakeId.success || !input.success) return jsonError("Invalid request.", 400);

  const [tenantContext, intake, procedimento] = await Promise.all([
    getCurrentTenantContext(),
    prisma.neutralIntake.findUnique({
      where: { id: neutralIntakeId.data },
      select: { id: true, enteId: true },
    }),
    prisma.procedimento.findUnique({
      where: { id: input.data.procedimentoId },
      select: { id: true, concessione: { select: { id: true, enteId: true } } },
    }),
  ]);
  if (!intake || !procedimento) return jsonError("Reference not found.", 404);

  const procedimentoEnteId = procedimento.concessione.enteId;
  try {
    if (!tenantContext || tenantContext.userId !== user.id) throw new Error("Tenant context unavailable.");
    requireTenantAccess(tenantContext, intake.enteId, { mode: "write", allowWhenEnteMissing: false });
    requireTenantAccess(tenantContext, procedimentoEnteId, { mode: "write", allowWhenEnteMissing: false });
    if (!intake.enteId || intake.enteId !== procedimentoEnteId) throw new Error("Cross-tenant destination.");
  } catch {
    await auditFailure({
      azione: "NEUTRAL_INTAKE_DESTINATION_ASSIGN",
      entita: "NeutralIntake",
      entitaId: intake.id,
      enteId: intake.enteId,
      concessioneId: procedimento.concessione.id,
      actor: { userId: user.id, userEmail: user.email, userRole: user.role },
      metadata: { reason: "TENANT_WRITE_DENIED", procedimentoId: procedimento.id },
    }).catch(() => undefined);
    return jsonError("Forbidden.", 403);
  }

  try {
    const result = await establishNeutralIntakeDestination({
      neutralIntakeId: intake.id,
      procedimentoId: procedimento.id,
      authoritySource,
      establishedByUserId: user.id,
      establishedByActorId: user.id,
      establishedByRole: user.role,
    });
    await auditSuccess({
      azione: "NEUTRAL_INTAKE_DESTINATION_ASSIGN",
      entita: "NeutralIntake",
      entitaId: intake.id,
      enteId: intake.enteId,
      concessioneId: procedimento.concessione.id,
      actor: { userId: user.id, userEmail: user.email, userRole: user.role },
      metadata: {
        procedimentoId: procedimento.id,
        destinationOutcome: result.outcome,
        handoffOutcome: result.handoff.outcome,
        authoritySource,
      },
    });
    return NextResponse.json(
      { destinationStatus: result.outcome, handoffStatus: result.handoff.outcome },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof NeutralIntakeDestinationConflictError || error instanceof NeutralIntakeHandoffConflictError) {
      await auditFailure({
        azione: "NEUTRAL_INTAKE_DESTINATION_ASSIGN",
        entita: "NeutralIntake",
        entitaId: intake.id,
        enteId: intake.enteId,
        concessioneId: procedimento.concessione.id,
        actor: { userId: user.id, userEmail: user.email, userRole: user.role },
        metadata: { reason: "DESTINATION_CONFLICT", procedimentoId: procedimento.id },
      }).catch(() => undefined);
      return jsonError("Destination conflict.", 409);
    }
    if (error instanceof NeutralIntakeDestinationHandoffError) {
      await auditFailure({
        azione: "NEUTRAL_INTAKE_DESTINATION_ASSIGN",
        entita: "NeutralIntake",
        entitaId: intake.id,
        enteId: intake.enteId,
        concessioneId: procedimento.concessione.id,
        actor: { userId: user.id, userEmail: user.email, userRole: user.role },
        metadata: { reason: "HANDOFF_RETRY_REQUIRED", procedimentoId: procedimento.id },
      }).catch(() => undefined);
      return jsonError("Destination established; handoff retry required.", 503, true);
    }
    await auditFailure({
      azione: "NEUTRAL_INTAKE_DESTINATION_ASSIGN",
      entita: "NeutralIntake",
      entitaId: intake.id,
      enteId: intake.enteId,
      concessioneId: procedimento.concessione.id,
      actor: { userId: user.id, userEmail: user.email, userRole: user.role },
      metadata: { reason: "DESTINATION_ESTABLISHMENT_FAILED", procedimentoId: procedimento.id },
    }).catch(() => undefined);
    return jsonError("Unable to establish destination.", 500);
  }
}
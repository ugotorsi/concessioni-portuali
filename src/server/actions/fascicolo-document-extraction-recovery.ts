"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditSuccess } from "@/server/audit/auditLog";
import { ensureFascicoloDocumentExtractionJobs } from "@/server/documents/fascicoloDocumentExtractionRecovery";

const inputSchema = z.object({
  procedimentoId: z.string().trim().min(1),
});

export async function recoverFascicoloDocumentExtractionsAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla lettura dei documenti del fascicolo.");
  }
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }
  const input = inputSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
  });
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: input.procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento) {
    throw new Error("Fascicolo non disponibile.");
  }
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext || tenantContext.userId !== currentUser.id) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await ensureFascicoloDocumentExtractionJobs({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
  });
  await auditSuccess({
    azione: "FASCICOLO_DOCUMENT_EXTRACTION_RECOVERY_REQUESTED",
    entita: "Procedimento",
    entitaId: procedimento.id,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: role,
    },
    metadata: {
      targetCount: result.targetCount,
      createdJobCount: result.createdJobCount,
      reusedJobCount: result.reusedJobCount,
      workerActivationOutcome: result.activation.outcome,
    },
  });
  revalidatePath(`/procedimenti/${procedimento.id}`);
}

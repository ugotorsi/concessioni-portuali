"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireAdminWithMfa, requireRole } from "@/lib/auth";
import { buildDatasetProcedimentoWhere } from "@/lib/dataset-visibility";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditSuccess } from "@/server/audit/auditLog";
import { ensureFascicoloDocumentExtractionJobs } from "@/server/documents/fascicoloDocumentExtractionRecovery";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import {
  ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries,
  ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery,
} from "@/server/documents/documentExtractionRetryAdmission";

const inputSchema = z.object({
  procedimentoId: z.string().trim().min(1),
});
const singleTerminalRecoveryInputSchema = inputSchema.extend({
  failedAttemptId: z.string().trim().min(1),
  reason: z.string().trim().min(10).max(500),
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
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext || tenantContext.userId !== currentUser.id) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  const procedimento = await prisma.procedimento.findFirst({
    where: {
      id: input.procedimentoId,
      ...buildDatasetProcedimentoWhere(tenantContext.datasetScope),
    },
    select: { id: true, enteId: true },
  });
  if (!procedimento) {
    throw new Error("Fascicolo non disponibile.");
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

export async function recoverFascicoloTerminalDocumentExtractionsAction(formData: FormData) {
  const currentUser = await requireAdminWithMfa();
  const input = inputSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
  });
  if (formData.get("confirmation") !== "RECOVER_FASCICOLO_DOCUMENT_EXTRACTIONS") {
    throw new Error("Conferma del recupero documentale richiesta.");
  }
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext || tenantContext.userId !== currentUser.id) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  const procedimento = await prisma.procedimento.findFirst({
    where: {
      id: input.procedimentoId,
      ...buildDatasetProcedimentoWhere(tenantContext.datasetScope),
    },
    select: { id: true, enteId: true },
  });
  if (!procedimento) throw new Error("Fascicolo non disponibile.");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
    reason: "Recupero autorizzato dal fascicolo per completare la lettura documentale.",
  });
  if (result.targetCount === 0) {
    throw new Error("Nessuna estrazione terminale recuperabile per le versioni correnti.");
  }
  const activation = await requestDocumentWorkerActivation({
    kind: "DOCUMENT_EXTRACTION",
    procedimentoId: procedimento.id,
  });
  await auditSuccess({
    azione: "FASCICOLO_TERMINAL_DOCUMENT_EXTRACTION_RECOVERY_REQUESTED",
    entita: "Procedimento",
    entitaId: procedimento.id,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      targetCount: result.targetCount,
      createdJobCount: result.createdJobCount,
      reusedJobCount: result.reusedJobCount,
      workerActivationOutcome: activation.outcome,
    },
  });
  revalidatePath(`/procedimenti/${procedimento.id}`);
}

export async function recoverFascicoloTerminalDocumentExtractionAction(formData: FormData) {
  const currentUser = await requireAdminWithMfa();
  const input = singleTerminalRecoveryInputSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    failedAttemptId: formData.get("failedAttemptId"),
    reason: formData.get("reason"),
  });
  if (formData.get("confirmation") !== "RECOVER_FASCICOLO_DOCUMENT_EXTRACTION") {
    throw new Error("Conferma del recupero documentale richiesta.");
  }
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext || tenantContext.userId !== currentUser.id) {
    throw new Error("Contesto tenant autenticato richiesto.");
  }
  const procedimento = await prisma.procedimento.findFirst({
    where: {
      id: input.procedimentoId,
      ...buildDatasetProcedimentoWhere(tenantContext.datasetScope),
    },
    select: { id: true, enteId: true },
  });
  if (!procedimento) throw new Error("Fascicolo non disponibile.");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const admission = await ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
    failedAttemptId: input.failedAttemptId,
    reason: input.reason,
  });
  const activation = await requestDocumentWorkerActivation({
    kind: "DOCUMENT_EXTRACTION",
    procedimentoId: procedimento.id,
  });
  await auditSuccess({
    azione: "FASCICOLO_TERMINAL_DOCUMENT_EXTRACTION_RECOVERY_REQUESTED",
    entita: "Procedimento",
    entitaId: procedimento.id,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      targetCount: 1,
      createdJobCount: admission.outcome === "CREATED" ? 1 : 0,
      reusedJobCount: admission.outcome === "REUSED" ? 1 : 0,
      workerActivationOutcome: activation.outcome,
    },
  });
  revalidatePath(`/procedimenti/${procedimento.id}`);
  redirect(`/procedimenti/${encodeURIComponent(procedimento.id)}?section=documents&extraction=retry-queued`);
}

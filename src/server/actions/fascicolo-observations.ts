"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { buildPecReceiptObservationCandidate } from "@/server/fascicolo-observations/pecReceiptDetector";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const refreshSchema = z.object({ procedimentoId: z.string().min(1) });
const reviewSchema = z.object({
  observationId: z.string().min(1),
  status: z.enum(["VALIDATO", "RIFIUTATO", "SUPERATO"]),
  reviewNote: z.string().trim().max(2000).optional(),
});

function resolvePersistedUserId(currentUserId: string): string | null {
  return currentUserId === STAGING_PREVIEW_ADMIN_ID ? null : currentUserId;
}

async function requireProcedimentoWriteAccess(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, concessioneId: true, concessione: { select: { enteId: true } } },
  });

  const enteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !enteId) {
    throw new Error("Procedimento o tenant non disponibile.");
  }
  if (tenantContext) {
    requireTenantAccess(tenantContext, enteId, { mode: "write", allowWhenEnteMissing: false });
  }

  return { procedimento, enteId };
}

export async function refreshFascicoloObservationsAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato all aggiornamento osservazioni fascicolo.");
  }

  const parsed = refreshSchema.parse({ procedimentoId: formData.get("procedimentoId") });
  const { procedimento, enteId } = await requireProcedimentoWriteAccess(parsed.procedimentoId);
  const documenti = await prisma.documento.findMany({
    where: {
      procedimentoId: procedimento.id,
      enteId,
      statoDocumento: "ATTIVO",
      pecWarningMancataRicevuta: true,
    },
    select: {
      id: true,
      procedimentoId: true,
      enteId: true,
      statoDocumento: true,
      canale: true,
      pecRicevutaAccettazioneId: true,
      pecRicevutaConsegnaId: true,
      pecWarningMancataRicevuta: true,
    },
  });

  const candidates = documenti
    .map((documento) => buildPecReceiptObservationCandidate(documento, procedimento.id, enteId))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  if (candidates.length > 0) {
    await prisma.fascicoloObservation.createMany({ data: candidates, skipDuplicates: true });
  }

  revalidatePath(`/procedimenti/${procedimento.id}`);
}

export async function reviewFascicoloObservationAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla verifica osservazioni fascicolo.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const parsed = reviewSchema.parse({
    observationId: formData.get("observationId"),
    status: formData.get("status"),
    reviewNote: formData.get("reviewNote")?.toString() || undefined,
  });
  if (["RIFIUTATO", "SUPERATO"].includes(parsed.status) && !parsed.reviewNote) {
    throw new Error("La nota di review e obbligatoria per questo esito.");
  }

  const observation = await prisma.fascicoloObservation.findUnique({
    where: { id: parsed.observationId },
    select: {
      id: true,
      status: true,
      enteId: true,
      procedimentoId: true,
      procedimento: { select: { concessioneId: true, concessione: { select: { enteId: true } } } },
    },
  });
  if (!observation || observation.status !== "PROPOSTO") {
    throw new Error("Osservazione non disponibile per la verifica.");
  }

  const tenantContext = await getCurrentTenantContext();
  const canonicalEnteId = observation.procedimento.concessione.enteId;
  if (!canonicalEnteId || observation.enteId !== canonicalEnteId) {
    throw new Error("Tenant osservazione non coerente.");
  }
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const reviewedAt = new Date();
  const reviewedByUserId = resolvePersistedUserId(currentUser.id);
  await prisma.$transaction(async (tx) => {
    const result = await tx.fascicoloObservation.updateMany({
      where: {
        id: observation.id,
        status: "PROPOSTO",
        enteId: canonicalEnteId,
      },
      data: {
        status: parsed.status,
        reviewedAt,
        reviewedByUserId,
        reviewedByActorId: currentUser.id,
        reviewedByEmail: currentUser.email,
        reviewedByRole: role,
        reviewNote: parsed.reviewNote ?? null,
      },
    });
    if (result.count !== 1) {
      throw new Error("Osservazione gia revisionata o non piu disponibile per la review.");
    }

    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_OBSERVATION_REVIEW",
      entita: "FascicoloObservation",
      entitaId: observation.id,
      enteId: canonicalEnteId,
      concessioneId: observation.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: reviewedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        status: parsed.status,
        rule: "P1-PEC-RECEIPT-001",
        ruleVersion: 1,
        meaning: "verifica umana dell osservazione tecnica",
      },
    });
  });

  revalidatePath(`/procedimenti/${observation.procedimentoId}`);
}
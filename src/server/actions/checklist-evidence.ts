"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import {
  CHECKLIST_ITEM_CODES,
  getChecklistContraddittorioItems,
} from "@/lib/procedimento-checklist";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const createSchema = z.object({
  procedimentoId: z.string().min(1),
  documentoId: z.string().min(1),
  checklistItemCode: z.enum(CHECKLIST_ITEM_CODES),
});
const reviewSchema = z.object({
  evidenceId: z.string().min(1),
  status: z.enum(["VALIDATO", "RIFIUTATO"]),
  reviewNote: z.string().trim().max(2000).optional(),
});

function resolvePersistedUserId(currentUserId: string): string | null {
  return currentUserId === STAGING_PREVIEW_ADMIN_ID ? null : currentUserId;
}

const checklistSelect = {
  tipologia: true,
  origineProcedimento: true,
  procedimentoUfficio: true,
  comunicazioneAvvioInviata: true,
  termineMemorieGiorni: true,
  termineMemorieScadenza: true,
  memorieRicevute: true,
  dataRicezioneMemorie: true,
  audizioneRichiesta: true,
  audizioneSvolta: true,
  dataAudizione: true,
  contestazioneFormaleInviata: true,
  dataContestazioneFormale: true,
  controdeduzioniValutate: true,
  motivazioneValutazione: true,
  propostaEsitoIstruttorio: true,
  preavvisoRigettoApplicabile: true,
  statoPreavvisoRigetto: true,
  dataPreavvisoRigetto: true,
  termineOsservazioniPreavviso: true,
  osservazioniPreavvisoRicevute: true,
  dataOsservazioniPreavviso: true,
  valutazioneOsservazioniPreavviso: true,
  motivazioneMancatoPreavviso: true,
} as const;

export async function createChecklistEvidenceAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato all associazione di evidenze istruttorie.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const parsed = createSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    documentoId: formData.get("documentoId"),
    checklistItemCode: formData.get("checklistItemCode"),
  });
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: parsed.procedimentoId },
    select: {
      id: true,
      concessioneId: true,
      concessione: { select: { enteId: true } },
      ...checklistSelect,
    },
  });
  const canonicalEnteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !canonicalEnteId) {
    throw new Error("Procedimento o tenant canonico non disponibile.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const checklistItemExists = getChecklistContraddittorioItems(procedimento).some(
    (item) => item.code === parsed.checklistItemCode,
  );
  if (!checklistItemExists) {
    throw new Error("Voce checklist non applicabile al procedimento corrente.");
  }

  const documento = await prisma.documento.findUnique({
    where: { id: parsed.documentoId },
    select: { id: true, statoDocumento: true, procedimentoId: true, enteId: true },
  });
  if (
    !documento ||
    documento.statoDocumento !== "ATTIVO" ||
    documento.procedimentoId !== procedimento.id ||
    documento.enteId !== canonicalEnteId
  ) {
    throw new Error("Documento non eleggibile per questa voce checklist.");
  }

  const createdByUserId = resolvePersistedUserId(currentUser.id);
  await prisma.$transaction(async (tx) => {
    const inserted = await tx.fascicoloChecklistEvidence.createMany({
      data: {
        enteId: canonicalEnteId,
        procedimentoId: procedimento.id,
        documentoId: documento.id,
        checklistItemCode: parsed.checklistItemCode,
        createdByActorId: currentUser.id,
        createdByUserId,
        createdByEmail: currentUser.email,
        createdByRole: role,
      },
      skipDuplicates: true,
    });
    const row = await tx.fascicoloChecklistEvidence.findUniqueOrThrow({
      where: {
        enteId_procedimentoId_documentoId_checklistItemCode: {
          enteId: canonicalEnteId,
          procedimentoId: procedimento.id,
          documentoId: documento.id,
          checklistItemCode: parsed.checklistItemCode,
        },
      },
      select: { id: true, status: true },
    });

    if (inserted.count === 1) {
      await createAuditLogInTransaction(tx, {
        azione: "CHECKLIST_EVIDENCE_CREATE",
        entita: "FascicoloChecklistEvidence",
        entitaId: row.id,
        enteId: canonicalEnteId,
        concessioneId: procedimento.concessioneId,
        esito: "SUCCESS",
        actor: { userId: createdByUserId, userEmail: currentUser.email, userRole: role },
        metadata: {
          procedimentoId: procedimento.id,
          documentoId: documento.id,
          checklistItemCode: parsed.checklistItemCode,
          status: row.status,
        },
      });
    }
    return row;
  });

  revalidatePath(`/procedimenti/${procedimento.id}`);
}

export async function reviewChecklistEvidenceAction(formData: FormData) {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla verifica umana delle evidenze istruttorie.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const parsed = reviewSchema.parse({
    evidenceId: formData.get("evidenceId"),
    status: formData.get("status"),
    reviewNote: formData.get("reviewNote")?.toString() || undefined,
  });
  if (parsed.status === "RIFIUTATO" && !parsed.reviewNote) {
    throw new Error("La nota di review e obbligatoria per il rifiuto.");
  }

  const evidence = await prisma.fascicoloChecklistEvidence.findUnique({
    where: { id: parsed.evidenceId },
    select: {
      id: true,
      status: true,
      enteId: true,
      procedimentoId: true,
      documentoId: true,
      checklistItemCode: true,
      procedimento: { select: { concessioneId: true, concessione: { select: { enteId: true } } } },
      documento: { select: { enteId: true, procedimentoId: true } },
    },
  });
  const canonicalEnteId = evidence?.procedimento.concessione.enteId ?? null;
  if (
    !evidence ||
    evidence.status !== "PROPOSTO" ||
    !canonicalEnteId ||
    evidence.enteId !== canonicalEnteId ||
    evidence.documento.enteId !== canonicalEnteId ||
    evidence.documento.procedimentoId !== evidence.procedimentoId
  ) {
    throw new Error("Evidenza non disponibile o non coerente per la verifica.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const reviewedByUserId = resolvePersistedUserId(currentUser.id);
  const reviewedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const result = await tx.fascicoloChecklistEvidence.updateMany({
      where: { id: evidence.id, status: "PROPOSTO", enteId: canonicalEnteId },
      data: {
        status: parsed.status,
        reviewedAt,
        reviewedByActorId: currentUser.id,
        reviewedByUserId,
        reviewedByEmail: currentUser.email,
        reviewedByRole: role,
        reviewNote: parsed.reviewNote ?? null,
      },
    });
    if (result.count !== 1) {
      throw new Error("Evidenza gia revisionata o non piu disponibile per la verifica.");
    }

    await createAuditLogInTransaction(tx, {
      azione: "CHECKLIST_EVIDENCE_REVIEW",
      entita: "FascicoloChecklistEvidence",
      entitaId: evidence.id,
      enteId: canonicalEnteId,
      concessioneId: evidence.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: reviewedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        procedimentoId: evidence.procedimentoId,
        documentoId: evidence.documentoId,
        checklistItemCode: evidence.checklistItemCode,
        status: parsed.status,
      },
    });
  });

  revalidatePath(`/procedimenti/${evidence.procedimentoId}`);
}
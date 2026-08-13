"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const createSchema = z.object({
  proposalId: z.string().trim().min(1),
  documentoId: z.string().trim().min(1),
}).strict();

const revokeSchema = z.object({
  evidenceId: z.string().trim().min(1),
  revocationNote: z.string().trim().min(1).max(2000),
}).strict();

function resolvePersistedUserId(currentUserId: string): string | null {
  return currentUserId === STAGING_PREVIEW_ADMIN_ID ? null : currentUserId;
}

export async function createFascicoloDocumentRequirementEvidence(input: {
  proposalId: string;
  documentoId: string;
}) {
  const parsed = createSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato all associazione di evidenze ai requisiti istruttori.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const proposal = await prisma.fascicoloDocumentRequirementProposal.findUnique({
    where: { id: parsed.proposalId },
    select: {
      id: true,
      enteId: true,
      procedimentoId: true,
      status: true,
      procedimento: {
        select: {
          concessioneId: true,
          concessione: { select: { enteId: true } },
        },
      },
    },
  });
  const canonicalEnteId = proposal?.procedimento.concessione.enteId ?? null;
  if (!proposal || !canonicalEnteId || proposal.enteId !== canonicalEnteId) {
    throw new Error("Proposta non disponibile o non coerente con il tenant canonico.");
  }
  if (proposal.status !== "VALIDATO") {
    throw new Error("Solo un requisito istruttorio validato puo ricevere evidenze associate.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const documento = await prisma.documento.findUnique({
    where: { id: parsed.documentoId },
    select: { id: true, enteId: true, procedimentoId: true, statoDocumento: true },
  });
  if (
    !documento ||
    documento.enteId !== canonicalEnteId ||
    documento.procedimentoId !== proposal.procedimentoId ||
    documento.statoDocumento !== "ATTIVO"
  ) {
    throw new Error("Documento non eleggibile per questo requisito istruttorio.");
  }

  const createdByUserId = resolvePersistedUserId(currentUser.id);
  const result = await prisma.$transaction(async (tx) => {
    const inserted = await tx.fascicoloDocumentRequirementEvidence.createMany({
      data: {
        enteId: canonicalEnteId,
        proposalId: proposal.id,
        documentoId: documento.id,
        createdByUserId,
        createdByActorId: currentUser.id,
        createdByEmail: currentUser.email,
        createdByRole: role,
      },
      skipDuplicates: true,
    });
    const evidence = await tx.fascicoloDocumentRequirementEvidence.findUniqueOrThrow({
      where: {
        enteId_proposalId_documentoId: {
          enteId: canonicalEnteId,
          proposalId: proposal.id,
          documentoId: documento.id,
        },
      },
    });

    if (inserted.count === 0 && evidence.revokedAt !== null) {
      throw new Error("Associazione revocata: la riassociazione non e consentita.");
    }

    if (inserted.count === 1) {
      await createAuditLogInTransaction(tx, {
        azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_CREATE",
        entita: "FascicoloDocumentRequirementEvidence",
        entitaId: evidence.id,
        enteId: canonicalEnteId,
        concessioneId: proposal.procedimento.concessioneId,
        esito: "SUCCESS",
        actor: { userId: createdByUserId, userEmail: currentUser.email, userRole: role },
        metadata: {
          evidenceId: evidence.id,
          proposalId: proposal.id,
          documentoId: documento.id,
        },
      });
    }

    return { created: inserted.count === 1, evidence };
  });

  revalidatePath(`/procedimenti/${proposal.procedimentoId}`);
  return result;
}

export async function revokeFascicoloDocumentRequirementEvidence(input: {
  evidenceId: string;
  revocationNote: string;
}) {
  const parsed = revokeSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla revoca di evidenze associate ai requisiti istruttori.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const evidence = await prisma.fascicoloDocumentRequirementEvidence.findUnique({
    where: { id: parsed.evidenceId },
    select: {
      id: true,
      enteId: true,
      proposalId: true,
      documentoId: true,
      revokedAt: true,
      proposal: {
        select: {
          enteId: true,
          procedimentoId: true,
          status: true,
          procedimento: {
            select: {
              concessioneId: true,
              concessione: { select: { enteId: true } },
            },
          },
        },
      },
      documento: { select: { enteId: true, procedimentoId: true } },
    },
  });
  const canonicalEnteId = evidence?.proposal.procedimento.concessione.enteId ?? null;
  if (
    !evidence ||
    !canonicalEnteId ||
    evidence.enteId !== canonicalEnteId ||
    evidence.proposal.enteId !== canonicalEnteId ||
    evidence.proposal.status !== "VALIDATO" ||
    evidence.documento.enteId !== canonicalEnteId ||
    evidence.documento.procedimentoId !== evidence.proposal.procedimentoId
  ) {
    throw new Error("Evidenza non disponibile o non coerente con il tenant canonico.");
  }
  if (evidence.revokedAt !== null) {
    throw new Error("Evidenza gia revocata o non piu disponibile.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const revokedByUserId = resolvePersistedUserId(currentUser.id);
  const revokedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fascicoloDocumentRequirementEvidence.updateMany({
      where: { id: evidence.id, enteId: canonicalEnteId, revokedAt: null },
      data: {
        revokedAt,
        revokedByUserId,
        revokedByActorId: currentUser.id,
        revokedByEmail: currentUser.email,
        revokedByRole: role,
        revocationNote: parsed.revocationNote,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Evidenza gia revocata o modificata da un altro operatore.");
    }

    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_REVOKE",
      entita: "FascicoloDocumentRequirementEvidence",
      entitaId: evidence.id,
      enteId: canonicalEnteId,
      concessioneId: evidence.proposal.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: revokedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        evidenceId: evidence.id,
        proposalId: evidence.proposalId,
        documentoId: evidence.documentoId,
        revocationNotePresent: true,
      },
    });
  });

  revalidatePath(`/procedimenti/${evidence.proposal.procedimentoId}`);
}
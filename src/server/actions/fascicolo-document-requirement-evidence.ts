"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { createFascicoloDocumentRequirementEvidenceInTransaction } from "@/server/fascicolo-document-requirement-evidence";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const createSchema = z.object({
  proposalId: z.string().trim().min(1),
  documentoId: z.string().trim().min(1),
}).strict();

const revokeSchema = z.object({
  evidenceId: z.string().trim().min(1),
  revocationNote: z.string().trim().min(1).max(2000),
}).strict();
const reviewSchema = z.object({
  evidenceId: z.string().trim().min(1),
  reviewNote: z.string().trim().max(2000).optional(),
}).strict();

const evidenceContextSelect = {
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
} satisfies Prisma.FascicoloDocumentRequirementEvidenceSelect;

type EvidenceContext = Prisma.FascicoloDocumentRequirementEvidenceGetPayload<{
  select: typeof evidenceContextSelect;
}>;

function resolvePersistedUserId(currentUserId: string): string | null {
  return currentUserId === STAGING_PREVIEW_ADMIN_ID ? null : currentUserId;
}

function canonicalEnteIdForEvidence(evidence: EvidenceContext | null): string | null {
  const canonicalEnteId = evidence?.proposal.procedimento.concessione.enteId ?? null;
  if (
    !evidence
    || !canonicalEnteId
    || evidence.enteId !== canonicalEnteId
    || evidence.proposal.enteId !== canonicalEnteId
    || evidence.proposal.status !== "VALIDATO"
    || evidence.documento.enteId !== canonicalEnteId
    || evidence.documento.procedimentoId !== evidence.proposal.procedimentoId
  ) {
    return null;
  }

  return canonicalEnteId;
}

async function lockEvidenceRow(tx: Prisma.TransactionClient, evidenceId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "FascicoloDocumentRequirementEvidence"
    WHERE "id" = ${evidenceId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Evidenza non disponibile o non coerente con il tenant canonico.");
  }
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
  const result = await prisma.$transaction((tx) => createFascicoloDocumentRequirementEvidenceInTransaction(tx, {
    canonicalEnteId,
    proposalId: proposal.id,
    documentoId: documento.id,
    concessioneId: proposal.procedimento.concessioneId,
    createdByUserId,
    createdByActorId: currentUser.id,
    createdByEmail: currentUser.email,
    createdByRole: role,
  }));

  revalidatePath(`/procedimenti/${proposal.procedimentoId}`);
  return result;
}

export async function reviewFascicoloDocumentRequirementEvidence(input: {
  evidenceId: string;
  reviewNote?: string;
}) {
  const parsed = reviewSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla registrazione dell esame umano dell evidenza.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const evidence = await prisma.fascicoloDocumentRequirementEvidence.findUnique({
    where: { id: parsed.evidenceId },
    select: evidenceContextSelect,
  });
  const canonicalEnteId = canonicalEnteIdForEvidence(evidence);
  if (!evidence || !canonicalEnteId) {
    throw new Error("Evidenza non disponibile o non coerente con il tenant canonico.");
  }
  if (evidence.revokedAt !== null) {
    throw new Error("Evidenza revocata o non piu disponibile per l esame umano.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }

  const reviewedByUserId = resolvePersistedUserId(currentUser.id);
  const reviewNote = parsed.reviewNote || null;
  const result = await prisma.$transaction(async (tx) => {
    await lockEvidenceRow(tx, evidence.id);
    const lockedEvidence = await tx.fascicoloDocumentRequirementEvidence.findUnique({
      where: { id: evidence.id },
      select: evidenceContextSelect,
    });
    const lockedCanonicalEnteId = canonicalEnteIdForEvidence(lockedEvidence);
    if (!lockedEvidence || lockedCanonicalEnteId !== canonicalEnteId || lockedEvidence.revokedAt !== null) {
      throw new Error("Evidenza revocata o non piu disponibile per l esame umano.");
    }

    const existing = await tx.fascicoloDocumentRequirementEvidenceReview.findUnique({
      where: { evidenceId: lockedEvidence.id },
    });
    if (existing) {
      return { created: false, review: existing };
    }

    const review = await tx.fascicoloDocumentRequirementEvidenceReview.create({
      data: {
        evidenceId: lockedEvidence.id,
        reviewedByUserId,
        reviewedByActorId: currentUser.id,
        reviewedByEmail: currentUser.email,
        reviewedByRole: role,
        reviewNote,
      },
    });
    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_REVIEW",
      entita: "FascicoloDocumentRequirementEvidenceReview",
      entitaId: review.id,
      enteId: canonicalEnteId,
      concessioneId: lockedEvidence.proposal.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: reviewedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        evidenceId: lockedEvidence.id,
        proposalId: lockedEvidence.proposalId,
        documentoId: lockedEvidence.documentoId,
        procedimentoId: lockedEvidence.proposal.procedimentoId,
        reviewNotePresent: reviewNote !== null,
        semanticMarker: "HUMAN_REVIEW_PERFORMED_NO_LEGAL_CONCLUSION",
      },
    });

    return { created: true, review };
  });

  revalidatePath(`/procedimenti/${evidence.proposal.procedimentoId}`);
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
    select: evidenceContextSelect,
  });
  const canonicalEnteId = canonicalEnteIdForEvidence(evidence);
  if (!evidence || !canonicalEnteId) {
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
    await lockEvidenceRow(tx, evidence.id);
    const lockedEvidence = await tx.fascicoloDocumentRequirementEvidence.findUnique({
      where: { id: evidence.id },
      select: evidenceContextSelect,
    });
    const lockedCanonicalEnteId = canonicalEnteIdForEvidence(lockedEvidence);
    if (!lockedEvidence || lockedCanonicalEnteId !== canonicalEnteId || lockedEvidence.revokedAt !== null) {
      throw new Error("Evidenza gia revocata o modificata da un altro operatore.");
    }

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
      concessioneId: lockedEvidence.proposal.procedimento.concessioneId,
      esito: "SUCCESS",
      actor: { userId: revokedByUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        evidenceId: lockedEvidence.id,
        proposalId: lockedEvidence.proposalId,
        documentoId: lockedEvidence.documentoId,
        revocationNotePresent: true,
      },
    });
  });

  revalidatePath(`/procedimenti/${evidence.proposal.procedimentoId}`);
}
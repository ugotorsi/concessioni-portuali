"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createFascicoloDocumentRequirementEvidence } from "@/server/actions/fascicolo-document-requirement-evidence";
import { deleteDocumentFile } from "@/server/documents/storage";
import {
  recordUploadCleanupFailure,
  recordUploadCompensated,
  uploadDocument,
} from "@/server/documents/uploadService";
import { DOCUMENT_TIPOLOGIA_VALUES, validateUploadFile } from "@/server/documents/validation";

const inputSchema = z.object({
  proposalId: z.string().trim().min(1),
  operationId: z.string().uuid(),
  file: z.instanceof(File),
  tipologia: z.enum(DOCUMENT_TIPOLOGIA_VALUES),
  nome: z.string().trim().max(180).optional(),
  descrizione: z.string().trim().max(1000).optional(),
  dataDocumento: z.string().trim().optional().refine(
    (value) => !value || !Number.isNaN(new Date(value).getTime()),
    "Data documento non valida.",
  ),
}).strict();

export interface UploadRequirementEvidenceInput {
  proposalId: string;
  operationId: string;
  file: File;
  tipologia: (typeof DOCUMENT_TIPOLOGIA_VALUES)[number];
  nome?: string;
  descrizione?: string;
  dataDocumento?: string;
}

export async function uploadFascicoloDocumentRequirementEvidence(input: UploadRequirementEvidenceInput) {
  const parsed = inputSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato al caricamento di evidenze istruttorie.");
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
    throw new Error("Solo un requisito istruttorio validato puo ricevere un nuovo documento.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
  }
  validateUploadFile(parsed.file);

  const actor = { id: currentUser.id, email: currentUser.email, role };
  const uploaded = await uploadDocument({
    documentId: parsed.operationId,
    file: parsed.file,
    actor,
    enteId: canonicalEnteId,
    concessioneId: proposal.procedimento.concessioneId,
    procedimentoId: proposal.procedimentoId,
    nome: parsed.nome || parsed.file.name,
    tipologia: parsed.tipologia,
    descrizione: parsed.descrizione || null,
    dataDocumento: parsed.dataDocumento ? new Date(parsed.dataDocumento) : null,
    source: "UPLOAD_UTENTE",
    status: "ATTIVO",
    deterministicStorage: { canonicalEnteId, operationId: parsed.operationId },
  });

  try {
    const evidenceResult = await createFascicoloDocumentRequirementEvidence({
      proposalId: proposal.id,
      documentoId: uploaded.document.id,
    });
    revalidatePath(`/procedimenti/${proposal.procedimentoId}`);
    return {
      created: uploaded.created || evidenceResult.created,
      documentoId: uploaded.document.id,
      evidenceId: evidenceResult.evidence.id,
    };
  } catch (error) {
    const evidence = await prisma.fascicoloDocumentRequirementEvidence.findUnique({
      where: {
        enteId_proposalId_documentoId: {
          enteId: canonicalEnteId,
          proposalId: proposal.id,
          documentoId: uploaded.document.id,
        },
      },
      select: { id: true, revokedAt: true },
    });
    if (evidence?.revokedAt === null) {
      return { created: uploaded.created, documentoId: uploaded.document.id, evidenceId: evidence.id };
    }
    if (!uploaded.created) {
      throw error;
    }

    let deleted;
    try {
      deleted = await prisma.documento.deleteMany({
        where: {
          id: uploaded.document.id,
          enteId: canonicalEnteId,
          procedimentoId: proposal.procedimentoId,
        },
      });
    } catch (cleanupError) {
      await recordUploadCleanupFailure({
        operationId: parsed.operationId,
        documentId: uploaded.document.id,
        phase: "EVIDENCE_ASSOCIATION",
        provider: uploaded.document.storageProvider ?? "unknown",
        storageKey: uploaded.storageKey,
        cleanupTarget: "DOCUMENTO",
        error: cleanupError,
        actor,
        enteId: canonicalEnteId,
        concessioneId: proposal.procedimento.concessioneId,
      });
      throw error;
    }
    if (deleted.count !== 1) {
      await recordUploadCleanupFailure({
        operationId: parsed.operationId,
        documentId: uploaded.document.id,
        phase: "EVIDENCE_ASSOCIATION",
        provider: uploaded.document.storageProvider ?? "unknown",
        storageKey: uploaded.storageKey,
        cleanupTarget: "DOCUMENTO",
        error: new Error("Documento compensation compare-and-delete failed."),
        actor,
        enteId: canonicalEnteId,
        concessioneId: proposal.procedimento.concessioneId,
      });
      throw error;
    }

    try {
      await deleteDocumentFile(uploaded.storageKey);
    } catch (cleanupError) {
      await recordUploadCleanupFailure({
        operationId: parsed.operationId,
        documentId: uploaded.document.id,
        phase: "EVIDENCE_ASSOCIATION",
        provider: uploaded.document.storageProvider ?? "unknown",
        storageKey: uploaded.storageKey,
        cleanupTarget: "OBJECT",
        error: cleanupError,
        actor,
        enteId: canonicalEnteId,
        concessioneId: proposal.procedimento.concessioneId,
      });
      throw error;
    }

    await recordUploadCompensated({
      operationId: parsed.operationId,
      documentId: uploaded.document.id,
      phase: "EVIDENCE_ASSOCIATION",
      provider: uploaded.document.storageProvider ?? "unknown",
      storageKey: uploaded.storageKey,
      reasonClass: error instanceof Error ? error.name : "UnknownError",
      actor,
      enteId: canonicalEnteId,
      concessioneId: proposal.procedimento.concessioneId,
    });
    throw error;
  }
}
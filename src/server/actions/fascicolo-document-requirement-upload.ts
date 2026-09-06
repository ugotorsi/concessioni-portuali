"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure } from "@/server/audit/auditLog";
import { uploadDocument } from "@/server/documents/uploadService";
import { DOCUMENT_TIPOLOGIA_VALUES, validateUploadFile } from "@/server/documents/validation";
import {
  createFascicoloDocumentRequirementEvidenceAuditInTransaction,
  createFascicoloDocumentRequirementEvidenceRecordInTransaction,
  type CreateFascicoloDocumentRequirementEvidenceInput,
} from "@/server/fascicolo-document-requirement-evidence";

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
    try {
      requireTenantAccess(tenantContext, canonicalEnteId, { mode: "write", allowWhenEnteMissing: false });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Documento",
        concessioneId: proposal.procedimento.concessioneId,
        enteId: canonicalEnteId,
        actor: {
          userId: currentUser.id === "staging-preview-admin" ? null : currentUser.id,
          userEmail: currentUser.email,
          userRole: role,
        },
        metadata: {
          actionType: "DOCUMENT_REQUIREMENT_EVIDENCE_UPLOAD",
          reason: "CROSS_TENANT_BLOCKED",
        },
      });
      throw new Error("Accesso tenant non consentito.");
    }
  }
  validateUploadFile(parsed.file);

  const actor = { id: currentUser.id, email: currentUser.email, role };
  const evidenceInput: CreateFascicoloDocumentRequirementEvidenceInput = {
    canonicalEnteId,
    proposalId: proposal.id,
    documentoId: parsed.operationId,
    concessioneId: proposal.procedimento.concessioneId,
    createdByUserId: currentUser.id === "staging-preview-admin" ? null : currentUser.id,
    createdByActorId: currentUser.id,
    createdByEmail: currentUser.email,
    createdByRole: role,
  };
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
    transactionExtension: {
      createRecord: (tx) => createFascicoloDocumentRequirementEvidenceRecordInTransaction(tx, evidenceInput),
      writeAudit: async (tx, result) => {
        if (result.created) {
          await createFascicoloDocumentRequirementEvidenceAuditInTransaction(tx, evidenceInput, result.evidence.id);
        }
      },
    },
  });

  const evidenceResult = uploaded.extensionResult;
  if (!evidenceResult) {
    throw new Error("Evidenza istruttoria non registrata.");
  }
  revalidatePath(`/procedimenti/${proposal.procedimentoId}`);
  return {
    created: uploaded.created || evidenceResult.created,
    documentoId: uploaded.document.id,
    evidenceId: evidenceResult.evidence.id,
  };
}
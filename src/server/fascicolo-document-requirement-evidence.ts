import type { Prisma } from "@/generated/prisma/client";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

export interface CreateFascicoloDocumentRequirementEvidenceInput {
  canonicalEnteId: string;
  proposalId: string;
  documentoId: string;
  concessioneId: string;
  createdByUserId: string | null;
  createdByActorId: string;
  createdByEmail: string;
  createdByRole: string;
}

export async function createFascicoloDocumentRequirementEvidenceRecordInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFascicoloDocumentRequirementEvidenceInput,
) {
  const inserted = await tx.fascicoloDocumentRequirementEvidence.createMany({
    data: {
      enteId: input.canonicalEnteId,
      proposalId: input.proposalId,
      documentoId: input.documentoId,
      createdByUserId: input.createdByUserId,
      createdByActorId: input.createdByActorId,
      createdByEmail: input.createdByEmail,
      createdByRole: input.createdByRole,
    },
    skipDuplicates: true,
  });
  const evidence = await tx.fascicoloDocumentRequirementEvidence.findUniqueOrThrow({
    where: {
      enteId_proposalId_documentoId: {
        enteId: input.canonicalEnteId,
        proposalId: input.proposalId,
        documentoId: input.documentoId,
      },
    },
  });

  if (inserted.count === 0 && evidence.revokedAt !== null) {
    throw new Error("Associazione revocata: la riassociazione non e consentita.");
  }

  return { created: inserted.count === 1, evidence };
}

export async function createFascicoloDocumentRequirementEvidenceAuditInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFascicoloDocumentRequirementEvidenceInput,
  evidenceId: string,
): Promise<void> {
  await createAuditLogInTransaction(tx, {
    azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_CREATE",
    entita: "FascicoloDocumentRequirementEvidence",
    entitaId: evidenceId,
    enteId: input.canonicalEnteId,
    concessioneId: input.concessioneId,
    esito: "SUCCESS",
    actor: {
      userId: input.createdByUserId,
      userEmail: input.createdByEmail,
      userRole: input.createdByRole,
    },
    metadata: {
      evidenceId,
      proposalId: input.proposalId,
      documentoId: input.documentoId,
    },
  });
}

export async function createFascicoloDocumentRequirementEvidenceInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateFascicoloDocumentRequirementEvidenceInput,
) {
  const result = await createFascicoloDocumentRequirementEvidenceRecordInTransaction(tx, input);
  if (result.created) {
    await createFascicoloDocumentRequirementEvidenceAuditInTransaction(tx, input, result.evidence.id);
  }
  return result;
}
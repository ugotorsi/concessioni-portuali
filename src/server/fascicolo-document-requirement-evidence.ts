import type { Prisma } from "@/generated/prisma/client";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

export async function createFascicoloDocumentRequirementEvidenceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    canonicalEnteId: string;
    proposalId: string;
    documentoId: string;
    concessioneId: string;
    createdByUserId: string | null;
    createdByActorId: string;
    createdByEmail: string;
    createdByRole: string;
  },
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

  if (inserted.count === 1) {
    await createAuditLogInTransaction(tx, {
      azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_CREATE",
      entita: "FascicoloDocumentRequirementEvidence",
      entitaId: evidence.id,
      enteId: input.canonicalEnteId,
      concessioneId: input.concessioneId,
      esito: "SUCCESS",
      actor: {
        userId: input.createdByUserId,
        userEmail: input.createdByEmail,
        userRole: input.createdByRole,
      },
      metadata: {
        evidenceId: evidence.id,
        proposalId: input.proposalId,
        documentoId: input.documentoId,
      },
    });
  }

  return { created: inserted.count === 1, evidence };
}
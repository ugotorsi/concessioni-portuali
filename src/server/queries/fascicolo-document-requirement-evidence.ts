import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export async function getFascicoloDocumentRequirementEvidenceData(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, concessione: { select: { enteId: true } } },
  });
  const canonicalEnteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !canonicalEnteId) {
    return { hasCanonicalTenant: false, associationsByProposalId: {}, eligibleDocumentsByProposalId: {} };
  }

  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, canonicalEnteId, { mode: "read", allowWhenEnteMissing: false });
    } catch {
      return { hasCanonicalTenant: false, associationsByProposalId: {}, eligibleDocumentsByProposalId: {} };
    }
  }

  const [validatedProposals, associations, eligibleDocuments] = await Promise.all([
    prisma.fascicoloDocumentRequirementProposal.findMany({
      where: { enteId: canonicalEnteId, procedimentoId: procedimento.id, status: "VALIDATO" },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    }),
    prisma.fascicoloDocumentRequirementEvidence.findMany({
      where: {
        enteId: canonicalEnteId,
        proposal: { enteId: canonicalEnteId, procedimentoId: procedimento.id, status: "VALIDATO" },
        documento: { enteId: canonicalEnteId, procedimentoId: procedimento.id },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        proposalId: true,
        documentoId: true,
        createdAt: true,
        createdByActorId: true,
        createdByEmail: true,
        createdByRole: true,
        revokedAt: true,
        revokedByActorId: true,
        revokedByEmail: true,
        revokedByRole: true,
        revocationNote: true,
        review: {
          select: {
            id: true,
            createdAt: true,
            reviewedByActorId: true,
            reviewedByEmail: true,
            reviewedByRole: true,
            reviewNote: true,
          },
        },
        documento: {
          select: {
            id: true,
            nome: true,
            tipologia: true,
            statoDocumento: true,
            dataDocumento: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.documento.findMany({
      where: {
        enteId: canonicalEnteId,
        procedimentoId: procedimento.id,
        statoDocumento: "ATTIVO",
      },
      orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
      select: { id: true, nome: true, tipologia: true, dataDocumento: true, createdAt: true },
    }),
  ]);

  const associationsByProposalId: Record<string, typeof associations> = Object.fromEntries(
    validatedProposals.map((proposal) => [proposal.id, []]),
  );
  for (const association of associations) {
    associationsByProposalId[association.proposalId]?.push(association);
  }

  const eligibleDocumentsByProposalId: Record<string, typeof eligibleDocuments> = {};
  for (const proposal of validatedProposals) {
    const historicalDocumentIds = new Set(
      associationsByProposalId[proposal.id]?.map((association) => association.documentoId) ?? [],
    );
    eligibleDocumentsByProposalId[proposal.id] = eligibleDocuments.filter(
      (documento) => !historicalDocumentIds.has(documento.id),
    );
  }

  return {
    hasCanonicalTenant: true,
    associationsByProposalId,
    eligibleDocumentsByProposalId,
  };
}
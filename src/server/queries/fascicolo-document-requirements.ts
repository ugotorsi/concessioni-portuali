import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export async function getFascicoloDocumentRequirementProposals(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, concessione: { select: { enteId: true } } },
  });
  const canonicalEnteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !canonicalEnteId) {
    return { hasCanonicalTenant: false, proposals: [] };
  }

  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, canonicalEnteId, { mode: "read", allowWhenEnteMissing: false });
    } catch {
      return { hasCanonicalTenant: false, proposals: [] };
    }
  }

  const proposals = await prisma.fascicoloDocumentRequirementProposal.findMany({
    where: { enteId: canonicalEnteId, procedimentoId: procedimento.id },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      screeningFingerprint: true,
      matcherAlgorithmVersion: true,
      canonicalArt18Snapshot: true,
      portActivityLegalTypeSnapshot: true,
      sourceStableKeySnapshot: true,
      sourceTitleSnapshot: true,
      sourceRelevantProvisionsSnapshot: true,
      ruleCodeSnapshot: true,
      ruleContractVersionSnapshot: true,
      legalRuleDefinitionSnapshot: true,
      gapKeySnapshot: true,
      gapLabelSnapshot: true,
      gapDescriptionSnapshot: true,
      matchedCriteriaSnapshot: true,
      createdAt: true,
      createdByActorId: true,
      createdByEmail: true,
      createdByRole: true,
      reviewedAt: true,
      reviewedByActorId: true,
      reviewedByEmail: true,
      reviewedByRole: true,
      reviewNote: true,
    },
  });

  return { hasCanonicalTenant: true, proposals };
}
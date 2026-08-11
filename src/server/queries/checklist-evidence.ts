import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export async function getChecklistEvidenceData(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, concessione: { select: { enteId: true } } },
  });
  const canonicalEnteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !canonicalEnteId) {
    return { hasCanonicalTenant: false, evidence: [], eligibleDocuments: [] };
  }

  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, canonicalEnteId, { mode: "read", allowWhenEnteMissing: false });
    } catch {
      return { hasCanonicalTenant: false, evidence: [], eligibleDocuments: [] };
    }
  }

  const [evidence, eligibleDocuments] = await Promise.all([
    prisma.fascicoloChecklistEvidence.findMany({
      where: {
        enteId: canonicalEnteId,
        procedimentoId: procedimento.id,
        documento: { enteId: canonicalEnteId, procedimentoId: procedimento.id },
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        checklistItemCode: true,
        status: true,
        createdAt: true,
        createdByActorId: true,
        createdByEmail: true,
        createdByRole: true,
        reviewedAt: true,
        reviewedByActorId: true,
        reviewedByEmail: true,
        reviewedByRole: true,
        reviewNote: true,
        documento: { select: { id: true, nome: true, tipologia: true } },
      },
    }),
    prisma.documento.findMany({
      where: {
        enteId: canonicalEnteId,
        procedimentoId: procedimento.id,
        statoDocumento: "ATTIVO",
      },
      orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
      select: { id: true, nome: true, tipologia: true },
    }),
  ]);

  return { hasCanonicalTenant: true, evidence, eligibleDocuments };
}
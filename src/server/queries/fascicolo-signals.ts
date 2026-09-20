import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export async function getFascicoloSignalsForProcedimento(procedimentoId: string) {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return [];

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, concessione: { select: { enteId: true } } },
  });
  const enteId = procedimento?.concessione.enteId ?? null;
  if (!procedimento || !enteId) return [];

  try {
    requireTenantAccess(tenantContext, enteId, { mode: "read", allowWhenEnteMissing: false });
  } catch {
    return [];
  }

  return prisma.fascicoloSignal.findMany({
    where: { procedimentoId: procedimento.id, enteId },
    orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
    select: {
      id: true,
      kind: true,
      status: true,
      humanDisposition: true,
      currentThreshold: true,
      attentionLevel: true,
      dispositionThreshold: true,
      detectedAt: true,
      lastObservedAt: true,
      reviewedAt: true,
      reviewNote: true,
      criticitaId: true,
    },
  });
}
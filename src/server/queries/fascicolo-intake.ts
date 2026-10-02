import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export async function getFascicoloIntakeDetail(id: string) {
  const fascicolo = await prisma.fascicoloIntake.findUnique({
    where: { id },
    include: {
      concessione: { select: { id: true, numeroAtto: true } },
      documenti: {
        where: { statoDocumento: { not: "ARCHIVIATO" } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!fascicolo) {
    return null;
  }

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    return null;
  }
  try {
    requireTenantAccess(tenantContext, fascicolo.enteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    return null;
  }

  return fascicolo;
}

export async function getFascicoliIntakeList(input: { search?: string; concessioneId?: string } = {}) {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    return [];
  }

  return prisma.fascicoloIntake.findMany({
    where: {
      ...(tenantContext.isAdmin ? {} : { enteId: { in: tenantContext.accessibleTenantIds } }),
      ...(input.concessioneId ? { concessioneId: input.concessioneId } : {}),
      ...(input.search
        ? {
            OR: [
              { denominazioneBreve: { contains: input.search, mode: "insensitive" as const } },
              { oggettoFascicolo: { contains: input.search, mode: "insensitive" as const } },
              { concessionario: { contains: input.search, mode: "insensitive" as const } },
              { numeroConcessione: { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: { concessione: { select: { numeroAtto: true } } },
    orderBy: { createdAt: "desc" },
  });
}

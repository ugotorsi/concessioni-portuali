import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, isTenantContextConstrained } from "@/lib/tenant-auth";

export interface AuditLogListItem {
  id: string;
  createdAt: Date;
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  azione: string;
  entita: string;
  entitaId: string | null;
  concessioneId: string | null;
  esito: "SUCCESS" | "FAILURE";
  previousHash: string | null;
  currentHash: string;
}

export async function getLatestAuditLogs(limit = 100): Promise<AuditLogListItem[]> {
  const tenantContext = await getCurrentTenantContext();
  const where = (() => {
    if (!tenantContext || !isTenantContextConstrained(tenantContext)) {
      return undefined;
    }

    if (tenantContext.accessibleTenantIds.length === 0) {
      return {
        OR: [{ enteId: null, concessioneId: null }],
      };
    }

    return {
      OR: [
        {
          enteId: {
            in: tenantContext.accessibleTenantIds,
          },
        },
        {
          enteId: null,
          concessione: {
            is: {
              enteId: {
                in: tenantContext.accessibleTenantIds,
              },
            },
          },
        },
      ],
    };
  })();

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      createdAt: true,
      userId: true,
      userEmail: true,
      userRole: true,
      azione: true,
      entita: true,
      entitaId: true,
      concessioneId: true,
      esito: true,
      previousHash: true,
      currentHash: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    userId: row.userId,
    userEmail: row.userEmail,
    userRole: row.userRole,
    azione: row.azione,
    entita: row.entita,
    entitaId: row.entitaId,
    concessioneId: row.concessioneId,
    esito: row.esito,
    previousHash: row.previousHash,
    currentHash: row.currentHash,
  }));
}

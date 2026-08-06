import { getCurrentUser, type DemoRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDefaultTenantMembership, isTenantScopedRole, type TenantMembershipLike } from "@/lib/tenant";
import type { Prisma } from "@/generated/prisma/client";

export interface CurrentTenantContext {
  userId: string;
  role: DemoRole;
  isAdmin: boolean;
  tenantMemberships: TenantMembershipLike[];
  defaultTenantId: string | null;
  accessibleTenantIds: string[];
}

export function resolveAccessibleTenantIds(input: {
  role: DemoRole;
  memberships: Array<Pick<TenantMembershipLike, "enteId">>;
}): string[] {
  if (input.role === "ADMIN") {
    return [];
  }

  const ids = new Set(input.memberships.map((item) => item.enteId));
  return Array.from(ids);
}

export function canReadTenantResource(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">,
  resourceEnteId: string | null | undefined,
  options?: { allowWhenEnteMissing?: boolean },
): boolean {
  if (context.isAdmin) {
    return true;
  }

  if (!resourceEnteId) {
    return options?.allowWhenEnteMissing ?? true;
  }

  return context.accessibleTenantIds.includes(resourceEnteId);
}

export function canWriteTenantResource(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">,
  resourceEnteId: string | null | undefined,
  options?: { allowWhenEnteMissing?: boolean },
): boolean {
  if (context.isAdmin) {
    return true;
  }

  if (!resourceEnteId) {
    return options?.allowWhenEnteMissing ?? true;
  }

  return context.accessibleTenantIds.includes(resourceEnteId);
}

export function assertSameTenant(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">,
  resourceEnteId: string | null | undefined,
  options?: { allowWhenEnteMissing?: boolean },
): void {
  if (canReadTenantResource(context, resourceEnteId, options)) {
    return;
  }

  throw new Error("Cross-tenant access denied.");
}

export function requireTenantAccess(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">,
  resourceEnteId: string | null | undefined,
  options?: { allowWhenEnteMissing?: boolean; mode?: "read" | "write" },
): void {
  const canAccess =
    options?.mode === "write"
      ? canWriteTenantResource(context, resourceEnteId, options)
      : canReadTenantResource(context, resourceEnteId, options);

  if (canAccess) {
    return;
  }

  throw new Error("Tenant access denied.");
}

export async function getCurrentTenantContext(): Promise<CurrentTenantContext | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      userId: true,
      enteId: true,
      role: true,
      isDefault: true,
      ente: {
        select: {
          id: true,
          codice: true,
          nome: true,
        },
      },
    },
  });

  const tenantMemberships: TenantMembershipLike[] = memberships.map((item) => ({
    id: item.id,
    userId: item.userId,
    enteId: item.enteId,
    role: item.role as DemoRole,
    isDefault: item.isDefault,
    ente: item.ente,
  }));

  const defaultMembership = getDefaultTenantMembership(tenantMemberships);
  const accessibleTenantIds = resolveAccessibleTenantIds({
    role: user.role,
    memberships: tenantMemberships,
  });

  return {
    userId: user.id,
    role: user.role,
    isAdmin: user.role === "ADMIN",
    tenantMemberships,
    defaultTenantId: defaultMembership?.enteId ?? null,
    accessibleTenantIds,
  };
}

export function isTenantContextConstrained(context: CurrentTenantContext): boolean {
  return !context.isAdmin && isTenantScopedRole(context.role);
}

export function buildTenantConcessioneWhere(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role"> | null,
  options?: { allowWhenEnteMissing?: boolean },
): Prisma.ConcessioneWhereInput {
  if (!context || context.isAdmin || !isTenantScopedRole(context.role)) {
    return {};
  }

  const allowWhenEnteMissing = options?.allowWhenEnteMissing ?? true;
  const tenantIds = context.accessibleTenantIds;

  if (tenantIds.length === 0) {
    return allowWhenEnteMissing ? { enteId: null } : { id: { in: [] } };
  }

  if (!allowWhenEnteMissing) {
    return { enteId: { in: tenantIds } };
  }

  return {
    OR: [{ enteId: { in: tenantIds } }, { enteId: null }],
  };
}

export function resolveResourceTenantId(input: {
  resourceEnteId?: string | null;
  concessioneEnteId?: string | null;
}): string | null {
  return input.resourceEnteId ?? input.concessioneEnteId ?? null;
}

export async function requireConcessioneTenantAccess(
  context: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">,
  concessioneId: string,
  options?: { mode?: "read" | "write"; allowWhenEnteMissing?: boolean },
): Promise<{ id: string; enteId: string | null }> {
  const concessione = await prisma.concessione.findUnique({
    where: { id: concessioneId },
    select: {
      id: true,
      enteId: true,
    },
  });

  if (!concessione) {
    throw new Error("Concessione non trovata.");
  }

  requireTenantAccess(context, concessione.enteId, {
    mode: options?.mode ?? "read",
    allowWhenEnteMissing: options?.allowWhenEnteMissing,
  });

  return concessione;
}

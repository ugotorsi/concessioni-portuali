import type { DemoRole } from "@/lib/auth";

const TENANT_SCOPED_ROLES: DemoRole[] = [
  "OPERATORE_SOCIETA",
  "GIURIDICO",
  "TECNICO",
  "ECONOMICO",
  "VIEWER_ADSP",
];

export interface TenantLike {
  id: string;
  codice: string;
  nome: string;
}

export interface TenantMembershipLike {
  id: string;
  userId: string;
  enteId: string;
  role: DemoRole;
  isDefault: boolean;
  ente?: TenantLike | null;
}

export function getDefaultTenantMembership<T extends TenantMembershipLike>(
  memberships: readonly T[],
): T | null {
  if (memberships.length === 0) {
    return null;
  }

  return memberships.find((membership) => membership.isDefault) ?? memberships[0] ?? null;
}

export function resolveTenantLabel(ente: TenantLike | null | undefined): string {
  if (!ente) {
    return "Ente non assegnato";
  }

  return `${ente.nome} (${ente.codice})`;
}

export function isTenantScopedRole(role: DemoRole): boolean {
  return TENANT_SCOPED_ROLES.includes(role);
}

export function resolveDemoEnteCodeForConcessione(input: {
  concessionVertical?: string | null;
  attivita?: string | null;
}): "DEMO-ENTE-ADSP" | "DEMO-COMUNE-COSTIERO" {
  if (
    input.concessionVertical === "MARITTIMA_TURISTICO_RICREATIVA" ||
    input.attivita === "TURISTICO_RICREATIVA"
  ) {
    return "DEMO-COMUNE-COSTIERO";
  }

  return "DEMO-ENTE-ADSP";
}

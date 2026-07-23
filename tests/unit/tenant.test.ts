import { describe, expect, it } from "vitest";

import {
  getDefaultTenantMembership,
  isTenantScopedRole,
  resolveDemoEnteCodeForConcessione,
  resolveTenantLabel,
  type TenantMembershipLike,
} from "@/lib/tenant";

describe("tenant baseline helpers", () => {
  it("returns null when membership list is empty", () => {
    expect(getDefaultTenantMembership([])).toBeNull();
  });

  it("prefers explicit default membership", () => {
    const memberships: TenantMembershipLike[] = [
      {
        id: "tm-1",
        userId: "u-1",
        enteId: "ente-a",
        role: "GIURIDICO",
        isDefault: false,
      },
      {
        id: "tm-2",
        userId: "u-1",
        enteId: "ente-b",
        role: "GIURIDICO",
        isDefault: true,
      },
    ];

    expect(getDefaultTenantMembership(memberships)?.id).toBe("tm-2");
  });

  it("falls back to first membership when no default is set", () => {
    const memberships: TenantMembershipLike[] = [
      {
        id: "tm-1",
        userId: "u-1",
        enteId: "ente-a",
        role: "TECNICO",
        isDefault: false,
      },
      {
        id: "tm-2",
        userId: "u-1",
        enteId: "ente-b",
        role: "TECNICO",
        isDefault: false,
      },
    ];

    expect(getDefaultTenantMembership(memberships)?.id).toBe("tm-1");
  });

  it("formats tenant label consistently", () => {
    expect(resolveTenantLabel({ id: "e-1", nome: "Comune costiero demo", codice: "DEMO-COMUNE-COSTIERO" })).toBe(
      "Comune costiero demo (DEMO-COMUNE-COSTIERO)",
    );
    expect(resolveTenantLabel(null)).toBe("Ente non assegnato");
  });

  it("keeps ADMIN non tenant-scoped and backoffice demo roles tenant-scoped", () => {
    expect(isTenantScopedRole("ADMIN")).toBe(false);
    expect(isTenantScopedRole("OPERATORE_SOCIETA")).toBe(true);
    expect(isTenantScopedRole("GIURIDICO")).toBe(true);
    expect(isTenantScopedRole("TECNICO")).toBe(true);
    expect(isTenantScopedRole("ECONOMICO")).toBe(true);
    expect(isTenantScopedRole("VIEWER_ADSP")).toBe(true);
  });

  it("maps demo concession profile to deterministic ente code", () => {
    expect(
      resolveDemoEnteCodeForConcessione({
        concessionVertical: "MARITTIMA_TURISTICO_RICREATIVA",
        attivita: "COMMERCIALE",
      }),
    ).toBe("DEMO-COMUNE-COSTIERO");

    expect(
      resolveDemoEnteCodeForConcessione({
        concessionVertical: "PORTUALE_ADSP",
        attivita: "TURISTICO_RICREATIVA",
      }),
    ).toBe("DEMO-COMUNE-COSTIERO");

    expect(
      resolveDemoEnteCodeForConcessione({
        concessionVertical: "PORTUALE_ADSP",
        attivita: "LOGISTICA",
      }),
    ).toBe("DEMO-ENTE-ADSP");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContextMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  concessione: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  criticita: {
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  scadenza: {
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  procedimento: {
    groupBy: vi.fn(),
    count: vi.fn(),
  },
  documento: {
    count: vi.fn(),
  },
  report: {
    count: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/tenant-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-auth")>("@/lib/tenant-auth");
  return {
    ...actual,
    getCurrentTenantContext: tenantContextMock,
  };
});

import { getVerticaleWorkspaceBySlug, getVerticaliOverview } from "@/server/queries/verticali";

describe("verticali queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    tenantContextMock.mockResolvedValue({
      userId: "u1",
      role: "GIURIDICO",
      isAdmin: false,
      tenantMemberships: [],
      defaultTenantId: "ente-a",
      accessibleTenantIds: ["ente-a"],
    });

    prismaMock.concessione.count.mockResolvedValue(1);
    prismaMock.concessione.findMany.mockResolvedValue([]);
    prismaMock.criticita.groupBy.mockResolvedValue([]);
    prismaMock.scadenza.groupBy.mockResolvedValue([]);
    prismaMock.procedimento.groupBy.mockResolvedValue([]);
    prismaMock.criticita.count.mockResolvedValue(0);
    prismaMock.scadenza.count.mockResolvedValue(0);
    prismaMock.procedimento.count.mockResolvedValue(0);
    prismaMock.documento.count.mockResolvedValue(0);
    prismaMock.report.count.mockResolvedValue(0);
  });

  it("scopes vertical overview counts by accessible tenant ids", async () => {
    await getVerticaliOverview();

    expect(prismaMock.concessione.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          concessionVertical: expect.any(String),
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("keeps admin platform-wide behavior", async () => {
    tenantContextMock.mockResolvedValue({
      userId: "admin",
      role: "ADMIN",
      isAdmin: true,
      tenantMemberships: [],
      defaultTenantId: null,
      accessibleTenantIds: [],
    });

    await getVerticaliOverview();

    expect(prismaMock.concessione.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          concessionVertical: expect.any(String),
        }),
      }),
    );

    const firstWhere = prismaMock.concessione.count.mock.calls[0][0].where;
    expect(firstWhere.OR).toBeUndefined();
  });

  it("returns null for unknown vertical slug", async () => {
    const result = await getVerticaleWorkspaceBySlug("verticale-non-esistente");
    expect(result).toBeNull();
  });

  it("builds workspace indicators and concessioni for configured slug", async () => {
    prismaMock.concessione.findMany.mockResolvedValue([
      {
        id: "con-1",
        numeroAtto: "CP-001",
        stato: "ATTIVA",
        dataScadenza: new Date("2027-01-01T00:00:00.000Z"),
        ubicazione: "Molo Nord",
        concessionario: {
          denominazione: "Demo Srl",
        },
      },
    ]);
    prismaMock.criticita.groupBy.mockResolvedValue([{ concessioneId: "con-1", _count: { _all: 2 } }]);
    prismaMock.scadenza.groupBy.mockResolvedValue([{ concessioneId: "con-1", _count: { _all: 1 } }]);
    prismaMock.procedimento.groupBy.mockResolvedValue([{ concessioneId: "con-1", _count: { _all: 3 } }]);
    prismaMock.concessione.count.mockResolvedValue(1);
    prismaMock.criticita.count.mockResolvedValue(2);
    prismaMock.scadenza.count.mockResolvedValue(1);
    prismaMock.procedimento.count.mockResolvedValue(3);
    prismaMock.documento.count.mockResolvedValue(4);
    prismaMock.report.count.mockResolvedValue(5);

    const result = await getVerticaleWorkspaceBySlug("portuale-adsp");

    expect(result).not.toBeNull();
    expect(result?.verticale.label).toBe("Portuale / AdSP");
    expect(result?.indicatori).toEqual({
      concessioni: 1,
      criticitaAperte: 2,
      scadenzeAperteScadute: 1,
      procedimentiInCorso: 3,
      documenti: 4,
      report: 5,
    });
    expect(result?.concessioni[0]?.criticitaAperteCount).toBe(2);
  });
});

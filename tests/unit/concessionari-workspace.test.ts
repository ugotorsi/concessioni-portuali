import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContextMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  concessionario: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-auth")>("@/lib/tenant-auth");
  return { ...actual, getCurrentTenantContext: tenantContextMock };
});

import { getConcessionariList, getConcessionarioDetail } from "@/server/queries/concessionari";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("concessionari workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      tenantMemberships: [],
      defaultTenantId: "ente-a",
      accessibleTenantIds: ["ente-a"],
    });
  });

  it("returns one canonical concessionario with all linked concessioni and fascicoli", async () => {
    prismaMock.concessionario.findMany.mockResolvedValue([
      {
        id: "concessionario-canonico",
        denominazione: "Terminal Servizi S.p.A.",
        codiceFiscale: "01234567890",
        partitaIva: null,
        pec: "terminal@example.test",
        email: null,
        telefono: null,
        concessioni: [
          {
            numeroAtto: "CP-001",
            stato: "ATTIVA",
            dataScadenza: new Date("2090-05-01T00:00:00.000Z"),
            procedimenti: [{ id: "proc-1" }],
            criticita: [{ id: "crit-1" }],
            pagamenti: [],
          },
          {
            numeroAtto: "CP-002",
            stato: "IN_PROROGA",
            dataScadenza: new Date("2091-05-01T00:00:00.000Z"),
            procedimenti: [{ id: "proc-2" }, { id: "proc-3" }],
            criticita: [],
            pagamenti: [{ id: "pay-1" }],
          },
        ],
      },
    ]);

    const result = await getConcessionariList();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "concessionario-canonico",
      concessioniCount: 2,
      fascicoliCount: 3,
      criticitaAperteCount: 1,
      pagamentiCriticiCount: 1,
      numeriConcessione: ["CP-001", "CP-002"],
    });
    expect(result.summary).toEqual({ concessionari: 1, concessioniAttive: 1, criticitaAperte: 1 });

    const query = prismaMock.concessionario.findMany.mock.calls[0][0];
    expect(query.where.concessioni.some.OR).toEqual(expect.any(Array));
    expect(query.select.concessioni.where.OR).toEqual(expect.any(Array));
  });

  it("returns detail relations without exposing unavailable fields", async () => {
    prismaMock.concessionario.findFirst.mockResolvedValue({
      id: "canonical-1",
      denominazione: "Approdi Tirrenici",
      codiceFiscale: null,
      partitaIva: "01987654321",
      sedeLegale: null,
      pec: null,
      email: null,
      telefono: null,
      legaleRappresentante: null,
      concessioni: [{
        id: "con-1",
        numeroAtto: "CP-010",
        stato: "ATTIVA",
        ubicazione: "Molo Levante",
        dataRilascio: new Date("2020-01-01T00:00:00.000Z"),
        dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
        canoneAnnuo: null,
        procedimenti: [{ id: "proc-10", tipologia: "CHIARIMENTI", stato: "IN_CORSO", createdAt: new Date() }],
        criticita: [],
        scadenze: [],
        documenti: [],
      }],
    });

    const detail = await getConcessionarioDetail("canonical-1");

    expect(detail?.concessioni[0]?.procedimenti[0]?.id).toBe("proc-10");
    expect(detail?.codiceFiscale).toBeNull();
    expect(detail?.documenti).toEqual([]);
  });

  it("keeps the UI operational, searchable and fascicolo-first", () => {
    const page = readSource("src/app/concessionari/page.tsx");
    const workspace = readSource("src/components/concessionari/ConcessionariWorkspace.tsx");
    const detail = readSource("src/app/concessionari/[id]/page.tsx");
    const sidebar = readSource("src/components/layout/Sidebar.tsx");

    expect(page).toContain("getConcessionariList");
    expect(page).toContain("Soggetti titolari di concessioni e relativi fascicoli.");
    expect(`${page}\n${workspace}`).not.toContain("In preparazione");
    expect(workspace).toContain("filteredItems.map");
    expect(workspace).toContain("item.numeriConcessione");
    expect(workspace).toContain("item.codiceFiscale");
    expect(workspace).toContain("item.partitaIva");
    expect(workspace).toContain("Nessun concessionario disponibile.");
    expect(workspace).toContain("Apri concessionario");
    expect(workspace).not.toContain("tenantId");
    expect(workspace).not.toContain("ID tecnico");
    expect(detail).toContain("href={`/procedimenti/${item.procedimenti[0].id}`}");
    expect(detail).toContain("href={`/concessioni/${item.id}`}");
    expect(detail).toContain("Apri fascicolo");
    expect(detail).toContain("concessionario.codiceFiscale ?");
    expect(detail).toContain("concessionario.documenti.length > 0");
    expect(sidebar).toContain('href: "/procedimenti"');
    expect(sidebar).toContain('href: "/concessionari"');
  });
});
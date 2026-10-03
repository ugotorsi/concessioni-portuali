import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContextMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  concessione: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-auth")>("@/lib/tenant-auth");
  return { ...actual, getCurrentTenantContext: tenantContextMock };
});

import { getMappaWorkspaceData, parseValidCoordinates } from "@/server/queries/mappa";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "con-1",
    numeroAtto: "CP-001/2021",
    stato: "ATTIVA",
    ubicazione: "Molo Nord",
    areaDescrizione: null,
    dataScadenza: new Date("2030-01-01T00:00:00.000Z"),
    latitudineGis: 41.214,
    longitudineGis: 12.501,
    coordinateGis: "41.214,12.501",
    concessionario: { id: "operator-1", denominazione: "Logistica Molo Sud" },
    procedimenti: [{ id: "proc-1" }],
    criticita: [{ id: "crit-1" }, { id: "crit-2" }],
    scadenze: [{ id: "deadline-1" }],
    ...overrides,
  };
}

describe("mappa workspace", () => {
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

  it("accepts numeric and strictly parsed string coordinates", () => {
    expect(parseValidCoordinates({ latitudineGis: 41.2, longitudineGis: 12.5, coordinateGis: null })).toEqual({ lat: 41.2, lng: 12.5 });
    expect(parseValidCoordinates({ latitudineGis: null, longitudineGis: null, coordinateGis: " 41.214, 12.501 " })).toEqual({ lat: 41.214, lng: 12.501 });
    expect(parseValidCoordinates({ latitudineGis: null, longitudineGis: null, coordinateGis: "41.214;12.501" })).toEqual({ lat: 41.214, lng: 12.501 });
  });

  it("rejects incomplete, malformed and out-of-range coordinates without fallbacks", () => {
    expect(parseValidCoordinates({ latitudineGis: 91, longitudineGis: 12, coordinateGis: null })).toBeNull();
    expect(parseValidCoordinates({ latitudineGis: 41, longitudineGis: 181, coordinateGis: null })).toBeNull();
    expect(parseValidCoordinates({ latitudineGis: null, longitudineGis: null, coordinateGis: "Porto commerciale" })).toBeNull();
    expect(parseValidCoordinates({ latitudineGis: null, longitudineGis: null, coordinateGis: "41.2" })).toBeNull();
  });

  it("creates one marker only for each valid concession and keeps invalid records separate", async () => {
    prismaMock.concessione.findMany.mockResolvedValue([
      row(),
      row({
        id: "con-invalid",
        numeroAtto: "CP-INVALID",
        latitudineGis: 120,
        longitudineGis: 12,
        coordinateGis: null,
        concessionario: { id: "operator-2", denominazione: "Terminal Servizi" },
        procedimenti: [],
        criticita: [],
        scadenze: [],
      }),
    ]);

    const result = await getMappaWorkspaceData();

    expect(result.markers).toHaveLength(1);
    expect(result.markers[0]).toMatchObject({
      id: "con-1",
      fascicoloId: "proc-1",
      fascicoliCount: 1,
      criticitaAperteCount: 2,
      scadenzeRilevantiCount: 1,
    });
    expect(result.nonGeolocalizzate).toEqual([
      expect.objectContaining({ id: "con-invalid", numeroAtto: "CP-INVALID" }),
    ]);
    expect(result.summary).toEqual({
      concessioniGeolocalizzate: 1,
      fascicoliCollegati: 1,
      criticitaAperte: 2,
      concessioniNonGeolocalizzate: 1,
    });
    expect(prismaMock.concessione.findMany.mock.calls[0][0].where.OR).toEqual(expect.any(Array));
  });

  it("keeps map behavior operational and fascicolo-first", () => {
    const page = readSource("src/app/mappa/page.tsx");
    const workspace = readSource("src/components/mappa/MappaWorkspace.tsx");
    const query = readSource("src/server/queries/mappa.ts");

    expect(page).toContain('title="Mappa"');
    expect(page).toContain("Distribuzione geografica delle concessioni e dei fascicoli collegati.");
    expect(`${page}\n${workspace}`).not.toContain("placeholder GIS-ready");
    expect(`${page}\n${workspace}`).not.toContain("Rischio ");
    expect(workspace).toContain("filteredItems.map");
    expect(workspace).toContain("leaflet.latLngBounds(points)");
    expect(workspace).toContain("map.fitBounds(bounds");
    expect(workspace).toContain("points.length === 1");
    expect(workspace).toContain('marker.on("add", () => {');
    expect(workspace).toContain('element?.setAttribute("aria-label", `Apri dettagli concessione ${item.numeroAtto}`)');
    expect(workspace).toContain('primary.href = `/procedimenti/${item.fascicoloId}`');
    expect(workspace).toContain('secondary.href = `/concessioni/${item.id}`');
    expect(workspace).toContain("item.concessionarioId === concessionarioId");
    expect(workspace).toContain("item.criticitaAperteCount > 0");
    expect(page).toContain("Non risultano concessioni geolocalizzate.");
    expect(query).not.toContain("fallbackLat");
    expect(query).not.toContain("fallbackLng");
    expect(workspace).not.toContain("tenantId");
    expect(workspace).not.toContain("ID tecnico");
  });
});
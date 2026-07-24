import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContextMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  concessione: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  criticita: {
    groupBy: vi.fn(),
  },
  scadenza: {
    groupBy: vi.fn(),
  },
  pagamento: {
    groupBy: vi.fn(),
  },
  documento: {
    findMany: vi.fn(),
  },
  report: {
    findMany: vi.fn(),
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

import { getConcessioniList } from "@/server/queries/concessioni";
import { getDocumentiList } from "@/server/queries/documenti";
import { getReportList } from "@/server/queries/report";

function expectConcessioniWhereHasTenantAndSearch(where: unknown, tenantId: string, search: string) {
  const and = (where as { AND?: unknown[] }).AND;
  expect(and).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ enteId: { in: [tenantId] } }),
          expect.objectContaining({ enteId: null }),
        ]),
      }),
      expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ numeroAtto: { contains: search } }),
        ]),
      }),
    ]),
  );
}

function createTenantContext(input?: Partial<{
  role: "ADMIN" | "OPERATORE_SOCIETA" | "GIURIDICO" | "TECNICO" | "ECONOMICO" | "VIEWER_ADSP";
  isAdmin: boolean;
  accessibleTenantIds: string[];
  defaultTenantId: string | null;
}>) {
  const role = input?.role ?? "GIURIDICO";
  const isAdmin = input?.isAdmin ?? false;

  return {
    userId: "u-1",
    role,
    isAdmin,
    tenantMemberships: [],
    defaultTenantId: input?.defaultTenantId ?? "ente-a",
    accessibleTenantIds: input?.accessibleTenantIds ?? ["ente-a"],
  };
}

describe("tenant search scope composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    tenantContextMock.mockResolvedValue(createTenantContext());

    prismaMock.concessione.findMany.mockResolvedValue([]);
    prismaMock.concessione.count.mockResolvedValue(0);
    prismaMock.criticita.groupBy.mockResolvedValue([]);
    prismaMock.scadenza.groupBy.mockResolvedValue([]);
    prismaMock.pagamento.groupBy.mockResolvedValue([]);
    prismaMock.documento.findMany.mockResolvedValue([]);
    prismaMock.report.findMany.mockResolvedValue([]);
  });

  it("keeps tenant clause and search clause together for tenant A", async () => {
    await getConcessioniList({ search: "CP-001" });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;
    expectConcessioniWhereHasTenantAndSearch(where, "ente-a", "CP-001");
  });

  it("keeps tenant clause when search is combined with vertical and scalar filters", async () => {
    await getConcessioniList({
      search: "CP",
      concessionVertical: "PORTUALE_ADSP",
      stato: "ATTIVA",
      tipologiaBene: "MOLO",
      attivita: "COMMERCIALE",
    });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;

    expect(where).toMatchObject({
      concessionVertical: "PORTUALE_ADSP",
      stato: "ATTIVA",
      tipologiaBene: "MOLO",
      attivita: "COMMERCIALE",
    });
    expectConcessioniWhereHasTenantAndSearch(where, "ente-a", "CP");
  });

  it("keeps tenant clause and search clause together for tenant B", async () => {
    tenantContextMock.mockResolvedValue(
      createTenantContext({
        role: "TECNICO",
        accessibleTenantIds: ["ente-b"],
        defaultTenantId: "ente-b",
      }),
    );

    await getConcessioniList({ search: "CP" });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;
    expectConcessioniWhereHasTenantAndSearch(where, "ente-b", "CP");
  });

  it("keeps ADMIN search global without tenant constraints", async () => {
    tenantContextMock.mockResolvedValue(
      createTenantContext({
        role: "ADMIN",
        isAdmin: true,
        accessibleTenantIds: [],
        defaultTenantId: null,
      }),
    );

    await getConcessioniList({ search: "CP" });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      OR: expect.arrayContaining([
        expect.objectContaining({ numeroAtto: { contains: "CP" } }),
      ]),
    });
    expect((where as { AND?: unknown }).AND).toBeUndefined();
    expect(JSON.stringify(where)).not.toContain('"enteId"');
  });

  it("preserves null-tenant fallback with search", async () => {
    tenantContextMock.mockResolvedValue(
      createTenantContext({
        role: "GIURIDICO",
        accessibleTenantIds: [],
        defaultTenantId: null,
      }),
    );

    await getConcessioniList({ search: "CP" });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({ enteId: null }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ numeroAtto: { contains: "CP" } }),
          ]),
        }),
      ]),
    });
  });

  it("treats empty and blank search as no-search and does not broaden scope", async () => {
    await getConcessioniList({ search: "   ", stato: "ATTIVA" });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;

    expect(where).toMatchObject({
      stato: "ATTIVA",
      OR: [{ enteId: { in: ["ente-a"] } }, { enteId: null }],
    });
    expect(JSON.stringify(where)).not.toContain('"numeroAtto"');
  });

  it("keeps tenant clause with special or long search strings", async () => {
    const search = "   !!__CP__%__LONG_TOKEN_1234567890__   ";
    await getConcessioniList({ search });

    const where = prismaMock.concessione.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.any(Array),
    });
    expectConcessioniWhereHasTenantAndSearch(where, "ente-a", "!!__CP__%__LONG_TOKEN_1234567890__");
  });

  it("uses explicit AND for document search to avoid tenant OR overwrite", async () => {
    await getDocumentiList({ search: "Titolo", stato: "ATTIVO" });

    const where = prismaMock.documento.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ enteId: { in: ["ente-a"] } }),
          ]),
        }),
        expect.objectContaining({
          statoDocumento: "ATTIVO",
          OR: expect.arrayContaining([
            expect.objectContaining({ nome: { contains: "Titolo" } }),
          ]),
        }),
      ]),
    });
  });

  it("uses explicit AND for report search to avoid tenant OR overwrite", async () => {
    await getReportList({ search: "Dossier", validato: "SI" });

    const where = prismaMock.report.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ enteId: { in: ["ente-a"] } }),
          ]),
        }),
        expect.objectContaining({
          validato: true,
          OR: expect.arrayContaining([
            expect.objectContaining({ titolo: { contains: "Dossier" } }),
          ]),
        }),
      ]),
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantContextMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());
const canManagePagamentiMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  concessione: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  criticita: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  pagamento: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  procedimento: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  sopralluogo: {
    findMany: vi.fn(),
  },
  scadenza: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  normaFonte: {
    count: vi.fn(),
  },
  normaVersione: {
    count: vi.fn(),
  },
  activityLog: {
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

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireRole: requireRoleMock,
    canManagePagamenti: canManagePagamentiMock,
  };
});

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  auditSuccess: auditSuccessMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

import { getDashboardData } from "@/server/queries/dashboard";
import { getMappaDemoData } from "@/server/queries/mappa";
import { getPagamentiSummary } from "@/server/queries/pagamenti";
import { getLatestAuditLogs } from "@/server/queries/audit";
import { updatePagamentoAction } from "@/server/actions/pagamenti";

function createTenantUserContext() {
  return {
    userId: "user-1",
    role: "ECONOMICO" as const,
    isAdmin: false,
    tenantMemberships: [],
    defaultTenantId: "ente-a",
    accessibleTenantIds: ["ente-a"],
  };
}

describe("tenant enforcement coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    tenantContextMock.mockResolvedValue(createTenantUserContext());

    prismaMock.concessione.count.mockResolvedValue(0);
    prismaMock.criticita.count.mockResolvedValue(0);
    prismaMock.pagamento.count.mockResolvedValue(0);
    prismaMock.procedimento.count.mockResolvedValue(0);
    prismaMock.scadenza.count.mockResolvedValue(0);
    prismaMock.normaFonte.count.mockResolvedValue(0);
    prismaMock.normaVersione.count.mockResolvedValue(0);

    prismaMock.criticita.findMany.mockResolvedValue([]);
    prismaMock.scadenza.findMany.mockResolvedValue([]);
    prismaMock.pagamento.findMany.mockResolvedValue([]);
    prismaMock.procedimento.findMany.mockResolvedValue([]);
    prismaMock.sopralluogo.findMany.mockResolvedValue([]);
    prismaMock.concessione.findMany.mockResolvedValue([]);
    prismaMock.activityLog.findMany.mockResolvedValue([]);

    requireRoleMock.mockResolvedValue("ECONOMICO");
    canManagePagamentiMock.mockReturnValue(true);
    auditFailureMock.mockResolvedValue(undefined);
    auditSuccessMock.mockResolvedValue(undefined);
  });

  it("scopes dashboard aggregates by concessione tenant for non-admin", async () => {
    await getDashboardData();

    expect(prismaMock.pagamento.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          concessione: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      }),
    );
  });

  it("scopes mappa queries to accessible tenant concessions", async () => {
    await getMappaDemoData();

    expect(prismaMock.concessione.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("scopes pagamenti summary with tenant-aware concessione filter", async () => {
    await getPagamentiSummary({});

    expect(prismaMock.pagamento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          concessione: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      }),
    );
  });

  it("scopes audit log listing for tenant-scoped users", async () => {
    await getLatestAuditLogs(25);

    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("denies pagamento update on cross-tenant access", async () => {
    prismaMock.pagamento.findUnique.mockResolvedValue({
      id: "pag-1",
      concessioneId: "con-2",
      concessione: {
        enteId: "ente-b",
      },
    });

    const formData = new FormData();
    formData.set("id", "pag-1");
    formData.set("importoVersato", "100");
    formData.set("stato", "PAGATO");

    await expect(updatePagamentoAction(formData)).rejects.toThrow(
      "Operazione non autorizzata per il tenant corrente.",
    );

    expect(prismaMock.pagamento.update).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        azione: "AUTHZ_DENIED",
        entita: "Pagamento",
      }),
    );
  });

  it("allows same-tenant pagamento update where role permits", async () => {
    prismaMock.pagamento.findUnique.mockResolvedValue({
      id: "pag-1",
      concessioneId: "con-1",
      concessione: {
        enteId: "ente-a",
      },
    });
    prismaMock.pagamento.update.mockResolvedValue({ id: "pag-1" });

    const formData = new FormData();
    formData.set("id", "pag-1");
    formData.set("importoVersato", "100");
    formData.set("stato", "PAGATO");

    await expect(updatePagamentoAction(formData)).rejects.toThrow("REDIRECT:/pagamenti/pag-1");

    expect(prismaMock.pagamento.update).toHaveBeenCalledTimes(1);
    expect(auditSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        azione: "PAGAMENTO_UPDATE",
        entitaId: "pag-1",
      }),
    );
  });
});

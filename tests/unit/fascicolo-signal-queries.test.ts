import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  fascicoloSignal: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));

import { getFascicoloSignalsForProcedimento } from "@/server/queries/fascicolo-signals";

describe("FascicoloSignal F2 query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({ role: "GIURIDICO" });
    requireTenantAccessMock.mockReturnValue("GIURIDICO");
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedimento-1",
      concessione: { enteId: "ente-1" },
    });
    prismaMock.fascicoloSignal.findMany.mockResolvedValue([{ id: "signal-1" }]);
  });

  it("returns only the bounded F2 projection in canonical tenant scope", async () => {
    await expect(getFascicoloSignalsForProcedimento("procedimento-1")).resolves.toEqual([{ id: "signal-1" }]);

    expect(requireTenantAccessMock).toHaveBeenCalledWith(expect.anything(), "ente-1", {
      mode: "read",
      allowWhenEnteMissing: false,
    });
    expect(prismaMock.fascicoloSignal.findMany).toHaveBeenCalledWith({
      where: { procedimentoId: "procedimento-1", enteId: "ente-1" },
      orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        humanDisposition: true,
        currentThreshold: true,
        attentionLevel: true,
        dispositionThreshold: true,
        detectedAt: true,
        lastObservedAt: true,
        reviewedAt: true,
        reviewNote: true,
        criticitaId: true,
      },
    });
  });

  it("fails closed without an authenticated tenant context", async () => {
    getCurrentTenantContextMock.mockResolvedValue(null);
    await expect(getFascicoloSignalsForProcedimento("procedimento-1")).resolves.toEqual([]);
    expect(prismaMock.procedimento.findUnique).not.toHaveBeenCalled();
  });

  it("returns no data for a missing canonical tenant", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: null } });
    await expect(getFascicoloSignalsForProcedimento("procedimento-1")).resolves.toEqual([]);
    expect(prismaMock.fascicoloSignal.findMany).not.toHaveBeenCalled();
  });

  it("does not expose signals across tenants", async () => {
    requireTenantAccessMock.mockImplementation(() => { throw new Error("Tenant access denied."); });
    await expect(getFascicoloSignalsForProcedimento("procedimento-1")).resolves.toEqual([]);
    expect(prismaMock.fascicoloSignal.findMany).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
  fascicoloDocumentRequirementProposal: { findMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  activityLog: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));

import { getFascicoloDocumentRequirementProposals } from "@/server/queries/fascicolo-document-requirements";

describe("P1-C1 document requirement query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: "ente-1" } });
    prismaMock.fascicoloDocumentRequirementProposal.findMany.mockResolvedValue([
      {
        id: "proposal-1",
        sourceTitleSnapshot: "L. 28 gennaio 1994 n. 84",
        gapLabelSnapshot: "Verifica titolo autorizzatorio ex art. 16 L. 84/1994",
      },
    ]);
  });

  it("returns immutable snapshots with tenant-scoped reads only", async () => {
    const result = await getFascicoloDocumentRequirementProposals("procedimento-1");
    expect(result).toMatchObject({
      hasCanonicalTenant: true,
      proposals: [{ sourceTitleSnapshot: "L. 28 gennaio 1994 n. 84" }],
    });
    expect(prismaMock.fascicoloDocumentRequirementProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enteId: "ente-1", procedimentoId: "procedimento-1" } }),
    );
    expect(prismaMock.fascicoloDocumentRequirementProposal.create).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloDocumentRequirementProposal.createMany).not.toHaveBeenCalled();
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
  });

  it("returns no data when cross-tenant access is rejected", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("tenant denied");
    });
    await expect(getFascicoloDocumentRequirementProposals("procedimento-1")).resolves.toEqual({
      hasCanonicalTenant: false,
      proposals: [],
    });
    expect(prismaMock.fascicoloDocumentRequirementProposal.findMany).not.toHaveBeenCalled();
  });

  it("returns no data without a canonical tenant", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: null } });
    await expect(getFascicoloDocumentRequirementProposals("procedimento-1")).resolves.toEqual({
      hasCanonicalTenant: false,
      proposals: [],
    });
    expect(prismaMock.fascicoloDocumentRequirementProposal.findMany).not.toHaveBeenCalled();
  });
});
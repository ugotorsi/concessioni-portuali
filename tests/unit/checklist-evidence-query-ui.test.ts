import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn(), update: vi.fn() },
  fascicoloChecklistEvidence: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  documento: { findMany: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/actions/checklist-evidence", () => ({
  createChecklistEvidenceAction: vi.fn(),
  reviewChecklistEvidenceAction: vi.fn(),
}));

import { ChecklistItemEvidence } from "@/components/procedimenti/ChecklistItemEvidence";
import { getChecklistEvidenceData } from "@/server/queries/checklist-evidence";

describe("checklist evidence read model and UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: "ente-1" } });
    prismaMock.fascicoloChecklistEvidence.findMany.mockResolvedValue([]);
    prismaMock.documento.findMany.mockResolvedValue([]);
  });

  it("GET is side-effect free and scopes associated and eligible documents", async () => {
    const result = await getChecklistEvidenceData("procedimento-1");
    expect(result.hasCanonicalTenant).toBe(true);
    expect(prismaMock.fascicoloChecklistEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ enteId: "ente-1", procedimentoId: "procedimento-1" }),
    }));
    expect(prismaMock.documento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { enteId: "ente-1", procedimentoId: "procedimento-1", statoDocumento: "ATTIVO" },
    }));
    expect(prismaMock.procedimento.update).not.toHaveBeenCalled();
    expect(prismaMock.documento.update).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloChecklistEvidence.create).not.toHaveBeenCalled();
  });

  it("returns persisted evidence after reload without writing", async () => {
    prismaMock.fascicoloChecklistEvidence.findMany.mockResolvedValue([{ id: "evidence-1" }]);
    const result = await getChecklistEvidenceData("procedimento-1");
    expect(result.evidence).toEqual([{ id: "evidence-1" }]);
    expect(prismaMock.fascicoloChecklistEvidence.update).not.toHaveBeenCalled();
  });

  it("null canonical tenant yields no active association submit", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: null } });
    const data = await getChecklistEvidenceData("procedimento-1");
    const html = renderToStaticMarkup(createElement(ChecklistItemEvidence, {
      procedimentoId: "procedimento-1",
      itemCode: "COMUNICAZIONE_AVVIO_INVIATA",
      canManage: true,
      data,
    }));
    expect(data.hasCanonicalTenant).toBe(false);
    expect(html).not.toContain("Associa documento");
    expect(prismaMock.fascicoloChecklistEvidence.findMany).not.toHaveBeenCalled();
    expect(prismaMock.documento.findMany).not.toHaveBeenCalled();
  });
});
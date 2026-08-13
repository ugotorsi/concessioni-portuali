import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const matcherMock = vi.hoisted(() => vi.fn());
const genericResolverMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn(), update: vi.fn() },
  fascicoloDocumentRequirementProposal: { findMany: vi.fn(), update: vi.fn() },
  fascicoloDocumentRequirementEvidence: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  documento: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  legalSource: { findUnique: vi.fn() },
  legalRule: { findUnique: vi.fn() },
  documentGap: { findUnique: vi.fn() },
  activityLog: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/fascicolo-document-requirements/matcher", () => ({
  evaluateP1C1DocumentRequirement: matcherMock,
}));
vi.mock("@/server/legal-rules/orchestrator", () => ({ resolveApplicableLegalRules: genericResolverMock }));

import { getFascicoloDocumentRequirementEvidenceData } from "@/server/queries/fascicolo-document-requirement-evidence";

const activeAssociation = {
  id: "evidence-active",
  proposalId: "proposal-1",
  documentoId: "documento-1",
  createdAt: new Date("2026-08-12T08:00:00.000Z"),
  createdByActorId: "creator-1",
  createdByEmail: "creator@example.test",
  createdByRole: "ADMIN",
  revokedAt: null,
  revokedByActorId: null,
  revokedByEmail: null,
  revokedByRole: null,
  revocationNote: null,
  documento: {
    id: "documento-1",
    nome: "Titolo autorizzatorio.pdf",
    tipologia: "ATTO",
    statoDocumento: "ATTIVO",
    dataDocumento: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T08:00:00.000Z"),
  },
};

const revokedAssociation = {
  ...activeAssociation,
  id: "evidence-revoked",
  documentoId: "documento-2",
  revokedAt: new Date("2026-08-12T09:00:00.000Z"),
  revokedByActorId: "reviewer-1",
  revokedByEmail: "reviewer@example.test",
  revokedByRole: "GIURIDICO",
  revocationNote: "Collegamento errato",
  documento: {
    ...activeAssociation.documento,
    id: "documento-2",
    nome: "Documento revocato.pdf",
  },
};

const documents = [
  { id: "documento-1", nome: "Titolo autorizzatorio.pdf", tipologia: "ATTO", dataDocumento: null, createdAt: new Date() },
  { id: "documento-2", nome: "Documento revocato.pdf", tipologia: "ATTO", dataDocumento: null, createdAt: new Date() },
  { id: "documento-3", nome: "Documento candidato.pdf", tipologia: "ATTO", dataDocumento: null, createdAt: new Date() },
];

describe("P1-NEXT-02A requirement evidence query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue({ id: "procedimento-1", concessione: { enteId: "ente-1" } });
    prismaMock.fascicoloDocumentRequirementProposal.findMany.mockResolvedValue([
      { id: "proposal-1" },
      { id: "proposal-2" },
    ]);
    prismaMock.fascicoloDocumentRequirementEvidence.findMany.mockResolvedValue([
      activeAssociation,
      revokedAssociation,
    ]);
    prismaMock.documento.findMany.mockResolvedValue(documents);
  });

  it("derives the canonical tenant from the procedure", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      {},
      "ente-1",
      { mode: "read", allowWhenEnteMissing: false },
    );
  });

  it("returns no data when cross-tenant procedure access is rejected", async () => {
    requireTenantAccessMock.mockImplementation(() => { throw new Error("tenant denied"); });
    await expect(getFascicoloDocumentRequirementEvidenceData("procedimento-1")).resolves.toEqual({
      hasCanonicalTenant: false,
      associationsByProposalId: {},
      eligibleDocumentsByProposalId: {},
    });
  });

  it("is side-effect free", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.procedimento.update).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloDocumentRequirementEvidence.create).not.toHaveBeenCalled();
    expect(prismaMock.fascicoloDocumentRequirementEvidence.update).not.toHaveBeenCalled();
  });

  it("groups associations by proposalId", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"]).toHaveLength(2);
    expect(result.associationsByProposalId["proposal-2"]).toEqual([]);
  });

  it("returns an active association with revokedAt null", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"][0]).toMatchObject({ id: "evidence-active", revokedAt: null });
  });

  it("returns and distinguishes revoked historical association", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"][1]).toMatchObject({
      id: "evidence-revoked",
      revokedAt: expect.any(Date),
    });
  });

  it("returns creator provenance", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"][0]).toMatchObject({
      createdByActorId: "creator-1",
      createdByEmail: "creator@example.test",
      createdByRole: "ADMIN",
    });
  });

  it("returns revoker provenance and reason", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"][1]).toMatchObject({
      revokedByActorId: "reviewer-1",
      revokedByEmail: "reviewer@example.test",
      revokedByRole: "GIURIDICO",
      revocationNote: "Collegamento errato",
    });
  });

  it("returns safe Documento display and download-identifying metadata", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.associationsByProposalId["proposal-1"][0].documento).toMatchObject({
      id: "documento-1",
      nome: "Titolo autorizzatorio.pdf",
      tipologia: "ATTO",
    });
  });

  it("queries active same-procedure documents as eligible candidates", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.documento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { enteId: "ente-1", procedimentoId: "procedimento-1", statoDocumento: "ATTIVO" },
    }));
  });

  it("excludes inactive documents through the query predicate", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.documento.findMany.mock.calls[0][0].where.statoDocumento).toBe("ATTIVO");
  });

  it("excludes documents from other procedures through the query predicate", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.documento.findMany.mock.calls[0][0].where.procedimentoId).toBe("procedimento-1");
  });

  it("excludes documents from other tenants through the query predicate", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.documento.findMany.mock.calls[0][0].where.enteId).toBe("ente-1");
  });

  it("does not reoffer an actively associated document for the same proposal", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.eligibleDocumentsByProposalId["proposal-1"].map((item) => item.id)).not.toContain("documento-1");
  });

  it("does not reoffer a revoked historical tuple for the same proposal", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.eligibleDocumentsByProposalId["proposal-1"].map((item) => item.id)).not.toContain("documento-2");
  });

  it("keeps the same Documento eligible for a different VALIDATO proposal", async () => {
    const result = await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(result.eligibleDocumentsByProposalId["proposal-2"].map((item) => item.id)).toContain("documento-1");
  });

  it("selects no binary or storage payload", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    const calls = JSON.stringify(prismaMock.fascicoloDocumentRequirementEvidence.findMany.mock.calls);
    expect(calls).not.toContain("storageKey");
    expect(calls).not.toContain("checksumSha256");
    expect(calls).not.toContain("url");
  });

  it("does not call the matcher", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(matcherMock).not.toHaveBeenCalled();
  });

  it("does not call the generic resolver", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(genericResolverMock).not.toHaveBeenCalled();
  });

  it("does not query the legal catalog", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.legalSource.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.legalRule.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.documentGap.findUnique).not.toHaveBeenCalled();
  });

  it("performs no writes during GET", async () => {
    await getFascicoloDocumentRequirementEvidenceData("procedimento-1");
    expect(prismaMock.fascicoloDocumentRequirementProposal.update).not.toHaveBeenCalled();
    expect(prismaMock.documento.create).not.toHaveBeenCalled();
    expect(prismaMock.documento.update).not.toHaveBeenCalled();
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
  });
});
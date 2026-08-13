import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  fascicoloDocumentRequirementEvidence: {
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  fascicoloDocumentRequirementProposal: { findUnique: vi.fn(), update: vi.fn() },
  fascicoloDocumentRequirementEvidence: { findUnique: vi.fn(), update: vi.fn() },
  documento: { findUnique: vi.fn(), update: vi.fn() },
  procedimento: { update: vi.fn() },
  concessione: { update: vi.fn() },
  fascicoloChecklistEvidence: { update: vi.fn() },
  fascicoloObservation: { update: vi.fn() },
  legalSource: { update: vi.fn() },
  legalRule: { update: vi.fn() },
  documentGap: { update: vi.fn() },
  user: { create: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  canManageProcedimenti: canManageProcedimentiMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditInTransactionMock }));

import {
  createFascicoloDocumentRequirementEvidence,
  revokeFascicoloDocumentRequirementEvidence,
} from "@/server/actions/fascicolo-document-requirement-evidence";

const proposal = {
  id: "proposal-1",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  status: "VALIDATO",
  procedimento: {
    concessioneId: "concessione-1",
    concessione: { enteId: "ente-1" },
  },
};

const documento = {
  id: "documento-1",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  statoDocumento: "ATTIVO",
};

const activeEvidence = {
  id: "evidence-1",
  enteId: "ente-1",
  proposalId: "proposal-1",
  documentoId: "documento-1",
  revokedAt: null,
};

const evidenceForRevoke = {
  ...activeEvidence,
  proposal,
  documento: { enteId: "ente-1", procedimentoId: "procedimento-1" },
};

function createInput(overrides: Record<string, unknown> = {}) {
  return { proposalId: "proposal-1", documentoId: "documento-1", ...overrides };
}

function revokeInput(revocationNote = "Associazione non pertinente") {
  return { evidenceId: "evidence-1", revocationNote };
}

describe("P1-NEXT-02A requirement evidence actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue(proposal);
    prismaMock.documento.findUnique.mockResolvedValue(documento);
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue(evidenceForRevoke);
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 1 });
    txMock.fascicoloDocumentRequirementEvidence.findUniqueOrThrow.mockResolvedValue(activeEvidence);
    txMock.fascicoloDocumentRequirementEvidence.updateMany.mockResolvedValue({ count: 1 });
    auditInTransactionMock.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(txMock));
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"])("allows %s to create an association", async (role) => {
    requireRoleMock.mockResolvedValue(role);
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).resolves.toMatchObject({ created: true });
  });

  it("rejects an unauthorized role", async () => {
    canManageProcedimentiMock.mockReturnValue(false);
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("non autorizzato");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("derives and enforces the canonical tenant server-side", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      {},
      "ente-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
  });

  it("rejects a proposal whose tenant snapshot differs from its canonical procedure tenant", async () => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...proposal, enteId: "ente-2" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("tenant canonico");
  });

  it("rejects a cross-tenant Documento", async () => {
    prismaMock.documento.findUnique.mockResolvedValue({ ...documento, enteId: "ente-2" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("non eleggibile");
  });

  it("rejects a Documento linked to a different procedure", async () => {
    prismaMock.documento.findUnique.mockResolvedValue({ ...documento, procedimentoId: "procedimento-2" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("non eleggibile");
  });

  it("rejects an inactive Documento", async () => {
    prismaMock.documento.findUnique.mockResolvedValue({ ...documento, statoDocumento: "ARCHIVIATO" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("non eleggibile");
  });

  it("rejects a PROPOSTO proposal", async () => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...proposal, status: "PROPOSTO" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("validato");
  });

  it("rejects a RIFIUTATO proposal", async () => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...proposal, status: "RIFIUTATO" });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("validato");
  });

  it("accepts a VALIDATO proposal without changing its status", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(prismaMock.fascicoloDocumentRequirementProposal.update).not.toHaveBeenCalled();
  });

  it.each(["enteId", "procedimentoId", "status"])("rejects client-authoritative %s", async (field) => {
    await expect(createFascicoloDocumentRequirementEvidence(createInput({ [field]: "override" }))).rejects.toThrow();
    expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
  });

  it("stores a null creator User FK for the technical actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdByUserId: null, createdByActorId: "staging-preview-admin" }) }),
    );
  });

  it("retains the persisted creator User FK", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdByUserId: "user-1" }) }),
    );
  });

  it("never creates or upserts a synthetic User", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
  });

  it("creates the association and CREATE audit in the same transaction", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_CREATE" }),
    );
  });

  it("propagates CREATE audit failure before revalidation", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("audit failed");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns an existing active association idempotently", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 0 });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).resolves.toMatchObject({ created: false });
  });

  it("creates no second audit for an existing active association", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 0 });
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("handles concurrent identical creates as one inserted domain row", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const results = await Promise.all([
      createFascicoloDocumentRequirementEvidence(createInput()),
      createFascicoloDocumentRequirementEvidence(createInput()),
    ]);
    expect(results.map((result) => result.created)).toEqual([true, false]);
  });

  it("creates one CREATE audit for concurrent identical creates", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await Promise.all([
      createFascicoloDocumentRequirementEvidence(createInput()),
      createFascicoloDocumentRequirementEvidence(createInput()),
    ]);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("rejects creation when the unique association was previously revoked", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 0 });
    txMock.fascicoloDocumentRequirementEvidence.findUniqueOrThrow.mockResolvedValue({
      ...activeEvidence,
      revokedAt: new Date(),
    });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow("riassociazione");
  });

  it("creates no audit when a revoked tuple is submitted again", async () => {
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 0 });
    txMock.fascicoloDocumentRequirementEvidence.findUniqueOrThrow.mockResolvedValue({
      ...activeEvidence,
      revokedAt: new Date(),
    });
    await expect(createFascicoloDocumentRequirementEvidence(createInput())).rejects.toThrow();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("rejects a blank revocation reason %j", async (revocationNote) => {
    await expect(revokeFascicoloDocumentRequirementEvidence(revokeInput(revocationNote))).rejects.toThrow();
    expect(prismaMock.fascicoloDocumentRequirementEvidence.findUnique).not.toHaveBeenCalled();
  });

  it("stores the trimmed revocation reason", async () => {
    await revokeFascicoloDocumentRequirementEvidence(revokeInput("  Collegamento errato  "));
    expect(txMock.fascicoloDocumentRequirementEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revocationNote: "Collegamento errato" }) }),
    );
  });

  it("stores a null revoker User FK for the technical actor", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });
    await revokeFascicoloDocumentRequirementEvidence(revokeInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedByUserId: null, revokedByActorId: "staging-preview-admin" }) }),
    );
  });

  it("retains the persisted revoker User FK", async () => {
    await revokeFascicoloDocumentRequirementEvidence(revokeInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedByUserId: "user-1" }) }),
    );
  });

  it("uses an active-only tenant-scoped revocation CAS", async () => {
    await revokeFascicoloDocumentRequirementEvidence(revokeInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evidence-1", enteId: "ente-1", revokedAt: null } }),
    );
  });

  it("allows only one concurrent revocation winner", async () => {
    txMock.fascicoloDocumentRequirementEvidence.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([
      revokeFascicoloDocumentRequirementEvidence(revokeInput("Prima revoca")),
      revokeFascicoloDocumentRequirementEvidence(revokeInput("Seconda revoca")),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
  });

  it("creates no revoke audit for the concurrent CAS loser", async () => {
    txMock.fascicoloDocumentRequirementEvidence.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await Promise.allSettled([
      revokeFascicoloDocumentRequirementEvidence(revokeInput("Prima revoca")),
      revokeFascicoloDocumentRequirementEvidence(revokeInput("Seconda revoca")),
    ]);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("revokes and writes its audit in the same transaction", async () => {
    await revokeFascicoloDocumentRequirementEvidence(revokeInput());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_REVOKE" }),
    );
  });

  it("propagates revoke audit failure before revalidation", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(revokeFascicoloDocumentRequirementEvidence(revokeInput())).rejects.toThrow("audit failed");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("does not include revocationNote text in audit metadata", async () => {
    await revokeFascicoloDocumentRequirementEvidence(revokeInput("Testo riservato"));
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        metadata: {
          evidenceId: "evidence-1",
          proposalId: "proposal-1",
          documentoId: "documento-1",
          revocationNotePresent: true,
        },
      }),
    );
  });

  it("writes only Evidence and ActivityLog during creation", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(txMock.fascicoloDocumentRequirementEvidence.createMany).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("never writes Proposal", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(prismaMock.fascicoloDocumentRequirementProposal.update).not.toHaveBeenCalled();
  });

  it("never writes Documento", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    expect(prismaMock.documento.update).not.toHaveBeenCalled();
  });

  it("never writes ChecklistEvidence or other frozen models", async () => {
    await createFascicoloDocumentRequirementEvidence(createInput());
    for (const model of [
      prismaMock.procedimento,
      prismaMock.concessione,
      prismaMock.fascicoloChecklistEvidence,
      prismaMock.fascicoloObservation,
      prismaMock.legalSource,
      prismaMock.legalRule,
      prismaMock.documentGap,
    ]) {
      expect(model.update).not.toHaveBeenCalled();
    }
  });
});
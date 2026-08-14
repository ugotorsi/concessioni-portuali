import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  fascicoloDocumentRequirementEvidence: {
    createMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
  fascicoloDocumentRequirementEvidenceReview: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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
  reviewFascicoloDocumentRequirementEvidence,
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

const reviewReceipt = {
  id: "review-1",
  evidenceId: "evidence-1",
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  reviewedByUserId: "user-1",
  reviewedByActorId: "user-1",
  reviewedByEmail: "admin@example.test",
  reviewedByRole: "ADMIN",
  reviewNote: "Esame documentale registrato",
};

function createInput(overrides: Record<string, unknown> = {}) {
  return { proposalId: "proposal-1", documentoId: "documento-1", ...overrides };
}

function revokeInput(revocationNote = "Associazione non pertinente") {
  return { evidenceId: "evidence-1", revocationNote };
}

function reviewInput(reviewNote = "Esame documentale registrato", overrides: Record<string, unknown> = {}) {
  return { evidenceId: "evidence-1", reviewNote, ...overrides };
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
    txMock.$queryRaw.mockResolvedValue([{ id: "evidence-1" }]);
    txMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue(evidenceForRevoke);
    txMock.fascicoloDocumentRequirementEvidence.createMany.mockResolvedValue({ count: 1 });
    txMock.fascicoloDocumentRequirementEvidence.findUniqueOrThrow.mockResolvedValue(activeEvidence);
    txMock.fascicoloDocumentRequirementEvidence.updateMany.mockResolvedValue({ count: 1 });
    txMock.fascicoloDocumentRequirementEvidenceReview.findUnique.mockResolvedValue(null);
    txMock.fascicoloDocumentRequirementEvidenceReview.create.mockResolvedValue(reviewReceipt);
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

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"])("allows %s to record one human review receipt", async (role) => {
    requireRoleMock.mockResolvedValue(role);
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput())).resolves.toMatchObject({ created: true });
  });

  it("rejects an unauthorized evidence review", async () => {
    canManageProcedimentiMock.mockReturnValue(false);
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput())).rejects.toThrow("non autorizzato");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a revoked Evidence before review", async () => {
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue({
      ...evidenceForRevoke,
      revokedAt: new Date(),
    });
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput())).rejects.toThrow("revocata");
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).not.toHaveBeenCalled();
  });

  it("derives review tenant access from the canonical procedure tenant", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      {},
      "ente-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
  });

  it("derives procedure and concession for the review audit", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        enteId: "ente-1",
        concessioneId: "concessione-1",
        metadata: expect.objectContaining({ procedimentoId: "procedimento-1" }),
      }),
    );
  });

  it("rejects cross-tenant Evidence review", async () => {
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockResolvedValue({
      ...evidenceForRevoke,
      enteId: "ente-2",
    });
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput())).rejects.toThrow("tenant canonico");
  });

  it.each(["enteId", "tenant", "procedimentoId", "concessioneId", "proposalId", "documentoId", "status", "outcome"])(
    "rejects client-authoritative review field %s",
    async (field) => {
      await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput("Nota", { [field]: "override" }))).rejects.toThrow();
      expect(prismaMock.fascicoloDocumentRequirementEvidence.findUnique).not.toHaveBeenCalled();
    },
  );

  it("stores trimmed review notes bounded to 2000 characters", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput("  Nota umana  "));
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewNote: "Nota umana" }) }),
    );
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput("x".repeat(2001)))).rejects.toThrow();
  });

  it("stores null User FK and required snapshots for the technical actor review", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test" });
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewedByUserId: null,
        reviewedByActorId: "staging-preview-admin",
        reviewedByEmail: "preview@example.test",
        reviewedByRole: "ADMIN",
      }),
    });
  });

  it("retains ordinary actor provenance on the review receipt", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewedByUserId: "user-1",
        reviewedByActorId: "user-1",
        reviewedByEmail: "admin@example.test",
        reviewedByRole: "ADMIN",
      }),
    });
  });

  it("uses a parameterized row lock before re-reading Evidence", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, parameter] = txMock.$queryRaw.mock.calls[0];
    expect(Array.from(sql).join("?")).toContain("FOR UPDATE");
    expect(Array.from(sql).join("?")).not.toContain("evidence-1");
    expect(parameter).toBe("evidence-1");
    expect(txMock.fascicoloDocumentRequirementEvidence.findUnique).toHaveBeenCalledAfter(txMock.$queryRaw);
  });

  it("creates Review and audit atomically with neutral metadata", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_REVIEW",
        entita: "FascicoloDocumentRequirementEvidenceReview",
        metadata: {
          evidenceId: "evidence-1",
          proposalId: "proposal-1",
          documentoId: "documento-1",
          procedimentoId: "procedimento-1",
          reviewNotePresent: true,
          semanticMarker: "HUMAN_REVIEW_PERFORMED_NO_LEGAL_CONCLUSION",
        },
      }),
    );
  });

  it("rolls back Review when its audit fails", async () => {
    let persistedReview = false;
    txMock.fascicoloDocumentRequirementEvidenceReview.create.mockImplementation(async () => {
      persistedReview = true;
      return reviewReceipt;
    });
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    prismaMock.$transaction.mockImplementation(async (callback) => {
      try {
        return await callback(txMock);
      } catch (error) {
        persistedReview = false;
        throw error;
      }
    });
    await expect(reviewFascicoloDocumentRequirementEvidence(reviewInput())).rejects.toThrow("audit failed");
    expect(persistedReview).toBe(false);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("concurrent reviews converge to the winner receipt without claiming loser provenance", async () => {
    let storedReview: typeof reviewReceipt | null = null;
    let transactionQueue = Promise.resolve<unknown>(undefined);
    prismaMock.$transaction.mockImplementation((callback) => {
      const result = transactionQueue.then(() => callback(txMock));
      transactionQueue = result.catch(() => undefined);
      return result;
    });
    txMock.fascicoloDocumentRequirementEvidenceReview.findUnique.mockImplementation(async () => storedReview);
    txMock.fascicoloDocumentRequirementEvidenceReview.create.mockImplementation(async ({ data }) => {
      storedReview = { ...reviewReceipt, ...data, reviewNote: data.reviewNote };
      return storedReview;
    });
    getCurrentUserMock
      .mockResolvedValueOnce({ id: "winner", email: "winner@example.test" })
      .mockResolvedValueOnce({ id: "loser", email: "loser@example.test" });

    const results = await Promise.all([
      reviewFascicoloDocumentRequirementEvidence(reviewInput("Nota vincente")),
      reviewFascicoloDocumentRequirementEvidence(reviewInput("Nota perdente")),
    ]);

    expect(results.map((result) => result.created)).toEqual([true, false]);
    expect(results[1].review).toMatchObject({
      reviewedByActorId: "winner",
      reviewedByEmail: "winner@example.test",
      reviewNote: "Nota vincente",
    });
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("review wins before revocation and both immutable histories remain", async () => {
    let revokedAt: Date | null = null;
    let storedReview: typeof reviewReceipt | null = null;
    let transactionQueue = Promise.resolve<unknown>(undefined);
    const currentEvidence = () => ({ ...evidenceForRevoke, revokedAt });
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockImplementation(async () => currentEvidence());
    txMock.fascicoloDocumentRequirementEvidence.findUnique.mockImplementation(async () => currentEvidence());
    txMock.fascicoloDocumentRequirementEvidenceReview.findUnique.mockImplementation(async () => storedReview);
    txMock.fascicoloDocumentRequirementEvidenceReview.create.mockImplementation(async () => {
      storedReview = reviewReceipt;
      return reviewReceipt;
    });
    txMock.fascicoloDocumentRequirementEvidence.updateMany.mockImplementation(async () => {
      if (revokedAt) return { count: 0 };
      revokedAt = new Date();
      return { count: 1 };
    });
    prismaMock.$transaction.mockImplementation((callback) => {
      const result = transactionQueue.then(() => callback(txMock));
      transactionQueue = result.catch(() => undefined);
      return result;
    });

    const [reviewResult, revokeResult] = await Promise.allSettled([
      reviewFascicoloDocumentRequirementEvidence(reviewInput()),
      revokeFascicoloDocumentRequirementEvidence(revokeInput()),
    ]);

    expect(reviewResult.status).toBe("fulfilled");
    expect(revokeResult.status).toBe("fulfilled");
    expect(storedReview).toEqual(reviewReceipt);
    expect(revokedAt).toBeInstanceOf(Date);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(2);
  });

  it("revocation wins before review, which creates no receipt or audit", async () => {
    let revokedAt: Date | null = null;
    let transactionQueue = Promise.resolve<unknown>(undefined);
    const currentEvidence = () => ({ ...evidenceForRevoke, revokedAt });
    prismaMock.fascicoloDocumentRequirementEvidence.findUnique.mockImplementation(async () => currentEvidence());
    txMock.fascicoloDocumentRequirementEvidence.findUnique.mockImplementation(async () => currentEvidence());
    txMock.fascicoloDocumentRequirementEvidence.updateMany.mockImplementation(async () => {
      if (revokedAt) return { count: 0 };
      revokedAt = new Date();
      return { count: 1 };
    });
    prismaMock.$transaction.mockImplementation((callback) => {
      const result = transactionQueue.then(() => callback(txMock));
      transactionQueue = result.catch(() => undefined);
      return result;
    });

    const [revokeResult, reviewResult] = await Promise.allSettled([
      revokeFascicoloDocumentRequirementEvidence(revokeInput()),
      reviewFascicoloDocumentRequirementEvidence(reviewInput()),
    ]);

    expect(revokeResult.status).toBe("fulfilled");
    expect(reviewResult.status).toBe("rejected");
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.create).not.toHaveBeenCalled();
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ azione: "FASCICOLO_DOCUMENT_REQUIREMENT_EVIDENCE_REVOKE" }),
    );
  });

  it("introduces no Review update or delete path and no legal outcome data", async () => {
    await reviewFascicoloDocumentRequirementEvidence(reviewInput());
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.update).not.toHaveBeenCalled();
    expect(txMock.fascicoloDocumentRequirementEvidenceReview.delete).not.toHaveBeenCalled();
    const data = txMock.fascicoloDocumentRequirementEvidenceReview.create.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual([
      "evidenceId",
      "reviewNote",
      "reviewedByActorId",
      "reviewedByEmail",
      "reviewedByRole",
      "reviewedByUserId",
    ]);
  });
});
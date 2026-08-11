import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  fascicoloChecklistEvidence: {
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn(), update: vi.fn() },
  documento: { findUnique: vi.fn(), update: vi.fn() },
  fascicoloChecklistEvidence: { findUnique: vi.fn() },
  criticita: { update: vi.fn() },
  decisioneProcedimento: { update: vi.fn() },
  concessione: { update: vi.fn() },
  fascicoloObservation: { update: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

vi.mock("@/lib/auth", () => ({
  canManageProcedimenti: vi.fn(() => true),
  getCurrentUser: getCurrentUserMock,
  requireRole: requireRoleMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditInTransactionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  createChecklistEvidenceAction,
  reviewChecklistEvidenceAction,
} from "@/server/actions/checklist-evidence";

const procedimento = {
  id: "procedimento-1",
  concessioneId: "concessione-1",
  concessione: { enteId: "ente-1" },
  tipologia: "ALTRO",
  origineProcedimento: "UFFICIO",
  procedimentoUfficio: true,
};
const documento = {
  id: "documento-1",
  statoDocumento: "ATTIVO",
  procedimentoId: "procedimento-1",
  enteId: "ente-1",
};
const evidence = {
  id: "evidence-1",
  status: "PROPOSTO",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  documentoId: "documento-1",
  checklistItemCode: "COMUNICAZIONE_AVVIO_INVIATA",
  procedimento: { concessioneId: "concessione-1", concessione: { enteId: "ente-1" } },
  documento: { enteId: "ente-1", procedimentoId: "procedimento-1" },
};

function createForm(code = "COMUNICAZIONE_AVVIO_INVIATA") {
  const formData = new FormData();
  formData.set("procedimentoId", "procedimento-1");
  formData.set("documentoId", "documento-1");
  formData.set("checklistItemCode", code);
  return formData;
}

function reviewForm(status: "VALIDATO" | "RIFIUTATO", note?: string) {
  const formData = new FormData();
  formData.set("evidenceId", "evidence-1");
  formData.set("status", status);
  if (note) formData.set("reviewNote", note);
  return formData;
}

describe("checklist evidence actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue(procedimento);
    prismaMock.documento.findUnique.mockResolvedValue(documento);
    prismaMock.fascicoloChecklistEvidence.findUnique.mockResolvedValue(evidence);
    txMock.fascicoloChecklistEvidence.createMany.mockResolvedValue({ count: 1 });
    txMock.fascicoloChecklistEvidence.findUniqueOrThrow.mockResolvedValue({ id: "evidence-1", status: "PROPOSTO" });
    txMock.fascicoloChecklistEvidence.updateMany.mockResolvedValue({ count: 1 });
    auditInTransactionMock.mockResolvedValue({});
  });

  it("creates an applicable item as PROPOSTO with audit in the same transaction", async () => {
    await createChecklistEvidenceAction(createForm());
    expect(txMock.fascicoloChecklistEvidence.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({ azione: "CHECKLIST_EVIDENCE_CREATE" }));
  });

  it("rejects an unknown code before any transaction", async () => {
    await expect(createChecklistEvidenceAction(createForm("UNKNOWN"))).rejects.toThrow();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a globally valid conditional item not present in the real checklist", async () => {
    await expect(createChecklistEvidenceAction(createForm("PREAVVISO_INVIATO"))).rejects.toThrow("non applicabile");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["other procedure", { ...documento, procedimentoId: "procedimento-2" }],
    ["other tenant", { ...documento, enteId: "ente-2" }],
    ["archived", { ...documento, statoDocumento: "ARCHIVIATO" }],
    ["concession only", { ...documento, procedimentoId: null }],
  ])("rejects an ineligible document: %s", async (_label, candidate) => {
    prismaMock.documento.findUnique.mockResolvedValue(candidate);
    await expect(createChecklistEvidenceAction(createForm())).rejects.toThrow("non eleggibile");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a null canonical tenant", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue({ ...procedimento, concessione: { enteId: null } });
    await expect(createChecklistEvidenceAction(createForm())).rejects.toThrow("tenant canonico");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("deduplicates repeated or concurrent creates through the unique-backed insert", async () => {
    txMock.fascicoloChecklistEvidence.createMany.mockResolvedValue({ count: 0 });
    await createChecklistEvidenceAction(createForm());
    expect(txMock.fascicoloChecklistEvidence.findUniqueOrThrow).toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["staging-preview-admin", null],
    ["user-1", "user-1"],
  ])("stores actor %s with the expected User FK", async (actorId, expectedUserId) => {
    getCurrentUserMock.mockResolvedValue({ id: actorId, email: "actor@example.test", role: "ADMIN" });
    await createChecklistEvidenceAction(createForm());
    expect(txMock.fascicoloChecklistEvidence.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdByActorId: actorId, createdByUserId: expectedUserId }) }),
    );
  });

  it("rolls back the create transaction path when audit fails", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(createChecklistEvidenceAction(createForm())).rejects.toThrow("audit failed");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("reviews as VALIDATO with an atomic optimistic guard and no core writes", async () => {
    await reviewChecklistEvidenceAction(reviewForm("VALIDATO"));
    expect(txMock.fascicoloChecklistEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evidence-1", status: "PROPOSTO", enteId: "ente-1" } }),
    );
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({ azione: "CHECKLIST_EVIDENCE_REVIEW" }));
    for (const model of [prismaMock.procedimento, prismaMock.documento, prismaMock.criticita, prismaMock.decisioneProcedimento, prismaMock.concessione, prismaMock.fascicoloObservation]) {
      expect(model.update).not.toHaveBeenCalled();
    }
  });

  it("requires a nonblank note for RIFIUTATO", async () => {
    await expect(reviewChecklistEvidenceAction(reviewForm("RIFIUTATO"))).rejects.toThrow("nota di review");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(["VALIDATO", "RIFIUTATO"])("treats existing %s evidence as terminal", async (status) => {
    prismaMock.fascicoloChecklistEvidence.findUnique.mockResolvedValue({ ...evidence, status });
    await expect(reviewChecklistEvidenceAction(reviewForm("VALIDATO"))).rejects.toThrow("non disponibile");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("allows only one concurrent review and emits no losing audit", async () => {
    txMock.fascicoloChecklistEvidence.updateMany.mockResolvedValue({ count: 0 });
    await expect(reviewChecklistEvidenceAction(reviewForm("VALIDATO"))).rejects.toThrow("gia revisionata");
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("stores technical review provenance with a null User FK", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "staging-preview-admin", email: "preview@example.test", role: "ADMIN" });
    await reviewChecklistEvidenceAction(reviewForm("RIFIUTATO", "Collegamento non pertinente"));
    expect(txMock.fascicoloChecklistEvidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewedByActorId: "staging-preview-admin", reviewedByUserId: null }) }),
    );
  });

  it("propagates review audit failure through the transaction path", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(reviewChecklistEvidenceAction(reviewForm("VALIDATO"))).rejects.toThrow("audit failed");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
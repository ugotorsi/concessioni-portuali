import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const evaluateRequirementMock = vi.hoisted(() => vi.fn());
const genericResolverMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  fascicoloDocumentRequirementProposal: {
    createMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn(), update: vi.fn() },
  fascicoloDocumentRequirementProposal: { findUnique: vi.fn() },
  legalSource: { findUnique: vi.fn(), update: vi.fn() },
  legalRule: { findUnique: vi.fn(), update: vi.fn() },
  documentGap: { findUnique: vi.fn(), update: vi.fn() },
  concessione: { update: vi.fn() },
  documento: { update: vi.fn() },
  criticita: { update: vi.fn() },
  decisioneProcedimento: { update: vi.fn() },
  fascicoloObservation: { update: vi.fn() },
  fascicoloChecklistEvidence: { update: vi.fn() },
  user: { create: vi.fn() },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}));

vi.mock("@/lib/auth", () => ({
  canManageProcedimenti: canManageProcedimentiMock,
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
vi.mock("@/server/fascicolo-document-requirements/matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/fascicolo-document-requirements/matcher")>();
  evaluateRequirementMock.mockImplementation(actual.evaluateP1C1DocumentRequirement);
  return { ...actual, evaluateP1C1DocumentRequirement: evaluateRequirementMock };
});
vi.mock("@/server/legal-rules/orchestrator", () => ({ resolveApplicableLegalRules: genericResolverMock }));

import {
  createFascicoloDocumentRequirementProposal,
  reviewFascicoloDocumentRequirementProposalAction,
} from "@/server/actions/fascicolo-document-requirements";

const procedimento = {
  id: "procedimento-1",
  concessioneId: "concessione-1",
  concessione: {
    enteId: "ente-1",
    normaRiferimento: "ART_18_L_84_1994",
    portActivityLegalType: "OPERAZIONI_PORTUALI",
  },
};
const source = {
  id: "source-1",
  sourceKey: "L-84-1994",
  title: "L. 28 gennaio 1994 n. 84",
  enteId: null,
  authorityId: null,
  portId: null,
  sourceType: "LEGGE",
  role: "NORMATIVE",
  legalRank: "NATIONAL_LAW",
  territorialScope: "NATIONAL",
  status: "CURRENT_SUBJECT_TO_REVIEW",
  isConformative: true,
  humanReviewRequired: true,
};
const rule = {
  id: "rule-1",
  sourceId: "source-1",
  ruleCode: "P1C_ART18_ART16_AUTH_REQUIREMENT",
  status: "BOZZA",
  enteId: null,
  portId: null,
  category: "DOCUMENTAZIONE",
  humanReviewRequired: true,
};
const gap = {
  id: "gap-1",
  gapKey: "REQ-AUTORIZZAZIONE-ART16",
  title: "Verifica titolo autorizzatorio ex art. 16 L. 84/1994",
  description: "Requisito istruttorio di verifica.",
  ruleId: "rule-1",
  status: "APERTA",
  enteId: null,
  portId: null,
  requiredDocumentTypes: [],
  humanReviewRequired: true,
};
const proposal = {
  id: "proposal-1",
  status: "PROPOSTO",
  screeningFingerprint: "a".repeat(64),
};
const reviewProposal = {
  id: "proposal-1",
  status: "PROPOSTO",
  enteId: "ente-1",
  procedimentoId: "procedimento-1",
  screeningFingerprint: "a".repeat(64),
  ruleCodeSnapshot: "P1C_ART18_ART16_AUTH_REQUIREMENT",
  gapKeySnapshot: "REQ-AUTORIZZAZIONE-ART16",
  procedimento: {
    concessioneId: "concessione-1",
    concessione: { enteId: "ente-1" },
  },
};

function reviewForm(targetStatus: string, reviewNote?: string, extra?: Record<string, string>) {
  const formData = new FormData();
  formData.set("proposalId", "proposal-1");
  formData.set("targetStatus", targetStatus);
  if (reviewNote !== undefined) formData.set("reviewNote", reviewNote);
  for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
  return formData;
}

describe("P1-C1 document requirement create action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.procedimento.findUnique.mockResolvedValue(procedimento);
    prismaMock.legalSource.findUnique.mockResolvedValue(source);
    prismaMock.legalRule.findUnique.mockResolvedValue(rule);
    prismaMock.documentGap.findUnique.mockResolvedValue(gap);
    txMock.fascicoloDocumentRequirementProposal.createMany.mockResolvedValue({ count: 1 });
    txMock.fascicoloDocumentRequirementProposal.findUniqueOrThrow.mockResolvedValue(proposal);
    auditInTransactionMock.mockResolvedValue({});
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"])("allows %s", async (role) => {
    requireRoleMock.mockResolvedValue(role);
    const result = await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(result).toMatchObject({ eligible: true, created: true, proposal });
  });

  it("rejects an unauthorized role before canonical reads", async () => {
    canManageProcedimentiMock.mockReturnValue(false);
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "non autorizzato",
    );
    expect(prismaMock.procedimento.findUnique).not.toHaveBeenCalled();
  });

  it("accepts only procedimentoId from the client", async () => {
    await expect(
      createFascicoloDocumentRequirementProposal({
        procedimentoId: "procedimento-1",
        enteId: "ente-2",
      } as never),
    ).rejects.toThrow();
    expect(prismaMock.procedimento.findUnique).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant access before catalog or writes", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("tenant denied");
    });
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "tenant denied",
    );
    expect(prismaMock.legalSource.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ART_18_L_84_1994", null],
    ["ART_36_COD_NAV", "OPERAZIONI_PORTUALI"],
  ])("returns a no-write result for ineligible facts", async (normaRiferimento, portActivityLegalType) => {
    prismaMock.procedimento.findUnique.mockResolvedValue({
      ...procedimento,
      concessione: { ...procedimento.concessione, normaRiferimento, portActivityLegalType },
    });
    const result = await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(result).toEqual({ eligible: false, created: false, proposal: null });
    expect(prismaMock.legalSource.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("persists canonical snapshots and audits in one transaction", async () => {
    await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(txMock.fascicoloDocumentRequirementProposal.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          enteId: "ente-1",
          procedimentoId: "procedimento-1",
          canonicalArt18Snapshot: "ART_18_L_84_1994",
          portActivityLegalTypeSnapshot: "OPERAZIONI_PORTUALI",
          sourceStableKeySnapshot: "L-84-1994",
          ruleCodeSnapshot: "P1C_ART18_ART16_AUTH_REQUIREMENT",
          gapKeySnapshot: "REQ-AUTORIZZAZIONE-ART16",
          ruleContractVersionSnapshot: 1,
        }),
      ],
      skipDuplicates: true,
    });
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ azione: "FASCICOLO_DOCUMENT_REQUIREMENT_PROPOSAL_CREATE" }),
    );
  });

  it("returns the existing proposal and emits no duplicate audit", async () => {
    txMock.fascicoloDocumentRequirementProposal.createMany.mockResolvedValue({ count: 0 });
    const result = await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(result).toMatchObject({ eligible: true, created: false, proposal });
    expect(txMock.fascicoloDocumentRequirementProposal.findUniqueOrThrow).toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong source key", { ...source, sourceKey: "OTHER" }],
    ["tenant-local source", { ...source, enteId: "ente-1" }],
    ["non-national source", { ...source, territorialScope: "AUTHORITY" }],
    ["non-conformative source", { ...source, isConformative: false }],
    ["source status", { ...source, status: "HISTORICAL" }],
    ["source human review", { ...source, humanReviewRequired: false }],
    ["source type", { ...source, sourceType: "DECRETO" }],
    ["source role", { ...source, role: "PROCEDURAL" }],
    ["source legal rank", { ...source, legalRank: "OTHER" }],
    ["source authority scope", { ...source, authorityId: "authority-1" }],
    ["source port scope", { ...source, portId: "port-1" }],
  ])("fails closed for %s", async (_label, invalidSource) => {
    prismaMock.legalSource.findUnique.mockResolvedValue(invalidSource);
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "Configurazione catalogo",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("keeps concurrent duplicates to one proposal and one audit", async () => {
    txMock.fascicoloDocumentRequirementProposal.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const results = await Promise.all([
      createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" }),
      createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" }),
    ]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing source", "source"],
    ["missing rule", "rule"],
    ["missing gap", "gap"],
  ])("fails closed for %s", async (_label, missing) => {
    if (missing === "source") prismaMock.legalSource.findUnique.mockResolvedValue(null);
    if (missing === "rule") prismaMock.legalRule.findUnique.mockResolvedValue(null);
    if (missing === "gap") prismaMock.documentGap.findUnique.mockResolvedValue(null);
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "Configurazione catalogo",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["ATTIVA rule", { ...rule, status: "ATTIVA" }],
    ["tenant-local rule", { ...rule, enteId: "ente-1" }],
    ["port-local rule", { ...rule, portId: "port-1" }],
    ["wrong rule category", { ...rule, category: "PROCEDURA" }],
    ["rule without human review", { ...rule, humanReviewRequired: false }],
    ["wrong source relation", { ...rule, sourceId: "source-other" }],
    ["wrong rule code", { ...rule, ruleCode: "OTHER" }],
  ])("fails closed for %s", async (_label, invalidRule) => {
    prismaMock.legalRule.findUnique.mockResolvedValue(invalidRule);
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "Configurazione catalogo",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong gap rule", { ...gap, ruleId: "rule-other" }],
    ["resolved gap", { ...gap, status: "RISOLTA" }],
    ["tenant-local gap", { ...gap, enteId: "ente-1" }],
    ["port-local gap", { ...gap, portId: "port-1" }],
    ["gap with required document types", { ...gap, requiredDocumentTypes: ["TITOLO_CONCESSORIO"] }],
    ["gap without human review", { ...gap, humanReviewRequired: false }],
  ])("fails closed for %s", async (_label, invalidGap) => {
    prismaMock.documentGap.findUnique.mockResolvedValue(invalidGap);
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "Configurazione catalogo",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("does not use presentation fields as catalog applicability guards", async () => {
    prismaMock.legalSource.findUnique.mockResolvedValue({ ...source, title: "Titolo fonte aggiornato" });
    prismaMock.legalRule.findUnique.mockResolvedValue({
      ...rule,
      title: "Titolo regola aggiornato",
      summary: "Sommario aggiornato",
      outcomeTitle: "Esito aggiornato",
    });
    prismaMock.documentGap.findUnique.mockResolvedValue({
      ...gap,
      title: "Etichetta aggiornata",
      description: "Descrizione aggiornata",
    });

    const result = await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(result).toMatchObject({ eligible: true, created: true, proposal });
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["staging-preview-admin", null],
    ["user-1", "user-1"],
  ])("stores actor %s with the expected User FK", async (actorId, expectedUserId) => {
    getCurrentUserMock.mockResolvedValue({ id: actorId, email: "actor@example.test", role: "ADMIN" });
    await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    expect(txMock.fascicoloDocumentRequirementProposal.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ createdByActorId: actorId, createdByUserId: expectedUserId })],
      }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("rolls back the transaction path when audit fails", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" })).rejects.toThrow(
      "audit failed",
    );
  });

  it("does not write core or closed fascicolo models", async () => {
    await createFascicoloDocumentRequirementProposal({ procedimentoId: "procedimento-1" });
    for (const model of [
      prismaMock.procedimento,
      prismaMock.concessione,
      prismaMock.documento,
      prismaMock.criticita,
      prismaMock.decisioneProcedimento,
      prismaMock.fascicoloObservation,
      prismaMock.fascicoloChecklistEvidence,
    ]) {
      expect(model.update).not.toHaveBeenCalled();
    }
  });
});

describe("P1-C1 document requirement review action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "admin@example.test", role: "ADMIN" });
    getCurrentTenantContextMock.mockResolvedValue({});
    requireTenantAccessMock.mockImplementation(() => undefined);
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue(reviewProposal);
    txMock.fascicoloDocumentRequirementProposal.updateMany.mockResolvedValue({ count: 1 });
    auditInTransactionMock.mockResolvedValue({});
  });

  it.each(["ADMIN", "OPERATORE_SOCIETA", "GIURIDICO"])("allows %s to review", async (role) => {
    requireRoleMock.mockResolvedValue(role);
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"));
    expect(canManageProcedimentiMock).toHaveBeenCalledWith(role);
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthorized role before proposal read, write, or audit", async () => {
    canManageProcedimentiMock.mockReturnValue(false);
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "non autorizzato",
    );
    expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant access before write or audit", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("tenant denied");
    });
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "tenant denied",
    );
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "ente-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("fails closed when proposal tenant differs from the canonical tenant", async () => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({
      ...reviewProposal,
      enteId: "ente-2",
    });
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "tenant canonico",
    );
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("reviews PROPOSTO as VALIDATO through the guarded update", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "proposal-1", enteId: "ente-1", status: "PROPOSTO" },
      data: expect.objectContaining({ status: "VALIDATO" }),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/procedimenti/procedimento-1");
  });

  it.each([
    ["missing", undefined],
    ["whitespace", "   "],
  ])("normalizes a %s VALIDATO note to null", async (_label, note) => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO", note));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewNote: null }) }),
    );
  });

  it("trims and stores a non-empty VALIDATO note", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO", "  Applicabile  "));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewNote: "Applicabile" }) }),
    );
  });

  it("reviews PROPOSTO as RIFIUTATO with a trimmed note", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("RIFIUTATO", "  Non applicabile  "));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RIFIUTATO", reviewNote: "Non applicabile" }) }),
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("rejects a %s RIFIUTATO note before write or audit", async (_label, note) => {
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("RIFIUTATO", note))).rejects.toThrow(
      "nota di review",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it.each(["PROPOSTO", "SUPERATO", "", "VALIDATO "])("rejects invalid target status %j", async (status) => {
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm(status))).rejects.toThrow();
    expect(prismaMock.fascicoloDocumentRequirementProposal.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(["VALIDATO", "RIFIUTATO"])("treats current %s as terminal", async (status) => {
    prismaMock.fascicoloDocumentRequirementProposal.findUnique.mockResolvedValue({ ...reviewProposal, status });
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "gia revisionata",
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects a CAS loser and creates no audit", async () => {
    txMock.fascicoloDocumentRequirementProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "altro revisore",
    );
    expect(auditInTransactionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("creates exactly one review audit in the same transaction", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"));
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(txMock, expect.objectContaining({
      azione: "FASCICOLO_DOCUMENT_REQUIREMENT_PROPOSAL_REVIEW",
      entita: "FascicoloDocumentRequirementProposal",
      entitaId: "proposal-1",
      enteId: "ente-1",
      concessioneId: "concessione-1",
    }));
  });

  it("rejects the transaction path and does not revalidate when audit fails", async () => {
    auditInTransactionMock.mockRejectedValue(new Error("audit failed"));
    await expect(reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"))).rejects.toThrow(
      "audit failed",
    );
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["staging-preview-admin", null],
    ["user-1", "user-1"],
  ])("stores review actor %s with expected User FK", async (actorId, expectedUserId) => {
    getCurrentUserMock.mockResolvedValue({ id: actorId, email: "actor@example.test", role: "ADMIN" });
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewedByActorId: actorId,
          reviewedByUserId: expectedUserId,
          reviewedByEmail: "actor@example.test",
          reviewedByRole: "ADMIN",
        }),
      }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("ignores client attempts to override reviewer, tenant, and current state", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO", undefined, {
      enteId: "ente-2",
      currentStatus: "RIFIUTATO",
      reviewedByActorId: "attacker",
      reviewedByUserId: "attacker",
      reviewedByEmail: "attacker@example.test",
      reviewedByRole: "ADMIN",
      reviewedAt: "2000-01-01T00:00:00.000Z",
    }));
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "proposal-1", enteId: "ente-1", status: "PROPOSTO" },
      data: expect.objectContaining({
        reviewedByActorId: "user-1",
        reviewedByUserId: "user-1",
        reviewedByEmail: "admin@example.test",
        reviewedByRole: "ADMIN",
      }),
    });
  });

  it("writes bounded audit metadata without duplicating the review note", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("RIFIUTATO", "Non applicabile"));
    const auditInput = auditInTransactionMock.mock.calls[0][1];
    expect(auditInput.metadata).toEqual({
      proposalId: "proposal-1",
      previousStatus: "PROPOSTO",
      newStatus: "RIFIUTATO",
      screeningFingerprint: "a".repeat(64),
      ruleCodeSnapshot: "P1C_ART18_ART16_AUTH_REQUIREMENT",
      gapKeySnapshot: "REQ-AUTORIZZAZIONE-ART16",
      reviewNotePresent: true,
    });
    expect(JSON.stringify(auditInput.metadata)).not.toContain("Non applicabile");
  });

  it("permits exactly one winner when two reviewers observed PROPOSTO", async () => {
    txMock.fascicoloDocumentRequirementProposal.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([
      reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO")),
      reviewFascicoloDocumentRequirementProposalAction(reviewForm("RIFIUTATO", "Non applicabile")),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(txMock.fascicoloDocumentRequirementProposal.updateMany).toHaveBeenCalledTimes(2);
    expect(auditInTransactionMock).toHaveBeenCalledTimes(1);
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ metadata: expect.objectContaining({ newStatus: "VALIDATO" }) }),
    );
  });

  it("does not reevaluate matcher, resolver, catalog, or forbidden models during review", async () => {
    await reviewFascicoloDocumentRequirementProposalAction(reviewForm("VALIDATO"));
    expect(evaluateRequirementMock).not.toHaveBeenCalled();
    expect(genericResolverMock).not.toHaveBeenCalled();
    expect(prismaMock.legalSource.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.legalRule.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.documentGap.findUnique).not.toHaveBeenCalled();
    for (const model of [
      prismaMock.procedimento,
      prismaMock.concessione,
      prismaMock.documento,
      prismaMock.criticita,
      prismaMock.decisioneProcedimento,
      prismaMock.fascicoloObservation,
      prismaMock.fascicoloChecklistEvidence,
      prismaMock.legalSource,
      prismaMock.legalRule,
      prismaMock.documentGap,
    ]) {
      expect(model.update).not.toHaveBeenCalled();
    }
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
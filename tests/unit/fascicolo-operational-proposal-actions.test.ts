import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "ADMIN",
  requireRole: vi.fn(),
  getCurrentUser: vi.fn(),
  canManageProcedimenti: vi.fn(),
  canManageCriticita: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  findProcedure: vi.fn(),
  auditFailure: vi.fn(),
  getWorkflow: vi.fn(),
  generateCandidates: vi.fn(),
  reconcile: vi.fn(),
  reverse: vi.fn(),
  list: vi.fn(),
  review: vi.fn(),
  materialize: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireRole: mocks.requireRole,
  getCurrentUser: mocks.getCurrentUser,
  canManageProcedimenti: mocks.canManageProcedimenti,
  canManageCriticita: mocks.canManageCriticita,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { procedimento: { findUnique: mocks.findProcedure } } }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock("@/server/audit/auditLog", () => ({ auditFailure: mocks.auditFailure }));
vi.mock("@/server/queries/fascicolo-automatic-workflow", () => ({
  getFascicoloAutomaticWorkflowReadModel: mocks.getWorkflow,
}));
vi.mock("@/server/fascicolo-operational-proposals", () => ({
  OperationalProposalRepositoryError: class extends Error {
    constructor(readonly code: string) { super(code); }
  },
  generateOperationalProposalCandidates: mocks.generateCandidates,
  reconcileOperationalProposals: mocks.reconcile,
  reverseOperationalProposalReconciliation: mocks.reverse,
  listOperationalProposals: mocks.list,
  reviewOperationalProposal: mocks.review,
  materializeOperationalProposal: mocks.materialize,
}));

import {
  generateOperationalProposalsAction,
  materializeOperationalProposalAction,
  reverseOperationalProposalReconciliationAction,
  reviewOperationalProposalAction,
} from "@/server/actions/fascicolo-operational-proposals";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const proposal = {
  id: "proposal-1",
  proposalType: "DEADLINE",
  procedimentoId: "procedure-1",
  reviewVersion: 0,
};
const generation = {
  procedimentoId: "procedure-1",
  expectedReportFingerprint: "a".repeat(64),
  expectedCorpusFingerprint: "c".repeat(64),
  expectedPreviewFingerprint: "d".repeat(64),
  confirmed: "true",
};

describe("Lotto 7 operational proposal server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue("ADMIN");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "ADMIN" });
    mocks.canManageProcedimenti.mockReturnValue(true);
    mocks.canManageCriticita.mockReturnValue(true);
    mocks.getCurrentTenantContext.mockResolvedValue({ userId: "user-1", enteId: "tenant-1" });
    mocks.findProcedure.mockResolvedValue({ enteId: "tenant-1", concessioneId: "concession-1" });
    mocks.getWorkflow.mockResolvedValue({
      structuredReport: {
        reportFingerprint: "a".repeat(64),
        payload: { tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1" },
      },
      analysisUpdate: { status: "CURRENT", corpusFingerprint: "c".repeat(64) },
      structuredReportSnapshots: [{ snapshotId: "report-1", reportFingerprint: "a".repeat(64), effectiveStatus: "CURRENT" }],
    });
    mocks.generateCandidates.mockReturnValue([{ proposalFingerprint: "b".repeat(64) }]);
    mocks.reconcile.mockResolvedValue({ created: 1, reused: 0, stale: 0, proposals: [] });
    mocks.list.mockResolvedValue([proposal]);
    mocks.review.mockResolvedValue({ ...proposal, status: "APPROVED" });
    mocks.materialize.mockResolvedValue({ outcome: "MATERIALIZED", entityType: "Scadenza", entityId: "deadline-1" });
    mocks.reverse.mockResolvedValue({ restored: 1, retainedAsHistory: 1 });
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
  });

  it("generates only from a confirmed preview and an archived current report", async () => {
    await expect(generateOperationalProposalsAction(form(generation))).rejects.toThrow("reconciliationDone=generated");
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(expect.anything(), "tenant-1", expect.objectContaining({ mode: "write" }));
    expect(mocks.generateCandidates).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1", structuredReportId: "report-1",
      expectedCorpusFingerprint: "c".repeat(64), expectedPreviewFingerprint: "d".repeat(64),
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    }));
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("passes explicit human actor, action and review version to review only", async () => {
    await reviewOperationalProposalAction(form({
      procedimentoId: "procedure-1", proposalId: "proposal-1", action: "APPROVE", reviewVersion: "0",
    }));
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: "proposal-1", action: "APPROVE", expectedReviewVersion: 0,
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    }));
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("materializes only through its separate action", async () => {
    await materializeOperationalProposalAction(form({ procedimentoId: "procedure-1", proposalId: "proposal-1" }));
    expect(mocks.materialize).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", procedimentoId: "procedure-1", proposalId: "proposal-1",
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    }));
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.generateCandidates).not.toHaveBeenCalled();
  });

  it("blocks an unauthorized target type and records a failure audit", async () => {
    mocks.list.mockResolvedValue([{ ...proposal, proposalType: "CRITICALITY" }]);
    mocks.canManageCriticita.mockReturnValue(false);
    await expect(reviewOperationalProposalAction(form({
      procedimentoId: "procedure-1", proposalId: "proposal-1", action: "APPROVE", reviewVersion: "0",
    }))).rejects.toThrow("Profilo non autorizzato");
    expect(mocks.review).not.toHaveBeenCalled();
    expect(mocks.auditFailure).toHaveBeenCalledWith(expect.objectContaining({
      azione: "OPERATIONAL_PROPOSAL_APPROVE_BLOCKED", entitaId: "proposal-1", enteId: "tenant-1",
    }));
  });

  it("audits a stale analysis and does not continue to reconciliation", async () => {
    const model = await mocks.getWorkflow();
    mocks.getWorkflow.mockResolvedValue({ ...model, analysisUpdate: { ...model.analysisUpdate, status: "STALE" } });
    await expect(generateOperationalProposalsAction(form(generation)))
      .rejects.toThrow("reconciliationError=CURRENT_INPUT_REQUIRED");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.auditFailure).toHaveBeenCalledWith(expect.objectContaining({
      azione: "OPERATIONAL_PROPOSALS_GENERATION_BLOCKED", entitaId: null,
    }));
  });

  it("rejects generation without explicit confirmation", async () => {
    const input = form(generation);
    input.delete("confirmed");
    await expect(generateOperationalProposalsAction(input)).rejects.toThrow();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.getWorkflow).not.toHaveBeenCalled();
  });

  it("requires confirmation and a human actor to reverse a reconciliation", async () => {
    const input = {
      procedimentoId: "procedure-1",
      reconciliationId: "reconciliation_00000000-0000-4000-8000-000000000001",
      expectedAfterFingerprint: "e".repeat(64),
      note: "Ripristino motivato.",
      confirmed: "true",
    };
    await expect(reverseOperationalProposalReconciliationAction(form(input))).rejects.toThrow("reconciliationDone=reversed");
    expect(mocks.reverse).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", procedimentoId: "procedure-1", reconciliationId: input.reconciliationId,
      actor: { actorId: "user-1", actorEmail: "user@example.test", actorRole: "ADMIN" },
    }));
    mocks.canManageProcedimenti.mockReturnValue(false);
    await expect(reverseOperationalProposalReconciliationAction(form(input))).rejects.toThrow("non autorizzato");
    expect(mocks.reverse).toHaveBeenCalledTimes(1);
    expect(mocks.auditFailure).toHaveBeenCalledWith(expect.objectContaining({ azione: "OPERATIONAL_PROPOSALS_REVERSAL_BLOCKED" }));
  });
});
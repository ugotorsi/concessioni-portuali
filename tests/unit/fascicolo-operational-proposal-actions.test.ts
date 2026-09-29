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
  persistReport: vi.fn(),
  generateCandidates: vi.fn(),
  reconcile: vi.fn(),
  list: vi.fn(),
  review: vi.fn(),
  materialize: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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
vi.mock("@/server/fascicolo-report", () => ({ persistStructuredFascicoloReport: mocks.persistReport }));
vi.mock("@/server/fascicolo-operational-proposals", () => ({
  generateOperationalProposalCandidates: mocks.generateCandidates,
  reconcileOperationalProposals: mocks.reconcile,
  listOperationalProposals: mocks.list,
  reviewOperationalProposal: mocks.review,
  materializeOperationalProposal: mocks.materialize,
}));

import {
  generateOperationalProposalsAction,
  materializeOperationalProposalAction,
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

describe("Lotto 7 operational proposal server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue("ADMIN");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "user@example.test", role: "ADMIN" });
    mocks.canManageProcedimenti.mockReturnValue(true);
    mocks.canManageCriticita.mockReturnValue(true);
    mocks.getCurrentTenantContext.mockResolvedValue({ userId: "user-1", enteId: "tenant-1" });
    mocks.findProcedure.mockResolvedValue({ concessioneId: "concession-1", concessione: { enteId: "tenant-1" } });
    mocks.getWorkflow.mockResolvedValue({ structuredReport: { reportFingerprint: "a".repeat(64), payload: {} } });
    mocks.persistReport.mockResolvedValue({ snapshot: {
      id: "report-1", tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1",
      reportFingerprint: "a".repeat(64), payload: {},
    } });
    mocks.generateCandidates.mockReturnValue([{ proposalFingerprint: "b".repeat(64) }]);
    mocks.reconcile.mockResolvedValue({ created: 1, reused: 0, stale: 0, proposals: [] });
    mocks.list.mockResolvedValue([proposal]);
    mocks.review.mockResolvedValue({ ...proposal, status: "APPROVED" });
    mocks.materialize.mockResolvedValue({ outcome: "MATERIALIZED", entityType: "Scadenza", entityId: "deadline-1" });
  });

  it("generates and reconciles without invoking review or materialization", async () => {
    await generateOperationalProposalsAction(form({ procedimentoId: "procedure-1" }));
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(expect.anything(), "tenant-1", expect.objectContaining({ mode: "write" }));
    expect(mocks.persistReport).toHaveBeenCalledOnce();
    expect(mocks.generateCandidates).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1", structuredReportId: "report-1",
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

  it("audits a generation failure and does not continue to reconciliation", async () => {
    mocks.persistReport.mockRejectedValue(new Error("CURRENT_REPORT_INVALID"));
    await expect(generateOperationalProposalsAction(form({ procedimentoId: "procedure-1" })))
      .rejects.toThrow("CURRENT_REPORT_INVALID");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.auditFailure).toHaveBeenCalledWith(expect.objectContaining({
      azione: "OPERATIONAL_PROPOSALS_GENERATION_BLOCKED", entitaId: null,
    }));
  });
});
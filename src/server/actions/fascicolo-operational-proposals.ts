"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageCriticita, canManageProcedimenti, getCurrentUser, requireRole, type DemoRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure } from "@/server/audit/auditLog";
import {
  generateOperationalProposalCandidates,
  listOperationalProposals,
  materializeOperationalProposal,
  OperationalProposalRepositoryError,
  reconcileOperationalProposals,
  reverseOperationalProposalReconciliation,
  reviewOperationalProposal,
  type OperationalProposalRecord,
} from "@/server/fascicolo-operational-proposals";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const scopeSchema = z.object({ procedimentoId: z.string().trim().min(1).max(256) }).strict();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const generationSchema = scopeSchema.extend({
  expectedReportFingerprint: hashSchema,
  expectedCorpusFingerprint: hashSchema,
  expectedPreviewFingerprint: hashSchema,
  confirmed: z.literal("true"),
}).strict();
const reversalSchema = scopeSchema.extend({
  reconciliationId: z.string().regex(/^reconciliation_[0-9a-f-]{36}$/),
  expectedAfterFingerprint: hashSchema,
  note: z.string().trim().min(3).max(4_000),
  confirmed: z.literal("true"),
}).strict();
const proposalSchema = scopeSchema.extend({ proposalId: z.string().trim().min(1).max(96) }).strict();
const reviewSchema = proposalSchema.extend({
  action: z.enum(["APPROVE", "REJECT", "AMEND_AND_APPROVE"]),
  reviewVersion: z.coerce.number().int().nonnegative(),
  approvedPayload: z.string().optional(),
  reviewNote: z.string().trim().max(10_000).optional(),
}).strict();

interface AuthorizedScope {
  tenantId: string;
  procedimentoId: string;
  concessioneId: string | null;
  role: DemoRole;
  actor: { actorId: string; actorEmail: string | null; actorRole: string };
}

async function authorizedScope(procedimentoId: string): Promise<AuthorizedScope> {
  const role = await requireRole();
  const [user, tenantContext, procedimento] = await Promise.all([
    getCurrentUser(),
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({
      where: { id: procedimentoId },
      select: { enteId: true, concessioneId: true },
    }),
  ]);
  const tenantId = procedimento?.enteId;
  if (!user || !tenantContext || !tenantId || !procedimento) throw new Error("Procedimento, attore o tenant non disponibile.");
  requireTenantAccess(tenantContext, tenantId, { mode: "write", allowWhenEnteMissing: false });
  return {
    tenantId,
    procedimentoId,
    concessioneId: procedimento.concessioneId,
    role,
    actor: { actorId: user.id, actorEmail: user.email, actorRole: role },
  };
}

function canManageProposal(role: DemoRole, proposal: Pick<OperationalProposalRecord, "proposalType">): boolean {
  return proposal.proposalType === "CRITICALITY" ? canManageCriticita(role) : canManageProcedimenti(role);
}

async function requireProposal(scope: AuthorizedScope, proposalId: string): Promise<OperationalProposalRecord> {
  const proposal = (await listOperationalProposals(scope)).find((item) => item.id === proposalId);
  if (!proposal) throw new Error("Proposta operativa non disponibile nel procedimento corrente.");
  if (!canManageProposal(scope.role, proposal)) throw new Error("Profilo non autorizzato per questo tipo di proposta.");
  return proposal;
}

async function auditBlocked(scope: AuthorizedScope, proposalId: string | null, action: string, error: unknown) {
  await auditFailure({
    azione: action,
    entita: "FascicoloOperationalProposal",
    entitaId: proposalId,
    enteId: scope.tenantId,
    concessioneId: scope.concessioneId,
    actor: { userId: scope.actor.actorId, userEmail: scope.actor.actorEmail, userRole: scope.actor.actorRole },
    metadata: {
      procedimentoId: scope.procedimentoId,
      reason: error instanceof Error ? error.message : "OPERATIONAL_PROPOSAL_OPERATION_BLOCKED",
    },
  });
}

export async function generateOperationalProposalsAction(formData: FormData): Promise<void> {
  const input = generationSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    expectedReportFingerprint: formData.get("expectedReportFingerprint"),
    expectedCorpusFingerprint: formData.get("expectedCorpusFingerprint"),
    expectedPreviewFingerprint: formData.get("expectedPreviewFingerprint"),
    confirmed: formData.get("confirmed"),
  });
  const scope = await authorizedScope(input.procedimentoId);
  if (!canManageProcedimenti(scope.role)) {
    const error = new Error("Profilo non autorizzato alla generazione delle proposte operative.");
    await auditBlocked(scope, null, "OPERATIONAL_PROPOSALS_GENERATION_BLOCKED", error);
    throw error;
  }
  let errorCode: string | null = null;
  try {
    const model = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    const report = model?.structuredReport;
    if (!model || !report || model.analysisUpdate.status !== "CURRENT"
      || model.analysisUpdate.corpusFingerprint !== input.expectedCorpusFingerprint
      || report.reportFingerprint !== input.expectedReportFingerprint
      || report.payload.tenantId !== scope.tenantId || report.payload.procedimentoId !== scope.procedimentoId) {
      throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");
    }
    const snapshot = model.structuredReportSnapshots.find((item) =>
      item.reportFingerprint === report.reportFingerprint && item.effectiveStatus === "CURRENT");
    if (!snapshot) throw new OperationalProposalRepositoryError("CURRENT_INPUT_REQUIRED");
    const candidates = generateOperationalProposalCandidates({
      tenantId: scope.tenantId,
      procedimentoId: scope.procedimentoId,
      structuredReportId: snapshot.snapshotId,
      structuredReportFingerprint: report.reportFingerprint,
      report: report.payload,
    });
    await reconcileOperationalProposals({
      tenantId: scope.tenantId,
      procedimentoId: scope.procedimentoId,
      knowledgeRevisionId: report.payload.knowledgeRevisionId,
      structuredReportId: snapshot.snapshotId,
      structuredReportFingerprint: report.reportFingerprint,
      expectedCorpusFingerprint: input.expectedCorpusFingerprint,
      expectedPreviewFingerprint: input.expectedPreviewFingerprint,
      candidates,
      actor: scope.actor,
    });
  } catch (error) {
    await auditBlocked(scope, null, "OPERATIONAL_PROPOSALS_GENERATION_BLOCKED", error);
    errorCode = error instanceof OperationalProposalRepositoryError ? error.code : "UNEXPECTED_ERROR";
    if (errorCode === "UNEXPECTED_ERROR") console.error("operational_proposals_generation_failed", { procedimentoId: input.procedimentoId, error });
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
  const query = errorCode ? `reconciliationError=${encodeURIComponent(errorCode)}` : "reconciliationDone=generated";
  redirect(`/procedimenti/${input.procedimentoId}?section=proposals&${query}#proposal-reconciliation`);
}

export async function reverseOperationalProposalReconciliationAction(formData: FormData): Promise<void> {
  const input = reversalSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    reconciliationId: formData.get("reconciliationId"),
    expectedAfterFingerprint: formData.get("expectedAfterFingerprint"),
    note: formData.get("note"),
    confirmed: formData.get("confirmed"),
  });
  const scope = await authorizedScope(input.procedimentoId);
  if (!canManageProcedimenti(scope.role)) {
    const error = new Error("Profilo non autorizzato al ripristino delle proposte operative.");
    await auditBlocked(scope, input.reconciliationId, "OPERATIONAL_PROPOSALS_REVERSAL_BLOCKED", error);
    throw error;
  }
  let errorCode: string | null = null;
  try {
    await reverseOperationalProposalReconciliation({ ...input, tenantId: scope.tenantId, actor: scope.actor });
  } catch (error) {
    await auditBlocked(scope, input.reconciliationId, "OPERATIONAL_PROPOSALS_REVERSAL_BLOCKED", error);
    errorCode = error instanceof OperationalProposalRepositoryError ? error.code : "UNEXPECTED_ERROR";
    if (errorCode === "UNEXPECTED_ERROR") console.error("operational_proposals_reversal_failed", { procedimentoId: input.procedimentoId, error });
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
  const query = errorCode ? `reconciliationError=${encodeURIComponent(errorCode)}` : "reconciliationDone=reversed";
  redirect(`/procedimenti/${input.procedimentoId}?section=proposals&${query}#proposal-reconciliation`);
}

export async function reviewOperationalProposalAction(formData: FormData): Promise<void> {
  const input = reviewSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    proposalId: formData.get("proposalId"),
    action: formData.get("action"),
    reviewVersion: formData.get("reviewVersion"),
    approvedPayload: formData.get("approvedPayload")?.toString(),
    reviewNote: formData.get("reviewNote")?.toString(),
  });
  const scope = await authorizedScope(input.procedimentoId);
  try {
    const proposal = await requireProposal(scope, input.proposalId);
    const approvedPayload = input.action === "AMEND_AND_APPROVE"
      ? JSON.parse(input.approvedPayload ?? "") as unknown
      : undefined;
    await reviewOperationalProposal({
      tenantId: scope.tenantId,
      procedimentoId: scope.procedimentoId,
      proposalId: proposal.id,
      action: input.action,
      expectedReviewVersion: input.reviewVersion,
      approvedPayload,
      reviewNote: input.reviewNote || null,
      actor: scope.actor,
    });
  } catch (error) {
    await auditBlocked(scope, input.proposalId, `OPERATIONAL_PROPOSAL_${input.action}_BLOCKED`, error);
    throw error;
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
}

export async function materializeOperationalProposalAction(formData: FormData): Promise<void> {
  const input = proposalSchema.parse({ procedimentoId: formData.get("procedimentoId"), proposalId: formData.get("proposalId") });
  const scope = await authorizedScope(input.procedimentoId);
  try {
    await requireProposal(scope, input.proposalId);
    await materializeOperationalProposal({
      tenantId: scope.tenantId,
      procedimentoId: scope.procedimentoId,
      proposalId: input.proposalId,
      actor: scope.actor,
    });
  } catch (error) {
    await auditBlocked(scope, input.proposalId, "OPERATIONAL_PROPOSAL_MATERIALIZATION_BLOCKED", error);
    throw error;
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
}
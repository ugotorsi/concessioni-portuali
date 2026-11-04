"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { buildFascicoloDocumentCorpusUpdateAdmission } from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const refreshSchema = z.object({
  procedimentoId: z.string().trim().min(1).max(256),
  expectedCorpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal("true"),
}).strict();

/**
 * Explicit, audited request to re-analyse the current document corpus. It only admits the
 * corpus-update job (idempotent per corpus fingerprint); it never deletes decisions, activities
 * or drafts, and it does not modify administrative data.
 */
export async function requestFascicoloAnalysisRefreshAction(formData: FormData): Promise<void> {
  const input = refreshSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    expectedCorpusFingerprint: formData.get("expectedCorpusFingerprint"),
    confirmed: formData.get("confirmed"),
  });
  const role = await requireRole(["ADMIN", "GIURIDICO"]);
  const [user, tenantContext, procedimento] = await Promise.all([
    getCurrentUser(),
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({ where: { id: input.procedimentoId }, select: { enteId: true, concessioneId: true } }),
  ]);
  if (!user || !tenantContext || !procedimento?.enteId) throw new Error("Procedimento, attore o tenant non disponibile.");
  requireTenantAccess(tenantContext, procedimento.enteId, { mode: "write", allowWhenEnteMissing: false });
  const audit = {
    entita: "FascicoloKnowledgeRevision",
    entitaId: input.procedimentoId,
    enteId: procedimento.enteId,
    concessioneId: procedimento.concessioneId,
    actor: { userId: user.id, userEmail: user.email, userRole: role },
  };
  let outcome = "requested";
  try {
    const model = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
    if (!model || model.analysisUpdate.corpusFingerprint !== input.expectedCorpusFingerprint) {
      throw new Error("ANALYSIS_REFRESH_CORPUS_CHANGED");
    }
    if (model.analysisUpdate.status === "CURRENT") {
      outcome = "current";
    } else {
      const admission = await admitAsyncJob(buildFascicoloDocumentCorpusUpdateAdmission({
        tenantId: procedimento.enteId,
        procedimentoId: input.procedimentoId,
        corpusFingerprint: input.expectedCorpusFingerprint,
        correlationId: randomUUID(),
        policyDecisionRef: null,
        admissionType: "AUTHENTICATED_USER",
        initiatingUserId: user.id,
        actorId: user.id,
        actorEmail: user.email,
        actorRole: role,
      }));
      await requestDocumentWorkerActivation("DOCUMENT_ANALYSIS", input.procedimentoId);
      await auditSuccess({
        ...audit,
        azione: "FASCICOLO_ANALYSIS_REFRESH_REQUESTED",
        metadata: {
          procedimentoId: input.procedimentoId,
          corpusFingerprint: input.expectedCorpusFingerprint,
          previousRevisionFingerprint: model.analysisUpdate.currentRevisionFingerprint,
          driftKinds: model.analysisUpdate.drift.entries.map((entry) => entry.kind),
          admissionOutcome: admission.outcome,
        },
      });
    }
  } catch (error) {
    outcome = "error";
    await auditFailure({
      ...audit,
      azione: "FASCICOLO_ANALYSIS_REFRESH_BLOCKED",
      metadata: { procedimentoId: input.procedimentoId, reason: error instanceof Error ? error.message : "UNEXPECTED_ERROR" },
    });
  }
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
  redirect(`/procedimenti/${input.procedimentoId}?section=proposals&analysisRefresh=${outcome}#analysis-update`);
}

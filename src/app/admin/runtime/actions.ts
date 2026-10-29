"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireAdminWithMfa, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { setGlobalAiControlState } from "@/server/ai/globalAiControl";
import {
  documentWorkerKindForOperation,
  requestDocumentWorkerActivation,
} from "@/server/async-jobs/documentWorkerActivation";
import { retryTerminalAsyncJob } from "@/server/async-jobs/persistence";
import {
  provisionDefaultProcedimentoBudgetPolicy,
  readDefaultProcedimentoBudgetAuthorization,
} from "@/server/runtime/procedimentoBudgetPolicy";
import { recoverCurrentKnowledgeResearchMissions } from "@/server/fascicolo-knowledge/researchMissionRecovery";

const RENDER_SERVICE_ID_PATTERN = /^srv-[a-z0-9]+$/;

export async function setRenderWorkerState(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const desiredState = formData.get("desiredState");
  if (desiredState !== "SUSPENDED" && desiredState !== "RUNNING") {
    throw new Error("INVALID_RENDER_WORKER_STATE");
  }
  const confirmation = formData.get("confirmation");
  const expectedConfirmation = desiredState === "SUSPENDED"
    ? "SUSPEND_RENDER_WORKER"
    : "RESUME_RENDER_WORKER";
  if (confirmation !== expectedConfirmation) {
    throw new Error("RENDER_WORKER_CONFIRMATION_REQUIRED");
  }
  const serviceId = process.env.RENDER_APPLICATION_WORKER_SERVICE_ID?.trim() ?? "";
  const apiKey = process.env.RENDER_WORKER_API_KEY?.trim() ?? "";
  if (!RENDER_SERVICE_ID_PATTERN.test(serviceId) || !apiKey) {
    throw new Error("RENDER_CONTROL_NOT_CONFIGURED");
  }

  const operation = desiredState === "SUSPENDED" ? "suspend" : "resume";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`https://api.render.com/v1/services/${serviceId}/${operation}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    await auditFailure({
      azione: "RUNTIME_RENDER_WORKER_CONTROL_FAILURE",
      entita: "RenderService",
      entitaId: serviceId,
      actor: { userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role },
      metadata: { desiredState, reason: error instanceof Error ? error.name : "REQUEST_FAILED" },
    });
    throw new Error("RENDER_CONTROL_REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    await auditFailure({
      azione: "RUNTIME_RENDER_WORKER_CONTROL_FAILURE",
      entita: "RenderService",
      entitaId: serviceId,
      actor: { userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role },
      metadata: { desiredState, status: response.status },
    });
    throw new Error(`RENDER_CONTROL_REJECTED_${response.status}`);
  }
  await auditSuccess({
    azione: "RUNTIME_RENDER_WORKER_CONTROL",
    entita: "RenderService",
    entitaId: serviceId,
    actor: { userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role },
    metadata: { desiredState, purchasesAuthorized: false, subscriptionChangesAuthorized: false },
  });
  revalidatePath("/admin/runtime");
}

export async function retryRuntimeJob(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTHENTICATION_REQUIRED");
  const jobId = formData.get("jobId");
  if (typeof jobId !== "string" || !jobId.trim()) throw new Error("INVALID_JOB_ID");
  const retry = await retryTerminalAsyncJob({
    jobId,
    actor: { userId: user.id, userEmail: user.email, userRole: user.role },
  });
  if (retry.outcome === "REQUEUED" && retry.procedimentoId) {
    const workerKind = documentWorkerKindForOperation(retry.operation);
    if (workerKind) {
      if (workerKind === "DOCUMENT_ANALYSIS") {
        if (!retry.tenantId) throw new Error("DOCUMENT_ANALYSIS_TARGET_AUTHORITY_MISMATCH");
        await requestDocumentWorkerActivation({
          kind: workerKind,
          applicationJobId: retry.jobId,
          tenantId: retry.tenantId,
          procedimentoId: retry.procedimentoId,
        });
      } else {
        await requestDocumentWorkerActivation({
          kind: workerKind,
          procedimentoId: retry.procedimentoId,
        });
      }
    }
  }
  revalidatePath("/admin/runtime");
}

export async function updateGlobalAiControl(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const enabled = formData.get("enabled");
  const reason = formData.get("reason");
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("INVALID_AI_CONTROL_STATE");
  }
  if (reason !== null && typeof reason !== "string") {
    throw new Error("INVALID_AI_CONTROL_REASON");
  }
  const normalizedReason = reason?.trim() || null;
  if (normalizedReason && normalizedReason.length > 500) {
    throw new Error("INVALID_AI_CONTROL_REASON");
  }

  await setGlobalAiControlState({
    enabled: enabled === "true",
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: "ADMIN",
    },
    reason: normalizedReason,
  });
  revalidatePath("/admin/runtime");
}

export async function assignDefaultProcedimentoBudgetPolicy(
  formData: FormData,
): Promise<void> {
  await requireRole(["ADMIN"]);
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("AUTHENTICATION_REQUIRED");

  const procedimentoId = formData.get("procedimentoId");
  if (typeof procedimentoId !== "string" || !procedimentoId.trim()) {
    throw new Error("INVALID_PROCEDIMENTO_ID");
  }
  const authorization = readDefaultProcedimentoBudgetAuthorization();
  if (!authorization.authorized) {
    throw new Error("PROCEDIMENTO_BUDGET_NOT_AUTHORIZED");
  }

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId.trim() },
    select: { id: true, enteId: true },
  });
  if (!procedimento?.enteId) {
    throw new Error("PROCEDIMENTO_NOT_FOUND");
  }
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new Error("TENANT_CONTEXT_REQUIRED");
  }
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await provisionDefaultProcedimentoBudgetPolicy({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
    authorization,
  });
  await auditSuccess({
    azione: "RUNTIME_PROCEDIMENTO_BUDGET_ASSIGN",
    entita: "RuntimeBudgetPolicy",
    entitaId: result.policy?.id ?? null,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      procedimentoId: procedimento.id,
      outcome: result.outcome,
      hardCapAmount: authorization.hardCapAmount,
      windowSeconds: authorization.windowSeconds,
      currency: authorization.currency,
    },
  });
  revalidatePath("/admin/runtime");
  revalidatePath(`/procedimenti/${procedimento.id}`);
}

export async function recoverCurrentKnowledgeMissions(
  formData: FormData,
): Promise<void> {
  await requireRole(["ADMIN"]);
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("AUTHENTICATION_REQUIRED");
  const procedimentoId = formData.get("procedimentoId");
  const assignedActorId = formData.get("assignedActorId");
  if (typeof procedimentoId !== "string" || !procedimentoId.trim()) {
    throw new Error("INVALID_PROCEDIMENTO_ID");
  }
  if (assignedActorId !== null && typeof assignedActorId !== "string") {
    throw new Error("INVALID_ASSIGNED_ACTOR_ID");
  }
  const candidateActorId = assignedActorId?.trim() || null;
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId.trim() },
    select: { id: true, enteId: true },
  });
  if (!procedimento?.enteId) throw new Error("PROCEDIMENTO_NOT_FOUND");
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("TENANT_CONTEXT_REQUIRED");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await recoverCurrentKnowledgeResearchMissions({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
    candidateActorId,
    requireValidCandidate: candidateActorId !== null,
  });
  await auditSuccess({
    azione: "FASCICOLO_KNOWLEDGE_MISSION_RECOVER",
    entita: "FascicoloKnowledgeRevision",
    entitaId: result.revisionId,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      procedimentoId: procedimento.id,
      missionCount: result.missionCount,
      assignmentRequired: result.assignmentRequired,
      assignedActorId: result.assignedActorId,
      providerCalled: false,
    },
  });
  revalidatePath("/admin/runtime");
  revalidatePath(`/procedimenti/${procedimento.id}`);
}
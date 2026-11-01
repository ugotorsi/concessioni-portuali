"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireAdminWithMfa, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess, createAuditLogInTransaction } from "@/server/audit/auditLog";
import { setGlobalAiControlState } from "@/server/ai/globalAiControl";
import {
  setAutomationControlState,
  type AutomationMode,
} from "@/server/automation/automationControl";
import { requestExistingCorpusAnalysis } from "@/server/ai/fascicoloExistingCorpusAnalysis";
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
import {
  getRuntimeServiceDiagnostics,
  RUNTIME_DIAGNOSTIC_SERVICE_IDS,
  type RuntimeDiagnosticServiceId,
} from "@/server/runtime/serviceDiagnostics";

const RENDER_SERVICE_ID_PATTERN = /^srv-[a-z0-9]+$/;
const RUNTIME_BUDGET_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const MAX_RUNTIME_BUDGET_WINDOW_SECONDS = 31 * 24 * 60 * 60;
const ACTIVE_PROCEDIMENTO_STATES = ["DA_AVVIARE", "IN_CORSO"] as const;
const MAX_MANUAL_BATCH_SIZE = 100;

async function assertCommercialAutomationReady(): Promise<void> {
  const requiredEnvironment = [
    "AI_OPENAI_API_KEY",
    "ASYNC_PROVIDER_EXECUTION_ENABLED",
    "MCP_PRODUCTION_ENABLED",
    "MCP_FASCICOLO_GRANT_SECRET",
    "WORKOS_API_KEY",
    "RENDER_APPLICATION_WORKER_SERVICE_ID",
    "RENDER_WORKER_API_KEY",
  ] as const;
  const missing: string[] = requiredEnvironment.filter((name) => {
    const value = process.env[name]?.trim();
    if (!value) return true;
    if (name.endsWith("_ENABLED")) return value.toLowerCase() !== "true";
    return false;
  });
  if (process.env.PERIODIC_LEGAL_RESEARCH_ENABLED?.trim().toLowerCase() !== "true") {
    missing.push("PERIODIC_LEGAL_RESEARCH_ENABLED");
  }
  if (process.env.PERIODIC_LEGAL_RESEARCH_INTERVAL_DAYS?.trim() !== "7") {
    missing.push("PERIODIC_LEGAL_RESEARCH_INTERVAL_DAYS");
  }
  if (missing.length) {
    throw new Error(`AUTOMATION_CONFIGURATION_INCOMPLETE:${missing.join(",")}`);
  }
  const globalBudget = await prisma.runtimeBudgetPolicy.findFirst({
    where: {
      scope: "GLOBAL",
      enabled: true,
      currency: "EUR",
      effectiveFrom: { lte: new Date() },
    },
    select: { id: true },
  });
  if (!globalBudget) throw new Error("AUTOMATION_GLOBAL_BUDGET_REQUIRED");
}

export async function updateAutomationControl(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const mode = formData.get("mode");
  const confirmation = formData.get("confirmation");
  const reason = formData.get("reason");
  if (mode !== "OFF" && mode !== "ON") {
    throw new Error("INVALID_AUTOMATION_MODE");
  }
  const expectedConfirmation = mode === "ON"
    ? "ENABLE_COMMERCIAL_AUTOMATION"
    : "DISABLE_AUTOMATION";
  if (confirmation !== expectedConfirmation) {
    throw new Error("AUTOMATION_CONFIRMATION_REQUIRED");
  }
  if (reason !== null && typeof reason !== "string") {
    throw new Error("INVALID_AUTOMATION_REASON");
  }
  const normalizedReason = reason?.trim() || null;
  if ((mode === "ON" && !normalizedReason) || (normalizedReason?.length ?? 0) > 500) {
    throw new Error("INVALID_AUTOMATION_REASON");
  }
  if (mode === "ON") {
    await assertCommercialAutomationReady();
  }

  await setAutomationControlState({
    mode: mode as AutomationMode,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: "ADMIN",
    },
    reason: normalizedReason,
  });
  revalidatePath("/admin/runtime");
}

export async function runManualFascicoloAnalysis(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const procedimentoId = formData.get("procedimentoId");
  if (typeof procedimentoId !== "string" || !procedimentoId.trim()) {
    throw new Error("INVALID_PROCEDIMENTO_ID");
  }
  if (formData.get("confirmation") !== "RUN_MANUAL_FASCICOLO_ANALYSIS") {
    throw new Error("MANUAL_ANALYSIS_CONFIRMATION_REQUIRED");
  }
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId.trim() },
    select: { id: true, enteId: true },
  });
  if (!procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("TENANT_CONTEXT_REQUIRED");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await requestExistingCorpusAnalysis({
    tenantId: procedimento.enteId,
    procedimentoId: procedimento.id,
    actor: {
      id: currentUser.id,
      email: currentUser.email,
      role: "ADMIN",
    },
  });
  await auditSuccess({
    azione: "FASCICOLO_MANUAL_ANALYSIS_REQUEST",
    entita: "Procedimento",
    entitaId: procedimento.id,
    enteId: procedimento.enteId,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      jobId: result.admission.job.id,
      admissionOutcome: result.admission.outcome,
      workerActivationOutcome: result.activation.outcome,
      automationRequired: false,
    },
  });
  revalidatePath("/admin/runtime");
  revalidatePath(`/procedimenti/${procedimento.id}`);
}

export async function runManualTenantBatchAnalysis(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const tenantId = formData.get("tenantId");
  if (typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error("INVALID_TENANT_ID");
  }
  if (formData.get("confirmation") !== "RUN_ALL_ACTIVE_FASCICOLI") {
    throw new Error("MANUAL_BATCH_CONFIRMATION_REQUIRED");
  }
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("TENANT_CONTEXT_REQUIRED");
  requireTenantAccess(tenantContext, tenantId.trim(), {
    mode: "write",
    allowWhenEnteMissing: false,
  });
  const procedimenti = await prisma.procedimento.findMany({
    where: {
      enteId: tenantId.trim(),
      stato: { in: [...ACTIVE_PROCEDIMENTO_STATES] },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: MAX_MANUAL_BATCH_SIZE + 1,
    select: { id: true, enteId: true },
  });
  if (procedimenti.length > MAX_MANUAL_BATCH_SIZE) {
    throw new Error("MANUAL_BATCH_SIZE_LIMIT_EXCEEDED");
  }
  if (!procedimenti.length) throw new Error("NO_ACTIVE_PROCEDIMENTI");

  const admittedJobIds: string[] = [];
  try {
    for (const procedimento of procedimenti) {
      const result = await requestExistingCorpusAnalysis({
        tenantId: procedimento.enteId,
        procedimentoId: procedimento.id,
        actor: {
          id: currentUser.id,
          email: currentUser.email,
          role: "ADMIN",
        },
      });
      admittedJobIds.push(result.admission.job.id);
    }
  } catch (error) {
    await auditFailure({
      azione: "FASCICOLO_MANUAL_BATCH_ANALYSIS_FAILURE",
      entita: "Ente",
      entitaId: tenantId.trim(),
      enteId: tenantId.trim(),
      actor: {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
      },
      metadata: {
        requestedCount: procedimenti.length,
        admittedCount: admittedJobIds.length,
        admittedJobIds,
        reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
    });
    throw error;
  }
  await auditSuccess({
    azione: "FASCICOLO_MANUAL_BATCH_ANALYSIS_REQUEST",
    entita: "Ente",
    entitaId: tenantId.trim(),
    enteId: tenantId.trim(),
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      requestedCount: procedimenti.length,
      admittedJobIds,
      automationRequired: false,
    },
  });
  revalidatePath("/admin/runtime");
}

export async function upsertRuntimeBudgetPolicy(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const scope = formData.get("scope");
  const tenantIdInput = formData.get("tenantId");
  const procedimentoIdInput = formData.get("procedimentoId");
  const hardCapAmountInput = formData.get("hardCapAmount");
  const windowSecondsInput = formData.get("windowSeconds");
  const desiredState = formData.get("desiredState");
  if (scope !== "GLOBAL" && scope !== "TENANT" && scope !== "PROCEDIMENTO") {
    throw new Error("INVALID_RUNTIME_BUDGET_SCOPE");
  }
  if (
    typeof hardCapAmountInput !== "string"
    || !RUNTIME_BUDGET_AMOUNT_PATTERN.test(hardCapAmountInput.trim())
    || Number(hardCapAmountInput) <= 0
  ) {
    throw new Error("INVALID_RUNTIME_BUDGET_AMOUNT");
  }
  if (
    typeof windowSecondsInput !== "string"
    || !/^\d+$/.test(windowSecondsInput)
    || Number(windowSecondsInput) < 60
    || Number(windowSecondsInput) > MAX_RUNTIME_BUDGET_WINDOW_SECONDS
  ) {
    throw new Error("INVALID_RUNTIME_BUDGET_WINDOW");
  }
  if (desiredState !== "ENABLED" && desiredState !== "DISABLED") {
    throw new Error("INVALID_RUNTIME_BUDGET_STATE");
  }
  if (formData.get("confirmation") !== "AUTHORIZE_RUNTIME_BUDGET_POLICY") {
    throw new Error("RUNTIME_BUDGET_CONFIRMATION_REQUIRED");
  }

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("TENANT_CONTEXT_REQUIRED");
  let tenantId: string | null = null;
  let procedimentoId: string | null = null;
  if (scope === "TENANT") {
    if (typeof tenantIdInput !== "string" || !tenantIdInput.trim()) {
      throw new Error("RUNTIME_BUDGET_TENANT_REQUIRED");
    }
    tenantId = tenantIdInput.trim();
    requireTenantAccess(tenantContext, tenantId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  }
  if (scope === "PROCEDIMENTO") {
    if (typeof procedimentoIdInput !== "string" || !procedimentoIdInput.trim()) {
      throw new Error("RUNTIME_BUDGET_PROCEDIMENTO_REQUIRED");
    }
    procedimentoId = procedimentoIdInput.trim();
    const procedimento = await prisma.procedimento.findUnique({
      where: { id: procedimentoId },
      select: { enteId: true },
    });
    if (!procedimento?.enteId) throw new Error("PROCEDIMENTO_NOT_FOUND");
    tenantId = procedimento.enteId;
    requireTenantAccess(tenantContext, tenantId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  }

  const hardCapAmount = Number(hardCapAmountInput).toFixed(6);
  const windowSeconds = Number(windowSecondsInput);
  const enabled = desiredState === "ENABLED";
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT TRUE
      FROM pg_advisory_xact_lock(
        hashtext('concessioni-portuali'),
        hashtext('runtime-budget-policy:v1')
      )
    `;
    const existing = await tx.runtimeBudgetPolicy.findFirst({
      where: {
        scope,
        tenantId,
        procedimentoId,
        currency: "EUR",
        windowSeconds,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, hardCapAmount: true, enabled: true },
    });
    const policy = existing
      ? await tx.runtimeBudgetPolicy.update({
          where: { id: existing.id },
          data: {
            hardCapAmount,
            enabled,
            effectiveFrom: new Date(),
          },
          select: { id: true },
        })
      : await tx.runtimeBudgetPolicy.create({
          data: {
            scope,
            tenantId,
            procedimentoId,
            currency: "EUR",
            hardCapAmount,
            windowSeconds,
            enabled,
          },
          select: { id: true },
        });
    await createAuditLogInTransaction(tx, {
      azione: "RUNTIME_BUDGET_POLICY_CHANGE",
      entita: "RuntimeBudgetPolicy",
      entitaId: policy.id,
      enteId: tenantId,
      esito: "SUCCESS",
      actor: {
        userId: currentUser.id,
        userEmail: currentUser.email,
        userRole: currentUser.role,
      },
      metadata: {
        scope,
        tenantId,
        procedimentoId,
        currency: "EUR",
        windowSeconds,
        previousHardCapAmount: existing?.hardCapAmount.toString() ?? null,
        hardCapAmount,
        previousEnabled: existing?.enabled ?? null,
        enabled,
      },
    });
  }, { isolationLevel: "Serializable" });
  revalidatePath("/admin/runtime");
}

export async function verifyRuntimeService(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const serviceId = formData.get("serviceId");
  if (
    typeof serviceId !== "string"
    || !RUNTIME_DIAGNOSTIC_SERVICE_IDS.includes(serviceId as RuntimeDiagnosticServiceId)
  ) {
    throw new Error("INVALID_RUNTIME_DIAGNOSTIC_SERVICE");
  }
  const diagnostics = await getRuntimeServiceDiagnostics();
  const service = diagnostics.services.find((candidate) => candidate.id === serviceId);
  if (!service) throw new Error("RUNTIME_DIAGNOSTIC_NOT_AVAILABLE");

  await auditSuccess({
    azione: "RUNTIME_SERVICE_DIAGNOSTIC",
    entita: "RuntimeService",
    entitaId: service.id,
    actor: {
      userId: currentUser.id,
      userEmail: currentUser.email,
      userRole: currentUser.role,
    },
    metadata: {
      status: service.status,
      code: service.code,
      checkedAt: diagnostics.checkedAt.toISOString(),
    },
  });
  revalidatePath("/admin/runtime");
}

export async function setRenderWorkerState(formData: FormData): Promise<void> {
  const currentUser = await requireAdminWithMfa();
  const desiredState = formData.get("desiredState");
  const workerKind = formData.get("workerKind");
  if (desiredState !== "SUSPENDED" && desiredState !== "RUNNING") {
    throw new Error("INVALID_RENDER_WORKER_STATE");
  }
  if (workerKind !== "APPLICATION") {
    throw new Error("INVALID_RENDER_WORKER_KIND");
  }
  const confirmation = formData.get("confirmation");
  const expectedConfirmation = desiredState === "SUSPENDED"
    ? "SUSPEND_RENDER_APPLICATION_WORKER"
    : "RESUME_RENDER_APPLICATION_WORKER";
  if (confirmation !== expectedConfirmation) {
    throw new Error("RENDER_WORKER_CONFIRMATION_REQUIRED");
  }
  if (
    desiredState === "RUNNING"
    && formData.get("costAcknowledgement") !== "EXISTING_SERVICE_COSTS_AUTHORIZED"
  ) {
    throw new Error("RENDER_WORKER_COST_ACKNOWLEDGEMENT_REQUIRED");
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
      metadata: { desiredState, workerKind, reason: error instanceof Error ? error.name : "REQUEST_FAILED" },
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
      metadata: { desiredState, workerKind, status: response.status },
    });
    throw new Error(`RENDER_CONTROL_REJECTED_${response.status}`);
  }
  await auditSuccess({
    azione: "RUNTIME_RENDER_WORKER_CONTROL",
    entita: "RenderService",
    entitaId: serviceId,
    actor: { userId: currentUser.id, userEmail: currentUser.email, userRole: currentUser.role },
    metadata: {
      desiredState,
      workerKind,
      existingServiceCostsAcknowledged: desiredState === "RUNNING",
      purchasesAuthorized: false,
      subscriptionChangesAuthorized: false,
    },
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
"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditSuccess } from "@/server/audit/auditLog";
import {
  documentWorkerKindForOperation,
  requestDocumentWorkerActivation,
} from "@/server/async-jobs/documentWorkerActivation";
import { retryTerminalAsyncJob } from "@/server/async-jobs/persistence";
import {
  provisionDefaultProcedimentoBudgetPolicy,
  readDefaultProcedimentoBudgetAuthorization,
} from "@/server/runtime/procedimentoBudgetPolicy";

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
      await requestDocumentWorkerActivation(workerKind, retry.procedimentoId);
    }
  }
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
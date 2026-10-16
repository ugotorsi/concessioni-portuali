"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, requireRole } from "@/lib/auth";
import {
  documentWorkerKindForOperation,
  requestDocumentWorkerActivation,
} from "@/server/async-jobs/documentWorkerActivation";
import { retryTerminalAsyncJob } from "@/server/async-jobs/persistence";

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
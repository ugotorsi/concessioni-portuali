"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRole } from "@/lib/auth";
import { buildDatasetProcedimentoWhere } from "@/lib/dataset-visibility";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runDocumentExtractionJobById } from "@/server/documents/documentExtractionJob";

const inputSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,256}$/);

/**
 * Bounded, explicitly user-triggered extraction from the authenticated
 * Production runtime: its storage credentials stay on Vercel.
 * Only queued DOCUMENT_EXTRACTION_V1 jobs of the authorized procedure
 * can be claimed; the existing job runner validates the stored identity.
 * This action cannot execute other historical queue operations or AI providers.
 */
export async function extractQueuedProcedimentoDocumentsAction(formData: FormData): Promise<never> {
  await requireRole(["ADMIN", "TECNICO"]);
  const procedimentoId = inputSchema.parse(formData.get("procedimentoId"));
  const tenant = await getCurrentTenantContext();
  if (!tenant) throw new Error("SESSION_REQUIRED");

  const procedimento = await prisma.procedimento.findFirst({
    where: {
      id: procedimentoId,
      ...buildDatasetProcedimentoWhere(tenant.datasetScope),
    },
    select: { enteId: true },
  });
  if (!procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  requireTenantAccess(tenant, procedimento.enteId, { mode: "write" });

  // Never drain other operations, other proceedings, or more than five jobs.
  const queued = await prisma.asyncJob.findMany({
    where: {
      procedimentoId,
      tenantId: procedimento.enteId,
      operation: "DOCUMENT_EXTRACTION_V1",
      status: "QUEUED",
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 5,
  });

  let completed = 0;
  let attempted = 0;
  for (const job of queued) {
    attempted++;
    try {
      const outcome = await runDocumentExtractionJobById({
        jobId: job.id,
        workerId: "vercel-authorized-document-extraction",
      });
      if (outcome.outcome === "SUCCEEDED") completed++;
    } catch (error) {
      console.error("bounded_document_extraction_failed", {
        code: error instanceof AsyncJobExecutionError
          ? error.code
          : "DOCUMENT_EXTRACTION_WORKER_FAILURE",
      });
    }
  }

  revalidatePath(`/procedimenti/${procedimentoId}`);
  const outcome = attempted === 0 ? "none" : completed === attempted ? "done" : "partial";
  redirect(`/procedimenti/${procedimentoId}?section=documents&extraction=${outcome}`);
}

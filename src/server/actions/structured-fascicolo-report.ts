"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageProcedimenti, requireRole } from "@/lib/auth";
import { buildDatasetProcedimentoWhere } from "@/lib/dataset-visibility";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { persistStructuredFascicoloReport } from "@/server/fascicolo-report";
import { getFascicoloAutomaticWorkflowReadModel } from "@/server/queries/fascicolo-automatic-workflow";

const inputSchema = z.object({ procedimentoId: z.string().trim().min(1).max(256) }).strict();

export async function archiveStructuredFascicoloReportAction(formData: FormData): Promise<void> {
  const role = await requireRole();
  if (!canManageProcedimenti(role)) throw new Error("Profilo non autorizzato all'archiviazione del rapporto strutturato.");
  const input = inputSchema.parse({ procedimentoId: formData.get("procedimentoId") });
  const tenantContext = await getCurrentTenantContext();
  const procedimento = tenantContext
    ? await prisma.procedimento.findFirst({
      where: {
        id: input.procedimentoId,
        ...buildDatasetProcedimentoWhere(tenantContext.datasetScope),
      },
      select: { enteId: true },
    })
    : null;
  const tenantId = procedimento?.enteId;
  if (!tenantContext || !tenantId) throw new Error("Procedimento o tenant non disponibile.");
  requireTenantAccess(tenantContext, tenantId, { mode: "write", allowWhenEnteMissing: false });
  const model = await getFascicoloAutomaticWorkflowReadModel(input.procedimentoId);
  if (!model?.structuredReport) throw new Error("Knowledge CURRENT non disponibile per il rapporto strutturato.");
  await persistStructuredFascicoloReport(model.structuredReport);
  revalidatePath(`/procedimenti/${input.procedimentoId}`);
}
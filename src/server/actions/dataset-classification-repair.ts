"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminWithMfa } from "@/lib/auth";
import { buildDatasetProcedimentoWhere } from "@/lib/dataset-visibility";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import {
  DATASET_CLASSIFICATION_REPAIR_CONFIRMATION,
  repairDatasetClassification,
} from "@/server/dataset-classification/repair";

const repairSchema = z.object({
  procedimentoId: z.string().trim().min(1),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(10).max(1_000),
  confirmation: z.literal(DATASET_CLASSIFICATION_REPAIR_CONFIRMATION),
});

export async function repairDatasetClassificationAction(formData: FormData) {
  const actor = await requireAdminWithMfa();
  const parsed = repairSchema.parse(Object.fromEntries(formData));
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new Error("DATASET_CLASSIFICATION_TENANT_CONTEXT_REQUIRED");
  }
  const visibleProcedure = await prisma.procedimento.findFirst({
    where: {
      id: parsed.procedimentoId,
      ...buildDatasetProcedimentoWhere(tenantContext.datasetScope),
    },
    select: { id: true, enteId: true },
  });
  if (!visibleProcedure) {
    throw new Error("DATASET_CLASSIFICATION_PROCEDURE_NOT_VISIBLE");
  }
  requireTenantAccess(tenantContext, visibleProcedure.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const result = await repairDatasetClassification({
    procedimentoId: parsed.procedimentoId,
    expectedFingerprint: parsed.expectedFingerprint,
    reason: parsed.reason,
    actor: { id: actor.id, email: actor.email, role: "ADMIN" },
  });
  revalidatePath("/", "layout");
  redirect(`/dashboard?datasetRepair=${result.targetScope.toLowerCase()}`);
}

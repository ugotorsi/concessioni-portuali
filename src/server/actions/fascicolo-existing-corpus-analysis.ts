"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminWithMfa } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { requestExistingCorpusAnalysis } from "@/server/ai/fascicoloExistingCorpusAnalysis";

const procedimentoIdSchema = z.string().trim().min(1).max(256);

export async function requestExistingCorpusAnalysisAction(formData: FormData): Promise<void> {
  const actor = await requireAdminWithMfa();
  const procedimentoId = procedimentoIdSchema.parse(formData.get("procedimentoId"));
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { enteId: true },
  });
  if (!procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) throw new Error("AUTHENTICATION_REQUIRED");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });
  await requestExistingCorpusAnalysis({
    tenantId: procedimento.enteId,
    procedimentoId,
    actor: {
      id: actor.id,
      email: actor.email,
      role: "ADMIN",
    },
  });
  revalidatePath(`/procedimenti/${procedimentoId}`);
}

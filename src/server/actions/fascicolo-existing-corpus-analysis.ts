"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminWithMfa } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { requestExistingCorpusAnalysis } from "@/server/ai/fascicoloExistingCorpusAnalysis";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import { AI_MODEL_CATALOG } from "@/server/ai/providerCatalog";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import {
  getEffectiveAiScopePolicy,
  getResearchChannelAvailability,
} from "@/server/ai/scopePolicy";
import { getAutomationControlState } from "@/server/automation/automationControl";

const procedimentoIdSchema = z.string().trim().min(1).max(256);
const executionIdSchema = z.string().uuid().transform((value) => value.toLowerCase());

export async function requestExistingCorpusAnalysisAction(formData: FormData): Promise<void> {
  const actor = await requireAdminWithMfa();
  const procedimentoId = procedimentoIdSchema.parse(formData.get("procedimentoId"));
  const executionId = executionIdSchema.parse(formData.get("executionId"));
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
  const [globalControl, automationControl, providerControl, channels] = await Promise.all([
    getGlobalAiControlState(),
    getAutomationControlState(),
    getAiProviderControlSnapshot(),
    getResearchChannelAvailability(),
  ]);
  const readiness = await getAiProviderReadiness({
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    control: providerControl,
  });
  const policy = await getEffectiveAiScopePolicy({
    tenantId: procedimento.enteId,
    procedimentoId,
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    allowedProviders: readiness
      .filter((provider) => provider.manualEnabled && provider.manualEligible)
      .map((provider) => provider.provider),
    allowedResearchChannels: channels
      .filter((channel) => channel.available)
      .map((channel) => channel.channel),
  });
  if (!policy.aiEnabled) throw new Error("FASCICOLO_AI_POLICY_DISABLED");
  const selection = AI_MODEL_CATALOG.find((entry) => (
    entry.selection.provider === policy.primaryProvider
  ))?.selection;
  if (!selection) throw new Error("FASCICOLO_AI_PRIMARY_PROVIDER_INVALID");
  await requestExistingCorpusAnalysis({
    tenantId: procedimento.enteId,
    procedimentoId,
    executionId,
    selection,
    withLegalResearch: policy.linkedResearchEnabled,
    actor: {
      id: actor.id,
      email: actor.email,
      role: "ADMIN",
    },
  });
  revalidatePath(`/procedimenti/${procedimentoId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminWithMfa } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import {
  aiExecutionModeSchema,
  getEffectiveAiScopePolicy,
  getResearchChannelAvailability,
  parseAiScopeRequestedPolicy,
  researchChannelSchema,
  setAiScopePolicy,
  toAiScopeRequestedPolicy,
} from "@/server/ai/scopePolicy";
import { aiProviderIdSchema } from "@/server/ai/providerCatalog";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import { getAutomationControlState } from "@/server/automation/automationControl";

const idSchema = z.string().trim().min(1).max(256);

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "true";
}

function requestedPolicyFromForm(formData: FormData) {
  const intervalValue = formData.get("reviewIntervalHours");
  return parseAiScopeRequestedPolicy({
    aiEnabled: checked(formData, "aiEnabled"),
    automaticAnalysisEnabled: checked(formData, "automaticAnalysisEnabled"),
    selectedProviders: formData.getAll("providers").map((provider) => (
      aiProviderIdSchema.parse(provider)
    )),
    primaryProvider: aiProviderIdSchema.parse(formData.get("primaryProvider")),
    executionMode: aiExecutionModeSchema.parse(formData.get("executionMode")),
    manualResearchEnabled: checked(formData, "manualResearchEnabled"),
    linkedResearchEnabled: checked(formData, "linkedResearchEnabled"),
    automaticResearchEnabled: checked(formData, "automaticResearchEnabled"),
    researchChannels: formData.getAll("researchChannels").map((channel) => (
      researchChannelSchema.parse(channel)
    )),
    reviewIntervalHours: typeof intervalValue === "string" && intervalValue.trim()
      ? Number(intervalValue)
      : null,
  });
}

export async function updateFascicoloAiPolicyAction(formData: FormData): Promise<void> {
  const actor = await requireAdminWithMfa();
  if (formData.get("confirmation") !== "UPDATE_FASCICOLO_AI_POLICY") {
    throw new Error("FASCICOLO_AI_POLICY_CONFIRMATION_REQUIRED");
  }
  const procedimentoId = idSchema.parse(formData.get("procedimentoId"));
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
  const upper = await getEffectiveAiScopePolicy({
    tenantId: procedimento.enteId,
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    allowedProviders: readiness
      .filter((provider) => provider.manualEnabled && provider.manualEligible)
      .map((provider) => provider.provider),
    allowedResearchChannels: channels
      .filter((channel) => channel.available)
      .map((channel) => channel.channel),
  });
  await setAiScopePolicy({
    scope: "FASCICOLO",
    tenantId: procedimento.enteId,
    procedimentoId,
    policy: requestedPolicyFromForm(formData),
    upperPolicy: toAiScopeRequestedPolicy(upper),
    actor: {
      userId: actor.id,
      userEmail: actor.email,
      userRole: "ADMIN",
    },
    reason: "Aggiornamento dalla sezione Intelligenza artificiale e ricerche",
  });
  revalidatePath(`/procedimenti/${procedimentoId}`);
}

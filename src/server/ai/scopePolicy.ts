import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import {
  AI_MODEL_CATALOG,
  aiProviderIdSchema,
  type AiProviderId,
} from "@/server/ai/providerCatalog";
import { getResearchMcpAuthConfig } from "@/server/legal-research/mcp-auth";
import { verifyAutomaticResearchConnectorReadiness } from "@/server/legal-research/automatic-research-readiness";
import { isTechnicalSourcesChannelEnabled } from "@/server/technical-sources/technical-sources-m2m";

export const AI_SCOPE_POLICY_ACTION = "AI_SCOPE_POLICY_CHANGE";
export const AI_SCOPE_POLICY_ENTITY = "AiScopePolicy";

export const aiExecutionModeSchema = z.enum(["SINGLE", "SEQUENTIAL", "PARALLEL"]);
export type AiExecutionMode = z.infer<typeof aiExecutionModeSchema>;

export const researchChannelSchema = z.enum([
  "CHATGPT_MCP",
  "LEGAL_DATA_HUNTER",
  "MOONLIT",
  "SIMPLICITER",
  "TECHNICAL_SOURCES",
]);
export type ResearchChannel = z.infer<typeof researchChannelSchema>;

const requestedPolicySchema = z.object({
  aiEnabled: z.boolean(),
  automaticAnalysisEnabled: z.boolean(),
  selectedProviders: z.array(aiProviderIdSchema).min(1),
  primaryProvider: aiProviderIdSchema,
  executionMode: aiExecutionModeSchema,
  manualResearchEnabled: z.boolean(),
  linkedResearchEnabled: z.boolean(),
  automaticResearchEnabled: z.boolean(),
  researchChannels: z.array(researchChannelSchema),
  reviewIntervalHours: z.number().int().min(1).max(24 * 365).nullable(),
}).strict().superRefine((policy, context) => {
  if (!policy.selectedProviders.includes(policy.primaryProvider)) {
    context.addIssue({
      code: "custom",
      path: ["primaryProvider"],
      message: "PRIMARY_PROVIDER_NOT_SELECTED",
    });
  }
  if (new Set(policy.selectedProviders).size !== policy.selectedProviders.length) {
    context.addIssue({
      code: "custom",
      path: ["selectedProviders"],
      message: "DUPLICATE_PROVIDER",
    });
  }
  if (new Set(policy.researchChannels).size !== policy.researchChannels.length) {
    context.addIssue({
      code: "custom",
      path: ["researchChannels"],
      message: "DUPLICATE_RESEARCH_CHANNEL",
    });
  }
});

export type AiScopeRequestedPolicy = z.infer<typeof requestedPolicySchema>;

export interface AiScopePolicyActor {
  readonly userId: string;
  readonly userEmail: string;
  readonly userRole: string;
}

export interface EffectiveAiScopePolicy extends AiScopeRequestedPolicy {
  readonly tenantId: string;
  readonly procedimentoId: string | null;
  readonly updatedAt: Date | null;
  readonly blockedReasons: readonly string[];
}

export interface ResearchChannelAvailability {
  readonly channel: ResearchChannel;
  readonly available: boolean;
  readonly reason: string | null;
}

const defaultPolicy: AiScopeRequestedPolicy = {
  aiEnabled: true,
  automaticAnalysisEnabled: false,
  selectedProviders: ["OPENAI"],
  primaryProvider: "OPENAI",
  executionMode: "SINGLE",
  manualResearchEnabled: true,
  linkedResearchEnabled: false,
  automaticResearchEnabled: false,
  researchChannels: [],
  reviewIntervalHours: null,
};

function entityId(scope: "TENANT" | "FASCICOLO", tenantId: string, procedimentoId?: string): string {
  return scope === "TENANT"
    ? `TENANT:${tenantId}`
    : `FASCICOLO:${tenantId}:${procedimentoId ?? ""}`;
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function policyFromMetadata(value: Prisma.JsonValue | null): AiScopeRequestedPolicy | null {
  const metadata = metadataRecord(value);
  const parsed = requestedPolicySchema.safeParse(metadata?.policy);
  return parsed.success ? parsed.data : null;
}

function restrictPolicy(
  upper: AiScopeRequestedPolicy,
  lower: AiScopeRequestedPolicy | null,
): AiScopeRequestedPolicy {
  if (!lower) return upper;
  const selectedProviders = lower.selectedProviders.filter((provider) => (
    upper.selectedProviders.includes(provider)
  ));
  const safeProviders = selectedProviders.length > 0
    ? selectedProviders
    : [upper.primaryProvider];
  const primaryProvider = safeProviders.includes(lower.primaryProvider)
    ? lower.primaryProvider
    : safeProviders.includes(upper.primaryProvider)
      ? upper.primaryProvider
      : safeProviders[0]!;
  const researchChannels = lower.researchChannels.filter((channel) => (
    upper.researchChannels.includes(channel)
  ));
  return {
    aiEnabled: upper.aiEnabled && lower.aiEnabled,
    automaticAnalysisEnabled:
      upper.automaticAnalysisEnabled && lower.automaticAnalysisEnabled,
    selectedProviders: safeProviders,
    primaryProvider,
    executionMode: lower.executionMode,
    manualResearchEnabled:
      upper.manualResearchEnabled && lower.manualResearchEnabled,
    linkedResearchEnabled:
      upper.linkedResearchEnabled && lower.linkedResearchEnabled,
    automaticResearchEnabled:
      upper.automaticResearchEnabled && lower.automaticResearchEnabled,
    researchChannels,
    reviewIntervalHours: lower.reviewIntervalHours === null
      ? upper.reviewIntervalHours
      : upper.reviewIntervalHours === null
        ? lower.reviewIntervalHours
        : Math.max(upper.reviewIntervalHours, lower.reviewIntervalHours),
  };
}

export async function getEffectiveAiScopePolicy(input: {
  readonly tenantId: string;
  readonly procedimentoId?: string | null;
  readonly globalAiEnabled: boolean;
  readonly generalAutomationEnabled: boolean;
  readonly allowedProviders: readonly AiProviderId[];
  readonly allowedResearchChannels?: readonly ResearchChannel[];
  readonly includePersistedScopes?: boolean;
}): Promise<EffectiveAiScopePolicy> {
  const ids = input.includePersistedScopes === false
    ? []
    : [
        entityId("TENANT", input.tenantId),
        ...(input.procedimentoId
          ? [entityId("FASCICOLO", input.tenantId, input.procedimentoId)]
          : []),
      ];
  const events = ids.length > 0 ? await prisma.activityLog.findMany({
    where: {
      azione: AI_SCOPE_POLICY_ACTION,
      entita: AI_SCOPE_POLICY_ENTITY,
      entitaId: { in: ids },
      esito: "SUCCESS",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entitaId: true, metadata: true, createdAt: true },
  }) : [];
  const latest = new Map<string, typeof events[number]>();
  for (const event of events) {
    if (!latest.has(event.entitaId ?? "")) latest.set(event.entitaId ?? "", event);
  }
  const allowedProviders = AI_MODEL_CATALOG
    .map((entry) => entry.selection.provider)
    .filter((provider) => input.allowedProviders.includes(provider));
  const systemPolicy: AiScopeRequestedPolicy = {
    ...defaultPolicy,
    aiEnabled: input.globalAiEnabled && allowedProviders.length > 0,
    automaticAnalysisEnabled:
      input.globalAiEnabled
      && input.generalAutomationEnabled
      && allowedProviders.length > 0,
    selectedProviders: allowedProviders.length > 0 ? allowedProviders : ["OPENAI"],
    primaryProvider: allowedProviders[0] ?? "OPENAI",
    manualResearchEnabled: true,
    linkedResearchEnabled: input.globalAiEnabled && allowedProviders.length > 0,
    automaticResearchEnabled:
      input.globalAiEnabled
      && input.generalAutomationEnabled
      && allowedProviders.length > 0,
    researchChannels: [...(input.allowedResearchChannels ?? [])],
  };
  const tenantEvent = latest.get(entityId("TENANT", input.tenantId));
  const tenantPolicy = restrictPolicy(
    systemPolicy,
    policyFromMetadata(tenantEvent?.metadata ?? null),
  );
  const fascicoloEvent = input.procedimentoId
    ? latest.get(entityId("FASCICOLO", input.tenantId, input.procedimentoId))
    : null;
  const effective = restrictPolicy(
    tenantPolicy,
    policyFromMetadata(fascicoloEvent?.metadata ?? null),
  );
  const blockedReasons = [
    ...(!input.globalAiEnabled ? ["AI_GLOBALLY_DISABLED"] : []),
    ...(input.allowedProviders.length === 0 ? ["NO_AUTHORIZED_AI_PROVIDER"] : []),
    ...(!input.generalAutomationEnabled && effective.automaticAnalysisEnabled
      ? ["GENERAL_AUTOMATION_DISABLED"]
      : []),
  ];
  return {
    ...effective,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId ?? null,
    updatedAt: fascicoloEvent?.createdAt ?? tenantEvent?.createdAt ?? null,
    blockedReasons,
  };
}

export async function getResearchChannelAvailability(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<readonly ResearchChannelAvailability[]> {
  const connectorReadiness = await verifyAutomaticResearchConnectorReadiness(environment);
  const mcpConfig = getResearchMcpAuthConfig(environment as NodeJS.ProcessEnv);
  const mcpAvailable = Boolean(
    mcpConfig
    && environment.MCP_FASCICOLO_GRANT_SECRET?.trim()
    && environment.WORKOS_API_KEY?.trim(),
  );
  return [
    {
      channel: "CHATGPT_MCP",
      available: mcpAvailable,
      reason: mcpAvailable ? null : "Configurazione MCP/WorkOS incompleta",
    },
    {
      channel: "LEGAL_DATA_HUNTER",
      available: connectorReadiness.legalDataHunter === "READY",
      reason: connectorReadiness.legalDataHunter === "READY"
        ? null
        : "Credenziale Legal Data Hunter assente",
    },
    {
      channel: "MOONLIT",
      available: connectorReadiness.moonlit === "READY",
      reason: connectorReadiness.moonlit === "READY"
        ? null
        : `Moonlit: ${connectorReadiness.moonlit}`,
    },
    {
      channel: "SIMPLICITER",
      available: connectorReadiness.simpliciter === "READY",
      reason: connectorReadiness.simpliciter === "READY"
        ? null
        : `Simpliciter: ${connectorReadiness.simpliciter}`,
    },
    {
      channel: "TECHNICAL_SOURCES",
      available: isTechnicalSourcesChannelEnabled(environment),
      reason: isTechnicalSourcesChannelEnabled(environment)
        ? null
        : "Canale fonti tecniche non configurato",
    },
  ];
}

export async function setAiScopePolicy(input: {
  readonly scope: "TENANT" | "FASCICOLO";
  readonly tenantId: string;
  readonly procedimentoId?: string | null;
  readonly policy: AiScopeRequestedPolicy;
  readonly upperPolicy: AiScopeRequestedPolicy;
  readonly actor: AiScopePolicyActor;
  readonly reason?: string | null;
}) {
  const policy = requestedPolicySchema.parse(input.policy);
  const restricted = restrictPolicy(input.upperPolicy, policy);
  if (JSON.stringify(restricted) !== JSON.stringify(policy)) {
    throw new Error("AI_SCOPE_POLICY_EXCEEDS_UPPER_SCOPE");
  }
  const targetId = entityId(
    input.scope,
    input.tenantId,
    input.procedimentoId ?? undefined,
  );
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT TRUE AS "acquired"
      FROM pg_advisory_xact_lock(
        hashtext('concessioni-portuali'),
        hashtext(${`ai-scope-policy:${targetId}`})
      )
    `;
    const audit = await createAuditLogInTransaction(tx, {
      azione: AI_SCOPE_POLICY_ACTION,
      entita: AI_SCOPE_POLICY_ENTITY,
      entitaId: targetId,
      esito: "SUCCESS",
      actor: input.actor,
      metadata: {
        scope: input.scope,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId ?? null,
        policy,
        reason: input.reason?.trim() || null,
      },
    });
    return { policy, updatedAt: audit.createdAt };
  });
}

export function parseAiScopeRequestedPolicy(value: unknown): AiScopeRequestedPolicy {
  return requestedPolicySchema.parse(value);
}

export function toAiScopeRequestedPolicy(
  policy: EffectiveAiScopePolicy,
): AiScopeRequestedPolicy {
  return {
    aiEnabled: policy.aiEnabled,
    automaticAnalysisEnabled: policy.automaticAnalysisEnabled,
    selectedProviders: [...policy.selectedProviders],
    primaryProvider: policy.primaryProvider,
    executionMode: policy.executionMode,
    manualResearchEnabled: policy.manualResearchEnabled,
    linkedResearchEnabled: policy.linkedResearchEnabled,
    automaticResearchEnabled: policy.automaticResearchEnabled,
    researchChannels: [...policy.researchChannels],
    reviewIntervalHours: policy.reviewIntervalHours,
  };
}

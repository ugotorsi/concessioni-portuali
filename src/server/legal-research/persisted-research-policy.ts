import { getGlobalAiControlState } from "@/server/ai/globalAiControl";
import {
  type EffectiveAiScopePolicy,
  type ResearchChannel,
  getEffectiveAiScopePolicy,
  getResearchChannelAvailability,
} from "@/server/ai/scopePolicy";
import { getAiProviderControlSnapshot } from "@/server/ai/providerControl";
import { getAiProviderReadiness } from "@/server/ai/providerReadiness";
import { getAutomationControlState } from "@/server/automation/automationControl";

import {
  evaluateAutomaticResearchPolicy,
  type AutomaticResearchPolicyDecision,
  type AutomaticResearchPolicyEnv,
} from "./automatic-research-policy";
import {
  evaluateManualResearchPolicy,
  type ManualResearchPolicyDecision,
  type ManualResearchPolicyEnv,
} from "./manual-research-policy";
import type { ResearchMission } from "./bridge";

const DEFAULT_CAPABILITIES = [
  "SEMANTIC_DISCOVERY",
  "KEYWORD_DISCOVERY",
  "EXACT_RETRIEVAL",
  "FULL_TEXT_RETRIEVAL",
  "CITATION_NETWORK",
  "CROSS_JURISDICTION_DISCOVERY",
  "ADVERSE_AUTHORITY_DISCOVERY",
].join(",");

const SERVER_RESEARCH_EXECUTION_CHANNELS = new Set([
  "LEGAL_DATA_HUNTER",
  "MOONLIT",
  "SIMPLICITER",
]);

export function hasServerResearchExecutionChannel(
  channels: readonly ResearchChannel[],
): boolean {
  return channels.some((channel) => SERVER_RESEARCH_EXECUTION_CHANNELS.has(channel));
}

export async function effectiveResearchPolicyEnvironment(input: {
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<AutomaticResearchPolicyEnv & ManualResearchPolicyEnv> {
  const environment = input.environment ?? process.env;
  const policy = await getPersistedResearchScopePolicy(input);
  const serverExecutionAvailable = hasServerResearchExecutionChannel(policy.researchChannels);
  const automaticEnabled = policy.automaticResearchEnabled
    && serverExecutionAvailable;
  const manualEnabled = policy.manualResearchEnabled
    && serverExecutionAvailable;
  const common = {
    tenantAllowlist: input.tenantId,
    procedimentoAllowlist: input.procedimentoId,
    capabilities:
      environment.AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES?.trim()
      || environment.MANUAL_RESEARCH_ALLOWED_CAPABILITIES?.trim()
      || DEFAULT_CAPABILITIES,
    maximumCalls:
      environment.AUTOMATIC_RESEARCH_MAX_CALLS?.trim()
      || environment.MANUAL_RESEARCH_MAX_CALLS?.trim()
      || "10",
    actorId:
      environment.AUTOMATIC_RESEARCH_WORKER_ACTOR_ID?.trim()
      || environment.MANUAL_RESEARCH_WORKER_ACTOR_ID?.trim()
      || "noetra-research-worker",
    leaseMs:
      environment.AUTOMATIC_RESEARCH_LEASE_MS?.trim()
      || environment.MANUAL_RESEARCH_LEASE_MS?.trim()
      || "900000",
    timeoutMs:
      environment.AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS?.trim()
      || environment.MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS?.trim()
      || "30000",
  };
  return {
    AUTOMATIC_RESEARCH_EXECUTION_ENABLED: automaticEnabled ? "true" : "false",
    AUTOMATIC_RESEARCH_TENANT_ALLOWLIST: common.tenantAllowlist,
    AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST: common.procedimentoAllowlist,
    AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES: common.capabilities,
    AUTOMATIC_RESEARCH_MAX_CALLS: common.maximumCalls,
    AUTOMATIC_RESEARCH_WORKER_ACTOR_ID: common.actorId,
    AUTOMATIC_RESEARCH_LEASE_MS: common.leaseMs,
    AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS: common.timeoutMs,
    AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED:
      environment.AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED === "true"
        ? "true"
        : "false",
    AUTOMATIC_OFFICIAL_SOURCE_MAX_ACQUISITIONS:
      environment.AUTOMATIC_OFFICIAL_SOURCE_MAX_ACQUISITIONS?.trim() || "0",
    MANUAL_RESEARCH_EXECUTION_ENABLED: manualEnabled ? "true" : "false",
    MANUAL_RESEARCH_TENANT_ALLOWLIST: common.tenantAllowlist,
    MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST: common.procedimentoAllowlist,
    MANUAL_RESEARCH_ALLOWED_CAPABILITIES: common.capabilities,
    MANUAL_RESEARCH_MAX_CALLS: common.maximumCalls,
    MANUAL_RESEARCH_WORKER_ACTOR_ID: common.actorId,
    MANUAL_RESEARCH_LEASE_MS: common.leaseMs,
    MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS: common.timeoutMs,
    MANUAL_OFFICIAL_SOURCE_VERIFICATION_ENABLED:
      environment.MANUAL_OFFICIAL_SOURCE_VERIFICATION_ENABLED === "true"
        ? "true"
        : "false",
    MANUAL_OFFICIAL_SOURCE_MAX_ACQUISITIONS:
      environment.MANUAL_OFFICIAL_SOURCE_MAX_ACQUISITIONS?.trim() || "0",
  };
}

export async function getPersistedResearchScopePolicy(input: {
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<EffectiveAiScopePolicy> {
  const environment = input.environment ?? process.env;
  const [globalControl, automationControl, channels, providerControl] = await Promise.all([
    getGlobalAiControlState(environment),
    getAutomationControlState(),
    getResearchChannelAvailability(environment),
    getAiProviderControlSnapshot(),
  ]);
  const readiness = await getAiProviderReadiness({
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    control: providerControl,
    environment,
  });
  return getEffectiveAiScopePolicy({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    globalAiEnabled: globalControl.effectiveEnabled,
    generalAutomationEnabled: automationControl.effectiveEnabled,
    allowedProviders: readiness
      .filter((provider) => provider.manualEnabled && provider.manualEligible)
      .map((provider) => provider.provider),
    allowedResearchChannels: channels
      .filter((channel) => channel.available)
      .map((channel) => channel.channel),
  });
}

export async function evaluatePersistedAutomaticResearchPolicy(input: {
  readonly tenantId: string;
  readonly mission?: ResearchMission;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<AutomaticResearchPolicyDecision> {
  const procedimentoId = input.mission?.caseReference.caseId;
  if (!procedimentoId) {
    return evaluateAutomaticResearchPolicy({
      tenantId: input.tenantId,
      mission: input.mission,
      env: {
        AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
      },
    });
  }
  return evaluateAutomaticResearchPolicy({
    tenantId: input.tenantId,
    mission: input.mission,
    env: await effectiveResearchPolicyEnvironment({
      tenantId: input.tenantId,
      procedimentoId,
      environment: input.environment,
    }),
  });
}

export async function evaluatePersistedManualResearchPolicy(input: {
  readonly tenantId: string;
  readonly mission: ResearchMission;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}): Promise<ManualResearchPolicyDecision> {
  return evaluateManualResearchPolicy({
    tenantId: input.tenantId,
    mission: input.mission,
    env: await effectiveResearchPolicyEnvironment({
      tenantId: input.tenantId,
      procedimentoId: input.mission.caseReference.caseId,
      environment: input.environment,
    }),
  });
}

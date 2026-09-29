import { createHash } from "node:crypto";

import type { ResearchCapability, ResearchMission } from "./bridge";

export const AUTOMATIC_RESEARCH_POLICY_ENV_NAMES = [
  "AUTOMATIC_RESEARCH_EXECUTION_ENABLED",
  "AUTOMATIC_RESEARCH_TENANT_ALLOWLIST",
  "AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST",
  "AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES",
  "AUTOMATIC_RESEARCH_MAX_CALLS",
  "AUTOMATIC_RESEARCH_WORKER_ACTOR_ID",
  "AUTOMATIC_RESEARCH_LEASE_MS",
  "AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS",
] as const;

const capabilities = new Set<ResearchCapability>([
  "SEMANTIC_DISCOVERY",
  "KEYWORD_DISCOVERY",
  "EXACT_RETRIEVAL",
  "FULL_TEXT_RETRIEVAL",
  "CITATION_NETWORK",
  "CROSS_JURISDICTION_DISCOVERY",
  "ADVERSE_AUTHORITY_DISCOVERY",
]);

export type AutomaticResearchPolicyRequirement =
  | "AUTOMATIC_RESEARCH_POLICY_DISABLED"
  | "AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED"
  | "AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED"
  | "AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED"
  | "AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED"
  | "AUTOMATIC_RESEARCH_POLICY_INVALID";

export type AutomaticResearchPolicyDecision = Readonly<{
  authorized: boolean;
  requirementCode: AutomaticResearchPolicyRequirement | null;
  policyDecisionRef: string | null;
  workerActorId: string | null;
  leaseDurationMs: number | null;
  providerTimeoutMs: number | null;
  allowedCapabilities: readonly ResearchCapability[];
}>;

export type AutomaticResearchPolicyEnv = Partial<
  Record<(typeof AUTOMATIC_RESEARCH_POLICY_ENV_NAMES)[number], string | undefined>
>;

function list(value: string | undefined): readonly string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function integer(value: string | undefined, minimum: number, maximum: number): number | null {
  if (!value || !/^[0-9]+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function denied(
  requirementCode: AutomaticResearchPolicyRequirement,
  allowedCapabilities: readonly ResearchCapability[] = [],
): AutomaticResearchPolicyDecision {
  return {
    authorized: false,
    requirementCode,
    policyDecisionRef: null,
    workerActorId: null,
    leaseDurationMs: null,
    providerTimeoutMs: null,
    allowedCapabilities,
  };
}

export function evaluateAutomaticResearchPolicy(input: Readonly<{
  tenantId: string;
  mission?: ResearchMission;
  env?: AutomaticResearchPolicyEnv | NodeJS.ProcessEnv;
}>): AutomaticResearchPolicyDecision {
  const env = input.env ?? process.env;
  if (env.AUTOMATIC_RESEARCH_EXECUTION_ENABLED?.trim().toLowerCase() !== "true") {
    return denied("AUTOMATIC_RESEARCH_POLICY_DISABLED");
  }
  const tenantAllowlist = list(env.AUTOMATIC_RESEARCH_TENANT_ALLOWLIST);
  if (!tenantAllowlist.includes(input.tenantId)) {
    return denied("AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED");
  }
  const procedimentoAllowlist = list(env.AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST);
  if (input.mission && !procedimentoAllowlist.includes(input.mission.caseReference.caseId)) {
    return denied("AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED");
  }
  const rawCapabilities = list(env.AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES);
  if (rawCapabilities.some((capability) => !capabilities.has(capability as ResearchCapability))) {
    return denied("AUTOMATIC_RESEARCH_POLICY_INVALID");
  }
  const allowedCapabilities = rawCapabilities as readonly ResearchCapability[];
  const maximumCalls = integer(env.AUTOMATIC_RESEARCH_MAX_CALLS, 0, 100);
  const leaseDurationMs = integer(env.AUTOMATIC_RESEARCH_LEASE_MS, 1_000, 86_400_000);
  const providerTimeoutMs = integer(env.AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS, 1_000, 300_000);
  const workerActorId = env.AUTOMATIC_RESEARCH_WORKER_ACTOR_ID?.trim() ?? "";
  if (maximumCalls === null || leaseDurationMs === null || providerTimeoutMs === null
    || !workerActorId || workerActorId.length > 256) {
    return denied("AUTOMATIC_RESEARCH_POLICY_INVALID", allowedCapabilities);
  }
  const requiredCapabilities = input.mission?.executionPlan?.requiredCapabilities ?? [];
  if (requiredCapabilities.some((capability) => !allowedCapabilities.includes(capability))) {
    return denied("AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED", allowedCapabilities);
  }
  if (input.mission && input.mission.budget.maxTotalResearchCalls > maximumCalls) {
    return denied("AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED", allowedCapabilities);
  }
  const policyDocument = {
    version: "AUTOMATIC_RESEARCH_POLICY_V1",
    tenantId: input.tenantId,
    tenantAllowlist: [...tenantAllowlist].sort(),
    procedimentoAllowlist: [...procedimentoAllowlist].sort(),
    allowedCapabilities: [...allowedCapabilities].sort(),
    maximumCalls,
    workerActorId,
    leaseDurationMs,
    providerTimeoutMs,
  };
  return {
    authorized: true,
    requirementCode: null,
    policyDecisionRef: `automatic-research-policy:${createHash("sha256")
      .update(JSON.stringify(policyDocument), "utf8").digest("hex")}`,
    workerActorId,
    leaseDurationMs,
    providerTimeoutMs,
    allowedCapabilities,
  };
}

import { createHash } from "node:crypto";

import type { ResearchMission } from "./bridge";
import {
  evaluateAutomaticResearchPolicy,
  type AutomaticResearchPolicyDecision,
  type AutomaticResearchPolicyEnv,
} from "./automatic-research-policy";

export const MANUAL_RESEARCH_POLICY_ENV_NAMES = [
  "MANUAL_RESEARCH_EXECUTION_ENABLED",
  "MANUAL_RESEARCH_TENANT_ALLOWLIST",
  "MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST",
  "MANUAL_RESEARCH_ALLOWED_CAPABILITIES",
  "MANUAL_RESEARCH_MAX_CALLS",
  "MANUAL_RESEARCH_WORKER_ACTOR_ID",
  "MANUAL_RESEARCH_LEASE_MS",
  "MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS",
  "MANUAL_OFFICIAL_SOURCE_VERIFICATION_ENABLED",
  "MANUAL_OFFICIAL_SOURCE_MAX_ACQUISITIONS",
] as const;

export type ManualResearchPolicyRequirement =
  | "MANUAL_RESEARCH_EXECUTION_CHANNEL_NOT_ALLOWED"
  | "MANUAL_RESEARCH_POLICY_DISABLED"
  | "MANUAL_RESEARCH_TENANT_NOT_ALLOWED"
  | "MANUAL_RESEARCH_PROCEDIMENTO_NOT_ALLOWED"
  | "MANUAL_RESEARCH_CAPABILITY_NOT_ALLOWED"
  | "MANUAL_RESEARCH_BUDGET_NOT_ALLOWED"
  | "MANUAL_RESEARCH_POLICY_INVALID";

export type ManualResearchPolicyEnv = Partial<
  Record<(typeof MANUAL_RESEARCH_POLICY_ENV_NAMES)[number], string | undefined>
>;

export type ManualResearchPolicyDecision = Omit<
  AutomaticResearchPolicyDecision,
  "requirementCode"
> & Readonly<{ requirementCode: ManualResearchPolicyRequirement | null }>;

const requirementCodes: Readonly<Record<string, ManualResearchPolicyRequirement>> = {
  AUTOMATIC_RESEARCH_EXECUTION_CHANNEL_NOT_ALLOWED: "MANUAL_RESEARCH_EXECUTION_CHANNEL_NOT_ALLOWED",
  AUTOMATIC_RESEARCH_POLICY_DISABLED: "MANUAL_RESEARCH_POLICY_DISABLED",
  AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED: "MANUAL_RESEARCH_TENANT_NOT_ALLOWED",
  AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED: "MANUAL_RESEARCH_PROCEDIMENTO_NOT_ALLOWED",
  AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED: "MANUAL_RESEARCH_CAPABILITY_NOT_ALLOWED",
  AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED: "MANUAL_RESEARCH_BUDGET_NOT_ALLOWED",
  AUTOMATIC_RESEARCH_POLICY_INVALID: "MANUAL_RESEARCH_POLICY_INVALID",
};

function automaticEnvironment(
  environment: ManualResearchPolicyEnv | NodeJS.ProcessEnv,
): AutomaticResearchPolicyEnv {
  return {
    AUTOMATIC_RESEARCH_EXECUTION_ENABLED: environment.MANUAL_RESEARCH_EXECUTION_ENABLED,
    AUTOMATIC_RESEARCH_TENANT_ALLOWLIST: environment.MANUAL_RESEARCH_TENANT_ALLOWLIST,
    AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST: environment.MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST,
    AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES: environment.MANUAL_RESEARCH_ALLOWED_CAPABILITIES,
    AUTOMATIC_RESEARCH_MAX_CALLS: environment.MANUAL_RESEARCH_MAX_CALLS,
    AUTOMATIC_RESEARCH_WORKER_ACTOR_ID: environment.MANUAL_RESEARCH_WORKER_ACTOR_ID,
    AUTOMATIC_RESEARCH_LEASE_MS: environment.MANUAL_RESEARCH_LEASE_MS,
    AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS: environment.MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS,
    AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED:
      environment.MANUAL_OFFICIAL_SOURCE_VERIFICATION_ENABLED,
    AUTOMATIC_OFFICIAL_SOURCE_MAX_ACQUISITIONS:
      environment.MANUAL_OFFICIAL_SOURCE_MAX_ACQUISITIONS,
  };
}

export function evaluateManualResearchPolicy(input: Readonly<{
  tenantId: string;
  mission?: ResearchMission;
  env?: ManualResearchPolicyEnv | NodeJS.ProcessEnv;
}>): ManualResearchPolicyDecision {
  const decision = evaluateAutomaticResearchPolicy({
    tenantId: input.tenantId,
    mission: input.mission,
    env: automaticEnvironment(input.env ?? process.env),
  });
  if (!decision.authorized || !decision.policyDecisionRef) {
    return {
      ...decision,
      requirementCode: decision.requirementCode
        ? requirementCodes[decision.requirementCode] ?? "MANUAL_RESEARCH_POLICY_INVALID"
        : "MANUAL_RESEARCH_POLICY_INVALID",
    };
  }
  return {
    ...decision,
    requirementCode: null,
    policyDecisionRef: `manual-research-policy-v1:${createHash("sha256")
      .update(decision.policyDecisionRef, "utf8").digest("hex")}`,
  };
}

export function manualResearchPlanner(
  tenantId: string,
  env?: ManualResearchPolicyEnv | NodeJS.ProcessEnv,
): (mission: ResearchMission) => Readonly<{ authorized: boolean; workerActorId: string | null }> {
  return (mission) => {
    const decision = evaluateManualResearchPolicy({ tenantId, mission, env });
    return { authorized: decision.authorized, workerActorId: decision.workerActorId };
  };
}

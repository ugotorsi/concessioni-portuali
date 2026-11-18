import {
  researchMissionExecutionChannel,
  type ResearchMission,
} from "./bridge";

export type ChatGptResearchPreflightBlocker =
  | "AUTONOMOUS_EXECUTION_GATE_OPEN"
  | "MISSION_ASSIGNMENT_MISSING"
  | "MISSION_BUDGET_INVALID"
  | "MISSION_EXECUTION_CHANNEL_INVALID"
  | "MISSION_LIFECYCLE_INVALID"
  | "MISSION_STATUS_INVALID";

export type ChatGptResearchPreflightInput = Readonly<{
  mission: ResearchMission;
  assignedActorId: string | null;
  lifecycleStatus: string;
  autonomousExecutionGates: Readonly<{
    aiRealDataEnabled?: string;
    asyncProviderExecutionEnabled?: string;
    automaticResearchExecutionEnabled?: string;
  }>;
}>;

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function evaluateChatGptResearchPreflight(
  input: ChatGptResearchPreflightInput,
): Readonly<{ ready: boolean; blockers: readonly ChatGptResearchPreflightBlocker[] }> {
  const blockers = new Set<ChatGptResearchPreflightBlocker>();
  if (researchMissionExecutionChannel(input.mission) !== "CHATGPT_CONNECTOR") {
    blockers.add("MISSION_EXECUTION_CHANNEL_INVALID");
  }
  if (!input.assignedActorId?.trim()) blockers.add("MISSION_ASSIGNMENT_MISSING");
  if (input.lifecycleStatus !== "CURRENT") blockers.add("MISSION_LIFECYCLE_INVALID");
  if (input.mission.status !== "PENDING" && input.mission.status !== "DEFERRED") {
    blockers.add("MISSION_STATUS_INVALID");
  }
  const budget = input.mission.budget;
  if (
    budget.maxTotalResearchCalls < 1
    || budget.maxTotalResearchCalls > 6
    || budget.maxMoonlitCalls < 0
    || budget.maxMoonlitCalls > 2
    || budget.maxSimpliciterCalls < 0
    || budget.maxSimpliciterCalls > 2
    || budget.maxLegalDataHunterCalls < 0
    || budget.maxLegalDataHunterCalls > 2
    || budget.maxMoonlitCalls + budget.maxSimpliciterCalls + budget.maxLegalDataHunterCalls
      < budget.maxTotalResearchCalls
  ) {
    blockers.add("MISSION_BUDGET_INVALID");
  }
  if (
    enabled(input.autonomousExecutionGates.aiRealDataEnabled)
    || enabled(input.autonomousExecutionGates.asyncProviderExecutionEnabled)
    || enabled(input.autonomousExecutionGates.automaticResearchExecutionEnabled)
  ) {
    blockers.add("AUTONOMOUS_EXECUTION_GATE_OPEN");
  }
  return {
    ready: blockers.size === 0,
    blockers: [...blockers].sort(),
  };
}

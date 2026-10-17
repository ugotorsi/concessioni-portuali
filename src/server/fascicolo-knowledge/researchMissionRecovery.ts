import { prisma } from "@/lib/prisma";

import {
  getCurrentKnowledgeRevision,
  type KnowledgeRevisionSnapshot,
} from "./repository";
import {
  buildKnowledgeResearchMissionPlans,
  DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
} from "./researchMissionPlanning";
import {
  reconcileKnowledgeResearchMissions,
  type KnowledgeMissionLifecycleResult,
} from "./researchMissionLifecycle";

export class ResearchMissionRecoveryError extends Error {
  constructor(readonly code:
    | "CURRENT_KNOWLEDGE_NOT_FOUND"
    | "ASSIGNED_ACTOR_INVALID"
    | "RESEARCH_MISSION_ASSIGNEE_RESOLUTION_FAILED"
    | "RESEARCH_MISSION_PLANNING_FAILED"
    | "RESEARCH_MISSION_RECONCILIATION_FAILED") {
    super(code);
    this.name = "ResearchMissionRecoveryError";
  }
}

export async function resolveResearchMissionAssignee(input: {
  tenantId: string;
  candidateActorId: string | null;
}): Promise<string | null> {
  if (!input.candidateActorId) return null;
  const actor = await prisma.user.findFirst({
    where: {
      id: input.candidateActorId,
      attivo: true,
      tenantMemberships: { some: { enteId: input.tenantId } },
    },
    select: { id: true },
  });
  return actor?.id ?? null;
}

export interface KnowledgeMissionRecoveryResult {
  revisionId: string;
  missionCount: number;
  assignedActorId: string | null;
  assignmentRequired: boolean;
  lifecycle: readonly KnowledgeMissionLifecycleResult[];
}

export async function recoverCurrentKnowledgeResearchMissions(input: {
  tenantId: string;
  procedimentoId: string;
  candidateActorId?: string | null;
  requireValidCandidate?: boolean;
  revision?: KnowledgeRevisionSnapshot;
  maxQuestionsPerWave?: number;
}): Promise<KnowledgeMissionRecoveryResult> {
  const revision = input.revision ?? await getCurrentKnowledgeRevision({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
  });
  if (!revision || revision.status !== "CURRENT") {
    throw new ResearchMissionRecoveryError("CURRENT_KNOWLEDGE_NOT_FOUND");
  }

  let assignedActorId: string | null;
  try {
    assignedActorId = await resolveResearchMissionAssignee({
      tenantId: input.tenantId,
      candidateActorId: input.candidateActorId ?? null,
    });
  } catch {
    throw new ResearchMissionRecoveryError(
      "RESEARCH_MISSION_ASSIGNEE_RESOLUTION_FAILED",
    );
  }
  if (input.requireValidCandidate && input.candidateActorId && !assignedActorId) {
    throw new ResearchMissionRecoveryError("ASSIGNED_ACTOR_INVALID");
  }

  let plans;
  try {
    plans = buildKnowledgeResearchMissionPlans(revision, {
      maxQuestionsPerWave:
        input.maxQuestionsPerWave ?? DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
    });
  } catch {
    throw new ResearchMissionRecoveryError("RESEARCH_MISSION_PLANNING_FAILED");
  }

  let lifecycle: readonly KnowledgeMissionLifecycleResult[];
  try {
    lifecycle = await reconcileKnowledgeResearchMissions({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      knowledgeRevisionId: revision.id,
      assignedActorId,
      plans,
    });
  } catch {
    throw new ResearchMissionRecoveryError(
      "RESEARCH_MISSION_RECONCILIATION_FAILED",
    );
  }

  return {
    revisionId: revision.id,
    missionCount: lifecycle.length,
    assignedActorId,
    assignmentRequired: lifecycle.some(
      (mission) => mission.assignmentStatus === "REQUIRES_ASSIGNMENT",
    ),
    lifecycle,
  };
}

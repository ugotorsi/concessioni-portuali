import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
}));
const getCurrentKnowledgeRevisionMock = vi.hoisted(() => vi.fn());
const buildPlansMock = vi.hoisted(() => vi.fn());
const reconcileMock = vi.hoisted(() => vi.fn());
const loadConfirmationsMock = vi.hoisted(() => vi.fn(async () => []));
const isAutomationEnabledMock = vi.hoisted(() => vi.fn(async () => false));
const autonomousResearchPlannerMock = vi.hoisted(() => vi.fn(() => vi.fn(() => ({
  authorized: true,
  workerActorId: "worker-1",
}))));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/fascicolo-knowledge/repository", () => ({
  getCurrentKnowledgeRevision: getCurrentKnowledgeRevisionMock,
}));
vi.mock("@/server/fascicolo-knowledge/researchMissionPlanning", () => ({
  DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT: 5,
  buildKnowledgeResearchMissionPlans: buildPlansMock,
}));
vi.mock("@/server/fascicolo-knowledge/researchMissionLifecycle", () => ({
  reconcileKnowledgeResearchMissions: reconcileMock,
}));
vi.mock("@/server/fascicolo-knowledge/referenceDateConfirmation", () => ({
  loadReferenceDateConfirmations: loadConfirmationsMock,
}));
vi.mock("@/server/automation/automationControl", () => ({
  isAutomationEnabled: isAutomationEnabledMock,
}));
vi.mock("@/server/legal-research/automatic-research-policy", () => ({
  autonomousResearchPlanner: autonomousResearchPlannerMock,
}));
vi.mock("@/server/legal-research/persisted-research-policy", () => ({
  effectiveResearchPolicyEnvironment: vi.fn(async () => ({
    AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
  })),
}));

import {
  recoverCurrentKnowledgeResearchMissions,
  ResearchMissionRecoveryError,
} from "@/server/fascicolo-knowledge/researchMissionRecovery";

describe("recoverCurrentKnowledgeResearchMissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentKnowledgeRevisionMock.mockResolvedValue({
      id: "revision-1",
      status: "CURRENT",
    });
    buildPlansMock.mockReturnValue([{ mission: { missionId: "mission-1" } }]);
    reconcileMock.mockResolvedValue([{
      missionId: "mission-1",
      assignmentStatus: "ASSIGNED",
    }]);
  });

  it("accepts only an active user with membership in the target tenant", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-1" });

    await expect(recoverCurrentKnowledgeResearchMissions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      candidateActorId: "user-1",
      requireValidCandidate: true,
    })).resolves.toMatchObject({
      revisionId: "revision-1",
      assignedActorId: "user-1",
      assignmentRequired: false,
    });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        attivo: true,
        tenantMemberships: { some: { enteId: "tenant-1" } },
      },
      select: { id: true },
    });
    expect(reconcileMock).toHaveBeenCalledWith(expect.objectContaining({
      assignedActorId: "user-1",
    }));
    expect(buildPlansMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      autonomousResearch: undefined,
    }));
    expect(autonomousResearchPlannerMock).not.toHaveBeenCalled();
  });

  it("uses the autonomous planner only when persistent automation is ON", async () => {
    isAutomationEnabledMock.mockResolvedValue(true);
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-1" });

    await recoverCurrentKnowledgeResearchMissions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      candidateActorId: "user-1",
      requireValidCandidate: true,
    });

    expect(autonomousResearchPlannerMock).toHaveBeenCalledWith("tenant-1", {
      AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
    });
    expect(buildPlansMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      autonomousResearch: expect.any(Function),
    }));
  });

  it("rejects an explicitly requested invalid assignee before mission writes", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(recoverCurrentKnowledgeResearchMissions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      candidateActorId: "system-actor",
      requireValidCandidate: true,
    })).rejects.toEqual(
      new ResearchMissionRecoveryError("ASSIGNED_ACTOR_INVALID"),
    );
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("creates deferred unassigned missions when no assignee is supplied", async () => {
    reconcileMock.mockResolvedValue([{
      missionId: "mission-1",
      assignmentStatus: "REQUIRES_ASSIGNMENT",
    }]);

    await expect(recoverCurrentKnowledgeResearchMissions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    })).resolves.toMatchObject({
      assignedActorId: null,
      assignmentRequired: true,
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(reconcileMock).toHaveBeenCalledWith(expect.objectContaining({
      assignedActorId: null,
    }));
  });
});

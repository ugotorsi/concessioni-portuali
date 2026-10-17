import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
}));
const getCurrentKnowledgeRevisionMock = vi.hoisted(() => vi.fn());
const buildPlansMock = vi.hoisted(() => vi.fn());
const reconcileMock = vi.hoisted(() => vi.fn());

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

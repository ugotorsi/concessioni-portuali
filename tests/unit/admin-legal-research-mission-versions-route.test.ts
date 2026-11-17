import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const versionMissionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

vi.mock("@/server/fascicolo-knowledge/researchMissionVersioning", () => {
  class ResearchMissionVersioningError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    ResearchMissionVersioningError,
    versionResearchMissionBudget: versionMissionMock,
  };
});

import { POST } from "@/app/api/admin/legal-research/missions/[missionId]/versions/route";

const budget = {
  maxTotalResearchCalls: 8,
  maxLegalDataHunterCalls: 6,
  maxSimpliciterCalls: 2,
  maxMoonlitCalls: 2,
};

function request(body: unknown): Request {
  return new Request("https://staging.example.test/api/admin/legal-research/missions/source-mission/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeContext = { params: Promise.resolve({ missionId: "source-mission" }) };

describe("POST /api/admin/legal-research/missions/[missionId]/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthSessionMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    versionMissionMock.mockResolvedValue({
      outcome: "CREATED",
      previousMissionId: "source-mission",
      mission: { missionId: "versioned-mission" },
      assignedActorId: "actor-1",
      knowledgeRevisionId: "revision-1",
      researchQuestionSemanticKey: "q".repeat(64),
    });
  });

  it("derives mission scope and assignee server-side while versioning only the budget", async () => {
    const response = await POST(request({
      budget,
      reason: "Adeguamento autorizzato per le ricerche gia effettuate.",
    }), routeContext);

    expect(response.status).toBe(201);
    expect(versionMissionMock).toHaveBeenCalledWith({
      sourceMissionId: "source-mission",
      budget,
      reason: "Adeguamento autorizzato per le ricerche gia effettuate.",
      actor: { userId: "admin-1", userEmail: "admin@example.test", userRole: "ADMIN" },
    });
    await expect(response.json()).resolves.toMatchObject({
      outcome: "CREATED",
      previousMissionId: "source-mission",
      missionId: "versioned-mission",
      assignedActorId: "actor-1",
      knowledgeRevisionId: "revision-1",
    });
  });

  it("requires an administrator and rejects free tenant, case, assignee, or mission payload selectors", async () => {
    getAuthSessionMock.mockResolvedValueOnce(null);
    await expect(POST(request({ budget, reason: "Adeguamento autorizzato con motivazione sufficiente." }), routeContext))
      .resolves.toMatchObject({ status: 401 });

    getAuthSessionMock.mockResolvedValueOnce({
      user: { id: "user-1", email: "user@example.test", role: "GIURIDICO" },
    });
    await expect(POST(request({ budget, reason: "Adeguamento autorizzato con motivazione sufficiente." }), routeContext))
      .resolves.toMatchObject({ status: 403 });

    const response = await POST(request({
      budget,
      reason: "Adeguamento autorizzato con motivazione sufficiente.",
      tenantId: "tenant-attacker",
      caseId: "case-attacker",
      assignedActorId: "actor-attacker",
      mission: {},
    }), routeContext);
    expect(response.status).toBe(400);
    expect(versionMissionMock).not.toHaveBeenCalled();
  });

  it("rejects an administrator without access to the mission tenant", async () => {
    const { ResearchMissionVersioningError } = await import(
      "@/server/fascicolo-knowledge/researchMissionVersioning"
    );
    versionMissionMock.mockRejectedValueOnce(
      new ResearchMissionVersioningError("TENANT_ACCESS_DENIED"),
    );

    const response = await POST(request({
      budget,
      reason: "Adeguamento autorizzato con motivazione sufficiente.",
    }), routeContext);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "FORBIDDEN" });
  });
});

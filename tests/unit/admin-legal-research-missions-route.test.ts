import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
} from "@/server/legal-research/bridge";

const getAuthSessionMock = vi.hoisted(() => vi.fn());
const findUserMock = vi.hoisted(() => vi.fn());
const createMissionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/next-auth", () => ({
  getAuthSession: getAuthSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: findUserMock },
  },
}));

vi.mock("@/server/legal-research/persistence", () => {
  class ResearchPersistenceError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    ResearchPersistenceError,
    createResearchMissionRecord: createMissionMock,
  };
});

import { POST } from "@/app/api/admin/legal-research/missions/route";

const mission = createResearchMission({
  kind: "RESEARCH_MISSION",
  version: RESEARCH_BRIDGE_VERSION,
  caseReference: { caseId: "case-1", fascicoloReference: "fascicolo-1" },
  legalIssueIds: ["issue-1"],
  legalPropositionIds: ["proposition-1"],
  referenceDate: "2026-10-08T00:00:00.000Z",
  mode: "DISCOVER_AUTHORITIES",
  researchQuestion: "Quali autorità sono rilevanti?",
  knownAuthorities: [],
  excludedAuthorities: [],
  preferredSourceFamilies: ["GIUSTIZIA_AMMINISTRATIVA"],
  missingSourceFamilies: [],
  knownCounterArguments: [],
  knownEvidenceGaps: [],
  requiredOutput: {
    authorityCandidates: true,
    citationObservations: true,
    legalResearchSuggestions: true,
    evidenceGaps: true,
    fullTextRequired: false,
  },
  budget: {
    maxTotalResearchCalls: 3,
    maxMoonlitCalls: 1,
    maxSimpliciterCalls: 1,
    maxLegalDataHunterCalls: 1,
  },
  status: "PENDING",
});

function request(body: unknown): Request {
  return new Request("https://staging.example.test/api/admin/legal-research/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/legal-research/missions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthSessionMock.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    });
    findUserMock.mockResolvedValue({
      id: "actor-1",
      attivo: true,
      tenantMemberships: [{ enteId: "tenant-1", isDefault: true }],
    });
    createMissionMock.mockResolvedValue({
      outcome: "CREATED",
      mission: { mission: mission },
    });
  });

  it("creates and assigns a mission using the actor's server-derived default tenant", async () => {
    const response = await POST(request({ assignedActorId: "actor-1", mission }));

    expect(response.status).toBe(201);
    expect(createMissionMock).toHaveBeenCalledWith({
      mission,
      assignedActorId: "actor-1",
      actor: { actorId: "admin-1", tenantId: "tenant-1" },
    });
    await expect(response.json()).resolves.toEqual({
      outcome: "CREATED",
      missionId: mission.missionId,
      assignedActorId: "actor-1",
    });
  });

  it("requires an authenticated admin", async () => {
    getAuthSessionMock.mockResolvedValueOnce(null);
    await expect(POST(request({ assignedActorId: "actor-1", mission })))
      .resolves.toMatchObject({ status: 401 });

    getAuthSessionMock.mockResolvedValueOnce({
      user: { id: "user-1", email: "user@example.test", role: "RESPONSABILE_ADSP" },
    });
    await expect(POST(request({ assignedActorId: "actor-1", mission })))
      .resolves.toMatchObject({ status: 403 });
    expect(createMissionMock).not.toHaveBeenCalled();
  });

  it("fails closed for inactive actors or ambiguous tenant assignment", async () => {
    findUserMock.mockResolvedValueOnce({
      id: "actor-1",
      attivo: false,
      tenantMemberships: [{ enteId: "tenant-1", isDefault: true }],
    });
    await expect(POST(request({ assignedActorId: "actor-1", mission })))
      .resolves.toMatchObject({ status: 404 });

    findUserMock.mockResolvedValueOnce({
      id: "actor-1",
      attivo: true,
      tenantMemberships: [
        { enteId: "tenant-1", isDefault: false },
        { enteId: "tenant-2", isDefault: false },
      ],
    });
    await expect(POST(request({ assignedActorId: "actor-1", mission })))
      .resolves.toMatchObject({ status: 409 });
    expect(createMissionMock).not.toHaveBeenCalled();
  });

  it("rejects free tenant, case, or scope selectors outside the mission contract", async () => {
    const response = await POST(request({
      assignedActorId: "actor-1",
      mission,
      tenantId: "tenant-attacker",
      caseId: "case-attacker",
      scopeId: "scope-attacker",
    }));

    expect(response.status).toBe(400);
    expect(createMissionMock).not.toHaveBeenCalled();
  });
});

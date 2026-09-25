import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtVerifyMock = vi.hoisted(() => vi.fn());
const userFindUniqueMock = vi.hoisted(() => vi.fn());
const missionFindUniqueMock = vi.hoisted(() => vi.fn());
const missionFindManyMock = vi.hoisted(() => vi.fn());
const bundleFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("jose", () => ({
  createRemoteJWKSet: () => vi.fn(),
  jwtVerify: jwtVerifyMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    researchMissionRecord: {
      findUnique: missionFindUniqueMock,
      findMany: missionFindManyMock,
    },
    researchEvidenceBundleRecord: { findMany: bundleFindManyMock },
  },
}));

import { POST as trustedMissionPost } from "@/app/api/legal-research/trusted/mission/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";

const missionId = "research-mission:7cd3faa5f4294068fc30558e65b4229ff46359463fa0039c61717b5da30e0b63";
const bearer = "integration-workos-bearer";
const actorId = "actor-a";
const tenantId = "tenant-a";
const resource = "https://staging.example.test/api/mcp";

const mission = {
  kind: "RESEARCH_MISSION",
  version: RESEARCH_BRIDGE_VERSION,
  missionId,
  caseReference: { caseId: "case-a", fascicoloReference: "fascicolo-a" },
  legalIssueIds: ["issue-a"],
  legalPropositionIds: ["proposition-a"],
  conclusionIds: ["conclusion-a"],
  referenceDate: "2026-09-24T00:00:00.000Z",
  mode: "DISCOVER_AUTHORITIES",
  researchQuestion: "Quali fonti disciplinano il caso?",
  knownAuthorities: [],
  excludedAuthorities: [],
  preferredSourceFamilies: ["GIUSTIZIA_AMMINISTRATIVA"],
  missingSourceFamilies: ["CASSAZIONE"],
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
    maxTotalResearchCalls: 10,
    maxMoonlitCalls: 4,
    maxSimpliciterCalls: 4,
    maxLegalDataHunterCalls: 4,
  },
  status: "PENDING",
  executionPlan: {
    requiredCapabilities: ["SEMANTIC_DISCOVERY"],
    preferredToolIds: ["SIMPLICITER", "MOONLIT", "LEGAL_DATA_HUNTER"],
  },
} as const;

const missionRecord = {
  id: missionId,
  tenantId,
  caseId: mission.caseReference.caseId,
  fascicoloReference: mission.caseReference.fascicoloReference,
  payload: mission,
  payloadFingerprint: "a".repeat(64),
  status: "PENDING",
  stateVersion: 0,
  claimantId: null,
  claimToken: null,
  claimExpiresAt: null,
  activeExecutionId: null,
  completedAt: null,
  deferredAt: null,
  createdAt: new Date("2026-09-24T08:00:00.000Z"),
  updatedAt: new Date("2026-09-24T08:00:00.000Z"),
};

describe("trusted mission route integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://auth.example.test");
    vi.stubEnv("MCP_RESOURCE_URI", resource);
    vi.stubEnv("MCP_FASCICOLO_GRANT_SECRET", "integration-secret-at-least-thirty-two-bytes");

    jwtVerifyMock.mockResolvedValue({ payload: {
      sub: "subject-a",
      "urn:concessioni-portuali:actor_id": actorId,
      "urn:concessioni-portuali:tenant_id": tenantId,
    } });
    userFindUniqueMock.mockResolvedValue({
      attivo: true,
      ruolo: "ADMIN",
      tenantMemberships: [{ enteId: tenantId, isDefault: true }],
    });
    missionFindUniqueMock.mockResolvedValue(missionRecord);
    missionFindManyMock.mockResolvedValue([]);
    bundleFindManyMock.mockResolvedValue([]);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target !== resource) throw new Error("UNEXPECTED_NETWORK_TARGET");
      return mcpPost(new Request(target, init));
    }));
  });

  it("passes through the real trusted transport, grant, MCP protocol, and research_get_mission handler", async () => {
    const response = await trustedMissionPost(new Request(
      "https://staging.example.test/api/legal-research/trusted/mission",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({ missionId }),
      },
    ));
    const payload = await response.json() as {
      result?: { structuredContent?: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.structuredContent).toEqual(expect.objectContaining({
      mission: expect.objectContaining({
        missionId,
        status: "PENDING",
        researchQuestion: mission.researchQuestion,
        budget: mission.budget,
      }),
      operational: expect.objectContaining({ status: "PENDING" }),
      fascicoloContext: expect.objectContaining({
        scope: expect.objectContaining({ tenantId }),
      }),
    }));
    expect(jwtVerifyMock).toHaveBeenCalledTimes(2);
    expect(missionFindUniqueMock).toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain(bearer);
    expect(JSON.stringify(payload)).not.toContain("fg1.");
  });
});

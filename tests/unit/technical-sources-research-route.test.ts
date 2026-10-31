import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentUserMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const tenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const procedureFindUniqueMock = vi.hoisted(() => vi.fn());
const missionFindFirstMock = vi.hoisted(() => vi.fn());
const missionFindManyMock = vi.hoisted(() => vi.fn());
const researchFindManyMock = vi.hoisted(() => vi.fn());
const researchCreateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const getMcpTokenMock = vi.hoisted(() => vi.fn());
const channelEnabledMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());
const auditInTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentUser: currentUserMock,
  canManageProcedimenti: canManageProcedimentiMock,
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: tenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: procedureFindUniqueMock },
    researchMissionRecord: { findFirst: missionFindFirstMock, findMany: missionFindManyMock },
    technicalSourceResearchRecord: { findMany: researchFindManyMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/server/audit/auditLog", () => ({
  auditFailure: auditFailureMock,
  createAuditLogInTransaction: auditInTransactionMock,
}));

vi.mock("@/server/technical-sources/technical-sources-m2m", () => ({
  getTechnicalSourcesMcpAccessToken: getMcpTokenMock,
  isTechnicalSourcesChannelEnabled: channelEnabledMock,
}));

import { GET, POST } from "@/app/api/procedimenti/[id]/technical-research/route";
import {
  TECHNICAL_SOURCES_MCP_ENDPOINT,
  TechnicalSourcesMcpError,
} from "@/server/technical-sources/technical-sources-mcp";

const user = { id: "user-a", email: "operatore@example.test", role: "ADMIN" as const };
const tenantContext = {
  userId: user.id,
  role: user.role,
  isAdmin: true,
  tenantMemberships: [],
  defaultTenantId: null,
  accessibleTenantIds: [],
};
const procedure = { id: "procedure-a", enteId: "tenant-a" };
const mission = {
  id: "mission-a",
  payload: { researchQuestion: "Verifica il quadro tecnico del manufatto." },
};
const routeContext = { params: Promise.resolve({ id: procedure.id }) };
const fakeJwt = "aaa.bbb.ccc";

function post(body: unknown): Request {
  return new Request(`https://app.example.test/api/procedimenti/${procedure.id}/technical-research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mcpFetch(structuredContent: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(TECHNICAL_SOURCES_MCP_ENDPOINT);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${fakeJwt}`);
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    const result = request.method === "initialize"
      ? { protocolVersion: "2025-06-18", serverInfo: { name: "noetra-fonti-tecniche", version: "0.5.0" } }
      : { content: [], structuredContent };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("technical source research route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserMock.mockResolvedValue(user);
    canManageProcedimentiMock.mockReturnValue(true);
    tenantContextMock.mockResolvedValue(tenantContext);
    requireTenantAccessMock.mockReturnValue(undefined);
    procedureFindUniqueMock.mockResolvedValue(procedure);
    missionFindFirstMock.mockResolvedValue(mission);
    missionFindManyMock.mockResolvedValue([mission, { id: "mission-empty", payload: {} }]);
    researchFindManyMock.mockResolvedValue([]);
    channelEnabledMock.mockReturnValue(false);
    auditFailureMock.mockResolvedValue(undefined);
    auditInTransactionMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ technicalSourceResearchRecord: { create: researchCreateMock } }));
    researchCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "record-new",
      missionId: data.missionId,
      toolName: data.toolName,
      serviceVersion: data.serviceVersion,
      verificationStatus: data.verificationStatus,
      retrievedAt: new Date("2026-10-18T12:00:00.000Z"),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed and audits without writing a result when M2M auth is not configured", async () => {
    getMcpTokenMock.mockRejectedValue(new TechnicalSourcesMcpError("M2M_AUTH_NOT_CONFIGURED"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(post({
      missionId: mission.id,
      call: { tool: "search", arguments: { query: "urbanistica Amalfi" } },
    }), routeContext);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Technical source service identity is not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      azione: "TECHNICAL_SOURCE_RESEARCH_FAILED",
      enteId: procedure.enteId,
      metadata: expect.objectContaining({ errorCode: "M2M_AUTH_NOT_CONFIGURED", missionId: mission.id }),
    }));
  });

  it("rejects a mission from another case before requesting a service token", async () => {
    missionFindFirstMock.mockResolvedValue(null);

    const response = await POST(post({
      missionId: "other-case-mission",
      call: { tool: "search", arguments: { query: "urbanistica Amalfi" } },
    }), routeContext);

    expect(response.status).toBe(404);
    expect(getMcpTokenMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(missionFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "other-case-mission",
        tenantId: procedure.enteId,
        caseId: procedure.id,
        lifecycleStatus: "CURRENT",
      },
    }));
  });

  it("denies access to a procedure of another tenant", async () => {
    requireTenantAccessMock.mockImplementation(() => {
      throw new Error("forbidden");
    });

    const response = await POST(post({
      missionId: mission.id,
      call: { tool: "search", arguments: { query: "urbanistica Amalfi" } },
    }), routeContext);

    expect(response.status).toBe(403);
    expect(missionFindFirstMock).not.toHaveBeenCalled();
    expect(getMcpTokenMock).not.toHaveBeenCalled();
  });

  it("persists a mocked M2M search result with audit in the same transaction", async () => {
    getMcpTokenMock.mockResolvedValue(fakeJwt);
    vi.stubGlobal("fetch", mcpFetch({ count: 1, results: [{ id: "regione-campania-ptr" }] }));

    const response = await POST(post({
      missionId: mission.id,
      call: { tool: "search", arguments: { query: "urbanistica Amalfi" } },
    }), routeContext);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      record: { id: "record-new", verificationStatus: "DA_VERIFICARE_SU_FONTE_ORIGINALE" },
    });
    expect(researchCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: procedure.enteId,
        procedimentoId: procedure.id,
        missionId: mission.id,
        requestedByUserId: user.id,
        questionSnapshot: mission.payload.researchQuestion,
        toolName: "search",
        serviceVersion: "0.5.0",
        verificationStatus: "DA_VERIFICARE_SU_FONTE_ORIGINALE",
      }),
    }));
    expect(auditInTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ technicalSourceResearchRecord: expect.anything() }),
      expect.objectContaining({
        azione: "TECHNICAL_SOURCE_RESEARCH_RECORDED",
        entitaId: "record-new",
        esito: "SUCCESS",
      }),
    );
  });

  it("records an empty WMS answer as non-probative, never as absence of constraints", async () => {
    getMcpTokenMock.mockResolvedValue(fakeJwt);
    vi.stubGlobal("fetch", mcpFetch({ result: "EMPTY_RESPONSE_NOT_PROOF", feature_count: 0 }));

    const response = await POST(post({
      missionId: mission.id,
      call: {
        tool: "interroga_punto_wms",
        arguments: { source_id: "campania-tematica", layer: "vincoli", latitudine: 40.63, longitudine: 14.6 },
      },
    }), routeContext);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      record: { verificationStatus: "RISPOSTA_VUOTA_NON_PROBATORIA" },
    });
  });

  it("rejects a WMS answer without an explicit result classification", async () => {
    getMcpTokenMock.mockResolvedValue(fakeJwt);
    vi.stubGlobal("fetch", mcpFetch({ feature_count: 0 }));

    const response = await POST(post({
      missionId: mission.id,
      call: {
        tool: "interroga_punto_wms",
        arguments: { source_id: "campania-tematica", layer: "vincoli", latitudine: 40.63, longitudine: 14.6 },
      },
    }), routeContext);

    expect(response.status).toBe(502);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns the persisted tenant-scoped history and the channel state", async () => {
    researchFindManyMock.mockResolvedValue([{
      id: "record-a",
      missionId: mission.id,
      questionSnapshot: mission.payload.researchQuestion,
      toolName: "search",
      requestPayload: { query: "urbanistica Amalfi" },
      responsePayload: { count: 1 },
      serviceVersion: "0.5.0",
      verificationStatus: "DA_VERIFICARE_SU_FONTE_ORIGINALE",
      retrievedAt: new Date("2026-10-18T12:00:00.000Z"),
    }]);

    const response = await GET(
      new Request(`https://app.example.test/api/procedimenti/${procedure.id}/technical-research`),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channelEnabled: false,
      canRequest: true,
      missions: [{ id: mission.id, question: mission.payload.researchQuestion }],
      hasMore: false,
      records: [{ id: "record-a", verificationStatus: "DA_VERIFICARE_SU_FONTE_ORIGINALE" }],
    });
    expect(researchFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: procedure.enteId, procedimentoId: procedure.id },
      take: 51,
    }));
  });
});

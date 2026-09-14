import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const canManageProcedimentiMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const findIntakeMock = vi.hoisted(() => vi.fn());
const findProcedimentoMock = vi.hoisted(() => vi.fn());
const establishDestinationMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const auditFailureMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getCurrentUser: getCurrentUserMock,
  canManageProcedimenti: canManageProcedimentiMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    neutralIntake: { findUnique: findIntakeMock },
    procedimento: { findUnique: findProcedimentoMock },
  },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess: auditSuccessMock,
  auditFailure: auditFailureMock,
}));
vi.mock("@/server/intake/neutralIntakeDestination", async () => {
  const actual = await vi.importActual<typeof import("@/server/intake/neutralIntakeDestination")>(
    "@/server/intake/neutralIntakeDestination",
  );
  return { ...actual, establishNeutralIntakeDestination: establishDestinationMock };
});

import { POST } from "@/app/api/neutral-intakes/[id]/destination/route";
import {
  NeutralIntakeDestinationConflictError,
  NeutralIntakeDestinationHandoffError,
} from "@/server/intake/neutralIntakeDestination";

function request(body: unknown = { procedimentoId: "procedimento-1" }) {
  return new Request("https://example.test/api/neutral-intakes/intake-1/destination", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id = "intake-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/neutral-intakes/[id]/destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
      role: "GIURIDICO",
    });
    canManageProcedimentiMock.mockReturnValue(true);
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "user-1",
      role: "GIURIDICO",
      isAdmin: false,
      accessibleTenantIds: ["ente-1"],
    });
    requireTenantAccessMock.mockImplementation((_context, enteId) => {
      if (enteId !== "ente-1") throw new Error("denied");
    });
    findIntakeMock.mockResolvedValue({ id: "intake-1", enteId: "ente-1" });
    findProcedimentoMock.mockResolvedValue({
      id: "procedimento-1",
      concessione: { id: "concessione-1", enteId: "ente-1" },
    });
    establishDestinationMock.mockResolvedValue({
      outcome: "CREATED",
      handoff: { outcome: "CASE_DOCUMENT_ROUTED" },
    });
    auditSuccessMock.mockResolvedValue(undefined);
    auditFailureMock.mockResolvedValue(undefined);
  });

  it("routes an authorized human assignment through the canonical resume-capable service", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      destinationStatus: "CREATED",
      handoffStatus: "CASE_DOCUMENT_ROUTED",
    });
    expect(requireTenantAccessMock).toHaveBeenCalledTimes(2);
    expect(establishDestinationMock).toHaveBeenCalledWith({
      neutralIntakeId: "intake-1",
      procedimentoId: "procedimento-1",
      authoritySource: "HUMAN_REVIEW_ASSIGNMENT",
      establishedByUserId: "user-1",
      establishedByActorId: "user-1",
      establishedByRole: "GIURIDICO",
    });
    expect(auditSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
      actor: { userId: "user-1", userEmail: "user@example.test", userRole: "GIURIDICO" },
    }));
  });

  it("rejects unauthenticated callers before reading or mutating resources", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const response = await POST(request(), context());
    expect(response.status).toBe(401);
    expect(findIntakeMock).not.toHaveBeenCalled();
    expect(establishDestinationMock).not.toHaveBeenCalled();
  });

  it("rejects unauthorized roles before mutation", async () => {
    canManageProcedimentiMock.mockReturnValue(false);
    const response = await POST(request(), context());
    expect(response.status).toBe(403);
    expect(establishDestinationMock).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant destinations before invoking the canonical service", async () => {
    findProcedimentoMock.mockResolvedValue({
      id: "procedimento-1",
      concessione: { id: "concessione-2", enteId: "ente-2" },
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(403);
    expect(establishDestinationMock).not.toHaveBeenCalled();
    expect(auditFailureMock).toHaveBeenCalledTimes(1);
  });

  it("returns idempotent replay success", async () => {
    establishDestinationMock.mockResolvedValue({
      outcome: "REUSED",
      handoff: { outcome: "CASE_DOCUMENT_ROUTED" },
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ destinationStatus: "REUSED" });
  });

  it("maps destination conflicts to a bounded response", async () => {
    establishDestinationMock.mockRejectedValue(new NeutralIntakeDestinationConflictError());
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Destination conflict." });
  });

  it("maps Phase B infrastructure failure to a safe retriable response", async () => {
    establishDestinationMock.mockRejectedValue(
      new NeutralIntakeDestinationHandoffError({ cause: new Error("database-secret") }),
    );
    const response = await POST(request(), context());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      error: "Destination established; handoff retry required.",
      retryable: true,
    });
    expect(body).not.toContain("database-secret");
  });

  it("audits an unexpected service failure without leaking its details", async () => {
    establishDestinationMock.mockRejectedValue(new Error("database-secret"));
    const response = await POST(request(), context());
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).not.toContain("database-secret");
    expect(auditFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        reason: "DESTINATION_ESTABLISHMENT_FAILED",
        procedimentoId: "procedimento-1",
      },
    }));
  });

  it("accepts reference-only input and rejects caller-supplied authority fields", async () => {
    const response = await POST(request({
      procedimentoId: "procedimento-1",
      actorId: "spoofed-user",
      tenantId: "ente-2",
    }), context());
    expect(response.status).toBe(400);
    expect(establishDestinationMock).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRoleMock = vi.hoisted(() => vi.fn());
const requireAdminWithMfaMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getCurrentTenantContextMock = vi.hoisted(() => vi.fn());
const requireTenantAccessMock = vi.hoisted(() => vi.fn());
const provisionMock = vi.hoisted(() => vi.fn());
const readAuthorizationMock = vi.hoisted(() => vi.fn());
const auditSuccessMock = vi.hoisted(() => vi.fn());
const recoverMissionsMock = vi.hoisted(() => vi.fn());
const setGlobalAiControlStateMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  procedimento: { findUnique: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
  requireAdminWithMfa: requireAdminWithMfaMock,
  getCurrentUser: getCurrentUserMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: getCurrentTenantContextMock,
  requireTenantAccess: requireTenantAccessMock,
}));
vi.mock("@/server/audit/auditLog", () => ({ auditSuccess: auditSuccessMock }));
vi.mock("@/server/runtime/procedimentoBudgetPolicy", () => ({
  provisionDefaultProcedimentoBudgetPolicy: provisionMock,
  readDefaultProcedimentoBudgetAuthorization: readAuthorizationMock,
}));
vi.mock("@/server/fascicolo-knowledge/researchMissionRecovery", () => ({
  recoverCurrentKnowledgeResearchMissions: recoverMissionsMock,
}));
vi.mock("@/server/ai/globalAiControl", () => ({
  setGlobalAiControlState: setGlobalAiControlStateMock,
}));
vi.mock("@/server/async-jobs/persistence", () => ({
  retryTerminalAsyncJob: vi.fn(),
}));
vi.mock("@/server/async-jobs/documentWorkerActivation", () => ({
  documentWorkerKindForOperation: vi.fn(),
  requestDocumentWorkerActivation: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  assignDefaultProcedimentoBudgetPolicy,
  recoverCurrentKnowledgeMissions,
  updateGlobalAiControl,
} from "@/app/admin/runtime/actions";

function formData() {
  const data = new FormData();
  data.set("procedimentoId", "procedure-1");
  return data;
}

describe("assignDefaultProcedimentoBudgetPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue("ADMIN");
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    getCurrentTenantContextMock.mockResolvedValue({
      userId: "admin-1",
      role: "ADMIN",
      isAdmin: true,
      defaultTenantId: "tenant-1",
      accessibleTenantIds: ["tenant-1"],
    });
    readAuthorizationMock.mockReturnValue({
      authorized: true,
      currency: "EUR",
      hardCapAmount: "1.000000",
      windowSeconds: 86_400,
    });
    prismaMock.procedimento.findUnique.mockResolvedValue({
      id: "procedure-1",
      enteId: "tenant-1",
    });
    provisionMock.mockResolvedValue({
      outcome: "CREATED",
      policy: {
        id: "policy-1",
        enabled: true,
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });
    recoverMissionsMock.mockResolvedValue({
      revisionId: "revision-1",
      missionCount: 2,
      assignedActorId: null,
      assignmentRequired: true,
      lifecycle: [],
    });
  });

  describe("updateGlobalAiControl", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      requireAdminWithMfaMock.mockResolvedValue({
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
        mfaVerified: true,
      });
      setGlobalAiControlStateMock.mockResolvedValue({
        previousEnabled: false,
        requestedEnabled: true,
      });
    });

    it("requires ADMIN with verified MFA before changing state", async () => {
      requireAdminWithMfaMock.mockRejectedValueOnce(
        new Error("MFA_VERIFICATION_REQUIRED"),
      );
      const data = new FormData();
      data.set("enabled", "true");

      await expect(updateGlobalAiControl(data)).rejects.toThrow(
        "MFA_VERIFICATION_REQUIRED",
      );
      expect(setGlobalAiControlStateMock).not.toHaveBeenCalled();
    });

    it("forwards the authenticated ADMIN identity and normalized reason", async () => {
      const data = new FormData();
      data.set("enabled", "true");
      data.set("reason", "  Controlled activation  ");

      await updateGlobalAiControl(data);

      expect(setGlobalAiControlStateMock).toHaveBeenCalledWith({
        enabled: true,
        actor: {
          userId: "admin-1",
          userEmail: "admin@example.test",
          userRole: "ADMIN",
        },
        reason: "Controlled activation",
      });
    });
  });

  it("requires ADMIN and tenant write access before provisioning", async () => {
    await assignDefaultProcedimentoBudgetPolicy(formData());

    expect(requireRoleMock).toHaveBeenCalledWith(["ADMIN"]);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(provisionMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorization: {
        authorized: true,
        currency: "EUR",
        hardCapAmount: "1.000000",
        windowSeconds: 86_400,
      },
    });
  });

  describe("recoverCurrentKnowledgeMissions", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      requireRoleMock.mockResolvedValue("ADMIN");
      getCurrentUserMock.mockResolvedValue({
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
      });
      getCurrentTenantContextMock.mockResolvedValue({
        userId: "admin-1",
        role: "ADMIN",
        isAdmin: true,
        defaultTenantId: "tenant-1",
        accessibleTenantIds: ["tenant-1"],
      });
      prismaMock.procedimento.findUnique.mockResolvedValue({
        id: "procedure-1",
        enteId: "tenant-1",
      });
      recoverMissionsMock.mockResolvedValue({
        revisionId: "revision-1",
        missionCount: 2,
        assignedActorId: null,
        assignmentRequired: true,
        lifecycle: [],
      });
    });

    it("is ADMIN-only, tenant-scoped, audited, and does not invoke a provider", async () => {
      await recoverCurrentKnowledgeMissions(formData());

      expect(requireRoleMock).toHaveBeenCalledWith(["ADMIN"]);
      expect(requireTenantAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        "tenant-1",
        { mode: "write", allowWhenEnteMissing: false },
      );
      expect(recoverMissionsMock).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        candidateActorId: null,
        requireValidCandidate: false,
      });
      expect(auditSuccessMock).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ providerCalled: false }),
      }));
    });

    it("requires an explicitly supplied assignee to be valid", async () => {
      const data = formData();
      data.set("assignedActorId", "user-1");

      await recoverCurrentKnowledgeMissions(data);

      expect(recoverMissionsMock).toHaveBeenCalledWith(expect.objectContaining({
        candidateActorId: "user-1",
        requireValidCandidate: true,
      }));
    });
  });

  it("fails closed when the default budget is not authorized", async () => {
    readAuthorizationMock.mockReturnValue({ authorized: false });

    await expect(assignDefaultProcedimentoBudgetPolicy(formData()))
      .rejects.toThrow("PROCEDIMENTO_BUDGET_NOT_AUTHORIZED");
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("does not provision a missing or tenant-less procedimento", async () => {
    prismaMock.procedimento.findUnique.mockResolvedValue(null);

    await expect(assignDefaultProcedimentoBudgetPolicy(formData()))
      .rejects.toThrow("PROCEDIMENTO_NOT_FOUND");
    expect(requireTenantAccessMock).not.toHaveBeenCalled();
    expect(provisionMock).not.toHaveBeenCalled();
  });
});

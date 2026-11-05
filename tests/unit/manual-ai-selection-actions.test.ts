import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminWithMfa = vi.hoisted(() => vi.fn());
const getCurrentTenantContext = vi.hoisted(() => vi.fn());
const requireTenantAccess = vi.hoisted(() => vi.fn());
const requestExistingCorpusAnalysis = vi.hoisted(() => vi.fn());
const auditSuccess = vi.hoisted(() => vi.fn());
const auditFailure = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const procedimentoFindUnique = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  requireAdminWithMfa,
  requireRole: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: {
      findUnique: procedimentoFindUnique,
    },
  },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext,
  requireTenantAccess,
}));
vi.mock("@/server/audit/auditLog", () => ({
  auditSuccess,
  auditFailure,
  createAuditLogInTransaction: vi.fn(),
}));
vi.mock("@/server/ai/fascicoloExistingCorpusAnalysis", () => ({
  requestExistingCorpusAnalysis,
}));

import { runManualFascicoloAnalysis } from "@/app/admin/runtime/actions";

describe("manual AI provider selection action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminWithMfa.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.test",
      role: "ADMIN",
    });
    procedimentoFindUnique.mockResolvedValue({
      id: "procedure-1",
      enteId: "tenant-1",
    });
    getCurrentTenantContext.mockResolvedValue({ enteId: "tenant-1" });
    requestExistingCorpusAnalysis.mockResolvedValue({
      admission: { outcome: "CREATED", job: { id: "job-1" } },
      activation: { outcome: "REQUESTED" },
      authorizationRef: "approval-1",
    });
  });

  it("validates the catalog choice server-side and records immutable selection audit data", async () => {
    const formData = new FormData();
    formData.set("procedimentoId", "procedure-1");
    formData.set("executionId", "11111111-1111-4111-8111-111111111111");
    formData.set("aiModelSelection", "OPENAI:gpt-5.6-terra");
    formData.set("confirmation", "RUN_MANUAL_FASCICOLO_ANALYSIS");

    await runManualFascicoloAnalysis(formData);

    expect(requireAdminWithMfa).toHaveBeenCalledOnce();
    expect(requireTenantAccess).toHaveBeenCalledWith(
      { enteId: "tenant-1" },
      "tenant-1",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(requestExistingCorpusAnalysis).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      executionId: "11111111-1111-4111-8111-111111111111",
      selection: {
        provider: "OPENAI",
        model: "gpt-5.6-terra",
        selectionVersion: "AI_MODEL_SELECTION_V1",
      },
      actor: {
        id: "admin-1",
        email: "admin@example.test",
        role: "ADMIN",
      },
    });
    expect(auditSuccess).toHaveBeenCalledWith(expect.objectContaining({
      azione: "FASCICOLO_MANUAL_ANALYSIS_REQUEST",
      entitaId: "procedure-1",
      metadata: expect.objectContaining({
        jobId: "job-1",
        provider: "OPENAI",
        model: "gpt-5.6-terra",
        selectionVersion: "AI_MODEL_SELECTION_V1",
        authorizationRef: "approval-1",
        pricingVersion: "OPENAI_GPT_5_6_TERRA_2026_10_21",
        dataPolicyVersion: "AI_PROVIDER_DATA_POLICY_V1",
        result: "ADMITTED",
      }),
    }));
  });

  it("rejects an unknown model before admission", async () => {
    const formData = new FormData();
    formData.set("procedimentoId", "procedure-1");
    formData.set("executionId", "11111111-1111-4111-8111-111111111111");
    formData.set("aiModelSelection", "ANTHROPIC:not-registered");
    formData.set("confirmation", "RUN_MANUAL_FASCICOLO_ANALYSIS");

    await expect(runManualFascicoloAnalysis(formData))
      .rejects.toThrow("INVALID_AI_MODEL_SELECTION");
    expect(requestExistingCorpusAnalysis).not.toHaveBeenCalled();
    expect(auditSuccess).not.toHaveBeenCalled();
  });
});

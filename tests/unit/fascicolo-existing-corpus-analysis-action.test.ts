import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminWithMfa: vi.fn(),
  procedimentoFindUnique: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  requestExistingCorpusAnalysis: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({
  requireAdminWithMfa: mocks.requireAdminWithMfa,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findUnique: mocks.procedimentoFindUnique },
  },
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: mocks.requireTenantAccess,
}));
vi.mock("@/server/ai/fascicoloExistingCorpusAnalysis", () => ({
  requestExistingCorpusAnalysis: mocks.requestExistingCorpusAnalysis,
}));

import {
  requestExistingCorpusAnalysisAction,
} from "@/server/actions/fascicolo-existing-corpus-analysis";

function formData() {
  const value = new FormData();
  value.set("procedimentoId", "procedure-a");
  return value;
}

describe("existing corpus analysis action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminWithMfa.mockResolvedValue({
      id: "admin-a",
      email: "admin-a@example.test",
      role: "ADMIN",
      mfaVerified: true,
    });
    mocks.procedimentoFindUnique.mockResolvedValue({ enteId: "tenant-a" });
    mocks.getCurrentTenantContext.mockResolvedValue({
      userId: "admin-a",
      role: "ADMIN",
      isAdmin: true,
      accessibleTenantIds: [],
    });
    mocks.requestExistingCorpusAnalysis.mockResolvedValue({
      admission: { outcome: "CREATED", job: { id: "analysis-job-a" } },
      activation: { outcome: "DISABLED" },
    });
  });

  it("requires an MFA-authenticated administrator before reading the procedure", async () => {
    mocks.requireAdminWithMfa.mockRejectedValue(new Error("ADMIN_REQUIRED"));

    await expect(requestExistingCorpusAnalysisAction(formData()))
      .rejects.toThrow("ADMIN_REQUIRED");
    expect(mocks.procedimentoFindUnique).not.toHaveBeenCalled();
    expect(mocks.requestExistingCorpusAnalysis).not.toHaveBeenCalled();
  });

  it("checks tenant write authority and passes only the canonical scope", async () => {
    await expect(requestExistingCorpusAnalysisAction(formData())).resolves.toBeUndefined();

    expect(mocks.procedimentoFindUnique).toHaveBeenCalledWith({
      where: { id: "procedure-a" },
      select: { enteId: true },
    });
    expect(mocks.requireTenantAccess).toHaveBeenCalledWith(
      expect.objectContaining({ isAdmin: true }),
      "tenant-a",
      { mode: "write", allowWhenEnteMissing: false },
    );
    expect(mocks.requestExistingCorpusAnalysis).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      actor: {
        id: "admin-a",
        email: "admin-a@example.test",
        role: "ADMIN",
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/procedimenti/procedure-a");
  });
});

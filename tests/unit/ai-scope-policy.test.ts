import { beforeEach, describe, expect, it, vi } from "vitest";

const activityFindManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: { findMany: activityFindManyMock },
  },
}));

import {
  getEffectiveAiScopePolicy,
  setAiScopePolicy,
  type AiScopeRequestedPolicy,
} from "@/server/ai/scopePolicy";

const basePolicy: AiScopeRequestedPolicy = {
  aiEnabled: true,
  automaticAnalysisEnabled: true,
  selectedProviders: ["OPENAI"],
  primaryProvider: "OPENAI",
  executionMode: "SINGLE",
  manualResearchEnabled: true,
  linkedResearchEnabled: true,
  automaticResearchEnabled: true,
  researchChannels: ["MOONLIT", "SIMPLICITER"],
  reviewIntervalHours: 24,
};

describe("AI scope policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityFindManyMock.mockResolvedValue([]);
  });

  it("applies tenant and fascicolo policy only as further restrictions", async () => {
    activityFindManyMock.mockResolvedValue([
      {
        entitaId: "FASCICOLO:tenant-1:case-1",
        metadata: {
          policy: {
            ...basePolicy,
            automaticAnalysisEnabled: false,
            automaticResearchEnabled: false,
            researchChannels: ["MOONLIT"],
            reviewIntervalHours: 12,
          },
        },
        createdAt: new Date("2026-11-07T10:00:00.000Z"),
      },
      {
        entitaId: "TENANT:tenant-1",
        metadata: {
          policy: {
            ...basePolicy,
            linkedResearchEnabled: false,
            reviewIntervalHours: 48,
          },
        },
        createdAt: new Date("2026-11-07T09:00:00.000Z"),
      },
    ]);

    await expect(getEffectiveAiScopePolicy({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      globalAiEnabled: true,
      generalAutomationEnabled: true,
      allowedProviders: ["OPENAI"],
      allowedResearchChannels: ["MOONLIT", "SIMPLICITER"],
    })).resolves.toMatchObject({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      aiEnabled: true,
      automaticAnalysisEnabled: false,
      linkedResearchEnabled: false,
      automaticResearchEnabled: false,
      selectedProviders: ["OPENAI"],
      researchChannels: ["MOONLIT"],
      reviewIntervalHours: 48,
    });
    expect(activityFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        entitaId: {
          in: ["TENANT:tenant-1", "FASCICOLO:tenant-1:case-1"],
        },
      }),
    }));
  });

  it("fails closed when no provider is authorized", async () => {
    await expect(getEffectiveAiScopePolicy({
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      globalAiEnabled: true,
      generalAutomationEnabled: true,
      allowedProviders: [],
      allowedResearchChannels: ["MOONLIT"],
    })).resolves.toMatchObject({
      aiEnabled: false,
      automaticAnalysisEnabled: false,
      linkedResearchEnabled: false,
      automaticResearchEnabled: false,
      blockedReasons: ["NO_AUTHORIZED_AI_PROVIDER"],
    });
  });

  it("rejects a lower scope that attempts to amplify its upper policy", async () => {
    await expect(setAiScopePolicy({
      scope: "FASCICOLO",
      tenantId: "tenant-1",
      procedimentoId: "case-1",
      upperPolicy: {
        ...basePolicy,
        automaticAnalysisEnabled: false,
        automaticResearchEnabled: false,
      },
      policy: {
        ...basePolicy,
        automaticAnalysisEnabled: true,
        automaticResearchEnabled: true,
      },
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    })).rejects.toThrow("AI_SCOPE_POLICY_EXCEEDS_UPPER_SCOPE");
  });
});

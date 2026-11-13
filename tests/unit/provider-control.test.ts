import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  txFindFirst: vi.fn(),
  createAudit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: mocks.createAudit,
}));

import {
  AI_AUTOMATIC_WORKFLOW,
  getAiProviderControlSnapshot,
  setAiProviderManualEnabled,
  setAutomaticAiProvider,
} from "@/server/ai/providerControl";

const actor = {
  userId: "admin-1",
  userEmail: "admin@example.test",
  userRole: "ADMIN" as const,
};

describe("AI provider control persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);
    mocks.queryRaw.mockResolvedValue([{ acquired: true }]);
    mocks.txFindFirst.mockResolvedValue(null);
    mocks.createAudit.mockResolvedValue({ createdAt: new Date("2026-11-05T12:00:00Z") });
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.queryRaw,
      activityLog: { findFirst: mocks.txFindFirst },
    }));
  });

  it("preserves safe defaults without stored events", async () => {
    const snapshot = await getAiProviderControlSnapshot();

    expect(snapshot.workflow).toBe(AI_AUTOMATIC_WORKFLOW);
    expect(snapshot.automaticSelection.provider).toBe("OPENAI");
    expect(snapshot.providers).toEqual([
      expect.objectContaining({ provider: "OPENAI", manualEnabled: true, automaticSelected: true }),
      expect.objectContaining({ provider: "ANTHROPIC", manualEnabled: false, automaticSelected: false }),
      expect.objectContaining({ provider: "DEEPSEEK", manualEnabled: false, automaticSelected: false }),
    ]);
  });

  it("reconstructs the latest manual and unique automatic state", async () => {
    mocks.findMany.mockResolvedValue([
      {
        entitaId: "ANTHROPIC",
        metadata: { newEnabled: true },
        createdAt: new Date("2026-11-05T12:00:00Z"),
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
      {
        entitaId: "ANTHROPIC",
        metadata: { newEnabled: false },
        createdAt: new Date("2026-11-05T11:00:00Z"),
        userId: "admin-2",
        userEmail: "other@example.test",
        userRole: "ADMIN",
      },
    ]);
    mocks.findFirst.mockResolvedValue({
      metadata: { provider: "ANTHROPIC" },
      createdAt: new Date("2026-11-05T12:01:00Z"),
    });

    const snapshot = await getAiProviderControlSnapshot();

    expect(snapshot.automaticSelection.provider).toBe("ANTHROPIC");
    expect(snapshot.providers.filter((provider) => provider.automaticSelected)).toHaveLength(1);
    expect(snapshot.providers.find((provider) => provider.provider === "ANTHROPIC"))
      .toMatchObject({ manualEnabled: true, automaticSelected: true });
  });

  it("serializes manual updates through the advisory lock and audit chain", async () => {
    const result = await setAiProviderManualEnabled({
      provider: "DEEPSEEK",
      enabled: true,
      actor,
    });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.createAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entitaId: "DEEPSEEK",
        actor,
        metadata: expect.objectContaining({
          previousEnabled: false,
          newEnabled: true,
        }),
      }),
    );
    expect(result).toMatchObject({ provider: "DEEPSEEK", manualEnabled: true });
  });

  it("uses the same lock for concurrent automatic selection requests", async () => {
    await Promise.all([
      setAutomaticAiProvider({
        selection: {
          provider: "OPENAI",
          model: "gpt-5.6-terra",
          selectionVersion: "AI_MODEL_SELECTION_V1",
        },
        actor,
      }),
      setAutomaticAiProvider({
        selection: {
          provider: "ANTHROPIC",
          model: "claude-sonnet-5",
          selectionVersion: "AI_MODEL_SELECTION_V1",
        },
        actor,
      }),
    ]);

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.createAudit).toHaveBeenCalledTimes(2);
  });
});

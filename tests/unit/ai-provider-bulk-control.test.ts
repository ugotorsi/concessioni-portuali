import { beforeEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const lockMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: transactionMock },
}));
vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: auditMock,
}));

import { setAiProvidersManualEnabled } from "@/server/ai/providerControl";

describe("AI provider bulk control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockMock.mockResolvedValue([{ acquired: true }]);
    findManyMock.mockResolvedValue([
      { entitaId: "OPENAI", metadata: { newEnabled: false } },
    ]);
    auditMock
      .mockResolvedValueOnce({ createdAt: new Date("2026-11-07T10:00:00.000Z") })
      .mockResolvedValueOnce({ createdAt: new Date("2026-11-07T10:00:01.000Z") });
    transactionMock.mockImplementation(async (callback) => callback({
      $queryRaw: lockMock,
      activityLog: { findMany: findManyMock },
    }));
  });

  it("deduplicates providers and writes one audited state change per provider", async () => {
    await expect(setAiProvidersManualEnabled({
      providers: ["OPENAI", "OPENAI", "ANTHROPIC"],
      enabled: true,
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
      reason: "Bulk enable eligible providers",
    })).resolves.toMatchObject({
      enabled: true,
      providers: [
        { provider: "OPENAI" },
        { provider: "ANTHROPIC" },
      ],
    });
    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMock).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      entitaId: "OPENAI",
      metadata: expect.objectContaining({
        previousEnabled: false,
        newEnabled: true,
        bulk: true,
      }),
    }));
    expect(auditMock).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      entitaId: "ANTHROPIC",
      metadata: expect.objectContaining({
        previousEnabled: false,
        newEnabled: true,
        bulk: true,
      }),
    }));
  });
});

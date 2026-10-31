import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  activityFindFirstMock,
  asyncJobUpdateManyMock,
  auditInTransactionMock,
  controlLockMock,
  transactionMock,
} = vi.hoisted(() => ({
  activityFindFirstMock: vi.fn(),
  asyncJobUpdateManyMock: vi.fn(),
  auditInTransactionMock: vi.fn(),
  controlLockMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityLog: { findFirst: activityFindFirstMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: auditInTransactionMock,
}));

import {
  assertGlobalAiExecutionAllowed,
  getGlobalAiControlState,
  GlobalAiDisabledError,
  setGlobalAiControlState,
} from "@/server/ai/globalAiControl";

describe("global AI control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityFindFirstMock.mockResolvedValue(null);
    asyncJobUpdateManyMock.mockResolvedValue({ count: 0 });
    controlLockMock.mockResolvedValue([{ acquired: true }]);
    auditInTransactionMock.mockResolvedValue({
      createdAt: new Date("2026-10-22T08:00:00.000Z"),
    });
    transactionMock.mockImplementation(async (callback) => callback({
      $queryRaw: controlLockMock,
      activityLog: { findFirst: activityFindFirstMock },
      asyncJob: { updateMany: asyncJobUpdateManyMock },
    }));
  });

  it("defaults persistently to OFF when no control event exists", async () => {
    await expect(getGlobalAiControlState({})).resolves.toMatchObject({
      requestedEnabled: false,
      effectiveEnabled: false,
      emergencyDisabled: false,
      environmentEnabled: false,
      environmentGates: {
        AI_REAL_DATA_ENABLED: false,
        ASYNC_PROVIDER_EXECUTION_ENABLED: false,
        AUTOMATIC_RESEARCH_EXECUTION_ENABLED: false,
        AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED: false,
      },
      updatedAt: null,
      updatedBy: null,
    });
    await expect(assertGlobalAiExecutionAllowed()).rejects.toBeInstanceOf(GlobalAiDisabledError);
  });

  it("reads ON from the latest successful audit event", async () => {
    activityFindFirstMock.mockResolvedValue({
      metadata: { previousState: "OFF", newState: "ON" },
      createdAt: new Date("2026-10-22T08:00:00.000Z"),
      userId: "admin-1",
      userEmail: "admin@example.test",
      userRole: "ADMIN",
    });

    await expect(getGlobalAiControlState({
      AI_REAL_DATA_ENABLED: "true",
    })).resolves.toMatchObject({
      requestedEnabled: true,
      effectiveEnabled: true,
      emergencyDisabled: false,
      environmentEnabled: true,
      updatedBy: { userId: "admin-1", userEmail: "admin@example.test", userRole: "ADMIN" },
    });
  });

  it("keeps the effective state OFF when ADMIN requests ON but all environment gates are OFF", async () => {
    activityFindFirstMock.mockResolvedValue({
      metadata: { newState: "ON" },
      createdAt: new Date(),
      userId: "admin-1",
      userEmail: "admin@example.test",
      userRole: "ADMIN",
    });

    await expect(getGlobalAiControlState({
      AI_REAL_DATA_ENABLED: " false ",
      ASYNC_PROVIDER_EXECUTION_ENABLED: "false",
      AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false",
      AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED: "false",
    })).resolves.toMatchObject({
      requestedEnabled: true,
      effectiveEnabled: false,
      environmentEnabled: false,
    });
  });

  it("gives the environmental emergency kill-switch precedence over ON", async () => {
    activityFindFirstMock.mockResolvedValue({
      metadata: { newState: "ON" },
      createdAt: new Date(),
      userId: "admin-1",
      userEmail: "admin@example.test",
      userRole: "ADMIN",
    });

    await expect(getGlobalAiControlState({
      AI_GLOBAL_EMERGENCY_DISABLED: "true",
      AI_REAL_DATA_ENABLED: "true",
    })).resolves.toMatchObject({
      requestedEnabled: true,
      effectiveEnabled: false,
      emergencyDisabled: true,
      environmentEnabled: true,
    });
  });

  it("cancels queued AI jobs, requests running cancellation, and audits OFF", async () => {
    activityFindFirstMock.mockResolvedValue({ metadata: { newState: "ON" } });
    asyncJobUpdateManyMock
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 2 });

    await expect(setGlobalAiControlState({
      enabled: false,
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
      reason: "Emergency stop",
    })).resolves.toMatchObject({
      previousEnabled: true,
      requestedEnabled: false,
      cancelledQueuedJobs: 3,
      cancellationRequestedJobs: 2,
    });

    expect(asyncJobUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(auditInTransactionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      azione: "AI_GLOBAL_CONTROL_CHANGE",
      esito: "SUCCESS",
      metadata: expect.objectContaining({
        previousState: "ON",
        newState: "OFF",
        reason: "Emergency stop",
        cancelledQueuedJobs: 3,
        cancellationRequestedJobs: 2,
      }),
    }));
  });

  it("does not start jobs when switching ON", async () => {
    await setGlobalAiControlState({
      enabled: true,
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    });

    expect(asyncJobUpdateManyMock).not.toHaveBeenCalled();
  });

  it("fails closed before reading or changing state when the transition lock is unavailable", async () => {
    controlLockMock.mockResolvedValueOnce([]);

    await expect(setGlobalAiControlState({
      enabled: true,
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    })).rejects.toThrow("GLOBAL_AI_CONTROL_LOCK_FAILED");

    expect(activityFindFirstMock).not.toHaveBeenCalled();
    expect(auditInTransactionMock).not.toHaveBeenCalled();
  });

  it("serializes concurrent transitions before reading previousState", async () => {
    let latestMetadata: { newState: "ON" | "OFF" } | null = null;
    let lockTail = Promise.resolve();

    activityFindFirstMock.mockImplementation(async () => {
      const snapshot = latestMetadata;
      await Promise.resolve();
      return snapshot ? { metadata: snapshot } : null;
    });
    auditInTransactionMock.mockImplementation(async (_tx, input) => {
      latestMetadata = {
        newState: input.metadata.newState as "ON" | "OFF",
      };
      return { createdAt: new Date("2026-10-22T08:00:00.000Z") };
    });
    transactionMock.mockImplementation(async (callback) => {
      const precedingTransaction = lockTail;
      let releaseTransaction!: () => void;
      lockTail = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      const tx = {
        $queryRaw: vi.fn(async () => {
          await precedingTransaction;
          return [{ acquired: true }];
        }),
        activityLog: { findFirst: activityFindFirstMock },
        asyncJob: { updateMany: asyncJobUpdateManyMock },
      };
      try {
        return await callback(tx);
      } finally {
        releaseTransaction();
      }
    });

    const [enabled, disabled] = await Promise.all([
      setGlobalAiControlState({
        enabled: true,
        actor: {
          userId: "admin-1",
          userEmail: "admin-1@example.test",
          userRole: "ADMIN",
        },
      }),
      setGlobalAiControlState({
        enabled: false,
        actor: {
          userId: "admin-2",
          userEmail: "admin-2@example.test",
          userRole: "ADMIN",
        },
      }),
    ]);

    expect(enabled).toMatchObject({ previousEnabled: false, requestedEnabled: true });
    expect(disabled).toMatchObject({ previousEnabled: true, requestedEnabled: false });
    expect(auditInTransactionMock.mock.calls.map(([, input]) => input.metadata))
      .toEqual([
        expect.objectContaining({ previousState: "OFF", newState: "ON" }),
        expect.objectContaining({ previousState: "ON", newState: "OFF" }),
      ]);
  });
});

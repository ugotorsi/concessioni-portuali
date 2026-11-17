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
  getAutomationControlState,
  MANUAL_AI_JOB_PURPOSES,
  setAutomationControlState,
} from "@/server/automation/automationControl";

describe("automation control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityFindFirstMock.mockResolvedValue(null);
    asyncJobUpdateManyMock.mockResolvedValue({ count: 0 });
    controlLockMock.mockResolvedValue([{ acquired: true }]);
    auditInTransactionMock.mockResolvedValue({
      createdAt: new Date("2026-11-01T08:00:00.000Z"),
    });
    transactionMock.mockImplementation(async (callback) => callback({
      $queryRaw: controlLockMock,
      activityLog: { findFirst: activityFindFirstMock },
      asyncJob: { updateMany: asyncJobUpdateManyMock },
    }));
  });

  it("defaults persistently to OFF without an audit event", async () => {
    await expect(getAutomationControlState()).resolves.toEqual({
      mode: "OFF",
      effectiveEnabled: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("reads ON only from the latest successful audit event", async () => {
    activityFindFirstMock.mockResolvedValue({
      metadata: { previousMode: "OFF", newMode: "ON" },
      createdAt: new Date("2026-11-01T08:00:00.000Z"),
      userId: "admin-1",
      userEmail: "admin@example.test",
      userRole: "ADMIN",
    });

    await expect(getAutomationControlState()).resolves.toMatchObject({
      mode: "ON",
      effectiveEnabled: true,
      updatedBy: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    });
  });

  it("turns OFF only automatic provider jobs and preserves manual purposes", async () => {
    activityFindFirstMock.mockResolvedValue({ metadata: { newMode: "ON" } });
    asyncJobUpdateManyMock
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(setAutomationControlState({
      mode: "OFF",
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
      reason: "Modalita dimostrativa",
    })).resolves.toMatchObject({
      previousMode: "ON",
      mode: "OFF",
      cancelledQueuedJobs: 3,
      cancellationRequestedJobs: 1,
    });

    expect(asyncJobUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(asyncJobUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        purpose: { notIn: [...MANUAL_AI_JOB_PURPOSES] },
      }),
    }));
    expect(auditInTransactionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      azione: "AUTOMATION_MODE_CHANGE",
      metadata: expect.objectContaining({
        previousMode: "ON",
        newMode: "OFF",
      }),
    }));
  });

  it("does not enqueue work when switching ON", async () => {
    await setAutomationControlState({
      mode: "ON",
      actor: {
        userId: "admin-1",
        userEmail: "admin@example.test",
        userRole: "ADMIN",
      },
    });

    expect(asyncJobUpdateManyMock).not.toHaveBeenCalled();
  });
});

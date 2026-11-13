import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getAuditRequestContextMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  activityLog: { findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/audit/requestContext", () => ({
  getAuditRequestContext: getAuditRequestContextMock,
}));

import { createAuditLogInTransaction, verifyCompleteAuditLogChain } from "@/server/audit/auditLog";
import { computeAuditHash } from "@/server/audit/hash";

const actor = { userId: "user-1", userEmail: "user@example.test", userRole: "ADMIN" };
const requestContext = { ipAddress: "127.0.0.1", userAgent: "vitest" };

function createTransaction(trace: string[]) {
  return {
    $queryRaw: vi.fn<(...query: [TemplateStringsArray, ...unknown[]]) => Promise<unknown>>(async () => {
      trace.push("lock");
      return [{ acquired: true }];
    }),
    activityLog: {
      findFirst: vi.fn(async () => {
        trace.push("read");
        return { currentHash: "previous-hash", createdAt: new Date("2026-08-19T11:59:59.999Z") };
      }),
      create: vi.fn(async ({ data }) => {
        trace.push("create");
        return data;
      }),
    },
  };
}

describe("createAuditLogInTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("verifyCompleteAuditLogChain", () => {
    it("verifies ordered pages while carrying the previous page hash", async () => {
      const make = (id: string, createdAt: Date, previousHash: string | null) => {
        const common = {
          createdAt,
          azione: "TEST",
          entita: "Entity",
          entitaId: id,
          enteId: "tenant-1",
          concessioneId: null,
          esito: "SUCCESS" as const,
          metadata: { id },
          userId: "user-1",
          userEmail: "user@example.test",
          userRole: "ADMIN",
        };
        return {
          id,
          ...common,
          previousHash,
          currentHash: computeAuditHash({
            ...common,
            previousHash,
            actor: {
              userId: common.userId,
              userEmail: common.userEmail,
              userRole: common.userRole,
            },
          }),
        };
      };
      const first = make("audit-1", new Date("2026-08-19T12:00:00.000Z"), null);
      const second = make("audit-2", new Date("2026-08-19T12:00:00.001Z"), first.currentHash);
      const third = make("audit-3", new Date("2026-08-19T12:00:00.002Z"), second.currentHash);
      prismaMock.activityLog.findMany
        .mockResolvedValueOnce([first, second])
        .mockResolvedValueOnce([third]);

      await expect(verifyCompleteAuditLogChain(2)).resolves.toEqual({
        valid: true,
        verifiedCount: 3,
        finalHash: third.currentHash,
        issue: null,
      });
      expect(prismaMock.activityLog.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: {
          OR: [
            { createdAt: { gt: second.createdAt } },
            { createdAt: second.createdAt, id: { gt: second.id } },
          ],
        },
      }));
    });
  });

  it("uses a strictly increasing timestamp after acquiring the chain lock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T11:59:00.000Z"));
    const tx = createTransaction([]);
    tx.$queryRaw.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
      return [{ acquired: true }];
    });
    tx.activityLog.findFirst.mockResolvedValue({
      currentHash: "previous-hash",
      createdAt: new Date("2026-08-19T12:00:00.000Z"),
    });

    await createAuditLogInTransaction(tx as never, {
      azione: "TEST_ACTION",
      entita: "TestEntity",
      esito: "SUCCESS",
      actor,
      requestContext,
    });

    expect(tx.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousHash: "previous-hash",
        createdAt: new Date("2026-08-19T12:00:00.001Z"),
      }),
    });
  });

  it("locks before reading and preserves hash and metadata behavior", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
    const trace: string[] = [];
    const tx = createTransaction(trace);

    await createAuditLogInTransaction(tx as never, {
      azione: "TEST_ACTION",
      entita: "TestEntity",
      entitaId: "entity-1",
      enteId: "ente-1",
      concessioneId: "concessione-1",
      esito: "SUCCESS",
      actor,
      requestContext,
      metadata: { visible: "kept", apiToken: "removed" },
    });

    expect(trace).toEqual(["lock", "read", "create"]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [queryParts, ...queryValues] = tx.$queryRaw.mock.calls[0];
    const query = queryParts.join(" ");
    expect(query).toContain('SELECT TRUE AS "acquired"');
    expect(query).toContain("FROM pg_advisory_xact_lock");
    expect(query).not.toContain("SELECT pg_advisory_xact_lock");
    expect(queryValues).toEqual([
      "concessioni-portuali",
      "activity-log-hash-chain:v1",
    ]);
    expect(tx.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousHash: "previous-hash",
        metadata: { visible: "kept" },
        currentHash: computeAuditHash({
          previousHash: "previous-hash",
          createdAt: new Date("2026-08-19T12:00:00.000Z"),
          azione: "TEST_ACTION",
          entita: "TestEntity",
          entitaId: "entity-1",
          enteId: "ente-1",
          concessioneId: "concessione-1",
          esito: "SUCCESS",
          actor,
          metadata: { visible: "kept" },
        }),
      }),
    });
  });

  it("propagates lock failure without reading or creating", async () => {
    const trace: string[] = [];
    const tx = createTransaction(trace);
    const lockError = new Error("lock failed");
    tx.$queryRaw.mockRejectedValue(lockError);

    await expect(createAuditLogInTransaction(tx as never, {
      azione: "TEST_ACTION",
      entita: "TestEntity",
      esito: "SUCCESS",
      actor,
      requestContext,
    })).rejects.toBe(lockError);

    expect(tx.activityLog.findFirst).not.toHaveBeenCalled();
    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["zero rows", []],
    ["false result", [{ acquired: false }]],
    ["malformed result", [{}]],
    ["multiple rows", [{ acquired: true }, { acquired: true }]],
  ])("fails closed for %s", async (_name, lockResult) => {
    const trace: string[] = [];
    const tx = createTransaction(trace);
    tx.$queryRaw.mockResolvedValue(lockResult);

    await expect(createAuditLogInTransaction(tx as never, {
      azione: "TEST_ACTION",
      entita: "TestEntity",
      esito: "SUCCESS",
      actor,
      requestContext,
    })).rejects.toThrow("ACTIVITY_LOG_HASH_CHAIN_LOCK_FAILED");

    expect(tx.activityLog.findFirst).not.toHaveBeenCalled();
    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });
});
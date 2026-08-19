import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getAuditRequestContextMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/audit/requestContext", () => ({
  getAuditRequestContext: getAuditRequestContextMock,
}));

import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { computeAuditHash } from "@/server/audit/hash";

const actor = { userId: "user-1", userEmail: "user@example.test", userRole: "ADMIN" };
const requestContext = { ipAddress: "127.0.0.1", userAgent: "vitest" };

function createTransaction(trace: string[]) {
  return {
    $queryRaw: vi.fn(async () => {
      trace.push("lock");
      return [{ pg_advisory_xact_lock: null }];
    }),
    activityLog: {
      findFirst: vi.fn(async () => {
        trace.push("read");
        return { currentHash: "previous-hash" };
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
    expect(queryParts.join(" ")).toContain("pg_advisory_xact_lock");
    expect(queryValues).toEqual([]);
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
});
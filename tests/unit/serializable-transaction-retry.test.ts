import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { Prisma } from "@/generated/prisma/client";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

function knownError(code: string, target?: string[]) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "7.8.0",
    meta: target ? { modelName: "Expected", target } : undefined,
  });
}

describe("serializable transaction opt-in retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves default P2034 retry and does not globally retry P2002", async () => {
    const conflict = knownError("P2034");
    prismaMock.$transaction.mockRejectedValueOnce(conflict).mockResolvedValueOnce("ok");
    await expect(runSerializableTransactionWithRetry(vi.fn())).resolves.toBe("ok");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);

    prismaMock.$transaction.mockReset().mockRejectedValue(knownError("P2002", ["key"]));
    await expect(runSerializableTransactionWithRetry(vi.fn())).rejects.toMatchObject({ code: "P2002" });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the caller predicate rejects the error", async () => {
    const error = knownError("P2002", ["wrong"]);
    prismaMock.$transaction.mockRejectedValue(error);
    await expect(runSerializableTransactionWithRetry(vi.fn(), {
      isRetryableError: () => false,
    })).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh transaction after a recognized P2002", async () => {
    const error = knownError("P2002", ["expected"]);
    const failedTx = { id: "failed" };
    const freshTx = { id: "fresh" };
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback(failedTx))
      .mockImplementationOnce(async (callback) => callback(freshTx));
    const callback = vi.fn(async (tx) => {
      if (tx === failedTx) throw error;
      return tx.id;
    });

    await expect(runSerializableTransactionWithRetry(callback, {
      isRetryableError: (cause) => cause === error,
    })).resolves.toBe("fresh");
    expect(callback.mock.calls.map(([tx]) => tx)).toEqual([failedTx, freshTx]);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("respects the shared three-attempt limit", async () => {
    const error = knownError("P2002", ["expected"]);
    prismaMock.$transaction.mockRejectedValue(error);
    await expect(runSerializableTransactionWithRetry(vi.fn(), {
      isRetryableError: (cause) => cause === error,
    })).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it("propagates non-Prisma errors unchanged", async () => {
    const error = new Error("boom");
    prismaMock.$transaction.mockRejectedValue(error);
    await expect(runSerializableTransactionWithRetry(vi.fn(), {
      isRetryableError: () => false,
    })).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
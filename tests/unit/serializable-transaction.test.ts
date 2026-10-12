import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { Prisma } from "@/generated/prisma/client";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: "7.8.0",
  });
}

describe("runSerializableTransactionWithRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback({ attempt: 1 }));
  });

  it("uses Serializable isolation and preserves a successful value", async () => {
    const callback = vi.fn().mockResolvedValue({ id: "result-1" });

    await expect(runSerializableTransactionWithRetry(callback)).resolves.toEqual({ id: "result-1" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it.each([
    { conflicts: 1, attempts: 2 },
    { conflicts: 2, attempts: 3 },
  ])("retries $conflicts P2034 conflict(s) with a fresh transaction", async ({ conflicts, attempts }) => {
    for (let index = 0; index < conflicts; index += 1) {
      prismaMock.$transaction.mockImplementationOnce(async (callback) => {
        await callback({ attempt: index + 1 });
        throw knownError("P2034");
      });
    }
    prismaMock.$transaction.mockImplementationOnce(async (callback) => callback({ attempt: attempts }));
    const callback = vi.fn().mockResolvedValue("done");

    await expect(runSerializableTransactionWithRetry(callback)).resolves.toBe("done");
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(attempts);
    expect(callback).toHaveBeenCalledTimes(attempts);
  });

  it("throws the third P2034 after exactly three attempts", async () => {
    const error = knownError("P2034");
    prismaMock.$transaction.mockImplementation(async (callback) => {
      await callback({ attempt: 1 });
      throw error;
    });
    const callback = vi.fn().mockResolvedValue(undefined);

    await expect(runSerializableTransactionWithRetry(callback)).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["an unknown error", new Error("unknown")],
    ["P2002", knownError("P2002")],
  ])("does not retry %s", async (_label, error) => {
    prismaMock.$transaction.mockImplementation(async (callback) => {
      await callback({ attempt: 1 });
      throw error;
    });
    const callback = vi.fn().mockResolvedValue(undefined);

    await expect(runSerializableTransactionWithRetry(callback)).rejects.toBe(error);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
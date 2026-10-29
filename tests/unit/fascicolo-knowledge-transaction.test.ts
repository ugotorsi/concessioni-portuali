import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSerializableTransactionWithRetry: vi.fn(),
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runSerializableTransactionWithRetry,
}));

import { runInFascicoloKnowledgeTransaction } from "@/server/fascicolo-knowledge/repository";

describe("fascicolo knowledge transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSerializableTransactionWithRetry.mockImplementation(async (operation) => (
      operation({ $queryRawUnsafe: vi.fn() })
    ));
  });

  it("uses a bounded timeout for the multi-statement persistence transaction", async () => {
    await expect(runInFascicoloKnowledgeTransaction(async () => "done")).resolves.toBe("done");

    expect(mocks.runSerializableTransactionWithRetry).toHaveBeenCalledWith(
      expect.any(Function),
      { timeoutMs: 30_000 },
    );
  });
});

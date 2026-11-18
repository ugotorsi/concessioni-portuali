import { describe, expect, it, vi } from "vitest";

import { ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries } from "@/server/documents/documentExtractionRetryAdmission";

describe("fascicolo terminal document extraction recovery", () => {
  it("recovers at most the eligible targets returned for the fascicolo", async () => {
    const list = vi.fn(async () => [
      { terminalJobId: "job-1", failedAttemptId: "attempt-1" },
      { terminalJobId: "job-2", failedAttemptId: "attempt-2" },
    ]);
    const recover = vi.fn()
      .mockResolvedValueOnce({ outcome: "CREATED", job: { id: "recovery-1" } })
      .mockResolvedValueOnce({ outcome: "REUSED", job: { id: "recovery-2" } });

    const result = await ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      reason: "Recupero autorizzato dal fascicolo.",
      limit: 5,
    }, { list, recover });

    expect(list).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      limit: 5,
    });
    expect(recover).toHaveBeenNthCalledWith(1, {
      terminalJobId: "job-1",
      failedAttemptId: "attempt-1",
      reason: "Recupero autorizzato dal fascicolo.",
    });
    expect(recover).toHaveBeenNthCalledWith(2, {
      terminalJobId: "job-2",
      failedAttemptId: "attempt-2",
      reason: "Recupero autorizzato dal fascicolo.",
    });
    expect(result).toEqual({
      targetCount: 2,
      createdJobCount: 1,
      reusedJobCount: 1,
    });
  });

  it("does not recover anything when no current target is eligible", async () => {
    const recover = vi.fn();
    const result = await ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      reason: "Recupero autorizzato dal fascicolo.",
    }, {
      list: vi.fn(async () => []),
      recover,
    });

    expect(recover).not.toHaveBeenCalled();
    expect(result).toEqual({
      targetCount: 0,
      createdJobCount: 0,
      reusedJobCount: 0,
    });
  });
});

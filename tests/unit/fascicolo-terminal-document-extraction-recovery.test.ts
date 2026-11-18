import { describe, expect, it, vi } from "vitest";

import {
  ensureAuthorizedFascicoloTerminalDocumentExtractionRecoveries,
  ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery,
  isRecoverableTerminalDocumentExtractionFailure,
} from "@/server/documents/documentExtractionRetryAdmission";

describe("fascicolo terminal document extraction recovery", () => {
  it("allows a bounded persistence failure to become the source of a new recovery", () => {
    expect(isRecoverableTerminalDocumentExtractionFailure(
      "DOCUMENT_EXTRACTION_PERSISTENCE_FAILED",
    )).toBe(true);
  });

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

  it("recovers only the selected failed attempt without exposing a job id to the caller", async () => {
    const list = vi.fn(async () => [
      { terminalJobId: "job-1", failedAttemptId: "attempt-1" },
      { terminalJobId: "job-2", failedAttemptId: "attempt-2" },
    ]);
    const recover = vi.fn().mockResolvedValue({ outcome: "CREATED", job: { id: "recovery-2" } });

    await expect(ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      failedAttemptId: "attempt-2",
      reason: "Recupero individuale autorizzato.",
    }, { list, recover })).resolves.toMatchObject({ outcome: "CREATED" });

    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith({
      terminalJobId: "job-2",
      failedAttemptId: "attempt-2",
      reason: "Recupero individuale autorizzato.",
    });
  });

  it("rejects an individual recovery when the selected attempt is not eligible", async () => {
    await expect(ensureAuthorizedFascicoloTerminalDocumentExtractionRecovery({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      failedAttemptId: "attempt-missing",
      reason: "Recupero individuale autorizzato.",
    }, {
      list: vi.fn(async () => []),
      recover: vi.fn(),
    })).rejects.toThrow("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_NOT_ELIGIBLE");
  });
});

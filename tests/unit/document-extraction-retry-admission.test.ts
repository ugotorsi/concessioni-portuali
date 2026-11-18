import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const harness = vi.hoisted(() => ({
  issuePermit: vi.fn(),
  verifyPermit: vi.fn(),
  admit: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    asyncJob: { findUnique: vi.fn(), findMany: vi.fn() },
    documentExtractionAttempt: { findMany: vi.fn() },
  },
  findRecoveryAudit: vi.fn(),
  createRecoveryAudit: vi.fn(),
}));

vi.mock("@/server/documents/documentExtractionRetryPermit", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/documents/documentExtractionRetryPermit")
  >();
  return {
    ...actual,
    issueDocumentExtractionRetryPermit: harness.issuePermit,
    verifyDocumentExtractionRetryPermit: harness.verifyPermit,
  };
});

vi.mock("@/server/async-jobs/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/async-jobs/persistence")>();
  return {
    ...actual,
    admitAsyncJob: harness.admit,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: harness.prisma }));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: harness.createRecoveryAudit,
}));

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  ensureAuthorizedDocumentExtractionRetryJob,
  ensureAuthorizedTerminalDocumentExtractionRecoveryJob,
} from "@/server/documents/documentExtractionJob";
import { listRecoverableFascicoloTerminalDocumentExtractions } from "@/server/documents/documentExtractionRetryAdmission";

const permit = {
  permitRef: "a".repeat(64),
  createdAt: new Date("2026-10-09T16:31:00.000Z"),
  failedAttemptId: "attempt-failed",
  documentoId: "document-1",
  documentFileVersionId: "version-1",
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
  policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
  actor: {
    userId: "user-1",
    userEmail: "admin@example.test",
    userRole: "ADMIN",
  },
};

describe("authorized document extraction retry admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.issuePermit.mockResolvedValue(permit);
    harness.admit.mockResolvedValue({ outcome: "CREATED", job: { id: "job-retry" } });
    harness.prisma.asyncJob.findUnique.mockResolvedValue({
      operation: "DOCUMENT_EXTRACTION_V1",
      status: "TERMINAL_FAILED",
      failureCode: "UNHANDLED_ERROR",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      inputReference: {
        metadata: {
          retryAttemptId: "attempt-failed",
          retryPermitRef: permit.permitRef,
        },
      },
    });
    harness.prisma.$transaction.mockImplementation(async (work) => work({
      $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
      activityLog: { findFirst: harness.findRecoveryAudit },
    }));
    harness.findRecoveryAudit.mockResolvedValue(null);
    harness.prisma.asyncJob.findMany.mockResolvedValue([]);
    harness.prisma.documentExtractionAttempt.findMany.mockResolvedValue([]);
  });

  it("verifies the persisted permit before admitting one idempotent job identity", async () => {
    await ensureAuthorizedDocumentExtractionRetryJob("attempt-failed");
    await ensureAuthorizedDocumentExtractionRetryJob("attempt-failed");
    expect(harness.issuePermit).toHaveBeenCalledTimes(2);
    expect(harness.verifyPermit).toHaveBeenCalledTimes(2);
    const first = normalizeAsyncJobAdmission(harness.admit.mock.calls[0]![0]);
    const second = normalizeAsyncJobAdmission(harness.admit.mock.calls[1]![0]);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.inputReference.metadata).toMatchObject({
      retryAttemptId: "attempt-failed",
      retryPermitRef: permit.permitRef,
    });
  });

  it("does not admit when permit verification fails", async () => {
    harness.verifyPermit.mockRejectedValueOnce(new Error("PERMIT_NOT_FOUND"));
    await expect(ensureAuthorizedDocumentExtractionRetryJob("attempt-failed"))
      .rejects.toThrow("PERMIT_NOT_FOUND");
    expect(harness.admit).not.toHaveBeenCalled();
  });

  it("recovers a terminal retry as a new idempotent audited job", async () => {
    const recoveryKey = createHash("sha256").update([
      "terminal-retry-job",
      "attempt-failed",
      permit.permitRef,
    ].join("\n"), "utf8").digest("hex");
    harness.findRecoveryAudit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        userId: permit.actor.userId,
        metadata: { failedAttemptId: "attempt-failed", recoveryKey },
      });

    await ensureAuthorizedTerminalDocumentExtractionRecoveryJob({
      terminalJobId: "terminal-retry-job",
      failedAttemptId: "attempt-failed",
      reason: "Recupero autorizzato del job terminale.",
    });
    await ensureAuthorizedTerminalDocumentExtractionRecoveryJob({
      terminalJobId: "terminal-retry-job",
      failedAttemptId: "attempt-failed",
      reason: "Recupero autorizzato del job terminale.",
    });

    const first = normalizeAsyncJobAdmission(harness.admit.mock.calls[0]![0]);
    const second = normalizeAsyncJobAdmission(harness.admit.mock.calls[1]![0]);
    await ensureAuthorizedDocumentExtractionRetryJob("attempt-failed");
    const standardRetry = normalizeAsyncJobAdmission(harness.admit.mock.calls[2]![0]);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).not.toBe(standardRetry.idempotencyKey);
    expect(first.inputReference.metadata).toMatchObject({
      retryAttemptId: "attempt-failed",
      retryPermitRef: permit.permitRef,
    });
    expect(harness.createRecoveryAudit).toHaveBeenCalledOnce();
    expect(harness.createRecoveryAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      azione: "DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_AUTHORIZED",
      entitaId: "terminal-retry-job",
      metadata: expect.objectContaining({ recoveryKey }),
    }));
  });

  it("refuses unrelated or legacy terminal jobs without admitting recovery", async () => {
    harness.prisma.asyncJob.findUnique.mockResolvedValueOnce({
      operation: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      status: "TERMINAL_FAILED",
      failureCode: "UNHANDLED_ERROR",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      inputReference: { metadata: { retryAttemptId: "attempt-failed", retryPermitRef: permit.permitRef } },
    });

    await expect(ensureAuthorizedTerminalDocumentExtractionRecoveryJob({
      terminalJobId: "legacy-job",
      failedAttemptId: "attempt-failed",
      reason: "Recupero autorizzato del job terminale.",
    })).rejects.toThrow("DOCUMENT_EXTRACTION_TERMINAL_RECOVERY_NOT_ELIGIBLE");
    expect(harness.admit).not.toHaveBeenCalled();
    expect(harness.issuePermit).not.toHaveBeenCalled();
  });

  it("selects only the newest terminal recovery for each current retryable attempt", async () => {
    harness.prisma.asyncJob.findMany.mockResolvedValue([
      {
        id: "terminal-new",
        failureCode: "UNHANDLED_ERROR",
        inputReference: {
          metadata: {
            retryAttemptId: "attempt-failed",
            retryPermitRef: permit.permitRef,
          },
        },
      },
      {
        id: "terminal-old",
        failureCode: "UNEXPECTED_TYPE_ERROR",
        inputReference: {
          metadata: {
            retryAttemptId: "attempt-failed",
            retryPermitRef: permit.permitRef,
          },
        },
      },
      {
        id: "terminal-unrelated",
        failureCode: "PROVIDER_FAILURE",
        inputReference: {
          metadata: {
            retryAttemptId: "attempt-other",
            retryPermitRef: permit.permitRef,
          },
        },
      },
    ]);
    harness.prisma.documentExtractionAttempt.findMany.mockResolvedValue([
      {
        id: "attempt-failed",
        failureCode: "DIRECT_PARSER_FAILURE",
        documentFileVersionId: "version-1",
        documento: { currentFileVersionId: "version-1" },
      },
    ]);

    await expect(listRecoverableFascicoloTerminalDocumentExtractions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    })).resolves.toEqual([{
      terminalJobId: "terminal-new",
      failedAttemptId: "attempt-failed",
    }]);
  });

  it("excludes terminal retries for stale document versions", async () => {
    harness.prisma.asyncJob.findMany.mockResolvedValue([{
      id: "terminal-old-version",
      failureCode: "UNHANDLED_ERROR",
      inputReference: {
        metadata: {
          retryAttemptId: "attempt-failed",
          retryPermitRef: permit.permitRef,
        },
      },
    }]);
    harness.prisma.documentExtractionAttempt.findMany.mockResolvedValue([{
      id: "attempt-failed",
      failureCode: "DIRECT_PARSER_FAILURE",
      documentFileVersionId: "version-1",
      documento: { currentFileVersionId: "version-2" },
    }]);

    await expect(listRecoverableFascicoloTerminalDocumentExtractions({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
    })).resolves.toEqual([]);
  });
});

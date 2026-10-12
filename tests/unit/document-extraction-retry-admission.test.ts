import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  issuePermit: vi.fn(),
  verifyPermit: vi.fn(),
  admit: vi.fn(),
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

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import { ensureAuthorizedDocumentExtractionRetryJob } from "@/server/documents/documentExtractionJob";

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
});

import { describe, expect, it, vi } from "vitest";

import {
  normalizeAsyncJobAdmission,
} from "@/server/async-jobs/domain";
import {
  DOCUMENT_EXTRACTION_OPERATION,
  buildDocumentExtractionAdmission,
  createDocumentExtractionHandler,
} from "@/server/documents/documentExtractionJob";

const authority = {
  admissionType: "AUTHORIZED_SYSTEM" as const,
  tenantId: "tenant-1",
  initiatingUserId: null,
  actorId: "document-extraction-e2e",
  actorEmail: null,
  actorRole: "SYSTEM",
  policyDecisionRef: "DOCUMENT_EXTRACTION_E2E_AUTHORIZATION_V1",
};

function admission() {
  return buildDocumentExtractionAdmission({
    documentoId: "document-1",
    documentFileVersionId: "version-1",
    procedimentoId: "procedure-1",
    correlationId: "document-extraction-test",
    authority,
    availableAt: new Date("2026-10-09T16:30:00.000Z"),
  });
}

describe("DOCUMENT_EXTRACTION_V1", () => {
  it("creates one idempotent direct-document job identity", () => {
    const first = normalizeAsyncJobAdmission(admission());
    const second = normalizeAsyncJobAdmission(admission());
    expect(first.operation).toBe(DOCUMENT_EXTRACTION_OPERATION);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.maxAttempts).toBe(1);
    expect(first.inputReference).toMatchObject({
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: "version-1",
      metadata: {
        documentoId: "document-1",
        procedimentoId: "procedure-1",
        retryAttemptId: null,
        retryPermitRef: null,
      },
    });
  });

  it("executes only the requested version and admits no collateral jobs", async () => {
    const extract = vi.fn().mockResolvedValue({
      reused: false,
      attempt: {
        id: "attempt-1",
        outcome: "SUCCEEDED",
        documentFileVersionId: "version-1",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        failureCode: null,
      },
    });
    const handler = createDocumentExtractionHandler({
      loadJob: vi.fn().mockResolvedValue({
        operation: DOCUMENT_EXTRACTION_OPERATION,
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        initiatingUserId: null,
        actorEmail: null,
        actorRole: "SYSTEM",
      }),
      verifyRetryPermit: vi.fn(),
      extract,
    });
    const reference = handler.parseInput(normalizeAsyncJobAdmission(admission()).inputReference);
    await expect(handler.execute(reference, {
      jobId: "job-1",
      correlationId: "document-extraction-test",
      attempt: 1,
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn(),
    })).resolves.toMatchObject({
      referenceType: "DOCUMENT_EXTRACTION_ATTEMPT",
      referenceId: "attempt-1",
    });
    expect(extract).toHaveBeenCalledOnce();
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      executionKey: "job-1",
      retryAuthorization: null,
    }));
  });

  it("fails closed when job authority and procedure do not match", async () => {
    const extract = vi.fn();
    const handler = createDocumentExtractionHandler({
      loadJob: vi.fn().mockResolvedValue({
        operation: DOCUMENT_EXTRACTION_OPERATION,
        tenantId: "tenant-1",
        procedimentoId: "different-procedure",
        initiatingUserId: null,
        actorEmail: null,
        actorRole: "SYSTEM",
      }),
      verifyRetryPermit: vi.fn(),
      extract,
    });
    const reference = handler.parseInput(normalizeAsyncJobAdmission(admission()).inputReference);
    await expect(handler.execute(reference, {
      jobId: "job-1",
      correlationId: "document-extraction-test",
      attempt: 1,
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn(),
    })).rejects.toMatchObject({ code: "DOCUMENT_EXTRACTION_AUTHORITY_MISMATCH" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects an invented retry permit before extraction", async () => {
    const extract = vi.fn();
    const handler = createDocumentExtractionHandler({
      loadJob: vi.fn().mockResolvedValue({
        operation: DOCUMENT_EXTRACTION_OPERATION,
        tenantId: "tenant-1",
        procedimentoId: "procedure-1",
        initiatingUserId: "user-1",
        actorEmail: "admin@example.test",
        actorRole: "ADMIN",
      }),
      verifyRetryPermit: vi.fn().mockRejectedValue(new Error("PERMIT_NOT_FOUND")),
      extract,
    });
    const reference = handler.parseInput({
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: "version-1",
      referenceVersion: "V1",
      metadata: {
        documentoId: "document-1",
        procedimentoId: "procedure-1",
        policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1",
        retryAttemptId: "attempt-failed",
        retryPermitRef: "a".repeat(64),
      },
    });
    await expect(handler.execute(reference, {
      jobId: "job-retry",
      correlationId: "document-extraction-retry",
      attempt: 1,
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn(),
    })).rejects.toMatchObject({ code: "DOCUMENT_EXTRACTION_RETRY_PERMIT_INVALID" });
    expect(extract).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  normalizeAsyncJobAdmission,
} from "@/server/async-jobs/domain";
import {
  DOCUMENT_EXTRACTION_OPERATION,
  buildDocumentExtractionAdmission,
  createDocumentExtractionHandler,
} from "@/server/documents/documentExtractionJob";
import {
  buildDocumentExtractionAdmission as buildLightweightDocumentExtractionAdmission,
} from "@/server/documents/documentExtractionAdmission";
import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";

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
  it("registers the extraction handler in the separate application worker", () => {
    expect(applicationAsyncJobRegistry.resolve(DOCUMENT_EXTRACTION_OPERATION)).not.toBeNull();
  });

  it("creates one idempotent direct-document job identity", () => {
    const first = normalizeAsyncJobAdmission(admission());
    const second = normalizeAsyncJobAdmission(admission());
    expect(first.operation).toBe(DOCUMENT_EXTRACTION_OPERATION);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.maxAttempts).toBe(3);
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

  it("preserves the normalized admission contract in the lightweight module", () => {
    const legacyCompatible = normalizeAsyncJobAdmission(admission());
    const lightweight = normalizeAsyncJobAdmission(buildLightweightDocumentExtractionAdmission({
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      procedimentoId: "procedure-1",
      correlationId: "document-extraction-test",
      authority,
      availableAt: new Date("2026-10-09T16:30:00.000Z"),
    }));

    expect(lightweight).toEqual(legacyCompatible);
    expect(lightweight.idempotencyKey).toBe(
      "3ac75b45d059511fce1c2c53c10129c9ecf40b483029e50ca148c5407f1c5be5",
    );
    expect(lightweight.requestFingerprint).toBe(
      "350d5e3ca51824855964f3f4690891ed260d8011b4218ccd5350a56db97f27d3",
    );
  });

  it("executes only the requested version and admits no collateral jobs", async () => {
    const ensureFascicoloUpdate = vi.fn().mockResolvedValue({ outcome: "CREATED" });
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
      ensureFascicoloUpdate,
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
    expect(ensureFascicoloUpdate).toHaveBeenCalledWith({
      sourceJobId: "job-1",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      extractionAttemptId: "attempt-1",
    });
  });

  it("marks update admission failures as retryable after successful extraction", async () => {
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
      extract: vi.fn().mockResolvedValue({
        reused: true,
        attempt: {
          id: "attempt-1",
          outcome: "SUCCEEDED",
          failureCode: null,
        },
      }),
      ensureFascicoloUpdate: vi.fn().mockRejectedValue(new Error("DATABASE_INTERRUPTED")),
    });
    const parsed = handler.parseInput(normalizeAsyncJobAdmission(admission()).inputReference);
    await expect(handler.execute(parsed, {
      jobId: "job-1",
      correlationId: "document-extraction-test",
      attempt: 1,
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      heartbeat: vi.fn(),
    })).rejects.toMatchObject({
      code: "FASCICOLO_UPDATE_ADMISSION_FAILED",
      retryable: true,
    });
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
      ensureFascicoloUpdate: vi.fn(),
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
      ensureFascicoloUpdate: vi.fn(),
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

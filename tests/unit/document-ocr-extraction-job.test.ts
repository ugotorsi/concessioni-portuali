import { describe, expect, it } from "vitest";

import {
  createDocumentOcrCoordinatorHandler,
  createDocumentOcrPageBatchHandler,
  DOCUMENT_OCR_COORDINATOR_OPERATION,
  DOCUMENT_OCR_PAGE_BATCH_OPERATION,
} from "@/server/documents/documentOcrExtractionJob";
import { DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2 } from "@/server/documents/documentExtractionPolicy";
import { matchesDocumentOcrBatchScope } from "@/server/documents/documentOcrBatch";

describe("professional document OCR jobs", () => {
  it("accepts a bounded, versioned coordinator reference", () => {
    const handler = createDocumentOcrCoordinatorHandler();
    expect(handler.operation).toBe(DOCUMENT_OCR_COORDINATOR_OPERATION);
    expect(handler.parseInput({
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: "version-1",
      referenceVersion: "V2",
      metadata: {
        documentoId: "document-1",
        procedimentoId: "procedure-1",
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        failedAttemptId: "attempt-direct-failed",
        permitRef: "permit-1",
      },
    })).toMatchObject({
      referenceId: "version-1",
      metadata: { permitRef: "permit-1" },
    });
  });

  it("accepts a page-range checkpoint job with the document page count", () => {
    const handler = createDocumentOcrPageBatchHandler();
    expect(handler.operation).toBe(DOCUMENT_OCR_PAGE_BATCH_OPERATION);
    expect(handler.parseInput({
      referenceType: "DOCUMENT_OCR_RUN",
      referenceId: "run-1",
      referenceVersion: "V2",
      metadata: {
        documentoId: "document-1",
        documentFileVersionId: "version-1",
        procedimentoId: "procedure-1",
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        pageCount: 100,
        firstPageCount: 96,
        lastPageCount: 100,
        permitRef: "permit-1",
      },
    })).toMatchObject({
      referenceId: "run-1",
      metadata: {
        pageCount: 100,
        firstPageCount: 96,
        lastPageCount: 100,
      },
    });
  });

  it("rejects legacy monolithic OCR references", () => {
    const handler = createDocumentOcrCoordinatorHandler();
    expect(() => handler.parseInput({
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: "version-1",
      referenceVersion: "V1",
      metadata: {
        documentoId: "document-1",
        procedimentoId: "procedure-1",
        policyVersion: "DOCUMENT_LOCAL_OCR_EXTRACTION_POLICY_V1",
        failedAttemptId: "attempt-direct-failed",
        authorizationRef: "authorization-1",
      },
    })).toThrow();
  });

  it("requires the batch job to match the persisted tenant, procedure, document, version, and permit", () => {
    const run = {
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      authorizationRef: "permit-1",
    };
    expect(matchesDocumentOcrBatchScope(run, run)).toBe(true);
    for (const mismatch of [
      { tenantId: "tenant-2" },
      { procedimentoId: "procedure-2" },
      { documentoId: "document-2" },
      { documentFileVersionId: "version-2" },
      { authorizationRef: "permit-2" },
    ]) {
      expect(matchesDocumentOcrBatchScope(run, { ...run, ...mismatch })).toBe(false);
    }
  });
});

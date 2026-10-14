import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  asyncJobFindUnique: vi.fn(),
  getCorpusForAsyncJob: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    asyncJob: { findUnique: mocks.asyncJobFindUnique },
  },
}));

vi.mock("@/server/queries/fascicolo-document-corpus", () => ({
  getFascicoloDocumentCorpusForAsyncJob: mocks.getCorpusForAsyncJob,
}));

import {
  createDefaultFascicoloAutomaticAnalysisDependencies,
  ensureFascicoloDocumentCorpusUpdateJob,
  FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";

const authorizedJob = {
  operation: "DOCUMENT_OCR_PAGE_BATCH_V2",
  tenantId: "tenant-a",
  procedimentoId: "procedure-a",
  correlationId: "correlation-a",
  policyDecisionRef: "OCR_PERMIT_A",
  admissionType: "AUTHORIZED_SYSTEM",
  initiatingUserId: null,
  actorId: "ocr-worker",
  actorEmail: null,
  actorRole: "SYSTEM",
};

describe("fascicolo automatic analysis worker corpus authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.asyncJobFindUnique.mockResolvedValue(authorizedJob);
    mocks.getCorpusForAsyncJob.mockResolvedValue(null);
  });

  it("uses the source job identity and authorization to admit a corpus update", async () => {
    await expect(ensureFascicoloDocumentCorpusUpdateJob({
      sourceJobId: "ocr-job-a",
      documentoId: "document-a",
      documentFileVersionId: "version-a",
      extractionAttemptId: "attempt-a",
    })).rejects.toThrow("FASCICOLO_DOCUMENT_CORPUS_NOT_READY");

    expect(mocks.getCorpusForAsyncJob).toHaveBeenCalledWith({
      jobId: "ocr-job-a",
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      operation: "DOCUMENT_OCR_PAGE_BATCH_V2",
      policyDecisionRef: "OCR_PERMIT_A",
      actorId: "ocr-worker",
    });
  });

  it("uses the analysis job identity and authorization while executing the corpus analysis", async () => {
    mocks.asyncJobFindUnique.mockResolvedValue({
      operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      policyDecisionRef: "OCR_PERMIT_A",
      admissionType: "AUTHORIZED_SYSTEM",
      initiatingUserId: null,
      actorId: "ocr-worker",
    });
    const reference = {
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: "c".repeat(64),
      referenceVersion: "V1",
      metadata: {
        procedimentoId: "procedure-a",
        corpusHash: "c".repeat(64),
      },
    } as const;

    const authority = await createDefaultFascicoloAutomaticAnalysisDependencies()
      .loadAuthority({ jobId: "analysis-job-a", reference });

    expect(authority).toBeNull();
    expect(mocks.getCorpusForAsyncJob).toHaveBeenCalledWith({
      jobId: "analysis-job-a",
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
      policyDecisionRef: "OCR_PERMIT_A",
      actorId: "ocr-worker",
    });
  });
});

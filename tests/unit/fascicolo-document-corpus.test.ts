import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  procedimentoFindFirst: vi.fn(),
  documentoFindMany: vi.fn(),
  extractionFindMany: vi.fn(),
  jobFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    procedimento: { findFirst: mocks.procedimentoFindFirst },
    documento: { findMany: mocks.documentoFindMany },
    documentExtractionAttempt: { findMany: mocks.extractionFindMany },
    asyncJob: { findMany: mocks.jobFindMany },
  },
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  isTenantContextConstrained: () => true,
  requireTenantAccess: mocks.requireTenantAccess,
}));

import {
  buildFascicoloDocumentCorpus,
  buildFascicoloDocumentKnowledgeEvidence,
  getFascicoloDocumentCorpus,
  toFascicoloDocumentAnalysisCorpus,
} from "@/server/queries/fascicolo-document-corpus";

const page = (pageNumber: number, text: string, textSha256: string) => ({
  pageNumber,
  normalizedText: text,
  textSha256,
  extractionMethod: "DIRECT_TEXT",
  ocrConfidence: null,
  normalizedCharacterCount: text.length,
});

describe("fascicolo document corpus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentTenantContext.mockResolvedValue({ accessibleTenantIds: ["tenant-a"] });
    mocks.requireTenantAccess.mockImplementation(() => undefined);
    mocks.procedimentoFindFirst.mockResolvedValue({ id: "procedure-a" });
    mocks.documentoFindMany.mockResolvedValue([]);
    mocks.extractionFindMany.mockResolvedValue([]);
    mocks.jobFindMany.mockResolvedValue([]);
  });

  it("builds a deterministic multi-PDF corpus with stable page provenance", () => {
    const input = {
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      documents: [
        {
          id: "document-b",
          nome: "Secondo.pdf",
          currentFileVersionId: "version-b",
          currentFileVersion: { sha256: "b".repeat(64) },
        },
        {
          id: "document-a",
          nome: "Primo.pdf",
          currentFileVersionId: "version-a",
          currentFileVersion: { sha256: "a".repeat(64) },
        },
      ],
      attempts: [
        {
          id: "attempt-b",
          documentoId: "document-b",
          documentFileVersionId: "version-b",
          outcome: "SUCCEEDED",
          sourceSha256: "b".repeat(64),
          failureCode: null,
          pages: [page(1, "Testo B", "2".repeat(64))],
        },
        {
          id: "attempt-a",
          documentoId: "document-a",
          documentFileVersionId: "version-a",
          outcome: "SUCCEEDED",
          sourceSha256: "a".repeat(64),
          failureCode: null,
          pages: [
            page(2, "Pagina due", "1".repeat(64)),
            page(1, "Pagina uno", "0".repeat(64)),
          ],
        },
      ],
    };

    const corpus = buildFascicoloDocumentCorpus(input);
    const repeated = buildFascicoloDocumentCorpus({
      ...input,
      documents: [...input.documents].reverse(),
    });

    expect(corpus.availability).toBe("READY");
    expect(corpus.documents.map((document) => document.reference)).toEqual(["DOCUMENT_1", "DOCUMENT_2"]);
    expect(corpus.excerpts.map((excerpt) => excerpt.reference)).toEqual([
      "DOCUMENT_1.PAGE_1",
      "DOCUMENT_1.PAGE_2",
      "DOCUMENT_2.PAGE_1",
    ]);
    expect(corpus.excerpts[0]).toMatchObject({
      documentoId: "document-a",
      documentVersionId: "version-a",
      extractionAttemptId: "attempt-a",
      artifactSha256: "a".repeat(64),
      textSha256: "0".repeat(64),
    });
    expect(repeated.corpusFingerprint).toBe(corpus.corpusFingerprint);
  });

  it("uses only current-version successful attempts and reports failed or missing documents", async () => {
    mocks.documentoFindMany.mockResolvedValue([
      {
        id: "document-a",
        nome: "Disponibile.pdf",
        currentFileVersionId: "version-current",
        currentFileVersion: { sha256: "a".repeat(64) },
      },
      {
        id: "document-b",
        nome: "Fallito.pdf",
        currentFileVersionId: "version-b",
        currentFileVersion: { sha256: "b".repeat(64) },
      },
      {
        id: "document-c",
        nome: "Non estratto.pdf",
        currentFileVersionId: "version-c",
        currentFileVersion: { sha256: "c".repeat(64) },
      },
    ]);
    mocks.extractionFindMany.mockResolvedValue([
      {
        id: "attempt-current",
        documentoId: "document-a",
        documentFileVersionId: "version-current",
        outcome: "SUCCEEDED",
        sourceSha256: "a".repeat(64),
        failureCode: null,
        pages: [page(1, "Corrente", "0".repeat(64))],
      },
      {
        id: "attempt-failed",
        documentoId: "document-b",
        documentFileVersionId: "version-b",
        outcome: "FAILED",
        sourceSha256: "b".repeat(64),
        failureCode: "OCR_REQUIRED",
        pages: [],
      },
    ]);

    const corpus = await getFascicoloDocumentCorpus({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
    });

    expect(mocks.extractionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-a",
        procedimentoId: "procedure-a",
        OR: [
          { documentoId: "document-a", documentFileVersionId: "version-current" },
          { documentoId: "document-b", documentFileVersionId: "version-b" },
          { documentoId: "document-c", documentFileVersionId: "version-c" },
        ],
      },
    }));
    expect(corpus).toMatchObject({
      availability: "PARTIAL",
      documentCount: 3,
      availableDocumentCount: 1,
      textPageCount: 1,
    });
    expect(corpus?.documents.map((document) => document.status)).toEqual([
      "AVAILABLE",
      "OCR_REQUIRED",
      "NOT_EXTRACTED",
    ]);
    expect(JSON.stringify(corpus)).not.toContain("version-previous");
  });

  it("classifies a terminal extraction job without a persisted attempt as failed", async () => {
    mocks.documentoFindMany.mockResolvedValue([{
      id: "document-a",
      nome: "Fallito.pdf",
      currentFileVersionId: "version-a",
      currentFileVersion: { sha256: "a".repeat(64) },
    }]);
    mocks.jobFindMany.mockResolvedValue([{
      logicalOperationId: "document-a:version-a:DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1:initial",
      status: "TERMINAL_FAILED",
      failureCode: "RETRY_EXHAUSTED",
    }]);

    const corpus = await getFascicoloDocumentCorpus({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
    });

    expect(corpus?.documents[0]).toMatchObject({
      status: "EXTRACTION_FAILED",
      failureCode: "RETRY_EXHAUSTED",
      extractionAttemptId: null,
    });
    expect(mocks.jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: "tenant-a",
        procedimentoId: "procedure-a",
        logicalOperationId: {
          in: ["document-a:version-a:DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1:initial"],
        },
      }),
    }));
  });

  it("rejects unauthorized tenant access before querying documents or extraction text", async () => {
    mocks.requireTenantAccess.mockImplementation(() => {
      throw new Error("TENANT_ACCESS_DENIED");
    });

    await expect(getFascicoloDocumentCorpus({
      tenantId: "tenant-b",
      procedimentoId: "procedure-a",
    })).rejects.toThrow("TENANT_ACCESS_DENIED");
    expect(mocks.procedimentoFindFirst).not.toHaveBeenCalled();
    expect(mocks.documentoFindMany).not.toHaveBeenCalled();
    expect(mocks.extractionFindMany).not.toHaveBeenCalled();
  });

  it("does not cross procedure scope and returns no corpus for a mismatched procedure", async () => {
    mocks.procedimentoFindFirst.mockResolvedValue(null);

    const corpus = await getFascicoloDocumentCorpus({
      tenantId: "tenant-a",
      procedimentoId: "procedure-other",
    });

    expect(corpus).toBeNull();
    expect(mocks.procedimentoFindFirst).toHaveBeenCalledWith({
      where: { id: "procedure-other", enteId: "tenant-a" },
      select: { id: true },
    });
    expect(mocks.documentoFindMany).not.toHaveBeenCalled();
    expect(mocks.extractionFindMany).not.toHaveBeenCalled();
  });

  it("provides the existing document-analysis corpus fields without a Neutral Intake identity", () => {
    const corpus = buildFascicoloDocumentCorpus({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      documents: [{
        id: "document-a",
        nome: "Documento.pdf",
        currentFileVersionId: "version-a",
        currentFileVersion: { sha256: "a".repeat(64) },
      }],
      attempts: [{
        id: "attempt-a",
        documentoId: "document-a",
        documentFileVersionId: "version-a",
        outcome: "SUCCEEDED",
        sourceSha256: "a".repeat(64),
        failureCode: null,
        pages: [page(1, "Testo", "0".repeat(64))],
      }],
    });

    const analysisCorpus = toFascicoloDocumentAnalysisCorpus(corpus);

    expect(analysisCorpus).toEqual({
      corpusFingerprint: corpus.corpusFingerprint,
      documents: [{
        documentVersionId: "version-a",
        artifactSha256: "a".repeat(64),
      }],
      excerpts: corpus.excerpts,
    });
    expect(analysisCorpus).not.toHaveProperty("neutralIntakeId");
    expect(buildFascicoloDocumentKnowledgeEvidence(corpus).get("DOCUMENT_1.PAGE_1")).toEqual({
      provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION",
      documentoId: "document-a",
      documentFileVersionId: "version-a",
      documentExtractionAttemptId: "attempt-a",
      pageNumber: 1,
      textSha256: "0".repeat(64),
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    });
  });
});

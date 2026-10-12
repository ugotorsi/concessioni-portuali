import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentTenantContext: vi.fn(),
  requireTenantAccess: vi.fn(),
  extractionFindMany: vi.fn(),
  jobFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    documentExtractionAttempt: {
      findMany: mocks.extractionFindMany,
    },
    asyncJob: {
      findMany: mocks.jobFindMany,
    },
  },
}));

vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  isTenantContextConstrained: () => true,
  requireTenantAccess: mocks.requireTenantAccess,
}));

import { getDocumentExtractionReadModels } from "@/server/queries/document-extractions";

const scope = {
  tenantId: "tenant-a",
  procedimentoId: "procedure-a",
  documents: [{ documentId: "document-a", currentFileVersionId: "version-current" }],
};

describe("document extraction read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentTenantContext.mockResolvedValue({
      accessibleTenantIds: ["tenant-a"],
    });
    mocks.requireTenantAccess.mockImplementation(() => undefined);
    mocks.extractionFindMany.mockResolvedValue([]);
    mocks.jobFindMany.mockResolvedValue([]);
  });

  it("reads persisted pages for the current document version in tenant scope", async () => {
    mocks.extractionFindMany.mockResolvedValue([
      {
        id: "attempt-a",
        documentoId: "document-a",
        documentFileVersionId: "version-current",
        outcome: "SUCCEEDED",
        policyVersion: "policy-1",
        failureCode: null,
        failureMessage: null,
        directExtractorName: "pdfjs",
        directExtractorVersion: "5.4.149",
        ocrExtractorName: null,
        ocrExtractorVersion: null,
        rasterizerName: null,
        rasterizerVersion: null,
        pages: [
          {
            pageNumber: 1,
            extractionMethod: "DIRECT_TEXT",
            text: "Testo persistito",
            normalizedCharacterCount: 377,
            ocrConfidence: null,
          },
        ],
      },
    ]);

    const result = await getDocumentExtractionReadModels(scope);

    expect(mocks.extractionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-a",
        procedimentoId: "procedure-a",
        OR: [{ documentoId: "document-a", documentFileVersionId: "version-current" }],
      },
    }));
    expect(result["document-a"]).toMatchObject({
      status: "AVAILABLE",
      versionId: "version-current",
      pageCount: 1,
      characterCount: 377,
      methods: ["DIRECT_TEXT"],
      pages: [{ pageNumber: 1, text: "Testo persistito" }],
    });
  });

  it("does not request or return attempts for a previous version", async () => {
    await getDocumentExtractionReadModels(scope);

    const query = mocks.extractionFindMany.mock.calls[0][0];
    expect(query.where.OR).toEqual([
      { documentoId: "document-a", documentFileVersionId: "version-current" },
    ]);
    expect(JSON.stringify(query)).not.toContain("version-previous");
  });

  it("returns a comprehensible empty state when no attempt exists", async () => {
    const result = await getDocumentExtractionReadModels(scope);

    expect(result["document-a"]).toEqual(expect.objectContaining({
      status: "NOT_RUN",
      versionId: "version-current",
      pages: [],
      pageCount: 0,
    }));
  });

  it("applies tenant authorization before reading extraction text", async () => {
    mocks.requireTenantAccess.mockImplementation(() => {
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    });

    await expect(getDocumentExtractionReadModels(scope)).rejects.toThrow(
      "Operazione non autorizzata per il tenant corrente.",
    );
    expect(mocks.extractionFindMany).not.toHaveBeenCalled();
    expect(mocks.jobFindMany).not.toHaveBeenCalled();
  });

  it("exposes OCR_REQUIRED and failed states without pages from other results", async () => {
    mocks.extractionFindMany.mockResolvedValue([
      {
        id: "attempt-ocr",
        documentoId: "document-a",
        documentFileVersionId: "version-current",
        outcome: "FAILED",
        policyVersion: "policy-1",
        failureCode: "OCR_REQUIRED",
        failureMessage: "OCR required",
        directExtractorName: null,
        directExtractorVersion: null,
        ocrExtractorName: null,
        ocrExtractorVersion: null,
        rasterizerName: null,
        rasterizerVersion: null,
        pages: [],
      },
    ]);

    const result = await getDocumentExtractionReadModels(scope);

    expect(result["document-a"]).toMatchObject({
      status: "OCR_REQUIRED",
      failureCode: "OCR_REQUIRED",
      pages: [],
    });
  });

  it("exposes a failed extraction distinctly from OCR_REQUIRED", async () => {
    mocks.extractionFindMany.mockResolvedValue([
      {
        id: "attempt-failed",
        documentoId: "document-a",
        documentFileVersionId: "version-current",
        outcome: "FAILED",
        policyVersion: "policy-1",
        failureCode: "UNSUPPORTED_MIME_TYPE",
        failureMessage: "Unsupported document",
        directExtractorName: null,
        directExtractorVersion: null,
        ocrExtractorName: null,
        ocrExtractorVersion: null,
        rasterizerName: null,
        rasterizerVersion: null,
        pages: [],
      },
    ]);

    const result = await getDocumentExtractionReadModels(scope);

    expect(result["document-a"]).toMatchObject({
      status: "FAILED",
      failureCode: "UNSUPPORTED_MIME_TYPE",
      pages: [],
    });
  });

  it.each([
    ["QUEUED", "PENDING"],
    ["RUNNING", "PROCESSING"],
    ["TERMINAL_FAILED", "FAILED"],
  ] as const)("maps extraction job state %s to %s without exposing another document", async (jobStatus, status) => {
    mocks.jobFindMany.mockResolvedValue([
      {
        logicalOperationId: "document-a:version-current:DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1:initial",
        status: jobStatus,
        failureCode: jobStatus === "TERMINAL_FAILED" ? "EXTRACTION_FAILED" : null,
      },
      {
        logicalOperationId: "document-other:version-other:DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1:initial",
        status: "RUNNING",
        failureCode: null,
      },
    ]);

    const result = await getDocumentExtractionReadModels(scope);

    expect(mocks.jobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        operation: "DOCUMENT_EXTRACTION_V1",
        tenantId: "tenant-a",
        procedimentoId: "procedure-a",
        logicalOperationId: {
          in: ["document-a:version-current:DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1:initial"],
        },
      }),
    }));
    expect(result["document-a"]).toMatchObject({ status, jobStatus });
    expect(result["document-other"]).toBeUndefined();
  });
});

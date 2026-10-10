import { prisma } from "@/lib/prisma";
import {
  getCurrentTenantContext,
  isTenantContextConstrained,
  requireTenantAccess,
} from "@/lib/tenant-auth";
import {
  DOCUMENT_EXTRACTION_OPERATION,
  documentExtractionLogicalOperationId,
} from "@/server/documents/documentExtractionJob";

export type DocumentExtractionReadModel = {
  status: "AVAILABLE" | "NOT_RUN" | "PENDING" | "PROCESSING" | "OCR_REQUIRED" | "FAILED";
  versionId: string | null;
  attemptId: string | null;
  outcome: string | null;
  policyVersion: string | null;
  methods: string[];
  pageCount: number;
  characterCount: number;
  provenance: string[];
  failureCode: string | null;
  failureMessage: string | null;
  jobStatus: string | null;
  pages: Array<{
    pageNumber: number;
    method: string;
    text: string;
    characterCount: number;
    ocrConfidence: number | null;
  }>;
};

type DocumentVersionScope = {
  documentId: string;
  currentFileVersionId: string | null;
};

function emptyResult(versionId: string | null): DocumentExtractionReadModel {
  return {
    status: "NOT_RUN",
    versionId,
    attemptId: null,
    outcome: null,
    policyVersion: null,
    methods: [],
    pageCount: 0,
    characterCount: 0,
    provenance: [],
    failureCode: null,
    failureMessage: null,
    jobStatus: null,
    pages: [],
  };
}

export async function getDocumentExtractionReadModels(input: {
  tenantId: string;
  procedimentoId: string;
  documents: DocumentVersionScope[];
}): Promise<Record<string, DocumentExtractionReadModel>> {
  const tenantContext = await getCurrentTenantContext();
  if (tenantContext && isTenantContextConstrained(tenantContext)) {
    requireTenantAccess(tenantContext, input.tenantId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  }

  const results = Object.fromEntries(
    input.documents.map((document) => [
      document.documentId,
      emptyResult(document.currentFileVersionId),
    ]),
  );
  const versionedDocuments = input.documents.filter(
    (document): document is DocumentVersionScope & { currentFileVersionId: string } =>
      document.currentFileVersionId !== null,
  );

  if (versionedDocuments.length === 0) {
    return results;
  }

  const attempts = await prisma.documentExtractionAttempt.findMany({
    where: {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      OR: versionedDocuments.map((document) => ({
        documentoId: document.documentId,
        documentFileVersionId: document.currentFileVersionId,
      })),
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    include: {
      pages: {
        orderBy: { pageNumber: "asc" },
      },
    },
  });
  const logicalOperationByDocumentId = new Map(
    versionedDocuments.map((document) => [
      document.documentId,
      documentExtractionLogicalOperationId({
        documentoId: document.documentId,
        documentFileVersionId: document.currentFileVersionId,
      }),
    ]),
  );
  const documentIdByLogicalOperation = new Map(
    [...logicalOperationByDocumentId.entries()].map(([documentId, logicalOperationId]) => [
      logicalOperationId,
      documentId,
    ]),
  );
  const jobs = await prisma.asyncJob.findMany({
    where: {
      operation: DOCUMENT_EXTRACTION_OPERATION,
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      logicalOperationId: { in: [...documentIdByLogicalOperation.keys()] },
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      logicalOperationId: true,
      status: true,
      failureCode: true,
    },
  });

  for (const job of jobs) {
    const documentId = documentIdByLogicalOperation.get(job.logicalOperationId);
    if (!documentId || results[documentId].jobStatus !== null) {
      continue;
    }
    const status = job.status === "QUEUED" || job.status === "RETRY_WAIT"
      ? "PENDING"
      : job.status === "RUNNING" || job.status === "CANCELLATION_REQUESTED"
        ? "PROCESSING"
        : job.status === "TERMINAL_FAILED" || job.status === "CANCELLED"
          ? "FAILED"
          : "PENDING";
    results[documentId] = {
      ...results[documentId],
      status,
      failureCode: job.failureCode,
      jobStatus: job.status,
    };
  }

  for (const attempt of attempts) {
    if (results[attempt.documentoId]?.attemptId) {
      continue;
    }

    const pages = attempt.pages.map((page) => ({
      pageNumber: page.pageNumber,
      method: page.extractionMethod,
      text: page.text,
      characterCount: page.normalizedCharacterCount,
      ocrConfidence: page.ocrConfidence,
    }));
    const methods = [...new Set(pages.map((page) => page.method))];
    const provenance = [
      attempt.directExtractorName
        ? `${attempt.directExtractorName}${attempt.directExtractorVersion ? ` ${attempt.directExtractorVersion}` : ""}`
        : null,
      attempt.ocrExtractorName
        ? `${attempt.ocrExtractorName}${attempt.ocrExtractorVersion ? ` ${attempt.ocrExtractorVersion}` : ""}`
        : null,
      attempt.rasterizerName
        ? `${attempt.rasterizerName}${attempt.rasterizerVersion ? ` ${attempt.rasterizerVersion}` : ""}`
        : null,
    ].filter((value): value is string => value !== null);
    const ocrRequired = attempt.failureCode === "OCR_REQUIRED";

    results[attempt.documentoId] = {
      status: attempt.outcome === "SUCCEEDED" ? "AVAILABLE" : ocrRequired ? "OCR_REQUIRED" : "FAILED",
      versionId: attempt.documentFileVersionId,
      attemptId: attempt.id,
      outcome: attempt.outcome,
      policyVersion: attempt.policyVersion,
      methods,
      pageCount: pages.length,
      characterCount: pages.reduce((total, page) => total + page.characterCount, 0),
      provenance,
      failureCode: attempt.failureCode,
      failureMessage: attempt.failureMessage,
      jobStatus: results[attempt.documentoId]?.jobStatus ?? null,
      pages,
    };
  }

  return results;
}

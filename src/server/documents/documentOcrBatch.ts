import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import { readDocumentFileBoundedFromProvider } from "@/server/documents/storage";
import { ExtractionFailure } from "@/server/intake/extraction/errors";
import { TesseractItalianOcrAdapter } from "@/server/intake/extraction/ocrAdapter";
import { PdfJsExtractionAdapter } from "@/server/intake/extraction/pdfAdapter";
import { B2C9_EXTRACTION_POLICY_V1 } from "@/server/intake/extraction/policy";
import {
  extractTechnicalDocumentPageRange,
  inspectTechnicalPdfPageCount,
} from "@/server/intake/extraction/technicalExtractor";
import type { ExtractedPageEvidence } from "@/server/intake/extraction/types";

import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
  DOCUMENT_OCR_BATCH_LIMITS_V2,
} from "./documentExtractionPolicy";

export const DOCUMENT_OCR_TECHNICAL_POLICY_V2 = Object.freeze({
  ...B2C9_EXTRACTION_POLICY_V1,
  version: "DOCUMENT_OCR_TECHNICAL_POLICY_V2",
  maxArtifactBytes: DOCUMENT_OCR_BATCH_LIMITS_V2.maxArtifactBytes,
  maxPdfPages: DOCUMENT_OCR_BATCH_LIMITS_V2.maxPdfPages,
  maxImagePixels: DOCUMENT_OCR_BATCH_LIMITS_V2.maxImagePixels,
  ocrTimeoutMsPerPage: DOCUMENT_OCR_BATCH_LIMITS_V2.ocrTimeoutMsPerPage,
});

const OCR_SOURCE_FAILURES = new Set(["OCR_REQUIRED", "ARTIFACT_TOO_LARGE"]);

type OcrActor = {
  userId: string;
  userEmail: string | null;
  userRole: string;
};

export type DocumentOcrManifest = {
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  sourceAttemptId: string;
  authorizationRef: string;
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
};

export class DocumentOcrBatchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DocumentOcrBatchError";
  }
}

export function matchesDocumentOcrBatchScope(
  run: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    procedimentoId: string;
    authorizationRef: string;
  },
  expected: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    procedimentoId: string;
    authorizationRef: string;
  },
): boolean {
  return run.documentoId === expected.documentoId
    && run.documentFileVersionId === expected.documentFileVersionId
    && run.tenantId === expected.tenantId
    && run.procedimentoId === expected.procedimentoId
    && run.authorizationRef === expected.authorizationRef;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function assertStorageProvider(value: string): "local" | "s3" {
  if (value !== "local" && value !== "s3") {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_MANIFEST_MISMATCH");
  }
  return value;
}

export async function inspectDocumentOcrManifest(input: {
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  sourceAttemptId: string;
  authorizationRef: string;
}): Promise<DocumentOcrManifest> {
  const document = await prisma.documento.findUnique({
    where: { id: input.documentoId },
    select: {
      id: true,
      enteId: true,
      procedimentoId: true,
      currentFileVersionId: true,
      currentFileVersion: {
        select: {
          id: true,
          documentId: true,
          canonicalEnteId: true,
          storageProvider: true,
          storageBucket: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
        },
      },
    },
  });
  const sourceAttempt = await prisma.documentExtractionAttempt.findUnique({
    where: { id: input.sourceAttemptId },
    select: {
      id: true,
      documentoId: true,
      documentFileVersionId: true,
      tenantId: true,
      procedimentoId: true,
      policyVersion: true,
      outcome: true,
      failureCode: true,
    },
  });
  const version = document?.currentFileVersion;
  if (
    !document
    || document.enteId !== input.tenantId
    || document.procedimentoId !== input.procedimentoId
    || document.currentFileVersionId !== input.documentFileVersionId
    || !version
    || version.id !== input.documentFileVersionId
    || version.documentId !== input.documentoId
    || version.canonicalEnteId !== input.tenantId
    || !sourceAttempt
    || sourceAttempt.documentoId !== input.documentoId
    || sourceAttempt.documentFileVersionId !== input.documentFileVersionId
    || sourceAttempt.tenantId !== input.tenantId
    || sourceAttempt.procedimentoId !== input.procedimentoId
    || sourceAttempt.policyVersion !== DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1
    || sourceAttempt.outcome !== "FAILED"
    || !OCR_SOURCE_FAILURES.has(sourceAttempt.failureCode ?? "")
  ) {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_SOURCE_MISMATCH");
  }
  if (version.sizeBytes > DOCUMENT_OCR_BATCH_LIMITS_V2.maxArtifactBytes) {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_ARTIFACT_TOO_LARGE");
  }
  const storageProvider = assertStorageProvider(version.storageProvider);
  const stored = await readDocumentFileBoundedFromProvider({
    storageProvider,
    storageBucket: version.storageBucket,
    storageKey: version.storageKey,
    maxBytes: DOCUMENT_OCR_BATCH_LIMITS_V2.maxArtifactBytes,
  });
  if (stored.disposition !== "FOUND") {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_STORAGE_READ_FAILURE");
  }
  const technicalInput = {
    bytes: stored.body,
    declaredMimeType: version.mimeType,
    expectedSha256: version.sha256,
    expectedSizeBytes: version.sizeBytes,
  };
  let pageCount: number;
  try {
    pageCount = await inspectTechnicalPdfPageCount(technicalInput, {
      policy: DOCUMENT_OCR_TECHNICAL_POLICY_V2,
    });
  } catch (error) {
    if (error instanceof ExtractionFailure) throw error;
    throw new DocumentOcrBatchError("DOCUMENT_OCR_PREFLIGHT_FAILED");
  }
  return {
    documentoId: input.documentoId,
    documentFileVersionId: input.documentFileVersionId,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    sourceAttemptId: input.sourceAttemptId,
    authorizationRef: input.authorizationRef,
    storageProvider,
    storageBucket: version.storageBucket,
    storageKey: version.storageKey,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
    pageCount,
  };
}

export async function ensureDocumentOcrRunInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    coordinatorJobId: string;
    manifest: DocumentOcrManifest;
  },
) {
  const existing = await tx.documentOcrRun.findUnique({
    where: {
      documentFileVersionId_policyVersion: {
        documentFileVersionId: input.manifest.documentFileVersionId,
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
      },
    },
  });
  if (existing) {
    if (
      existing.documentoId !== input.manifest.documentoId
      || existing.tenantId !== input.manifest.tenantId
      || existing.procedimentoId !== input.manifest.procedimentoId
      || existing.sourceAttemptId !== input.manifest.sourceAttemptId
      || existing.authorizationRef !== input.manifest.authorizationRef
      || existing.sourceSha256 !== input.manifest.sha256
      || existing.sourceSizeBytes !== input.manifest.sizeBytes
      || existing.pageCount !== input.manifest.pageCount
      || existing.batchSize !== DOCUMENT_OCR_BATCH_LIMITS_V2.pagesPerBatch
    ) {
      throw new DocumentOcrBatchError("DOCUMENT_OCR_RUN_IDENTITY_MISMATCH");
    }
    return existing;
  }
  return tx.documentOcrRun.create({
    data: {
      id: randomUUID(),
      coordinatorJobId: input.coordinatorJobId,
      documentoId: input.manifest.documentoId,
      documentFileVersionId: input.manifest.documentFileVersionId,
      tenantId: input.manifest.tenantId,
      procedimentoId: input.manifest.procedimentoId,
      sourceAttemptId: input.manifest.sourceAttemptId,
      authorizationRef: input.manifest.authorizationRef,
      policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
      sourceSha256: input.manifest.sha256,
      sourceSizeBytes: input.manifest.sizeBytes,
      declaredMimeType: input.manifest.mimeType,
      pageCount: input.manifest.pageCount,
      batchSize: DOCUMENT_OCR_BATCH_LIMITS_V2.pagesPerBatch,
    },
  });
}

function checkpointMatches(existing: {
  extractionMethod: string;
  text: string;
  normalizedText: string;
  textSha256: string;
  normalizedCharacterCount: number;
  ocrConfidence: number | null;
  warnings: unknown;
}, page: ExtractedPageEvidence): boolean {
  return existing.extractionMethod === page.method
    && existing.text === page.text
    && existing.normalizedText === page.normalizedText
    && existing.textSha256 === page.textSha256
    && existing.normalizedCharacterCount === page.normalizedCharacterCount
    && existing.ocrConfidence === page.ocrConfidence
    && JSON.stringify(existing.warnings ?? []) === JSON.stringify(page.warnings);
}

async function persistPageCheckpoint(input: {
  runId: string;
  page: ExtractedPageEvidence;
  pdf: PdfJsExtractionAdapter;
  ocr: TesseractItalianOcrAdapter;
}): Promise<void> {
  await runSerializableTransactionWithRetry(async (tx) => {
    const existing = await tx.documentOcrPageCheckpoint.findUnique({
      where: {
        runId_pageNumber: {
          runId: input.runId,
          pageNumber: input.page.pageNumber,
        },
      },
    });
    if (existing) {
      if (!checkpointMatches(existing, input.page)) {
        throw new DocumentOcrBatchError("DOCUMENT_OCR_CHECKPOINT_CONFLICT");
      }
      return;
    }
    const run = await tx.documentOcrRun.findUnique({ where: { id: input.runId } });
    if (!run || run.status === "FAILED") {
      throw new DocumentOcrBatchError("DOCUMENT_OCR_RUN_NOT_RESUMABLE");
    }
    await tx.documentOcrPageCheckpoint.create({
      data: {
        runId: input.runId,
        pageNumber: input.page.pageNumber,
        extractionMethod: input.page.method,
        text: input.page.text,
        normalizedText: input.page.normalizedText,
        textSha256: input.page.textSha256,
        normalizedCharacterCount: input.page.normalizedCharacterCount,
        ocrConfidence: input.page.ocrConfidence,
        warnings: json(input.page.warnings),
        directExtractorName: input.pdf.name,
        directExtractorVersion: input.pdf.version,
        ocrExtractorName: input.page.method === "OCR" ? input.ocr.name : null,
        ocrExtractorVersion: input.page.method === "OCR" ? input.ocr.version : null,
        rasterizerName: input.page.method === "OCR" ? input.pdf.rasterizerName : null,
        rasterizerVersion: input.page.method === "OCR" ? input.pdf.rasterizerVersion : null,
      },
    });
    await tx.documentOcrRun.update({
      where: { id: input.runId },
      data: {
        status: "PROCESSING",
        startedAt: run.startedAt ?? new Date(),
        completedPageCount: { increment: 1 },
      },
    });
  });
}

async function finalizeDocumentOcrRun(runId: string, actor: OcrActor) {
  return runSerializableTransactionWithRetry(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "DocumentOcrRun" WHERE "id" = ${runId} FOR UPDATE
    `);
    if (!locked) throw new DocumentOcrBatchError("DOCUMENT_OCR_RUN_NOT_FOUND");
    const run = await tx.documentOcrRun.findUnique({
      where: { id: runId },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    });
    if (!run) throw new DocumentOcrBatchError("DOCUMENT_OCR_RUN_NOT_FOUND");
    if (run.status === "SUCCEEDED" && run.extractionAttemptId) {
      return { completed: true as const, extractionAttemptId: run.extractionAttemptId };
    }
    if (run.pages.length !== run.pageCount) {
      return { completed: false as const, extractionAttemptId: null };
    }
    for (let index = 0; index < run.pages.length; index += 1) {
      if (run.pages[index]?.pageNumber !== index + 1) {
        throw new DocumentOcrBatchError("DOCUMENT_OCR_PAGE_SET_INCOMPLETE");
      }
    }
    const extractionAttemptId = randomUUID();
    const ocrUsed = run.pages.some((page) => page.extractionMethod === "OCR");
    const attempt = await tx.documentExtractionAttempt.create({
      data: {
        id: extractionAttemptId,
        executionKey: run.coordinatorJobId,
        documentoId: run.documentoId,
        documentFileVersionId: run.documentFileVersionId,
        tenantId: run.tenantId,
        procedimentoId: run.procedimentoId,
        policyVersion: run.policyVersion,
        retryOfAttemptId: run.sourceAttemptId,
        retryAuthorizationId: run.authorizationRef,
        outcome: "SUCCEEDED",
        sourceSha256: run.sourceSha256,
        declaredMimeType: run.declaredMimeType,
        detectedMimeType: "application/pdf",
        sourceSizeBytes: run.sourceSizeBytes,
        startedAt: run.startedAt ?? run.createdAt,
        completedAt: new Date(),
        directExtractorName: run.pages[0]?.directExtractorName,
        directExtractorVersion: run.pages[0]?.directExtractorVersion,
        ocrExtractorName: ocrUsed ? run.pages.find((page) => page.ocrExtractorName)?.ocrExtractorName : null,
        ocrExtractorVersion: ocrUsed ? run.pages.find((page) => page.ocrExtractorVersion)?.ocrExtractorVersion : null,
        rasterizerName: ocrUsed ? run.pages.find((page) => page.rasterizerName)?.rasterizerName : null,
        rasterizerVersion: ocrUsed ? run.pages.find((page) => page.rasterizerVersion)?.rasterizerVersion : null,
        warnings: json([]),
        technicalMetadata: json({
          ocrRunId: run.id,
          pageCount: run.pageCount,
          batchSize: run.batchSize,
        }),
        pages: {
          create: run.pages.map((page) => ({
            pageNumber: page.pageNumber,
            extractionMethod: page.extractionMethod,
            text: page.text,
            normalizedText: page.normalizedText,
            textSha256: page.textSha256,
            normalizedCharacterCount: page.normalizedCharacterCount,
            ocrConfidence: page.ocrConfidence,
            warnings: json(page.warnings ?? []),
            technicalMetadata: json({ ocrRunId: run.id }),
          })),
        },
      },
    });
    await tx.documentOcrRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        extractionAttemptId: attempt.id,
        completedAt: attempt.completedAt,
      },
    });
    await createAuditLogInTransaction(tx, {
      azione: "DOCUMENT_OCR_EXTRACTION",
      entita: "Documento",
      entitaId: run.documentoId,
      enteId: run.tenantId,
      esito: "SUCCESS",
      actor,
      metadata: {
        documentFileVersionId: run.documentFileVersionId,
        procedimentoId: run.procedimentoId,
        policyVersion: run.policyVersion,
        sourceAttemptId: run.sourceAttemptId,
        authorizationRef: run.authorizationRef,
        pageCount: run.pageCount,
        extractionAttemptId: attempt.id,
      },
    });
    return { completed: true as const, extractionAttemptId: attempt.id };
  });
}

export async function processDocumentOcrBatch(input: {
  runId: string;
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  authorizationRef: string;
  firstPage: number;
  lastPage: number;
  actor: OcrActor;
  onPageCompleted?: () => Promise<void>;
}) {
  const run = await prisma.documentOcrRun.findUnique({
    where: { id: input.runId },
    include: {
      documento: {
        select: { currentFileVersionId: true },
      },
      pages: {
        where: { pageNumber: { gte: input.firstPage, lte: input.lastPage } },
        select: { pageNumber: true },
      },
      documentFileVersion: {
        select: {
          storageProvider: true,
          storageBucket: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
          documentId: true,
          canonicalEnteId: true,
        },
      },
    },
  });
  if (
    !run
    || run.status === "FAILED"
    || !matchesDocumentOcrBatchScope(run, input)
    || input.firstPage < 1
    || input.lastPage < input.firstPage
    || input.lastPage > run.pageCount
    || input.lastPage - input.firstPage + 1 > run.batchSize
    || run.documento.currentFileVersionId !== run.documentFileVersionId
    || run.documentFileVersion.documentId !== run.documentoId
    || run.documentFileVersion.canonicalEnteId !== run.tenantId
    || run.documentFileVersion.sha256 !== run.sourceSha256
    || run.documentFileVersion.sizeBytes !== run.sourceSizeBytes
  ) {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_BATCH_SCOPE_MISMATCH");
  }
  if (run.status === "SUCCEEDED" && run.extractionAttemptId) {
    return { completed: true as const, extractionAttemptId: run.extractionAttemptId, processedPages: 0 };
  }
  const storageProvider = assertStorageProvider(run.documentFileVersion.storageProvider);
  const stored = await readDocumentFileBoundedFromProvider({
    storageProvider,
    storageBucket: run.documentFileVersion.storageBucket,
    storageKey: run.documentFileVersion.storageKey,
    maxBytes: DOCUMENT_OCR_BATCH_LIMITS_V2.maxArtifactBytes,
  });
  if (stored.disposition !== "FOUND") {
    throw new DocumentOcrBatchError("DOCUMENT_OCR_STORAGE_READ_FAILURE");
  }
  const pdf = new PdfJsExtractionAdapter();
  const ocr = new TesseractItalianOcrAdapter();
  const completedPages = new Set(run.pages.map((page) => page.pageNumber));
  const result = await extractTechnicalDocumentPageRange({
    bytes: stored.body,
    declaredMimeType: run.documentFileVersion.mimeType,
    expectedSha256: run.sourceSha256,
    expectedSizeBytes: run.sourceSizeBytes,
  }, {
    firstPage: input.firstPage,
    lastPage: input.lastPage,
    skipPageNumbers: completedPages,
    onPage: async (page) => {
      await persistPageCheckpoint({ runId: run.id, page, pdf, ocr });
      await input.onPageCompleted?.();
    },
  }, {
    pdf,
    ocr,
    ocrMode: "ENABLED",
    policy: DOCUMENT_OCR_TECHNICAL_POLICY_V2,
  });
  const finalized = await finalizeDocumentOcrRun(run.id, input.actor);
  return {
    ...finalized,
    processedPages: result.pages.length,
  };
}

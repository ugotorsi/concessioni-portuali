import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  getCurrentTenantContext,
  isTenantContextConstrained,
  requireTenantAccess,
} from "@/lib/tenant-auth";
import type {
  FascicoloDocumentAnalysisInput,
  FascicoloDocumentExcerpt,
} from "@/server/ai/fascicoloDocumentAnalysis";
import type { KnowledgeEvidenceCandidate } from "@/server/fascicolo-knowledge";
import {
  DOCUMENT_EXTRACTION_OPERATION,
  documentExtractionLogicalOperationId,
} from "@/server/documents/documentExtractionAdmission";

export type FascicoloDocumentCorpusDocumentStatus =
  | "AVAILABLE"
  | "NOT_EXTRACTED"
  | "OCR_REQUIRED"
  | "EXTRACTION_FAILED"
  | "NO_CURRENT_VERSION";

export interface FascicoloDocumentCorpusDocument {
  readonly reference: string;
  readonly documentoId: string;
  readonly name: string;
  readonly documentFileVersionId: string | null;
  readonly extractionAttemptId: string | null;
  readonly sourceSha256: string | null;
  readonly status: FascicoloDocumentCorpusDocumentStatus;
  readonly failureCode: string | null;
  readonly pageCount: number;
  readonly characterCount: number;
}

export interface FascicoloDocumentCorpusExcerpt extends FascicoloDocumentExcerpt {
  readonly documentoId: string;
  readonly extractionAttemptId: string;
}

export interface FascicoloDocumentCorpus {
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly corpusFingerprint: string;
  readonly availability: "READY" | "PARTIAL" | "NOT_READY";
  readonly documentCount: number;
  readonly availableDocumentCount: number;
  readonly textPageCount: number;
  readonly documents: readonly FascicoloDocumentCorpusDocument[];
  readonly excerpts: readonly FascicoloDocumentCorpusExcerpt[];
}

interface CorpusDocumentRow {
  readonly id: string;
  readonly nome: string;
  readonly currentFileVersionId: string | null;
  readonly currentFileVersion: { readonly sha256: string } | null;
}

interface CorpusAttemptRow {
  readonly id: string;
  readonly documentoId: string;
  readonly documentFileVersionId: string;
  readonly outcome: string;
  readonly sourceSha256: string;
  readonly failureCode: string | null;
  readonly pages: readonly {
    readonly pageNumber: number;
    readonly normalizedText: string;
    readonly textSha256: string;
    readonly extractionMethod: string;
    readonly ocrConfidence: number | null;
    readonly normalizedCharacterCount: number;
  }[];
}

interface CorpusJobRow {
  readonly logicalOperationId: string;
  readonly status: string;
  readonly failureCode: string | null;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildFascicoloDocumentCorpus(input: {
  tenantId: string;
  procedimentoId: string;
  documents: readonly CorpusDocumentRow[];
  attempts: readonly CorpusAttemptRow[];
  jobs?: readonly CorpusJobRow[];
}): FascicoloDocumentCorpus {
  const documents = [...input.documents].sort((left, right) => left.id.localeCompare(right.id));
  const attemptsByVersion = new Map<string, CorpusAttemptRow[]>();
  for (const attempt of input.attempts) {
    const key = `${attempt.documentoId}\n${attempt.documentFileVersionId}`;
    const current = attemptsByVersion.get(key) ?? [];
    current.push(attempt);
    attemptsByVersion.set(key, current);
  }

  const excerpts: FascicoloDocumentCorpusExcerpt[] = [];
  const jobsByLogicalOperationId = new Map<string, CorpusJobRow>();
  for (const job of input.jobs ?? []) {
    if (!jobsByLogicalOperationId.has(job.logicalOperationId)) {
      jobsByLogicalOperationId.set(job.logicalOperationId, job);
    }
  }
  const corpusDocuments = documents.map((document, documentIndex): FascicoloDocumentCorpusDocument => {
    const reference = `DOCUMENT_${documentIndex + 1}`;
    if (!document.currentFileVersionId || !document.currentFileVersion) {
      return {
        reference,
        documentoId: document.id,
        name: document.nome,
        documentFileVersionId: null,
        extractionAttemptId: null,
        sourceSha256: null,
        status: "NO_CURRENT_VERSION",
        failureCode: null,
        pageCount: 0,
        characterCount: 0,
      };
    }

    const attempts = attemptsByVersion.get(`${document.id}\n${document.currentFileVersionId}`) ?? [];
    const succeeded = attempts.find((attempt) => attempt.outcome === "SUCCEEDED");
    if (succeeded) {
      const pages = [...succeeded.pages].sort((left, right) => left.pageNumber - right.pageNumber);
      for (const page of pages) {
        if (!page.normalizedText.trim()) continue;
        excerpts.push({
          reference: `${reference}.PAGE_${page.pageNumber}`,
          documentoId: document.id,
          extractionAttemptId: succeeded.id,
          pageNumber: page.pageNumber,
          documentVersionId: document.currentFileVersionId,
          artifactSha256: succeeded.sourceSha256,
          text: page.normalizedText,
          textSha256: page.textSha256,
          extractionMethod: page.extractionMethod,
          ocrConfidence: page.ocrConfidence,
        });
      }
      return {
        reference,
        documentoId: document.id,
        name: document.nome,
        documentFileVersionId: document.currentFileVersionId,
        extractionAttemptId: succeeded.id,
        sourceSha256: succeeded.sourceSha256,
        status: "AVAILABLE",
        failureCode: null,
        pageCount: pages.length,
        characterCount: pages.reduce((total, page) => total + page.normalizedCharacterCount, 0),
      };
    }

    const failed = attempts[0];
    const job = jobsByLogicalOperationId.get(documentExtractionLogicalOperationId({
      documentoId: document.id,
      documentFileVersionId: document.currentFileVersionId,
    }));
    const jobFailed = job?.status === "TERMINAL_FAILED" || job?.status === "CANCELLED";
    return {
      reference,
      documentoId: document.id,
      name: document.nome,
      documentFileVersionId: document.currentFileVersionId,
      extractionAttemptId: failed?.id ?? null,
      sourceSha256: failed?.sourceSha256 ?? document.currentFileVersion.sha256,
      status: failed?.failureCode === "OCR_REQUIRED"
        ? "OCR_REQUIRED"
        : failed || jobFailed
          ? "EXTRACTION_FAILED"
          : "NOT_EXTRACTED",
      failureCode: failed?.failureCode ?? (jobFailed ? job?.failureCode ?? "EXTRACTION_FAILED" : null),
      pageCount: 0,
      characterCount: 0,
    };
  });

  const availableDocumentCount = corpusDocuments.filter((document) => document.status === "AVAILABLE").length;
  const availability = availableDocumentCount === 0
    ? "NOT_READY"
    : availableDocumentCount === corpusDocuments.length
      ? "READY"
      : "PARTIAL";
  const corpusIdentity = corpusDocuments.map((document) => ({
    reference: document.reference,
    documentoId: document.documentoId,
    documentFileVersionId: document.documentFileVersionId,
    extractionAttemptId: document.extractionAttemptId,
    sourceSha256: document.sourceSha256,
    status: document.status,
    failureCode: document.failureCode,
    pages: excerpts
      .filter((excerpt) => excerpt.documentoId === document.documentoId)
      .map((excerpt) => ({
        reference: excerpt.reference,
        pageNumber: excerpt.pageNumber,
        textSha256: excerpt.textSha256,
      })),
  }));

  return {
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    corpusFingerprint: fingerprint(corpusIdentity),
    availability,
    documentCount: corpusDocuments.length,
    availableDocumentCount,
    textPageCount: excerpts.length,
    documents: corpusDocuments,
    excerpts,
  };
}

export function toFascicoloDocumentAnalysisCorpus(
  corpus: FascicoloDocumentCorpus,
): Pick<FascicoloDocumentAnalysisInput, "corpusFingerprint" | "documents" | "excerpts"> {
  return {
    corpusFingerprint: corpus.corpusFingerprint,
    documents: corpus.documents
      .filter((document): document is FascicoloDocumentCorpusDocument & {
        documentFileVersionId: string;
        sourceSha256: string;
      } => document.status === "AVAILABLE"
        && document.documentFileVersionId !== null
        && document.sourceSha256 !== null)
      .map((document) => ({
        documentVersionId: document.documentFileVersionId,
        artifactSha256: document.sourceSha256,
      })),
    excerpts: corpus.excerpts,
  };
}

export function buildFascicoloDocumentKnowledgeEvidence(
  corpus: FascicoloDocumentCorpus,
): ReadonlyMap<string, KnowledgeEvidenceCandidate> {
  return new Map(corpus.excerpts.map((excerpt) => [
    excerpt.reference,
    {
      provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
      documentoId: excerpt.documentoId,
      documentFileVersionId: excerpt.documentVersionId,
      documentExtractionAttemptId: excerpt.extractionAttemptId,
      pageNumber: excerpt.pageNumber,
      textSha256: excerpt.textSha256,
      quoteSha256: null,
      basisRef: excerpt.reference,
    },
  ]));
}

export async function getFascicoloDocumentCorpus(input: {
  tenantId: string;
  procedimentoId: string;
}): Promise<FascicoloDocumentCorpus | null> {
  const tenantContext = await getCurrentTenantContext();
  if (tenantContext && isTenantContextConstrained(tenantContext)) {
    requireTenantAccess(tenantContext, input.tenantId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  }
  const procedimento = await prisma.procedimento.findFirst({
    where: { id: input.procedimentoId, enteId: input.tenantId },
    select: { id: true },
  });
  if (!procedimento) return null;

  const documents = await prisma.documento.findMany({
    where: {
      enteId: input.tenantId,
      procedimentoId: input.procedimentoId,
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      nome: true,
      currentFileVersionId: true,
      currentFileVersion: { select: { sha256: true } },
    },
  });
  const versionedDocuments = documents.filter(
    (document): document is typeof document & { currentFileVersionId: string } =>
      document.currentFileVersionId !== null,
  );
  const attempts = versionedDocuments.length === 0
    ? []
    : await prisma.documentExtractionAttempt.findMany({
        where: {
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          OR: versionedDocuments.map((document) => ({
            documentoId: document.id,
            documentFileVersionId: document.currentFileVersionId,
          })),
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          documentoId: true,
          documentFileVersionId: true,
          outcome: true,
          sourceSha256: true,
          failureCode: true,
          pages: {
            orderBy: { pageNumber: "asc" },
            select: {
              pageNumber: true,
              normalizedText: true,
              textSha256: true,
              extractionMethod: true,
              ocrConfidence: true,
              normalizedCharacterCount: true,
            },
          },
        },
      });
  const logicalOperationIds = versionedDocuments.map((document) => documentExtractionLogicalOperationId({
    documentoId: document.id,
    documentFileVersionId: document.currentFileVersionId,
  }));
  const jobs = logicalOperationIds.length === 0
    ? []
    : await prisma.asyncJob.findMany({
        where: {
          operation: DOCUMENT_EXTRACTION_OPERATION,
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          logicalOperationId: { in: logicalOperationIds },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          logicalOperationId: true,
          status: true,
          failureCode: true,
        },
      });

  return buildFascicoloDocumentCorpus({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    documents,
    attempts,
    jobs,
  });
}

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction, auditFailure } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import { readDocumentFileBoundedFromProvider } from "@/server/documents/storage";
import {
  DocumentStorageReadCoherenceError,
  DocumentStorageReadLimitError,
  DocumentStorageReadUnavailableError,
} from "@/server/documents/storage/types";
import { ExtractionFailure } from "@/server/intake/extraction/errors";
import {
  B2C9_EXTRACTION_POLICY_V1,
  type ExtractionPolicy,
} from "@/server/intake/extraction/policy";
import { extractTechnicalDocument } from "@/server/intake/extraction/technicalExtractor";
import type {
  ExtractedPageEvidence,
  TechnicalExtractionResult,
} from "@/server/intake/extraction/types";
import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  DOCUMENT_LOCAL_OCR_EXTRACTION_POLICY_V1,
} from "./documentExtractionPolicy";

export {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  DOCUMENT_LOCAL_OCR_EXTRACTION_POLICY_V1,
} from "./documentExtractionPolicy";

const identifier = z.string().trim().min(1).max(256);
const RETRYABLE_DOCUMENT_EXTRACTION_FAILURES = new Set([
  "STORAGE_READ_FAILURE",
  "INTERNAL_EXTRACTION_FAILURE",
]);

export function isRetryableDocumentExtractionFailure(
  failureCode: string | null | undefined,
): boolean {
  return Boolean(failureCode && RETRYABLE_DOCUMENT_EXTRACTION_FAILURES.has(failureCode));
}

type Actor = {
  userId: string | null;
  userEmail: string | null;
  userRole: string;
};

export type DocumentExtractionSourceManifest = {
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

type LoadedDocument = {
  id: string;
  enteId: string | null;
  procedimentoId: string | null;
  currentFileVersionId: string | null;
  procedimento: { enteId: string } | null;
  currentFileVersion: {
    id: string;
    documentId: string;
    canonicalEnteId: string;
    storageProvider: string;
    storageBucket: string | null;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  } | null;
};

type ExistingAttempt = {
  id: string;
  executionKey: string;
  outcome: "SUCCEEDED" | "FAILED";
  documentoId: string;
  documentFileVersionId: string;
  tenantId: string;
  procedimentoId: string;
  policyVersion: string;
  retryOfAttemptId: string | null;
  retryAuthorizationId: string | null;
  failureCode: string | null;
};

export type DocumentExtractionRetryAuthorization = {
  failedAttemptId: string;
  authorizationId: string;
};

export type CompletedDocumentExtraction = {
  attemptId: string;
  executionKey: string;
  policyVersion:
    | typeof DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1
    | typeof DOCUMENT_LOCAL_OCR_EXTRACTION_POLICY_V1;
  retryAuthorization: DocumentExtractionRetryAuthorization | null;
  source: DocumentExtractionSourceManifest;
  actor: Actor;
  startedAt: Date;
  completedAt: Date;
} & (
  | { outcome: "SUCCEEDED"; result: TechnicalExtractionResult }
  | { outcome: "FAILED"; failureCode: string; failureMessage: string }
);

export type ExtractDocumentFileVersionResult = {
  attempt: ExistingAttempt;
  reused: boolean;
};

export class DocumentExtractionAuthorityError extends Error {
  constructor(
    readonly code:
      | "DOCUMENT_NOT_FOUND"
      | "TENANT_MISMATCH"
      | "PROCEDURE_MISMATCH"
      | "CURRENT_VERSION_MISMATCH"
      | "VERSION_MANIFEST_MISMATCH"
      | "EXECUTION_IDENTITY_MISMATCH"
      | "RETRY_AUTHORIZATION_MISMATCH"
      | "OCR_AUTHORIZATION_REQUIRED",
  ) {
    super(code);
    this.name = "DocumentExtractionAuthorityError";
  }
}

export interface ExtractDocumentFileVersionDependencies {
  loadDocument(documentoId: string): Promise<LoadedDocument | null>;
  findExecutionAttempt(executionKey: string): Promise<ExistingAttempt | null>;
  findCanonicalSuccess(
    documentFileVersionId: string,
    policyVersion: string,
  ): Promise<ExistingAttempt | null>;
  findLatestFailure(
    documentFileVersionId: string,
    policyVersion: string,
  ): Promise<ExistingAttempt | null>;
  loadRetryAttempt(attemptId: string): Promise<ExistingAttempt | null>;
  readBounded(input: {
    storageProvider: "local" | "s3";
    storageBucket: string | null;
    storageKey: string;
    maxBytes: number;
  }): Promise<{ disposition: "FOUND"; body: Buffer } | { disposition: "MISSING" }>;
  extract(input: {
    bytes: Buffer;
    declaredMimeType: string;
    expectedSha256: string;
    expectedSizeBytes: number;
  }): Promise<TechnicalExtractionResult>;
  persist(input: CompletedDocumentExtraction): Promise<ExtractDocumentFileVersionResult>;
  auditRejected(input: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    actor: Actor;
    code: string;
  }): Promise<unknown>;
  createAttemptId(): string;
  now(): Date;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function storageProvider(value: string): "local" | "s3" {
  if (value !== "local" && value !== "s3") {
    throw new DocumentExtractionAuthorityError("VERSION_MANIFEST_MISMATCH");
  }
  return value;
}

function sourceManifest(
  document: LoadedDocument,
  input: { documentoId: string; documentFileVersionId: string; tenantId: string },
): DocumentExtractionSourceManifest {
  if (document.enteId !== input.tenantId) {
    throw new DocumentExtractionAuthorityError("TENANT_MISMATCH");
  }
  if (
    !document.procedimentoId
    || !document.procedimento
    || document.procedimento.enteId !== input.tenantId
  ) {
    throw new DocumentExtractionAuthorityError("PROCEDURE_MISMATCH");
  }
  if (
    document.currentFileVersionId !== input.documentFileVersionId
    || document.currentFileVersion?.id !== input.documentFileVersionId
  ) {
    throw new DocumentExtractionAuthorityError("CURRENT_VERSION_MISMATCH");
  }
  const version = document.currentFileVersion;
  if (
    version.documentId !== input.documentoId
    || version.canonicalEnteId !== input.tenantId
    || !version.storageKey.trim()
    || !version.mimeType.trim()
    || !Number.isInteger(version.sizeBytes)
    || version.sizeBytes <= 0
    || !/^[0-9a-f]{64}$/.test(version.sha256)
    || (version.storageProvider === "s3" && !version.storageBucket?.trim())
    || (version.storageProvider === "local" && version.storageBucket !== null)
  ) {
    throw new DocumentExtractionAuthorityError("VERSION_MANIFEST_MISMATCH");
  }
  storageProvider(version.storageProvider);
  return {
    documentoId: document.id,
    documentFileVersionId: version.id,
    tenantId: input.tenantId,
    procedimentoId: document.procedimentoId,
    storageProvider: version.storageProvider,
    storageBucket: version.storageBucket,
    storageKey: version.storageKey,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
  };
}

function pageData(page: ExtractedPageEvidence) {
  return {
    pageNumber: page.pageNumber,
    extractionMethod: page.method,
    text: page.text,
    normalizedText: page.normalizedText,
    textSha256: page.textSha256,
    normalizedCharacterCount: page.normalizedCharacterCount,
    ocrConfidence: page.ocrConfidence,
    warnings: json(page.warnings),
  };
}

function sameAttemptScope(
  attempt: ExistingAttempt,
  source: DocumentExtractionSourceManifest,
  policyVersion: string,
): boolean {
  return attempt.documentoId === source.documentoId
    && attempt.documentFileVersionId === source.documentFileVersionId
    && attempt.tenantId === source.tenantId
    && attempt.procedimentoId === source.procedimentoId
    && attempt.policyVersion === policyVersion;
}

function validRetrySource(
  attempt: ExistingAttempt | null,
  source: DocumentExtractionSourceManifest,
  targetPolicyVersion: CompletedDocumentExtraction["policyVersion"],
): attempt is ExistingAttempt {
  return Boolean(
    attempt
    && attempt.outcome === "FAILED"
    && (
      targetPolicyVersion === DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1
        ? isRetryableDocumentExtractionFailure(attempt.failureCode)
          && sameAttemptScope(attempt, source, DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1)
        : attempt.failureCode === "OCR_REQUIRED"
          && sameAttemptScope(attempt, source, DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1)
    ),
  );
}

function isAttemptIdentityP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "DocumentExtractionAttempt") return false;
  const target = meta.target;
  return target === "document_extraction_execution_key_uq"
    || target === "document_extraction_succeeded_version_policy_uq"
    || target === "DocumentExtractionAttempt_executionKey_key"
    || target === "executionKey"
    || (Array.isArray(target)
      && (
        (target.length === 1 && target[0] === "executionKey")
        || (
          target.includes("documentFileVersionId")
          && target.includes("policyVersion")
        )
      ));
}

export async function persistCompletedDocumentExtraction(
  input: CompletedDocumentExtraction,
): Promise<ExtractDocumentFileVersionResult> {
  const persist = () => runSerializableTransactionWithRetry(async (tx) => {
    const executionAttempt = await tx.documentExtractionAttempt.findUnique({
      where: { executionKey: input.executionKey },
    });
    if (executionAttempt) {
      if (!sameAttemptScope(executionAttempt, input.source, input.policyVersion)) {
        throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
      }
      return { attempt: executionAttempt, reused: true };
    }
    const canonicalSuccess = await tx.documentExtractionAttempt.findFirst({
      where: {
        documentFileVersionId: input.source.documentFileVersionId,
        policyVersion: input.policyVersion,
        outcome: "SUCCEEDED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (canonicalSuccess) {
      if (!sameAttemptScope(canonicalSuccess, input.source, input.policyVersion)) {
        throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
      }
      return { attempt: canonicalSuccess, reused: true };
    }
    if (input.retryAuthorization) {
      const retrySource = await tx.documentExtractionAttempt.findUnique({
        where: { id: input.retryAuthorization.failedAttemptId },
      });
      if (!validRetrySource(retrySource, input.source, input.policyVersion)) {
        throw new DocumentExtractionAuthorityError("RETRY_AUTHORIZATION_MISMATCH");
      }
    } else {
      const previousFailure = await tx.documentExtractionAttempt.findFirst({
        where: {
          documentFileVersionId: input.source.documentFileVersionId,
          policyVersion: input.policyVersion,
          outcome: "FAILED",
        },
        orderBy: { createdAt: "desc" },
      });
      if (previousFailure) {
        if (!sameAttemptScope(previousFailure, input.source, input.policyVersion)) {
          throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
        }
        return { attempt: previousFailure, reused: true };
      }
    }
    const succeeded = input.outcome === "SUCCEEDED";
    const result = succeeded ? input.result : null;
    const attempt = await tx.documentExtractionAttempt.create({
      data: {
        id: input.attemptId,
        executionKey: input.executionKey,
        documentoId: input.source.documentoId,
        documentFileVersionId: input.source.documentFileVersionId,
        tenantId: input.source.tenantId,
        procedimentoId: input.source.procedimentoId,
        policyVersion: input.policyVersion,
        retryOfAttemptId: input.retryAuthorization?.failedAttemptId ?? null,
        retryAuthorizationId: input.retryAuthorization?.authorizationId ?? null,
        outcome: input.outcome,
        sourceSha256: input.source.sha256,
        declaredMimeType: input.source.mimeType,
        detectedMimeType: result?.detectedMimeType ?? null,
        sourceSizeBytes: input.source.sizeBytes,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        directExtractorName: result?.directExtractorName ?? null,
        directExtractorVersion: result?.directExtractorVersion ?? null,
        ocrExtractorName: null,
        ocrExtractorVersion: null,
        rasterizerName: null,
        rasterizerVersion: null,
        failureCode: succeeded ? null : input.failureCode,
        failureMessage: succeeded ? null : input.failureMessage.slice(0, 500),
        warnings: json(result?.warnings ?? []),
        pages: result ? { create: result.pages.map(pageData) } : undefined,
      },
    });
    await createAuditLogInTransaction(tx, {
      azione: "DOCUMENT_EXTRACTION",
      entita: "Documento",
      entitaId: input.source.documentoId,
      enteId: input.source.tenantId,
      esito: succeeded ? "SUCCESS" : "FAILURE",
      actor: input.actor,
      metadata: {
        documentFileVersionId: input.source.documentFileVersionId,
        procedimentoId: input.source.procedimentoId,
        policyVersion: input.policyVersion,
        sourceSha256: input.source.sha256,
        executionKey: input.executionKey,
        retryOfAttemptId: input.retryAuthorization?.failedAttemptId ?? null,
        retryAuthorizationId: input.retryAuthorization?.authorizationId ?? null,
        outcome: input.outcome,
        pageCount: result?.pages.length ?? 0,
        extractionMethods: result ? [...new Set(result.pages.map((page) => page.method))] : [],
        failureCode: succeeded ? null : input.failureCode,
      },
    });
    return { attempt, reused: false };
  });
  try {
    return await persist();
  } catch (error) {
    if (!isAttemptIdentityP2002(error)) throw error;
    const executionAttempt = await prisma.documentExtractionAttempt.findUnique({
      where: { executionKey: input.executionKey },
    });
    if (executionAttempt) {
      if (!sameAttemptScope(executionAttempt, input.source, input.policyVersion)) {
        throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
      }
      return { attempt: executionAttempt, reused: true };
    }
    const canonicalSuccess = await prisma.documentExtractionAttempt.findFirst({
      where: {
        documentFileVersionId: input.source.documentFileVersionId,
        policyVersion: input.policyVersion,
        outcome: "SUCCEEDED",
      },
      orderBy: { createdAt: "asc" },
    });
    if (!canonicalSuccess) throw error;
    if (!sameAttemptScope(canonicalSuccess, input.source, input.policyVersion)) {
      throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
    }
    return { attempt: canonicalSuccess, reused: true };
  }
}

type DocumentExtractionProfile = {
  policyVersion: CompletedDocumentExtraction["policyVersion"];
  ocrMode: "ENABLED" | "DISABLED";
  technicalPolicy: ExtractionPolicy;
};

const DIRECT_TEXT_PROFILE: DocumentExtractionProfile = {
  policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  ocrMode: "DISABLED",
  technicalPolicy: B2C9_EXTRACTION_POLICY_V1,
};

const LOCAL_OCR_PROFILE: DocumentExtractionProfile = {
  policyVersion: DOCUMENT_LOCAL_OCR_EXTRACTION_POLICY_V1,
  ocrMode: "ENABLED",
  technicalPolicy: {
    ...B2C9_EXTRACTION_POLICY_V1,
    version: "DOCUMENT_LOCAL_OCR_TECHNICAL_POLICY_V1",
    maxPdfPages: 20,
    maxImagePixels: 12_000_000,
  },
};

function defaultDependencies(
  profile: DocumentExtractionProfile,
): ExtractDocumentFileVersionDependencies {
  return {
  loadDocument: (documentoId) => prisma.documento.findUnique({
    where: { id: documentoId },
    select: {
      id: true,
      enteId: true,
      procedimentoId: true,
      currentFileVersionId: true,
      procedimento: { select: { enteId: true } },
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
  }),
  findExecutionAttempt: (executionKey) =>
    prisma.documentExtractionAttempt.findUnique({ where: { executionKey } }),
  findCanonicalSuccess: (documentFileVersionId, policyVersion) =>
    prisma.documentExtractionAttempt.findFirst({
      where: { documentFileVersionId, policyVersion, outcome: "SUCCEEDED" },
      orderBy: { createdAt: "asc" },
    }),
  findLatestFailure: (documentFileVersionId, policyVersion) =>
    prisma.documentExtractionAttempt.findFirst({
      where: { documentFileVersionId, policyVersion, outcome: "FAILED" },
      orderBy: { createdAt: "desc" },
    }),
  loadRetryAttempt: (attemptId) =>
    prisma.documentExtractionAttempt.findUnique({ where: { id: attemptId } }),
  readBounded: (input) => readDocumentFileBoundedFromProvider(input),
  extract: (input) => extractTechnicalDocument(input, {
    ocrMode: profile.ocrMode,
    policy: profile.technicalPolicy,
  }),
  persist: persistCompletedDocumentExtraction,
  auditRejected: (input) => auditFailure({
    azione: "DOCUMENT_EXTRACTION",
    entita: "Documento",
    entitaId: input.documentoId,
    enteId: input.tenantId,
    actor: input.actor,
    metadata: {
      documentFileVersionId: input.documentFileVersionId,
      policyVersion: profile.policyVersion,
      outcome: "REJECTED",
      failureCode: input.code,
    },
  }),
  createAttemptId: randomUUID,
  now: () => new Date(),
  };
}

function storageFailure(error: unknown): string {
  if (error instanceof DocumentStorageReadCoherenceError) return error.code;
  if (error instanceof DocumentStorageReadLimitError) return "ARTIFACT_TOO_LARGE";
  if (error instanceof DocumentStorageReadUnavailableError) return "STORAGE_READ_FAILURE";
  if (error instanceof ExtractionFailure) return error.code;
  return "INTERNAL_EXTRACTION_FAILURE";
}

export async function extractDocumentFileVersion(
  rawInput: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    executionKey: string;
    retryAuthorization?: DocumentExtractionRetryAuthorization | null;
    actor: Actor;
  },
  dependencies: ExtractDocumentFileVersionDependencies = defaultDependencies(DIRECT_TEXT_PROFILE),
): Promise<ExtractDocumentFileVersionResult> {
  return extractDocumentFileVersionWithProfile(rawInput, dependencies, DIRECT_TEXT_PROFILE);
}

export async function extractDocumentFileVersionWithLocalOcr(
  rawInput: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    executionKey: string;
    retryAuthorization: DocumentExtractionRetryAuthorization;
    actor: Actor;
  },
  dependencies: ExtractDocumentFileVersionDependencies = defaultDependencies(LOCAL_OCR_PROFILE),
): Promise<ExtractDocumentFileVersionResult> {
  return extractDocumentFileVersionWithProfile(rawInput, dependencies, LOCAL_OCR_PROFILE);
}

async function extractDocumentFileVersionWithProfile(
  rawInput: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    executionKey: string;
    retryAuthorization?: DocumentExtractionRetryAuthorization | null;
    actor: Actor;
  },
  dependencies: ExtractDocumentFileVersionDependencies,
  profile: DocumentExtractionProfile,
): Promise<ExtractDocumentFileVersionResult> {
  const input = {
    documentoId: identifier.parse(rawInput.documentoId),
    documentFileVersionId: identifier.parse(rawInput.documentFileVersionId),
    tenantId: identifier.parse(rawInput.tenantId),
    executionKey: identifier.parse(rawInput.executionKey),
    retryAuthorization: rawInput.retryAuthorization
      ? {
          failedAttemptId: identifier.parse(rawInput.retryAuthorization.failedAttemptId),
          authorizationId: identifier.parse(rawInput.retryAuthorization.authorizationId),
        }
      : null,
    actor: rawInput.actor,
  };
  if (profile.ocrMode === "ENABLED" && !input.retryAuthorization) {
    throw new DocumentExtractionAuthorityError("OCR_AUTHORIZATION_REQUIRED");
  }
  const document = await dependencies.loadDocument(input.documentoId);
  if (!document) {
    await dependencies.auditRejected({ ...input, code: "DOCUMENT_NOT_FOUND" });
    throw new DocumentExtractionAuthorityError("DOCUMENT_NOT_FOUND");
  }

  let source: DocumentExtractionSourceManifest;
  try {
    source = sourceManifest(document, input);
  } catch (error) {
    const code = error instanceof DocumentExtractionAuthorityError
      ? error.code
      : "VERSION_MANIFEST_MISMATCH";
    await dependencies.auditRejected({ ...input, code });
    throw error;
  }

  const executionAttempt = await dependencies.findExecutionAttempt(input.executionKey);
  if (executionAttempt) {
    if (!sameAttemptScope(executionAttempt, source, profile.policyVersion)) {
      throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
    }
    return { attempt: executionAttempt, reused: true };
  }

  const canonicalSuccess = await dependencies.findCanonicalSuccess(
    source.documentFileVersionId,
    profile.policyVersion,
  );
  if (canonicalSuccess) {
    if (!sameAttemptScope(canonicalSuccess, source, profile.policyVersion)) {
      throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
    }
    return { attempt: canonicalSuccess, reused: true };
  }

  if (input.retryAuthorization) {
    const retrySource = await dependencies.loadRetryAttempt(
      input.retryAuthorization.failedAttemptId,
    );
    if (!validRetrySource(retrySource, source, profile.policyVersion)) {
      throw new DocumentExtractionAuthorityError("RETRY_AUTHORIZATION_MISMATCH");
    }
  } else {
    const previousFailure = await dependencies.findLatestFailure(
      source.documentFileVersionId,
      profile.policyVersion,
    );
    if (previousFailure) {
      if (!sameAttemptScope(previousFailure, source, profile.policyVersion)) {
        throw new DocumentExtractionAuthorityError("EXECUTION_IDENTITY_MISMATCH");
      }
      return { attempt: previousFailure, reused: true };
    }
  }

  const startedAt = dependencies.now();
  const attemptId = dependencies.createAttemptId();
  let completed: CompletedDocumentExtraction;
  try {
    if (source.sizeBytes > profile.technicalPolicy.maxArtifactBytes) {
      throw new ExtractionFailure("ARTIFACT_TOO_LARGE");
    }
    const stored = await dependencies.readBounded({
      storageProvider: storageProvider(source.storageProvider),
      storageBucket: source.storageBucket,
      storageKey: source.storageKey,
      maxBytes: source.sizeBytes,
    });
    if (stored.disposition !== "FOUND") {
      throw new ExtractionFailure("STORAGE_READ_FAILURE");
    }
    const result = await dependencies.extract({
      bytes: stored.body,
      declaredMimeType: source.mimeType,
      expectedSha256: source.sha256,
      expectedSizeBytes: source.sizeBytes,
    });
    if (profile.ocrMode === "DISABLED" && (
      result.pages.some((page) => page.method !== "DIRECT_TEXT")
      || result.ocrExtractorName !== null
      || result.ocrExtractorVersion !== null
      || result.rasterizerName !== null
      || result.rasterizerVersion !== null
    )) {
      throw new ExtractionFailure("OCR_REQUIRED");
    }
    completed = {
      attemptId,
      executionKey: input.executionKey,
      policyVersion: profile.policyVersion,
      retryAuthorization: input.retryAuthorization,
      source,
      actor: input.actor,
      startedAt,
      completedAt: dependencies.now(),
      outcome: "SUCCEEDED",
      result,
    };
  } catch (error) {
    completed = {
      attemptId,
      executionKey: input.executionKey,
      policyVersion: profile.policyVersion,
      retryAuthorization: input.retryAuthorization,
      source,
      actor: input.actor,
      startedAt,
      completedAt: dependencies.now(),
      outcome: "FAILED",
      failureCode: storageFailure(error),
      failureMessage: error instanceof Error ? error.message.slice(0, 500) : "Technical extraction failed.",
    };
  }
  return dependencies.persist(completed);
}

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import { ExtractionFailure, type ExtractionFailureCode } from "./errors";
import type { ExtractedPageEvidence, TechnicalExtractionResult } from "./types";

export interface ExtractionAttemptSnapshot {
  attemptId: string;
  neutralIntakeId: string;
  policyVersion: string;
  artifactSha256: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  artifactSizeBytes: number;
  startedAt: Date;
  completedAt: Date;
}

export type CompletedExtractionAttempt = ExtractionAttemptSnapshot & (
  | { outcome: "SUCCEEDED"; result: TechnicalExtractionResult }
  | { outcome: "FAILED"; failureCode: ExtractionFailureCode; failureMessage: string }
);

export class ExtractionPersistenceConflictError extends Error {
  readonly code = "EXTRACTION_PERSISTENCE_CONFLICT" as const;

  constructor() {
    super("Extraction persistence conflict.");
    this.name = "ExtractionPersistenceConflictError";
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
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

function isAttemptIdP2002(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as { modelName?: unknown; target?: unknown } | undefined;
  if (meta?.modelName !== "NeutralIntakeExtractionAttempt") return false;
  const target = meta.target;
  return target === "NeutralIntakeExtractionAttempt_pkey"
    || target === "id"
    || (Array.isArray(target) && target.length === 1 && target[0] === "id");
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function completedAttemptMatches(existing: {
  id: string;
  neutralIntakeId: string;
  policyVersion: string;
  outcome: string;
  artifactSha256: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  artifactSizeBytes: number;
  startedAt: Date;
  completedAt: Date;
  directExtractorName: string | null;
  directExtractorVersion: string | null;
  ocrExtractorName: string | null;
  ocrExtractorVersion: string | null;
  rasterizerName: string | null;
  rasterizerVersion: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  warnings: unknown;
  pages: Array<{
    pageNumber: number;
    extractionMethod: string;
    text: string;
    normalizedText: string;
    textSha256: string;
    normalizedCharacterCount: number;
    ocrConfidence: number | null;
    warnings: unknown;
  }>;
}, input: CompletedExtractionAttempt): boolean {
  const result = input.outcome === "SUCCEEDED" ? input.result : null;
  const pages = result?.pages ?? [];
  return existing.id === input.attemptId
    && existing.neutralIntakeId === input.neutralIntakeId
    && existing.policyVersion === input.policyVersion
    && existing.outcome === input.outcome
    && existing.artifactSha256 === input.artifactSha256
    && existing.declaredMimeType === input.declaredMimeType
    && existing.detectedMimeType === input.detectedMimeType
    && existing.artifactSizeBytes === input.artifactSizeBytes
    && existing.startedAt.getTime() === input.startedAt.getTime()
    && existing.completedAt.getTime() === input.completedAt.getTime()
    && existing.directExtractorName === (result?.directExtractorName ?? null)
    && existing.directExtractorVersion === (result?.directExtractorVersion ?? null)
    && existing.ocrExtractorName === (result?.ocrExtractorName ?? null)
    && existing.ocrExtractorVersion === (result?.ocrExtractorVersion ?? null)
    && existing.rasterizerName === (result?.rasterizerName ?? null)
    && existing.rasterizerVersion === (result?.rasterizerVersion ?? null)
    && existing.failureCode === (input.outcome === "FAILED" ? input.failureCode : null)
    && existing.failureMessage === (input.outcome === "FAILED" ? input.failureMessage.slice(0, 500) : null)
    && jsonEqual(existing.warnings, result?.warnings ?? [])
    && existing.pages.length === pages.length
    && existing.pages.every((page, index) => {
      const expected = pages[index];
      return expected !== undefined
        && page.pageNumber === expected.pageNumber
        && page.extractionMethod === expected.method
        && page.text === expected.text
        && page.normalizedText === expected.normalizedText
        && page.textSha256 === expected.textSha256
        && page.normalizedCharacterCount === expected.normalizedCharacterCount
        && page.ocrConfidence === expected.ocrConfidence
        && jsonEqual(page.warnings, expected.warnings);
    });
}

const attemptInclude = { pages: { orderBy: { pageNumber: "asc" as const } } };

export async function persistCompletedExtractionAttemptInTransaction(
  tx: Prisma.TransactionClient,
  input: CompletedExtractionAttempt,
) {
  const existing = await tx.neutralIntakeExtractionAttempt.findUnique({
    where: { id: input.attemptId },
    include: attemptInclude,
  });
  if (existing) {
    if (!completedAttemptMatches(existing, input)) throw new ExtractionPersistenceConflictError();
    return existing;
  }

  const intake = await tx.neutralIntake.findUnique({
    where: { id: input.neutralIntakeId },
    select: { id: true, sha256: true, mimeType: true, sizeBytes: true, status: true, statusVersion: true },
  });
  if (
    !intake
    || intake.sha256 !== input.artifactSha256
    || intake.mimeType !== input.declaredMimeType
    || intake.sizeBytes !== input.artifactSizeBytes
  ) {
    throw new ExtractionPersistenceConflictError();
  }

  const succeeded = input.outcome === "SUCCEEDED";
  const result = succeeded ? input.result : null;
  const attempt = await tx.neutralIntakeExtractionAttempt.create({
    data: {
      id: input.attemptId,
      neutralIntakeId: input.neutralIntakeId,
      policyVersion: input.policyVersion,
      outcome: input.outcome,
      artifactSha256: input.artifactSha256,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: input.detectedMimeType,
      artifactSizeBytes: input.artifactSizeBytes,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      directExtractorName: result?.directExtractorName ?? null,
      directExtractorVersion: result?.directExtractorVersion ?? null,
      ocrExtractorName: result?.ocrExtractorName ?? null,
      ocrExtractorVersion: result?.ocrExtractorVersion ?? null,
      rasterizerName: result?.rasterizerName ?? null,
      rasterizerVersion: result?.rasterizerVersion ?? null,
      failureCode: succeeded ? null : input.failureCode,
      failureMessage: succeeded ? null : input.failureMessage.slice(0, 500),
      warnings: json(result?.warnings ?? []),
      pages: input.outcome === "SUCCEEDED" ? { create: input.result.pages.map(pageData) } : undefined,
    },
    include: { pages: { orderBy: { pageNumber: "asc" } } },
  });

  if (intake.status === "RECEIVED") {
    const transition = await tx.neutralIntake.updateMany({
      where: {
        id: intake.id,
        status: "RECEIVED",
        statusVersion: intake.statusVersion,
      },
      data: {
        status: succeeded ? "EVIDENCE_READY" : "FAILED_EXTRACTION",
        statusVersion: { increment: 1 },
      },
    });
    if (transition.count !== 1) {
      throw new ExtractionPersistenceConflictError();
    }
  }

  return attempt;
}

export async function persistCompletedExtractionAttempt(input: CompletedExtractionAttempt) {
  try {
    return await runSerializableTransactionWithRetry((tx) =>
      persistCompletedExtractionAttemptInTransaction(tx, input));
  } catch (error) {
    if (!isAttemptIdP2002(error)) throw error;
    const existing = await prisma.neutralIntakeExtractionAttempt.findUnique({
      where: { id: input.attemptId },
      include: attemptInclude,
    });
    if (!existing || !completedAttemptMatches(existing, input)) {
      throw new ExtractionPersistenceConflictError();
    }
    return existing;
  }
}

export function assertCompletedAttempt(input: CompletedExtractionAttempt): void {
  if (input.completedAt < input.startedAt) {
    throw new ExtractionFailure("DIRECT_PARSER_FAILURE", "Extraction timestamps are invalid.");
  }
}

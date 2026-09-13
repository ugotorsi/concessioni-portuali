import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { readDocumentFileBoundedFromProvider } from "@/server/documents/storage";
import {
  DocumentStorageReadCoherenceError,
  DocumentStorageReadLimitError,
  DocumentStorageReadUnavailableError,
} from "@/server/documents/storage/types";

import { asBoundedFailureMessage, ExtractionFailure, type ExtractionFailureCode } from "./extraction/errors";
import { detectArtifactMimeType, isSupportedExtractionMimeType } from "./extraction/mime";
import {
  assertCompletedAttempt,
  persistCompletedExtractionAttempt,
  type CompletedExtractionAttempt,
} from "./extraction/persistence";
import { B2C9_EXTRACTION_POLICY_V1 } from "./extraction/policy";
import { extractTechnicalDocument } from "./extraction/technicalExtractor";
import type { TechnicalExtractionResult } from "./extraction/types";

const intakeIdSchema = z.string().trim().min(1);

type IntakeManifest = {
  id: string;
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
};

export interface ExtractNeutralIntakeDependencies {
  loadIntake(id: string): Promise<IntakeManifest | null>;
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
  persist(input: CompletedExtractionAttempt): Promise<unknown>;
  createAttemptId(): string;
  now(): Date;
}

function storageFailureCode(error: unknown): ExtractionFailureCode {
  if (error instanceof ExtractionFailure) {
    return error.code;
  }
  if (error instanceof DocumentStorageReadLimitError) {
    return "ARTIFACT_TOO_LARGE";
  }
  if (error instanceof DocumentStorageReadCoherenceError) {
    return "STORAGE_READ_FAILURE";
  }
  if (error instanceof DocumentStorageReadUnavailableError) {
    return "STORAGE_READ_FAILURE";
  }
  return "STORAGE_READ_FAILURE";
}

function extractionFailureCode(error: unknown): ExtractionFailureCode {
  return error instanceof ExtractionFailure ? error.code : "INTERNAL_EXTRACTION_FAILURE";
}

const defaultDependencies: ExtractNeutralIntakeDependencies = {
  loadIntake: (id) => prisma.neutralIntake.findUnique({
    where: { id },
    select: {
      id: true,
      storageProvider: true,
      storageBucket: true,
      storageKey: true,
      sha256: true,
      mimeType: true,
      sizeBytes: true,
    },
  }),
  readBounded: (input) => readDocumentFileBoundedFromProvider(input),
  extract: (input) => extractTechnicalDocument(input),
  persist: persistCompletedExtractionAttempt,
  createAttemptId: randomUUID,
  now: () => new Date(),
};

function storageProvider(value: string): "local" | "s3" {
  if (value !== "local" && value !== "s3") {
    throw new ExtractionFailure("STORAGE_READ_FAILURE");
  }
  return value;
}

export async function extractNeutralIntake(
  rawIntakeId: string,
  dependencies: ExtractNeutralIntakeDependencies = defaultDependencies,
) {
  const neutralIntakeId = intakeIdSchema.parse(rawIntakeId);
  const intake = await dependencies.loadIntake(neutralIntakeId);
  if (!intake) {
    throw new ExtractionFailure("STORAGE_READ_FAILURE", "Neutral intake is unavailable.");
  }
  const startedAt = dependencies.now();
  const attemptId = dependencies.createAttemptId();
  let body: Buffer | null = null;
  let completed: CompletedExtractionAttempt;
  try {
    if (intake.sizeBytes > B2C9_EXTRACTION_POLICY_V1.maxArtifactBytes) {
      throw new ExtractionFailure("ARTIFACT_TOO_LARGE");
    }
    const stored = await dependencies.readBounded({
      storageProvider: storageProvider(intake.storageProvider),
      storageBucket: intake.storageBucket,
      storageKey: intake.storageKey,
      maxBytes: B2C9_EXTRACTION_POLICY_V1.maxArtifactBytes,
    });
    if (stored.disposition !== "FOUND") {
      throw new ExtractionFailure("STORAGE_READ_FAILURE", "Stored artifact is unavailable.");
    }
    body = stored.body;
  } catch (error) {
    completed = {
      attemptId,
      neutralIntakeId,
      policyVersion: B2C9_EXTRACTION_POLICY_V1.version,
      outcome: "FAILED",
      artifactSha256: intake.sha256,
      declaredMimeType: intake.mimeType,
      detectedMimeType: null,
      artifactSizeBytes: intake.sizeBytes,
      startedAt,
      completedAt: dependencies.now(),
      failureCode: storageFailureCode(error),
      failureMessage: asBoundedFailureMessage(error),
    };
    assertCompletedAttempt(completed);
    const attempt = await dependencies.persist(completed);
    return { outcome: "FAILED" as const, failureCode: completed.failureCode, attempt };
  }

  try {
    const result = await dependencies.extract({
      bytes: body,
      declaredMimeType: intake.mimeType,
      expectedSha256: intake.sha256,
      expectedSizeBytes: intake.sizeBytes,
    });
    completed = {
      attemptId,
      neutralIntakeId,
      policyVersion: B2C9_EXTRACTION_POLICY_V1.version,
      outcome: "SUCCEEDED",
      artifactSha256: intake.sha256,
      declaredMimeType: intake.mimeType,
      detectedMimeType: result.detectedMimeType,
      artifactSizeBytes: intake.sizeBytes,
      startedAt,
      completedAt: dependencies.now(),
      result,
    };
  } catch (error) {
    const code = extractionFailureCode(error);
    const detected = body ? detectArtifactMimeType(body) : null;
    completed = {
      attemptId,
      neutralIntakeId,
      policyVersion: B2C9_EXTRACTION_POLICY_V1.version,
      outcome: "FAILED",
      artifactSha256: intake.sha256,
      declaredMimeType: intake.mimeType,
      detectedMimeType: detected && isSupportedExtractionMimeType(detected) ? detected : null,
      artifactSizeBytes: intake.sizeBytes,
      startedAt,
      completedAt: dependencies.now(),
      failureCode: code,
      failureMessage: asBoundedFailureMessage(error),
    };
  }
  assertCompletedAttempt(completed);
  const attempt = await dependencies.persist(completed);
  return completed.outcome === "SUCCEEDED"
    ? { outcome: "SUCCEEDED" as const, attempt }
    : { outcome: "FAILED" as const, failureCode: completed.failureCode, attempt };
}

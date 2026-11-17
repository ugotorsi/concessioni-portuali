import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { stableStringify } from "@/server/audit/hash";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  classifyNeutralIntakeEvidenceV1,
  NEUTRAL_INTAKE_CLASSIFIER_VERSION,
  type NeutralIntakeClassificationProjection,
  type NeutralIntakeClassificationResult,
} from "./classifier";
import {
  buildNeutralIntakeClassificationProjection,
  hashNeutralIntakeClassificationEvidence,
  type ClassificationExtractionEvidence,
} from "./projection";

export class NeutralIntakeClassificationConflictError extends Error {
  readonly code = "NEUTRAL_INTAKE_CLASSIFICATION_CONFLICT" as const;

  constructor() {
    super("Neutral intake classification state or evidence is not eligible.");
    this.name = "NeutralIntakeClassificationConflictError";
  }
}

export class NeutralIntakeClassificationExecutionError extends Error {
  readonly code = "NEUTRAL_INTAKE_CLASSIFICATION_EXECUTION_FAILED" as const;
  readonly neutralIntakeId: string;
  readonly expectedStatusVersion: number;

  constructor(neutralIntakeId: string, expectedStatusVersion: number, options?: ErrorOptions) {
    super("Neutral intake classification execution failed.", options);
    this.name = "NeutralIntakeClassificationExecutionError";
    this.neutralIntakeId = neutralIntakeId;
    this.expectedStatusVersion = expectedStatusVersion;
  }
}

interface ClassificationDependencies {
  classify(projection: NeutralIntakeClassificationProjection): NeutralIntakeClassificationResult;
}

const defaultDependencies: ClassificationDependencies = { classify: classifyNeutralIntakeEvidenceV1 };

const extractionInclude = {
  extractionAttempts: {
    where: { outcome: "SUCCEEDED" as const },
    orderBy: [{ completedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    include: { pages: { orderBy: { pageNumber: "asc" as const } } },
  },
};

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function idempotencyKey(neutralIntakeId: string, evidenceHash: string): string {
  return createHash("sha256").update(stableStringify({
    neutralIntakeId,
    evidenceHash,
    classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
  })).digest("hex");
}

function isClassificationUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  return (error.meta as { modelName?: unknown } | undefined)?.modelName === "NeutralIntakeClassificationAttempt";
}

function asEvidence(attempt: {
  id: string;
  policyVersion: string;
  artifactSha256: string;
  warnings: unknown;
  pages: Array<{
    pageNumber: number;
    normalizedText: string;
    textSha256: string;
    normalizedCharacterCount: number;
    ocrConfidence: number | null;
    warnings: unknown;
  }>;
}): ClassificationExtractionEvidence {
  return {
    attemptId: attempt.id,
    policyVersion: attempt.policyVersion,
    artifactSha256: attempt.artifactSha256,
    warnings: attempt.warnings,
    pages: attempt.pages,
  };
}

export async function classifyNeutralIntakeInTransaction(
  tx: Prisma.TransactionClient,
  neutralIntakeId: string,
  dependencies: ClassificationDependencies = defaultDependencies,
) {
  const intake = await tx.neutralIntake.findUnique({ where: { id: neutralIntakeId }, include: extractionInclude });
  const attempt = intake?.extractionAttempts[0];
  if (!intake || !attempt) throw new NeutralIntakeClassificationConflictError();

  const evidence = asEvidence(attempt);
  const evidenceHash = hashNeutralIntakeClassificationEvidence(evidence);
  const logicalKey = idempotencyKey(intake.id, evidenceHash);
  const existing = await tx.neutralIntakeClassificationAttempt.findUnique({ where: { idempotencyKey: logicalKey } });
  if (existing) return existing;
  if (intake.status !== "EVIDENCE_READY") throw new NeutralIntakeClassificationConflictError();

  let classification: NeutralIntakeClassificationResult;
  try {
    classification = dependencies.classify(buildNeutralIntakeClassificationProjection(evidence));
  } catch (cause) {
    throw new NeutralIntakeClassificationExecutionError(intake.id, intake.statusVersion, { cause });
  }

  const persisted = await tx.neutralIntakeClassificationAttempt.create({
    data: {
      neutralIntakeId: intake.id,
      extractionAttemptId: attempt.id,
      idempotencyKey: logicalKey,
      classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      evidenceHash,
      outcome: classification.outcome,
      confidence: classification.confidence,
      reasonCodes: json(classification.reasonCodes),
      evidenceMarkers: json(classification.evidenceMarkers),
      reviewRequired: classification.reviewRequired,
    },
  });
  const transition = await tx.neutralIntake.updateMany({
    where: { id: intake.id, status: "EVIDENCE_READY", statusVersion: intake.statusVersion },
    data: {
      status: classification.reviewRequired ? "REVIEW_REQUIRED" : "EVIDENCE_READY",
      statusVersion: { increment: 1 },
    },
  });
  if (transition.count !== 1) throw new NeutralIntakeClassificationConflictError();
  return persisted;
}

export async function markClassificationExecutionFailedInTransaction(
  tx: Prisma.TransactionClient,
  neutralIntakeId: string,
  expectedStatusVersion: number,
): Promise<void> {
  await tx.neutralIntake.updateMany({
    where: { id: neutralIntakeId, status: "EVIDENCE_READY", statusVersion: expectedStatusVersion },
    data: { status: "FAILED_CLASSIFICATION", statusVersion: { increment: 1 } },
  });
}

async function markClassificationExecutionFailed(
  neutralIntakeId: string,
  expectedStatusVersion: number,
): Promise<void> {
  await runSerializableTransactionWithRetry((tx) =>
    markClassificationExecutionFailedInTransaction(tx, neutralIntakeId, expectedStatusVersion));
}

export async function classifyNeutralIntake(
  neutralIntakeId: string,
  dependencies: ClassificationDependencies = defaultDependencies,
) {
  try {
    return await runSerializableTransactionWithRetry((tx) =>
      classifyNeutralIntakeInTransaction(tx, neutralIntakeId, dependencies));
  } catch (error) {
    if (isClassificationUniqueConflict(error)) {
      return runSerializableTransactionWithRetry((tx) =>
        classifyNeutralIntakeInTransaction(tx, neutralIntakeId, dependencies));
    }
    if (error instanceof NeutralIntakeClassificationExecutionError) {
      await markClassificationExecutionFailed(error.neutralIntakeId, error.expectedStatusVersion);
    }
    throw error;
  }
}
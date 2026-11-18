import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { normalizeAsyncJobAdmission, type AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type {
  AsyncJobHandler,
  AsyncJobHandlerContext,
  AsyncJobTerminalFailureContext,
  AsyncJobTerminalFailureResolution,
} from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import { NEUTRAL_INTAKE_CLASSIFIER_VERSION } from "./classification/classifier";
import {
  hashNeutralIntakeClassificationEvidence,
  type ClassificationExtractionEvidence,
} from "./classification/projection";
import {
  classifyNeutralIntakeInTransaction,
  markClassificationExecutionFailedInTransaction,
  NeutralIntakeClassificationExecutionError,
} from "./classification/service";
import {
  ensureClassificationHandoffInTransaction,
  NeutralIntakeHandoffConflictError,
} from "./classification/handoff";

export const NEUTRAL_INTAKE_CLASSIFICATION_OPERATION = "NEUTRAL_INTAKE_CLASSIFICATION_V1" as const;
export const NEUTRAL_INTAKE_CLASSIFICATION_PURPOSE = "NEUTRAL_INTAKE_CLASSIFICATION" as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const referenceSchema = z.object({
  referenceType: z.literal("NEUTRAL_INTAKE_CLASSIFICATION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    evidenceHash: sha256,
    classifierVersion: z.literal(NEUTRAL_INTAKE_CLASSIFIER_VERSION),
  }).strict(),
}).strict();

type ClassificationReference = z.output<typeof referenceSchema>;

type SourceJobProvenance = {
  tenantId: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
  correlationId: string;
};

type ClassificationEvidenceSnapshot = ClassificationExtractionEvidence & {
  neutralIntakeId: string;
};

export function neutralIntakeClassificationLogicalOperationId(
  neutralIntakeId: string,
  evidenceHash: string,
): string {
  return createHash("sha256").update([
    NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
    neutralIntakeId,
    evidenceHash,
    NEUTRAL_INTAKE_CLASSIFIER_VERSION,
  ].join("\n"), "utf8").digest("hex");
}

function logicalOperationId(input: ClassificationEvidenceSnapshot): string {
  return neutralIntakeClassificationLogicalOperationId(
    input.neutralIntakeId,
    hashNeutralIntakeClassificationEvidence(input),
  );
}

export function buildNeutralIntakeClassificationAdmission(
  evidence: ClassificationEvidenceSnapshot,
  provenance: SourceJobProvenance,
): AsyncJobAdmissionInput {
  const evidenceHash = hashNeutralIntakeClassificationEvidence(evidence);
  return {
    operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
    logicalOperationId: logicalOperationId(evidence),
    purpose: NEUTRAL_INTAKE_CLASSIFICATION_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: {
      referenceType: "NEUTRAL_INTAKE_CLASSIFICATION",
      referenceId: evidence.neutralIntakeId,
      referenceVersion: "V1",
      metadata: {
        evidenceHash,
        classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      },
    },
    maxAttempts: 2,
    availableAt: new Date(0),
    admission: provenance.admissionType === "AUTHENTICATED_USER"
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: provenance.tenantId,
          initiatingUserId: provenance.initiatingUserId!,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: provenance.tenantId,
          initiatingUserId: null,
          actor: {
            actorId: provenance.actorId,
            actorEmail: provenance.actorEmail,
            actorRole: provenance.actorRole,
          },
        },
  };
}

const extractionInclude = {
  pages: { orderBy: { pageNumber: "asc" as const } },
};

function asEvidence(attempt: {
  id: string;
  neutralIntakeId: string;
  policyVersion: string;
  artifactSha256: string;
  completedAt: Date;
  warnings: unknown;
  pages: Array<{
    pageNumber: number;
    normalizedText: string;
    textSha256: string;
    normalizedCharacterCount: number;
    ocrConfidence: number | null;
    warnings: unknown;
  }>;
}): ClassificationEvidenceSnapshot {
  return {
    attemptId: attempt.id,
    neutralIntakeId: attempt.neutralIntakeId,
    policyVersion: attempt.policyVersion,
    artifactSha256: attempt.artifactSha256,
    warnings: attempt.warnings,
    pages: attempt.pages,
  };
}

export async function ensureNeutralIntakeClassificationJobInTransaction(
  tx: Prisma.TransactionClient,
  input: { sourceJobId: string; neutralIntakeId: string; extractionAttemptId?: string },
) {
  const [sourceJob, intake, latestAttempt] = await Promise.all([
    tx.asyncJob.findUnique({ where: { id: input.sourceJobId } }),
    tx.neutralIntake.findUnique({ where: { id: input.neutralIntakeId }, select: { id: true, enteId: true, status: true } }),
    tx.neutralIntakeExtractionAttempt.findFirst({
      where: { neutralIntakeId: input.neutralIntakeId, outcome: "SUCCEEDED" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      include: extractionInclude,
    }),
  ]);
  if (
    !sourceJob
    || sourceJob.operation !== "NEUTRAL_INTAKE_EXTRACTION_V1"
    || !intake
    || !["EVIDENCE_READY", "REVIEW_REQUIRED", "FAILED_CLASSIFICATION"].includes(intake.status)
    || sourceJob.tenantId !== intake.enteId
    || !latestAttempt
    || (input.extractionAttemptId !== undefined && latestAttempt.id !== input.extractionAttemptId)
  ) {
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_ADMISSION_EVIDENCE_MISMATCH", false);
  }
  const admission = buildNeutralIntakeClassificationAdmission(
    asEvidence(latestAttempt),
    {
      tenantId: sourceJob.tenantId,
      admissionType: sourceJob.admissionType,
      initiatingUserId: sourceJob.initiatingUserId,
      actorId: sourceJob.actorId,
      actorEmail: sourceJob.actorEmail,
      actorRole: sourceJob.actorRole,
      policyDecisionRef: sourceJob.policyDecisionRef,
      correlationId: sourceJob.correlationId,
    },
  );
  if (intake.status !== "EVIDENCE_READY") {
    const normalized = normalizeAsyncJobAdmission(admission);
    const existing = await tx.asyncJob.findUnique({ where: { idempotencyKey: normalized.idempotencyKey } });
    if (!existing) {
      throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_ADMISSION_EVIDENCE_MISMATCH", false);
    }
  }
  return admitAsyncJobInTransaction(tx, admission);
}

export function ensureNeutralIntakeClassificationJob(input: {
  sourceJobId: string;
  neutralIntakeId: string;
  extractionAttemptId?: string;
}) {
  return runSerializableTransactionWithRetry((tx) =>
    ensureNeutralIntakeClassificationJobInTransaction(tx, input));
}

function isClassificationUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002"
    && (error.meta as { modelName?: unknown } | undefined)?.modelName === "NeutralIntakeClassificationAttempt";
}

export async function executeBoundClassification(input: ClassificationReference, context: AsyncJobHandlerContext) {
  const run = () => runSerializableTransactionWithRetry(async (tx) => {
    const [job, intake, latestAttempt] = await Promise.all([
      tx.asyncJob.findUnique({ where: { id: context.jobId }, select: { operation: true, tenantId: true } }),
      tx.neutralIntake.findUnique({ where: { id: input.referenceId }, select: { id: true, enteId: true } }),
      tx.neutralIntakeExtractionAttempt.findFirst({
        where: { neutralIntakeId: input.referenceId, outcome: "SUCCEEDED" },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        include: extractionInclude,
      }),
    ]);
    if (
      !job
      || job.operation !== NEUTRAL_INTAKE_CLASSIFICATION_OPERATION
      || !intake
      || job.tenantId !== intake.enteId
      || !latestAttempt
      || hashNeutralIntakeClassificationEvidence(asEvidence(latestAttempt)) !== input.metadata.evidenceHash
    ) {
      throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_EVIDENCE_MISMATCH", false);
    }
    try {
      const decision = await classifyNeutralIntakeInTransaction(tx, input.referenceId);
      if (
        decision.evidenceHash !== input.metadata.evidenceHash
        || decision.classifierVersion !== input.metadata.classifierVersion
      ) {
        throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_RESULT_EVIDENCE_MISMATCH", false);
      }
      return { decision } as const;
    } catch (error) {
      if (!(error instanceof NeutralIntakeClassificationExecutionError)) throw error;
      await markClassificationExecutionFailedInTransaction(
        tx,
        error.neutralIntakeId,
        error.expectedStatusVersion,
      );
      return { executionFailure: true } as const;
    }
  });
  let transactionResult: Awaited<ReturnType<typeof run>>;
  try {
    transactionResult = await run();
  } catch (error) {
    if (error instanceof AsyncJobExecutionError) throw error;
    if (isClassificationUniqueConflict(error)) {
      try {
        transactionResult = await run();
      } catch (retryError) {
        if (retryError instanceof AsyncJobExecutionError) throw retryError;
        throw new AsyncJobExecutionError(
          "CLASSIFICATION_INFRASTRUCTURE",
          "CLASSIFICATION_INFRASTRUCTURE_FAILURE",
          true,
        );
      }
    } else {
      throw new AsyncJobExecutionError(
        "CLASSIFICATION_INFRASTRUCTURE",
        "CLASSIFICATION_INFRASTRUCTURE_FAILURE",
        true,
      );
    }
  }
  if ("executionFailure" in transactionResult) {
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_EXECUTION_FAILED", false);
  }
  try {
    await runSerializableTransactionWithRetry((tx) => ensureClassificationHandoffInTransaction(tx, {
      jobId: context.jobId,
      neutralIntakeId: input.referenceId,
      classificationAttemptId: transactionResult.decision.id,
      evidenceHash: input.metadata.evidenceHash,
      classifierVersion: input.metadata.classifierVersion,
    }));
  } catch (error) {
    if (error instanceof NeutralIntakeHandoffConflictError) {
      throw new AsyncJobExecutionError("HANDOFF", "CLASSIFICATION_HANDOFF_BINDING_MISMATCH", false);
    }
    throw new AsyncJobExecutionError("HANDOFF_INFRASTRUCTURE", "CLASSIFICATION_HANDOFF_FAILED", true);
  }
  return classificationResultReference(transactionResult.decision);
}

function classificationResultReference(decision: {
  id: string;
  classifierVersion: string;
  evidenceHash: string;
  outcome: string;
}) {
  return {
    referenceType: "NEUTRAL_INTAKE_CLASSIFICATION_RESULT",
    referenceId: decision.id,
    referenceVersion: decision.classifierVersion,
    metadata: {
      outcomeCode: decision.outcome,
      evidenceHash: decision.evidenceHash,
    },
  };
}

async function resolveClassificationTerminalFailure(
  tx: Prisma.TransactionClient,
  context: AsyncJobTerminalFailureContext,
): Promise<AsyncJobTerminalFailureResolution> {
  if (context.operation !== NEUTRAL_INTAKE_CLASSIFICATION_OPERATION) {
    throw new AsyncJobExecutionError("AUTHORIZATION", "CLASSIFICATION_TERMINAL_AUTHORITY_MISMATCH", false);
  }
  const input = referenceSchema.parse(context.inputReference);
  const [intake, latestAttempt, expectedDecision] = await Promise.all([
    tx.neutralIntake.findUnique({
      where: { id: input.referenceId },
      select: { id: true, enteId: true, status: true, statusVersion: true },
    }),
    tx.neutralIntakeExtractionAttempt.findFirst({
      where: { neutralIntakeId: input.referenceId, outcome: "SUCCEEDED" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      include: extractionInclude,
    }),
    tx.neutralIntakeClassificationAttempt.findFirst({
      where: {
        neutralIntakeId: input.referenceId,
        evidenceHash: input.metadata.evidenceHash,
        classifierVersion: input.metadata.classifierVersion,
      },
    }),
  ]);
  if (!intake || intake.enteId !== context.tenantId) {
    throw new AsyncJobExecutionError("AUTHORIZATION", "CLASSIFICATION_TERMINAL_AUTHORITY_MISMATCH", false);
  }
  if (intake.status === "FAILED_CLASSIFICATION") return { outcome: "TERMINAL_FAILED" };
  if (!latestAttempt) {
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_TERMINAL_EVIDENCE_MISMATCH", false);
  }
  const currentEvidenceHash = hashNeutralIntakeClassificationEvidence(asEvidence(latestAttempt));
  if (currentEvidenceHash !== input.metadata.evidenceHash) {
    const newerDecision = await tx.neutralIntakeClassificationAttempt.findFirst({
      where: {
        neutralIntakeId: input.referenceId,
        evidenceHash: currentEvidenceHash,
        classifierVersion: input.metadata.classifierVersion,
      },
    });
    if (newerDecision) return { outcome: "TERMINAL_FAILED" };
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_TERMINAL_EVIDENCE_MISMATCH", false);
  }
  if (expectedDecision) {
    await ensureClassificationHandoffInTransaction(tx, {
      jobId: context.jobId,
      neutralIntakeId: input.referenceId,
      classificationAttemptId: expectedDecision.id,
      evidenceHash: input.metadata.evidenceHash,
      classifierVersion: input.metadata.classifierVersion,
    });
    return { outcome: "SUCCEEDED", resultReference: classificationResultReference(expectedDecision) };
  }
  if (intake.status !== "EVIDENCE_READY") {
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_TERMINAL_STATE_MISMATCH", false);
  }
  await markClassificationExecutionFailedInTransaction(tx, intake.id, intake.statusVersion);
  const confirmed = await tx.neutralIntake.findUnique({
    where: { id: intake.id },
    select: { status: true },
  });
  if (confirmed?.status !== "FAILED_CLASSIFICATION") {
    throw new AsyncJobExecutionError("CLASSIFICATION", "CLASSIFICATION_TERMINAL_CAS_LOST", false);
  }
  return { outcome: "TERMINAL_FAILED" };
}

export interface NeutralIntakeClassificationHandlerDependencies {
  executeBound(
    input: ClassificationReference,
    context: AsyncJobHandlerContext,
  ): ReturnType<typeof executeBoundClassification>;
}

const defaultHandlerDependencies: NeutralIntakeClassificationHandlerDependencies = {
  executeBound: executeBoundClassification,
};

export function createNeutralIntakeClassificationHandler(
  dependencies: NeutralIntakeClassificationHandlerDependencies = defaultHandlerDependencies,
): AsyncJobHandler<ClassificationReference> {
  return {
    operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: (input, context) => dependencies.executeBound(input, context),
    beforeTerminalFailureInTransaction: resolveClassificationTerminalFailure,
  };
}
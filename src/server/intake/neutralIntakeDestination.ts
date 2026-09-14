import { Prisma } from "@/generated/prisma/client";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import { NEUTRAL_INTAKE_CLASSIFIER_VERSION } from "./classification/classifier";
import {
  ensureClassificationHandoffInTransaction,
  NeutralIntakeHandoffConflictError,
} from "./classification/handoff";
import { hashNeutralIntakeClassificationEvidence } from "./classification/projection";
import {
  NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
  neutralIntakeClassificationLogicalOperationId,
} from "./neutralIntakeClassificationJob";

export const NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION =
  "B2C9_NEUTRAL_INTAKE_DESTINATION_V1" as const;

export class NeutralIntakeDestinationConflictError extends Error {
  readonly code = "NEUTRAL_INTAKE_DESTINATION_CONFLICT" as const;

  constructor() {
    super("Neutral intake destination is missing, cross-tenant, or already bound differently.");
    this.name = "NeutralIntakeDestinationConflictError";
  }
}

export class NeutralIntakeDestinationHandoffError extends Error {
  readonly code = "NEUTRAL_INTAKE_DESTINATION_HANDOFF_FAILED" as const;
  readonly retryable = true as const;

  constructor(options: ErrorOptions) {
    super("Destination persisted, but classification handoff could not be resumed.", options);
    this.name = "NeutralIntakeDestinationHandoffError";
  }
}

export interface EstablishNeutralIntakeDestinationInput {
  neutralIntakeId: string;
  procedimentoId: string;
  authoritySource: string;
  establishedByUserId: string | null;
  establishedByActorId: string;
  establishedByRole: string;
}

export async function establishNeutralIntakeDestinationInTransaction(
  tx: Prisma.TransactionClient,
  input: EstablishNeutralIntakeDestinationInput,
) {
  const [intake, procedimento, existing] = await Promise.all([
    tx.neutralIntake.findUnique({
      where: { id: input.neutralIntakeId },
      select: { id: true, enteId: true },
    }),
    tx.procedimento.findUnique({
      where: { id: input.procedimentoId },
      select: { id: true, concessione: { select: { enteId: true } } },
    }),
    tx.neutralIntakeDestination.findUnique({ where: { neutralIntakeId: input.neutralIntakeId } }),
  ]);
  if (
    !intake
    || !procedimento
    || intake.enteId === null
    || procedimento.concessione.enteId !== intake.enteId
  ) {
    throw new NeutralIntakeDestinationConflictError();
  }
  if (existing) {
    if (
      existing.procedimentoId !== input.procedimentoId
      || existing.contractVersion !== NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION
    ) {
      throw new NeutralIntakeDestinationConflictError();
    }
    return { outcome: "REUSED" as const, destination: existing };
  }

  await tx.neutralIntakeDestination.createMany({
    data: [{
      neutralIntakeId: input.neutralIntakeId,
      procedimentoId: input.procedimentoId,
      contractVersion: NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION,
      authoritySource: input.authoritySource,
      establishedByUserId: input.establishedByUserId,
      establishedByActorId: input.establishedByActorId,
      establishedByRole: input.establishedByRole,
    }],
    skipDuplicates: true,
  });
  const destination = await tx.neutralIntakeDestination.findUnique({
    where: { neutralIntakeId: input.neutralIntakeId },
  });
  if (
    !destination
    || destination.procedimentoId !== input.procedimentoId
    || destination.contractVersion !== NEUTRAL_INTAKE_DESTINATION_CONTRACT_VERSION
  ) {
    throw new NeutralIntakeDestinationConflictError();
  }
  return { outcome: "CREATED" as const, destination };
}

const effectiveExtractionInclude = {
  pages: { orderBy: { pageNumber: "asc" as const } },
};

export async function resumeEffectiveCaseDocumentHandoffInTransaction(
  tx: Prisma.TransactionClient,
  neutralIntakeId: string,
) {
  const [intake, extractionAttempt] = await Promise.all([
    tx.neutralIntake.findUnique({
      where: { id: neutralIntakeId },
      select: { id: true, enteId: true },
    }),
    tx.neutralIntakeExtractionAttempt.findFirst({
      where: { neutralIntakeId, outcome: "SUCCEEDED" },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      include: effectiveExtractionInclude,
    }),
  ]);
  if (!intake || !extractionAttempt) return { outcome: "NO_EFFECTIVE_CLASSIFICATION" as const };

  const evidenceHash = hashNeutralIntakeClassificationEvidence({
    attemptId: extractionAttempt.id,
    policyVersion: extractionAttempt.policyVersion,
    artifactSha256: extractionAttempt.artifactSha256,
    warnings: extractionAttempt.warnings,
    pages: extractionAttempt.pages,
  });
  const decision = await tx.neutralIntakeClassificationAttempt.findUnique({
    where: {
      neutralIntakeId_evidenceHash_classifierVersion: {
        neutralIntakeId,
        evidenceHash,
        classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION,
      },
    },
  });
  if (!decision) return { outcome: "NO_EFFECTIVE_CLASSIFICATION" as const };
  if (decision.outcome !== "CASE_DOCUMENT") return { outcome: "NOT_CASE_DOCUMENT" as const };

  const logicalOperationId = neutralIntakeClassificationLogicalOperationId(neutralIntakeId, evidenceHash);
  const job = await tx.asyncJob.findFirst({
    where: {
      operation: NEUTRAL_INTAKE_CLASSIFICATION_OPERATION,
      logicalOperationId,
      tenantId: intake.enteId,
      inputReference: {
        equals: {
          referenceType: "NEUTRAL_INTAKE_CLASSIFICATION",
          referenceId: neutralIntakeId,
          referenceVersion: "V1",
          metadata: { evidenceHash, classifierVersion: NEUTRAL_INTAKE_CLASSIFIER_VERSION },
        },
      },
    },
    select: { id: true },
  });
  if (!job) throw new NeutralIntakeHandoffConflictError();

  return ensureClassificationHandoffInTransaction(tx, {
    jobId: job.id,
    neutralIntakeId,
    classificationAttemptId: decision.id,
    evidenceHash,
    classifierVersion: decision.classifierVersion,
  });
}

export async function establishNeutralIntakeDestination(input: EstablishNeutralIntakeDestinationInput) {
  const established = await runSerializableTransactionWithRetry((tx) =>
    establishNeutralIntakeDestinationInTransaction(tx, input));
  try {
    const handoff = await runSerializableTransactionWithRetry((tx) =>
      resumeEffectiveCaseDocumentHandoffInTransaction(tx, input.neutralIntakeId));
    return { ...established, handoff };
  } catch (cause) {
    if (cause instanceof NeutralIntakeHandoffConflictError) throw cause;
    throw new NeutralIntakeDestinationHandoffError({ cause });
  }
}
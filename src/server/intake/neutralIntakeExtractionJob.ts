import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";

import { extractNeutralIntake } from "./extractNeutralIntake";

export const NEUTRAL_INTAKE_EXTRACTION_OPERATION = "NEUTRAL_INTAKE_EXTRACTION_V1" as const;
export const NEUTRAL_INTAKE_EXTRACTION_PURPOSE = "NEUTRAL_INTAKE_EXTRACTION" as const;
const EXTRACTION_HEARTBEAT_INTERVAL_MS = 60_000;

const referenceSchema = z.object({
  referenceType: z.literal("NEUTRAL_INTAKE"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    receivedActorId: z.string().trim().min(1).max(256).optional(),
    receivedActorRoleCode: z.string().trim().min(1).max(512).optional(),
  }).strict(),
}).strict();

type ExtractionReference = z.output<typeof referenceSchema>;

function evidenceReadyResult(neutralIntakeId: string) {
  return {
    referenceType: "NEUTRAL_INTAKE_EXTRACTION",
    referenceId: neutralIntakeId,
    referenceVersion: "V1",
    metadata: { statusCode: "EVIDENCE_READY" },
  };
}

type IntakeAdmissionRecord = {
  id: string;
  idempotencyKey: string;
  enteId: string | null;
  receivedByUserId: string | null;
  receivedByActorId: string;
  receivedByRole: string;
  initiatingUserRole: string | null;
  receivedAt: Date;
};

export function buildNeutralIntakeExtractionAdmission(
  intake: IntakeAdmissionRecord,
): AsyncJobAdmissionInput {
  const authenticated = intake.receivedByUserId !== null;
  if (authenticated && intake.initiatingUserRole === null) {
    throw new Error("NEUTRAL_INTAKE_INITIATING_USER_ROLE_UNAVAILABLE");
  }
  const distinctReceiptActor = authenticated && intake.receivedByActorId !== intake.receivedByUserId
    ? {
        receivedActorId: intake.receivedByActorId,
        receivedActorRoleCode: intake.receivedByRole,
      }
    : {};
  return {
    operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION,
    logicalOperationId: intake.id,
    purpose: NEUTRAL_INTAKE_EXTRACTION_PURPOSE,
    correlationId: intake.idempotencyKey,
    policyDecisionRef: authenticated ? null : "NEUTRAL_INTAKE_SYSTEM_ADMISSION_V1",
    inputReference: {
      referenceType: "NEUTRAL_INTAKE",
      referenceId: intake.id,
      referenceVersion: "V1",
      metadata: distinctReceiptActor,
    },
    maxAttempts: 1,
    availableAt: intake.receivedAt,
    admission: authenticated
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: intake.enteId,
          initiatingUserId: intake.receivedByUserId!,
          actor: {
            actorId: intake.receivedByUserId!,
            actorEmail: null,
            actorRole: intake.initiatingUserRole!,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: intake.enteId,
          initiatingUserId: null,
          actor: {
            actorId: intake.receivedByActorId,
            actorEmail: null,
            actorRole: intake.receivedByRole,
          },
        },
  };
}

export interface NeutralIntakeExtractionHandlerDependencies {
  loadAuthority(input: { jobId: string; neutralIntakeId: string }): Promise<{
    job: { operation: string; tenantId: string | null } | null;
    intake: { id: string; enteId: string | null; status: string } | null;
  }>;
  extract(neutralIntakeId: string): ReturnType<typeof extractNeutralIntake>;
}

const defaultDependencies: NeutralIntakeExtractionHandlerDependencies = {
  async loadAuthority(input) {
    const [job, intake] = await Promise.all([
      prisma.asyncJob.findUnique({
        where: { id: input.jobId },
        select: { operation: true, tenantId: true },
      }),
      prisma.neutralIntake.findUnique({
        where: { id: input.neutralIntakeId },
        select: { id: true, enteId: true, status: true },
      }),
    ]);
    return { job, intake };
  },
  extract: (neutralIntakeId) => extractNeutralIntake(neutralIntakeId),
};

async function executeExtraction(
  input: ExtractionReference,
  context: AsyncJobHandlerContext,
  dependencies: NeutralIntakeExtractionHandlerDependencies,
) {
  const authority = await dependencies.loadAuthority({
    jobId: context.jobId,
    neutralIntakeId: input.referenceId,
  });
  if (
    !authority.job
    || authority.job.operation !== NEUTRAL_INTAKE_EXTRACTION_OPERATION
    || !authority.intake
    || authority.job.tenantId !== authority.intake.enteId
  ) {
    throw new AsyncJobExecutionError("AUTHORIZATION", "NEUTRAL_INTAKE_AUTHORITY_MISMATCH", false);
  }
  if (authority.intake.status !== "RECEIVED" && authority.intake.status !== "EVIDENCE_READY") {
    throw new AsyncJobExecutionError("EXTRACTION", "NEUTRAL_INTAKE_NOT_EXTRACTABLE", false);
  }
  if (await context.isCancellationRequested()) {
    throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
  }
  if (authority.intake.status === "EVIDENCE_READY") {
    return evidenceReadyResult(input.referenceId);
  }

  await context.heartbeat();
  let heartbeatFailure: unknown;
  let heartbeatInFlight: Promise<void> | null = null;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = context.heartbeat()
      .catch((error: unknown) => { heartbeatFailure ??= error; })
      .finally(() => { heartbeatInFlight = null; });
  }, EXTRACTION_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
  let result: Awaited<ReturnType<typeof dependencies.extract>>;
  try {
    result = await dependencies.extract(input.referenceId);
  } finally {
    clearInterval(heartbeatTimer);
    await heartbeatInFlight;
  }
  if (heartbeatFailure) throw heartbeatFailure;
  await context.heartbeat();
  if (result.outcome === "FAILED") {
    throw new AsyncJobExecutionError("EXTRACTION", result.failureCode, false);
  }

  const completed = await dependencies.loadAuthority({
    jobId: context.jobId,
    neutralIntakeId: input.referenceId,
  });
  if (!completed.intake || completed.intake.status !== "EVIDENCE_READY") {
    throw new AsyncJobExecutionError("EXTRACTION", "EVIDENCE_READY_NOT_CONFIRMED", false);
  }
  return evidenceReadyResult(input.referenceId);
}

export function createNeutralIntakeExtractionHandler(
  dependencies: NeutralIntakeExtractionHandlerDependencies = defaultDependencies,
): AsyncJobHandler<ExtractionReference> {
  return {
    operation: NEUTRAL_INTAKE_EXTRACTION_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: (input, context) => executeExtraction(input, context, dependencies),
  };
}
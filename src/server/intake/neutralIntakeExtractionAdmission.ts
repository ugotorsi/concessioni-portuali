import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";

export const NEUTRAL_INTAKE_EXTRACTION_OPERATION = "NEUTRAL_INTAKE_EXTRACTION_V1" as const;
export const NEUTRAL_INTAKE_EXTRACTION_PURPOSE = "NEUTRAL_INTAKE_EXTRACTION" as const;

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
    maxAttempts: 2,
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
import type { Prisma } from "@/generated/prisma/client";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob, admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";

import { DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1 } from "./documentExtractionPolicy";

export const DOCUMENT_EXTRACTION_OPERATION = "DOCUMENT_EXTRACTION_V1" as const;
export const DOCUMENT_EXTRACTION_PURPOSE = "DOCUMENT_EXTRACTION" as const;

type AdmissionAuthority = {
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  tenantId: string;
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
};

export function documentExtractionLogicalOperationId(input: {
  documentoId: string;
  documentFileVersionId: string;
}): string {
  return [
    input.documentoId,
    input.documentFileVersionId,
    DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
    "initial",
  ].join(":");
}

export function buildDocumentExtractionAdmission(input: {
  documentoId: string;
  documentFileVersionId: string;
  procedimentoId: string;
  correlationId: string;
  authority: AdmissionAuthority;
  availableAt?: Date;
}): AsyncJobAdmissionInput {
  return {
    operation: DOCUMENT_EXTRACTION_OPERATION,
    logicalOperationId: documentExtractionLogicalOperationId(input),
    purpose: DOCUMENT_EXTRACTION_PURPOSE,
    correlationId: input.correlationId,
    procedimentoId: input.procedimentoId,
    policyDecisionRef: input.authority.policyDecisionRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: input.documentFileVersionId,
      referenceVersion: "V1",
      metadata: {
        documentoId: input.documentoId,
        procedimentoId: input.procedimentoId,
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryAttemptId: null,
        retryPermitRef: null,
      },
    },
    maxAttempts: 1,
    availableAt: input.availableAt ?? new Date(),
    admission: input.authority.admissionType === "AUTHENTICATED_USER"
      ? {
          admissionType: "AUTHENTICATED_USER",
          tenantId: input.authority.tenantId,
          initiatingUserId: input.authority.initiatingUserId!,
          actor: {
            actorId: input.authority.initiatingUserId!,
            actorEmail: input.authority.actorEmail,
            actorRole: input.authority.actorRole,
          },
        }
      : {
          admissionType: "AUTHORIZED_SYSTEM",
          tenantId: input.authority.tenantId,
          initiatingUserId: null,
          actor: {
            actorId: input.authority.actorId,
            actorEmail: input.authority.actorEmail,
            actorRole: input.authority.actorRole,
          },
        },
  };
}

export function ensureDocumentExtractionJob(
  input: Parameters<typeof buildDocumentExtractionAdmission>[0],
  tx?: Prisma.TransactionClient,
) {
  const admission = buildDocumentExtractionAdmission(input);
  return tx
    ? admitAsyncJobInTransaction(tx, admission)
    : admitAsyncJob(admission);
}

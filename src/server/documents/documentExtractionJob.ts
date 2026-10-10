import { hostname } from "node:os";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import {
  AsyncJobHandlerRegistry,
  type AsyncJobHandler,
  type AsyncJobHandlerContext,
} from "@/server/async-jobs/registry";
import { AsyncJobExecutionError, drainAsyncJobById } from "@/server/async-jobs/worker";

import {
  DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
  extractDocumentFileVersion,
  type DocumentExtractionRetryAuthorization,
} from "./documentExtraction";
import {
  issueDocumentExtractionRetryPermit,
  verifyDocumentExtractionRetryPermit,
  type DocumentExtractionRetryPermit,
} from "./documentExtractionRetryPermit";

export const DOCUMENT_EXTRACTION_OPERATION = "DOCUMENT_EXTRACTION_V1" as const;
export const DOCUMENT_EXTRACTION_PURPOSE = "DOCUMENT_EXTRACTION" as const;
const DOCUMENT_EXTRACTION_LEASE_MS = 5 * 60 * 1_000;

const referenceSchema = z.object({
  referenceType: z.literal("DOCUMENT_FILE_VERSION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    documentoId: z.string().trim().min(1).max(256),
    procedimentoId: z.string().trim().min(1).max(256),
    policyVersion: z.literal(DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1),
    retryAttemptId: z.string().trim().min(1).max(256).nullable(),
    retryPermitRef: z.string().trim().min(1).max(256).nullable(),
  }).strict().refine(
    (metadata) => (metadata.retryAttemptId === null) === (metadata.retryPermitRef === null),
    "Retry attempt and permit must be provided together.",
  ),
}).strict();

type DocumentExtractionReference = z.output<typeof referenceSchema>;

type AdmissionAuthority = {
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  tenantId: string;
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
};

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
    logicalOperationId: [
      input.documentoId,
      input.documentFileVersionId,
      DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      "initial",
    ].join(":"),
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

function buildAuthorizedRetryAdmission(
  permit: DocumentExtractionRetryPermit,
): AsyncJobAdmissionInput {
  return {
    operation: DOCUMENT_EXTRACTION_OPERATION,
    logicalOperationId: [
      permit.documentoId,
      permit.documentFileVersionId,
      DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
      `retry:${permit.failedAttemptId}:${permit.permitRef}`,
    ].join(":"),
    purpose: DOCUMENT_EXTRACTION_PURPOSE,
    correlationId: `document-extraction-retry:${permit.permitRef}`,
    procedimentoId: permit.procedimentoId,
    policyDecisionRef: permit.permitRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: permit.documentFileVersionId,
      referenceVersion: "V1",
      metadata: {
        documentoId: permit.documentoId,
        procedimentoId: permit.procedimentoId,
        policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
        retryAttemptId: permit.failedAttemptId,
        retryPermitRef: permit.permitRef,
      },
    },
    maxAttempts: 1,
    availableAt: permit.createdAt,
    admission: {
      admissionType: "AUTHENTICATED_USER",
      tenantId: permit.tenantId,
      initiatingUserId: permit.actor.userId,
      actor: {
        actorId: permit.actor.userId,
        actorEmail: permit.actor.userEmail,
        actorRole: permit.actor.userRole,
      },
    },
  };
}

export function ensureDocumentExtractionJob(
  input: Parameters<typeof buildDocumentExtractionAdmission>[0],
) {
  return admitAsyncJob(buildDocumentExtractionAdmission(input));
}

export async function ensureAuthorizedDocumentExtractionRetryJob(
  failedAttemptId: string,
) {
  const permit = await issueDocumentExtractionRetryPermit(failedAttemptId);
  await verifyDocumentExtractionRetryPermit({
    permitRef: permit.permitRef,
    failedAttemptId: permit.failedAttemptId,
    documentoId: permit.documentoId,
    documentFileVersionId: permit.documentFileVersionId,
    tenantId: permit.tenantId,
    procedimentoId: permit.procedimentoId,
    actorUserId: permit.actor.userId,
    actorRole: permit.actor.userRole,
  });
  return admitAsyncJob(buildAuthorizedRetryAdmission(permit));
}

export interface DocumentExtractionHandlerDependencies {
  loadJob(jobId: string): Promise<{
    operation: string;
    tenantId: string | null;
    procedimentoId: string | null;
    initiatingUserId: string | null;
    actorEmail: string | null;
    actorRole: string;
  } | null>;
  verifyRetryPermit(input: Parameters<typeof verifyDocumentExtractionRetryPermit>[0]): Promise<void>;
  extract(input: {
    documentoId: string;
    documentFileVersionId: string;
    tenantId: string;
    executionKey: string;
    retryAuthorization: DocumentExtractionRetryAuthorization | null;
    actor: { userId: string | null; userEmail: string | null; userRole: string };
  }): ReturnType<typeof extractDocumentFileVersion>;
}

const defaultDependencies: DocumentExtractionHandlerDependencies = {
  loadJob: (jobId) => prisma.asyncJob.findUnique({
    where: { id: jobId },
    select: {
      operation: true,
      tenantId: true,
      procedimentoId: true,
      initiatingUserId: true,
      actorEmail: true,
      actorRole: true,
    },
  }),
  extract: (input) => extractDocumentFileVersion(input),
  verifyRetryPermit: verifyDocumentExtractionRetryPermit,
};

export function createDocumentExtractionHandler(
  dependencies: DocumentExtractionHandlerDependencies = defaultDependencies,
): AsyncJobHandler<DocumentExtractionReference> {
  return {
    operation: DOCUMENT_EXTRACTION_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    async execute(input: DocumentExtractionReference, context: AsyncJobHandlerContext) {
      const job = await dependencies.loadJob(context.jobId);
      if (
        !job
        || job.operation !== DOCUMENT_EXTRACTION_OPERATION
        || !job.tenantId
        || job.procedimentoId !== input.metadata.procedimentoId
      ) {
        throw new AsyncJobExecutionError("AUTHORIZATION", "DOCUMENT_EXTRACTION_AUTHORITY_MISMATCH", false);
      }
      if (input.metadata.retryAttemptId && input.metadata.retryPermitRef) {
        if (!job.initiatingUserId) {
          throw new AsyncJobExecutionError("AUTHORIZATION", "DOCUMENT_EXTRACTION_RETRY_PERMIT_INVALID", false);
        }
        try {
          await dependencies.verifyRetryPermit({
            permitRef: input.metadata.retryPermitRef,
            failedAttemptId: input.metadata.retryAttemptId,
            documentoId: input.metadata.documentoId,
            documentFileVersionId: input.referenceId,
            tenantId: job.tenantId,
            procedimentoId: input.metadata.procedimentoId,
            actorUserId: job.initiatingUserId,
            actorRole: job.actorRole,
          });
        } catch {
          throw new AsyncJobExecutionError("AUTHORIZATION", "DOCUMENT_EXTRACTION_RETRY_PERMIT_INVALID", false);
        }
      }
      const result = await dependencies.extract({
        documentoId: input.metadata.documentoId,
        documentFileVersionId: input.referenceId,
        tenantId: job.tenantId,
        executionKey: context.jobId,
        retryAuthorization: input.metadata.retryAttemptId && input.metadata.retryPermitRef
          ? {
              failedAttemptId: input.metadata.retryAttemptId,
              authorizationId: input.metadata.retryPermitRef,
            }
          : null,
        actor: {
          userId: job.initiatingUserId,
          userEmail: job.actorEmail,
          userRole: job.actorRole,
        },
      });
      if (result.attempt.outcome !== "SUCCEEDED") {
        throw new AsyncJobExecutionError(
          "EXTRACTION",
          result.attempt.failureCode ?? "DOCUMENT_EXTRACTION_FAILED",
          false,
        );
      }
      return {
        referenceType: "DOCUMENT_EXTRACTION_ATTEMPT",
        referenceId: result.attempt.id,
        referenceVersion: "V1",
        metadata: {
          documentoId: input.metadata.documentoId,
          documentFileVersionId: input.referenceId,
          procedimentoId: input.metadata.procedimentoId,
          policyVersion: DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1,
          reusedEnabled: result.reused,
        },
      };
    },
  };
}

export async function runDocumentExtractionJobById(input: {
  jobId: string;
  workerId?: string;
  retryDelayMs?: number;
  dependencies?: DocumentExtractionHandlerDependencies;
}) {
  const registry = new AsyncJobHandlerRegistry([
    createDocumentExtractionHandler(input.dependencies),
  ]);
  return drainAsyncJobById({
    jobId: input.jobId,
    expectedOperation: DOCUMENT_EXTRACTION_OPERATION,
    workerId: input.workerId ?? `${hostname()}:${process.pid}:document-extraction`,
    leaseDurationMs: DOCUMENT_EXTRACTION_LEASE_MS,
    retryDelayMs: input.retryDelayMs ?? 0,
    registry,
  });
}

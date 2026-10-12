import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  admitAsyncJob,
  admitAsyncJobInTransaction,
} from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  ensureDocumentOcrRunInTransaction,
  inspectDocumentOcrManifest,
  processDocumentOcrBatch,
} from "./documentOcrBatch";
import {
  DocumentOcrAuthorizationError,
  issueDocumentOcrAuthorization,
  verifyDocumentOcrAuthorization,
} from "./documentOcrAuthorization";
import {
  DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
  DOCUMENT_OCR_BATCH_LIMITS_V2,
} from "./documentExtractionPolicy";

export const DOCUMENT_OCR_COORDINATOR_OPERATION =
  "DOCUMENT_OCR_COORDINATOR_V2" as const;
export const DOCUMENT_OCR_PAGE_BATCH_OPERATION =
  "DOCUMENT_OCR_PAGE_BATCH_V2" as const;

const coordinatorReferenceSchema = z.object({
  referenceType: z.literal("DOCUMENT_FILE_VERSION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V2"),
  metadata: z.object({
    documentoId: z.string().trim().min(1).max(256),
    procedimentoId: z.string().trim().min(1).max(256),
    policyVersion: z.literal(DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2),
    failedAttemptId: z.string().trim().min(1).max(256),
    permitRef: z.string().trim().min(1).max(256),
  }).strict(),
}).strict();

const batchReferenceSchema = z.object({
  referenceType: z.literal("DOCUMENT_OCR_RUN"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V2"),
  metadata: z.object({
    documentoId: z.string().trim().min(1).max(256),
    documentFileVersionId: z.string().trim().min(1).max(256),
    procedimentoId: z.string().trim().min(1).max(256),
    policyVersion: z.literal(DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2),
    pageCount: z.number().int().min(1).max(DOCUMENT_OCR_BATCH_LIMITS_V2.maxPdfPages),
    firstPageCount: z.number().int().min(1),
    lastPageCount: z.number().int().min(1),
    permitRef: z.string().trim().min(1).max(256),
  }).strict(),
}).strict();

type CoordinatorReference = z.output<typeof coordinatorReferenceSchema>;
type BatchReference = z.output<typeof batchReferenceSchema>;

type JobAuthority = {
  operation: string;
  tenantId: string | null;
  procedimentoId: string | null;
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
};

function loadJob(jobId: string): Promise<JobAuthority | null> {
  return prisma.asyncJob.findUnique({
    where: { id: jobId },
    select: {
      operation: true,
      tenantId: true,
      procedimentoId: true,
      initiatingUserId: true,
      actorId: true,
      actorEmail: true,
      actorRole: true,
      policyDecisionRef: true,
    },
  });
}

function batchAdmissionInput(input: {
  runId: string;
  documentoId: string;
  documentFileVersionId: string;
  procedimentoId: string;
  tenantId: string;
  pageCount: number;
  firstPage: number;
  lastPage: number;
  permitRef: string;
  actor: { actorId: string; actorEmail: string | null; actorRole: string };
}) {
  return {
    operation: DOCUMENT_OCR_PAGE_BATCH_OPERATION,
    logicalOperationId: `${input.runId}:${input.firstPage}-${input.lastPage}`,
    purpose: "DOCUMENT_OCR_EXTRACTION",
    correlationId: `document-ocr:${input.runId}`,
    procedimentoId: input.procedimentoId,
    policyDecisionRef: input.permitRef,
    inputReference: {
      referenceType: "DOCUMENT_OCR_RUN",
      referenceId: input.runId,
      referenceVersion: "V2",
      metadata: {
        documentoId: input.documentoId,
        documentFileVersionId: input.documentFileVersionId,
        procedimentoId: input.procedimentoId,
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        pageCount: input.pageCount,
        firstPageCount: input.firstPage,
        lastPageCount: input.lastPage,
        permitRef: input.permitRef,
      },
    },
    maxAttempts: 3,
    availableAt: new Date(0),
    admission: {
      admissionType: "AUTHORIZED_SYSTEM" as const,
      tenantId: input.tenantId,
      initiatingUserId: null,
      actor: input.actor,
    },
  };
}

export async function ensureAuthorizedDocumentOcrExtractionJob(
  failedAttemptId: string,
) {
  const authorization = await issueDocumentOcrAuthorization(failedAttemptId);
  await verifyDocumentOcrAuthorization({
    authorizationRef: authorization.authorizationRef,
    failedAttemptId: authorization.failedAttemptId,
    documentoId: authorization.documentoId,
    documentFileVersionId: authorization.documentFileVersionId,
    tenantId: authorization.tenantId,
    procedimentoId: authorization.procedimentoId,
    actorUserId: authorization.actor.userId,
    actorRole: authorization.actor.userRole,
  });
  return admitAsyncJob({
    operation: DOCUMENT_OCR_COORDINATOR_OPERATION,
    logicalOperationId: [
      authorization.documentoId,
      authorization.documentFileVersionId,
      DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
      authorization.authorizationRef,
    ].join(":"),
    purpose: "DOCUMENT_OCR_EXTRACTION",
    correlationId: `document-ocr:${authorization.authorizationRef}`,
    procedimentoId: authorization.procedimentoId,
    policyDecisionRef: authorization.authorizationRef,
    inputReference: {
      referenceType: "DOCUMENT_FILE_VERSION",
      referenceId: authorization.documentFileVersionId,
      referenceVersion: "V2",
      metadata: {
        documentoId: authorization.documentoId,
        procedimentoId: authorization.procedimentoId,
        policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
        failedAttemptId: authorization.failedAttemptId,
        permitRef: authorization.authorizationRef,
      },
    },
    maxAttempts: 3,
    availableAt: authorization.createdAt,
    admission: {
      admissionType: "AUTHENTICATED_USER",
      tenantId: authorization.tenantId,
      initiatingUserId: authorization.actor.userId,
      actor: {
        actorId: authorization.actor.userId,
        actorEmail: authorization.actor.userEmail,
        actorRole: authorization.actor.userRole,
      },
    },
  });
}

function authorityMismatch(): never {
  throw new AsyncJobExecutionError("AUTHORIZATION", "DOCUMENT_OCR_AUTHORITY_MISMATCH", false);
}

async function verifyCoordinatorAuthority(
  input: CoordinatorReference,
  context: AsyncJobHandlerContext,
) {
  const job = await loadJob(context.jobId);
  if (
    !job
    || job.operation !== DOCUMENT_OCR_COORDINATOR_OPERATION
    || !job.tenantId
    || !job.initiatingUserId
    || job.procedimentoId !== input.metadata.procedimentoId
    || job.policyDecisionRef !== input.metadata.permitRef
  ) authorityMismatch();
  try {
    await verifyDocumentOcrAuthorization({
      authorizationRef: input.metadata.permitRef,
      failedAttemptId: input.metadata.failedAttemptId,
      documentoId: input.metadata.documentoId,
      documentFileVersionId: input.referenceId,
      tenantId: job.tenantId,
      procedimentoId: input.metadata.procedimentoId,
      actorUserId: job.initiatingUserId,
      actorRole: job.actorRole,
    });
  } catch (error) {
    if (!(error instanceof DocumentOcrAuthorizationError)) throw error;
    throw new AsyncJobExecutionError(
      "AUTHORIZATION",
      "DOCUMENT_OCR_AUTHORIZATION_INVALID",
      false,
    );
  }
  return job as JobAuthority & { tenantId: string; initiatingUserId: string };
}

export function createDocumentOcrCoordinatorHandler(): AsyncJobHandler<CoordinatorReference> {
  return {
    operation: DOCUMENT_OCR_COORDINATOR_OPERATION,
    parseInput: (input) => coordinatorReferenceSchema.parse(input),
    async execute(input, context) {
      const job = await verifyCoordinatorAuthority(input, context);
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      await context.heartbeat();
      const manifest = await inspectDocumentOcrManifest({
        documentoId: input.metadata.documentoId,
        documentFileVersionId: input.referenceId,
        tenantId: job.tenantId,
        procedimentoId: input.metadata.procedimentoId,
        sourceAttemptId: input.metadata.failedAttemptId,
        authorizationRef: input.metadata.permitRef,
      });
      const run = await runSerializableTransactionWithRetry(async (tx) => {
        const persisted = await ensureDocumentOcrRunInTransaction(tx, {
          coordinatorJobId: context.jobId,
          manifest,
        });
        await admitAsyncJobInTransaction(tx, batchAdmissionInput({
          runId: persisted.id,
          documentoId: persisted.documentoId,
          documentFileVersionId: persisted.documentFileVersionId,
          procedimentoId: persisted.procedimentoId,
          tenantId: persisted.tenantId,
          pageCount: persisted.pageCount,
          firstPage: 1,
          lastPage: Math.min(persisted.batchSize, persisted.pageCount),
          permitRef: persisted.authorizationRef,
          actor: {
            actorId: job.actorId,
            actorEmail: job.actorEmail,
            actorRole: job.actorRole,
          },
        }));
        return persisted;
      });
      return {
        referenceType: "DOCUMENT_OCR_RUN",
        referenceId: run.id,
        referenceVersion: "V2",
        metadata: {
          documentoId: run.documentoId,
          documentFileVersionId: run.documentFileVersionId,
          procedimentoId: run.procedimentoId,
          policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
          pageCount: run.pageCount,
        },
      };
    },
  };
}

export function createDocumentOcrPageBatchHandler(): AsyncJobHandler<BatchReference> {
  return {
    operation: DOCUMENT_OCR_PAGE_BATCH_OPERATION,
    parseInput: (input) => batchReferenceSchema.parse(input),
    async execute(input, context) {
      const job = await loadJob(context.jobId);
      if (
        !job
        || job.operation !== DOCUMENT_OCR_PAGE_BATCH_OPERATION
        || !job.tenantId
        || job.procedimentoId !== input.metadata.procedimentoId
        || job.policyDecisionRef !== input.metadata.permitRef
      ) authorityMismatch();
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      await context.heartbeat();
      const result = await processDocumentOcrBatch({
        runId: input.referenceId,
        documentoId: input.metadata.documentoId,
        documentFileVersionId: input.metadata.documentFileVersionId,
        tenantId: job.tenantId,
        procedimentoId: input.metadata.procedimentoId,
        authorizationRef: input.metadata.permitRef,
        firstPage: input.metadata.firstPageCount,
        lastPage: input.metadata.lastPageCount,
        actor: {
          userId: job.actorId,
          userEmail: job.actorEmail,
          userRole: job.actorRole,
        },
        onPageCompleted: context.heartbeat,
      });
      if (!result.completed) {
        if (input.metadata.lastPageCount >= input.metadata.pageCount) {
          throw new AsyncJobExecutionError(
            "EXTRACTION",
            "DOCUMENT_OCR_PAGE_SET_INCOMPLETE",
            true,
          );
        }
        const firstPage = input.metadata.lastPageCount + 1;
        await admitAsyncJob(batchAdmissionInput({
          runId: input.referenceId,
          documentoId: input.metadata.documentoId,
          documentFileVersionId: input.metadata.documentFileVersionId,
          procedimentoId: input.metadata.procedimentoId,
          tenantId: job.tenantId,
          pageCount: input.metadata.pageCount,
          firstPage,
          lastPage: Math.min(
            firstPage + DOCUMENT_OCR_BATCH_LIMITS_V2.pagesPerBatch - 1,
            input.metadata.pageCount,
          ),
          permitRef: input.metadata.permitRef,
          actor: {
            actorId: job.actorId,
            actorEmail: job.actorEmail,
            actorRole: job.actorRole,
          },
        }));
      } else {
        try {
          const { ensureFascicoloDocumentCorpusUpdateJob } = await import(
            "@/server/ai/fascicoloAutomaticAnalysisJob"
          );
          await ensureFascicoloDocumentCorpusUpdateJob({
            sourceJobId: context.jobId,
            documentoId: input.metadata.documentoId,
            documentFileVersionId: input.metadata.documentFileVersionId,
            extractionAttemptId: result.extractionAttemptId,
          });
        } catch (error) {
          if (error instanceof AsyncJobExecutionError) throw error;
          throw new AsyncJobExecutionError(
            "FASCICOLO_UPDATE_ADMISSION",
            "FASCICOLO_UPDATE_ADMISSION_FAILED",
            true,
          );
        }
      }
      return {
        referenceType: result.completed
          ? "DOCUMENT_EXTRACTION_ATTEMPT"
          : "DOCUMENT_OCR_RUN",
        referenceId: result.extractionAttemptId ?? input.referenceId,
        referenceVersion: "V2",
        metadata: {
          documentoId: input.metadata.documentoId,
          documentFileVersionId: input.metadata.documentFileVersionId,
          procedimentoId: input.metadata.procedimentoId,
          policyVersion: DOCUMENT_OCR_BATCH_EXTRACTION_POLICY_V2,
          firstPageCount: input.metadata.firstPageCount,
          lastPageCount: input.metadata.lastPageCount,
          completedEnabled: result.completed,
        },
      };
    },
  };
}

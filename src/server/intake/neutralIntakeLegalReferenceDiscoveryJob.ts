import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  discoverItalianLegalReferences,
  LEGAL_REFERENCE_DISCOVERY_VERSION,
} from "./legal-reference-discovery/parser";
import { ensureLegalReferenceMatchingJob } from "./neutralIntakeLegalReferenceMatchingJob";

export const LEGAL_REFERENCE_DISCOVERY_OPERATION = "LEGAL_REFERENCE_DISCOVERY_V1" as const;
export const LEGAL_REFERENCE_DISCOVERY_PURPOSE = "LEGAL_REFERENCE_DISCOVERY" as const;
export const MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION = 2000;

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_REFERENCE_DISCOVERY"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    extractionAttemptId: z.string().trim().min(1).max(256),
    discoveryVersion: z.literal(LEGAL_REFERENCE_DISCOVERY_VERSION),
  }).strict(),
}).strict();

type DiscoveryReference = z.output<typeof referenceSchema>;

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

function logicalOperationId(neutralIntakeId: string, extractionAttemptId: string): string {
  return createHash("sha256").update([
    LEGAL_REFERENCE_DISCOVERY_OPERATION,
    neutralIntakeId,
    extractionAttemptId,
    LEGAL_REFERENCE_DISCOVERY_VERSION,
  ].join("\n"), "utf8").digest("hex");
}

export function buildLegalReferenceDiscoveryAdmission(
  input: { neutralIntakeId: string; extractionAttemptId: string },
  provenance: SourceJobProvenance,
): AsyncJobAdmissionInput {
  return {
    operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
    logicalOperationId: logicalOperationId(input.neutralIntakeId, input.extractionAttemptId),
    purpose: LEGAL_REFERENCE_DISCOVERY_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: {
      referenceType: "LEGAL_REFERENCE_DISCOVERY",
      referenceId: input.neutralIntakeId,
      referenceVersion: "V1",
      metadata: {
        extractionAttemptId: input.extractionAttemptId,
        discoveryVersion: LEGAL_REFERENCE_DISCOVERY_VERSION,
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

export async function ensureLegalReferenceDiscoveryJobInTransaction(
  tx: Prisma.TransactionClient,
  input: { sourceJobId: string; neutralIntakeId: string; extractionAttemptId?: string },
) {
  const [sourceJob, intake, extractionAttempt] = await Promise.all([
    tx.asyncJob.findUnique({ where: { id: input.sourceJobId } }),
    tx.neutralIntake.findUnique({
      where: { id: input.neutralIntakeId },
      select: {
        id: true,
        enteId: true,
        destination: {
          select: { procedimento: { select: { concessione: { select: { enteId: true } } } } },
        },
      },
    }),
    input.extractionAttemptId
      ? tx.neutralIntakeExtractionAttempt.findUnique({ where: { id: input.extractionAttemptId } })
      : tx.neutralIntakeExtractionAttempt.findFirst({
          where: { neutralIntakeId: input.neutralIntakeId, outcome: "SUCCEEDED" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        }),
  ]);
  if (
    !sourceJob
    || sourceJob.operation !== "NEUTRAL_INTAKE_EXTRACTION_V1"
    || !intake
    || sourceJob.tenantId !== intake.enteId
    || !extractionAttempt
    || extractionAttempt.neutralIntakeId !== intake.id
    || extractionAttempt.outcome !== "SUCCEEDED"
  ) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_DISCOVERY", "DISCOVERY_ADMISSION_EVIDENCE_MISMATCH", false);
  }
  if (!intake.destination) return { outcome: "NOT_ELIGIBLE" as const, job: null };

  const canonicalEnteId = intake.destination.procedimento.concessione.enteId;
  if (!canonicalEnteId || canonicalEnteId !== intake.enteId) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_DISCOVERY", "DISCOVERY_ADMISSION_AUTHORITY_MISMATCH", false);
  }

  return admitAsyncJobInTransaction(tx, buildLegalReferenceDiscoveryAdmission(
    { neutralIntakeId: intake.id, extractionAttemptId: extractionAttempt.id },
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
  ));
}

export function ensureLegalReferenceDiscoveryJob(input: {
  sourceJobId: string;
  neutralIntakeId: string;
  extractionAttemptId?: string;
}) {
  return runSerializableTransactionWithRetry((tx) =>
    ensureLegalReferenceDiscoveryJobInTransaction(tx, input));
}

export async function discoverLegalReferencesInTransaction(
  tx: Prisma.TransactionClient,
  input: { jobId: string; neutralIntakeId: string; extractionAttemptId: string },
) {
  const [job, attempt] = await Promise.all([
    tx.asyncJob.findUnique({ where: { id: input.jobId }, select: { operation: true, tenantId: true } }),
    tx.neutralIntakeExtractionAttempt.findUnique({
      where: { id: input.extractionAttemptId },
      include: {
        pages: { orderBy: { pageNumber: "asc" } },
        neutralIntake: {
          select: {
            id: true,
            enteId: true,
            destination: {
              select: { procedimento: { select: { concessione: { select: { enteId: true } } } } },
            },
          },
        },
      },
    }),
  ]);
  const canonicalEnteId = attempt?.neutralIntake.destination?.procedimento.concessione.enteId ?? null;
  if (
    !job
    || job.operation !== LEGAL_REFERENCE_DISCOVERY_OPERATION
    || !attempt
    || attempt.outcome !== "SUCCEEDED"
    || attempt.neutralIntakeId !== input.neutralIntakeId
    || attempt.neutralIntake.id !== input.neutralIntakeId
    || !canonicalEnteId
    || attempt.neutralIntake.enteId !== canonicalEnteId
    || job.tenantId !== canonicalEnteId
  ) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_DISCOVERY", "DISCOVERY_EXECUTION_AUTHORITY_MISMATCH", false);
  }

  const mentions = [];
  for (const page of attempt.pages) {
    const remainingCapacity = MAX_LEGAL_REFERENCE_MENTIONS_PER_EXTRACTION - mentions.length;
    const pageReferences = discoverItalianLegalReferences(page.normalizedText, remainingCapacity);
    if (pageReferences.length > remainingCapacity) {
      throw new AsyncJobExecutionError(
        "LEGAL_REFERENCE_DISCOVERY",
        "LEGAL_REFERENCE_DISCOVERY_LIMIT_EXCEEDED",
        false,
      );
    }
    mentions.push(...pageReferences.map((reference) => ({
      extractionAttemptId: attempt.id,
      extractionPageId: page.id,
      discoveryVersion: LEGAL_REFERENCE_DISCOVERY_VERSION,
      ...reference,
    })));
  }
  if (mentions.length > 0) {
    await tx.legalReferenceMention.createMany({ data: mentions, skipDuplicates: true });
  }
  return { mentionCount: mentions.length };
}

async function executeDiscovery(
  input: DiscoveryReference,
  context: AsyncJobHandlerContext,
  ensureMatching: typeof ensureLegalReferenceMatchingJob,
) {
  if (await context.isCancellationRequested()) {
    throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
  }
  const result = await runSerializableTransactionWithRetry((tx) =>
    discoverLegalReferencesInTransaction(tx, {
      jobId: context.jobId,
      neutralIntakeId: input.referenceId,
      extractionAttemptId: input.metadata.extractionAttemptId,
    }));
  try {
    await ensureMatching({
      sourceJobId: context.jobId,
      neutralIntakeId: input.referenceId,
      extractionAttemptId: input.metadata.extractionAttemptId,
    });
  } catch (error) {
    if (error instanceof AsyncJobExecutionError) throw error;
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_MATCHING_ADMISSION", "MATCHING_ADMISSION_FAILED", true);
  }
  return {
    referenceType: "LEGAL_REFERENCE_DISCOVERY_RESULT",
    referenceId: input.referenceId,
    referenceVersion: LEGAL_REFERENCE_DISCOVERY_VERSION,
    metadata: { mentionCount: result.mentionCount },
  };
}

export function createLegalReferenceDiscoveryHandler(
  ensureMatching: typeof ensureLegalReferenceMatchingJob = ensureLegalReferenceMatchingJob,
): AsyncJobHandler<DiscoveryReference> {
  return {
    operation: LEGAL_REFERENCE_DISCOVERY_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: (input, context) => executeDiscovery(input, context, ensureMatching),
  };
}
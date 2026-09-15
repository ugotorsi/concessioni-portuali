import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  LEGAL_REFERENCE_MATCHING_VERSION,
  matchLegalReferenceMention,
} from "./legal-reference-matching/matcher";

export const LEGAL_REFERENCE_MATCHING_OPERATION = "LEGAL_REFERENCE_MATCHING_V1" as const;
export const LEGAL_REFERENCE_MATCHING_PURPOSE = "LEGAL_REFERENCE_MATCHING" as const;
export const MAX_LOCAL_LEGAL_SOURCES_PER_MATCHING_JOB = 10_000;
const SOURCE_DISCOVERY_OPERATION = "LEGAL_REFERENCE_DISCOVERY_V1";

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_REFERENCE_MATCHING"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    extractionAttemptId: z.string().trim().min(1).max(256),
    matchingVersion: z.literal(LEGAL_REFERENCE_MATCHING_VERSION),
  }).strict(),
}).strict();

type MatchingReference = z.output<typeof referenceSchema>;

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
    LEGAL_REFERENCE_MATCHING_OPERATION,
    neutralIntakeId,
    extractionAttemptId,
    LEGAL_REFERENCE_MATCHING_VERSION,
  ].join("\n"), "utf8").digest("hex");
}

export function buildLegalReferenceMatchingAdmission(
  input: { neutralIntakeId: string; extractionAttemptId: string },
  provenance: SourceJobProvenance,
): AsyncJobAdmissionInput {
  return {
    operation: LEGAL_REFERENCE_MATCHING_OPERATION,
    logicalOperationId: logicalOperationId(input.neutralIntakeId, input.extractionAttemptId),
    purpose: LEGAL_REFERENCE_MATCHING_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: {
      referenceType: "LEGAL_REFERENCE_MATCHING",
      referenceId: input.neutralIntakeId,
      referenceVersion: "V1",
      metadata: {
        extractionAttemptId: input.extractionAttemptId,
        matchingVersion: LEGAL_REFERENCE_MATCHING_VERSION,
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

export async function ensureLegalReferenceMatchingJobInTransaction(
  tx: Prisma.TransactionClient,
  input: { sourceJobId: string; neutralIntakeId: string; extractionAttemptId: string },
) {
  const [sourceJob, attempt] = await Promise.all([
    tx.asyncJob.findUnique({ where: { id: input.sourceJobId } }),
    tx.neutralIntakeExtractionAttempt.findUnique({
      where: { id: input.extractionAttemptId },
      select: {
        id: true,
        neutralIntakeId: true,
        outcome: true,
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
    !sourceJob
    || sourceJob.operation !== SOURCE_DISCOVERY_OPERATION
    || !attempt
    || attempt.outcome !== "SUCCEEDED"
    || attempt.neutralIntakeId !== input.neutralIntakeId
    || attempt.neutralIntake.id !== input.neutralIntakeId
    || !canonicalEnteId
    || attempt.neutralIntake.enteId !== canonicalEnteId
    || sourceJob.tenantId !== canonicalEnteId
  ) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_MATCHING", "MATCHING_ADMISSION_AUTHORITY_MISMATCH", false);
  }

  return admitAsyncJobInTransaction(tx, buildLegalReferenceMatchingAdmission(
    { neutralIntakeId: input.neutralIntakeId, extractionAttemptId: input.extractionAttemptId },
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

export function ensureLegalReferenceMatchingJob(input: {
  sourceJobId: string;
  neutralIntakeId: string;
  extractionAttemptId: string;
}) {
  return runSerializableTransactionWithRetry((tx) =>
    ensureLegalReferenceMatchingJobInTransaction(tx, input));
}

export async function matchLegalReferencesInTransaction(
  tx: Prisma.TransactionClient,
  input: { jobId: string; neutralIntakeId: string; extractionAttemptId: string },
) {
  const [job, attempt] = await Promise.all([
    tx.asyncJob.findUnique({ where: { id: input.jobId }, select: { operation: true, tenantId: true } }),
    tx.neutralIntakeExtractionAttempt.findUnique({
      where: { id: input.extractionAttemptId },
      select: {
        id: true,
        neutralIntakeId: true,
        outcome: true,
        neutralIntake: {
          select: {
            id: true,
            enteId: true,
            destination: {
              select: { procedimento: { select: { concessione: { select: { enteId: true } } } } },
            },
          },
        },
        legalReferenceMentions: {
          where: { discoveryVersion: "LEGAL_REFERENCE_DISCOVERY_V1" },
          select: {
            id: true,
            kind: true,
            normalizedKey: true,
            authorityHint: true,
            actType: true,
            actNumber: true,
            year: true,
            chamberSection: true,
            matches: {
              where: { matchingVersion: LEGAL_REFERENCE_MATCHING_VERSION },
              select: { id: true },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    }),
  ]);
  const canonicalEnteId = attempt?.neutralIntake.destination?.procedimento.concessione.enteId ?? null;
  if (
    !job
    || job.operation !== LEGAL_REFERENCE_MATCHING_OPERATION
    || !attempt
    || attempt.outcome !== "SUCCEEDED"
    || attempt.neutralIntakeId !== input.neutralIntakeId
    || attempt.neutralIntake.id !== input.neutralIntakeId
    || !canonicalEnteId
    || attempt.neutralIntake.enteId !== canonicalEnteId
    || job.tenantId !== canonicalEnteId
  ) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_MATCHING", "MATCHING_EXECUTION_AUTHORITY_MISMATCH", false);
  }

  const pendingMentions = attempt.legalReferenceMentions.filter((mention) => mention.matches.length === 0);
  if (pendingMentions.length === 0) {
    return { mentionCount: attempt.legalReferenceMentions.length, persistedCount: 0 };
  }
  const sources = await tx.legalSource.findMany({
    where: {
      AND: [
        { OR: [{ enteId: canonicalEnteId }, { enteId: null }] },
        { duplicateOfSourceKey: null },
        { status: { not: "MISSING_SOURCE" } },
      ],
    },
    select: {
      id: true,
      enteId: true,
      sourceType: true,
      legalAuthorityKind: true,
      issuingBody: true,
      sourceNumber: true,
      sourceDate: true,
      identityNamespace: true,
      identityScopeKind: true,
      identityScopeKey: true,
      canonicalKey: true,
      identityAssertions: {
        select: {
          identifierScheme: true,
          normalizedValue: true,
          issuingAuthority: true,
          jurisdiction: true,
          verificationStatus: true,
        },
      },
    },
    take: MAX_LOCAL_LEGAL_SOURCES_PER_MATCHING_JOB + 1,
  });
  if (sources.length > MAX_LOCAL_LEGAL_SOURCES_PER_MATCHING_JOB) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_MATCHING", "MATCHING_CATALOG_LIMIT_EXCEEDED", false);
  }
  const data = pendingMentions.map(({ matches: _matches, ...mention }) => ({
    mentionId: mention.id,
    matchingVersion: LEGAL_REFERENCE_MATCHING_VERSION,
    ...matchLegalReferenceMention(mention, sources),
  }));
  await tx.legalReferenceMatch.createMany({ data, skipDuplicates: true });
  return { mentionCount: attempt.legalReferenceMentions.length, persistedCount: data.length };
}

async function executeMatching(input: MatchingReference, context: AsyncJobHandlerContext) {
  if (await context.isCancellationRequested()) {
    throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
  }
  const result = await runSerializableTransactionWithRetry((tx) =>
    matchLegalReferencesInTransaction(tx, {
      jobId: context.jobId,
      neutralIntakeId: input.referenceId,
      extractionAttemptId: input.metadata.extractionAttemptId,
    }));
  return {
    referenceType: "LEGAL_REFERENCE_MATCHING_RESULT",
    referenceId: input.referenceId,
    referenceVersion: LEGAL_REFERENCE_MATCHING_VERSION,
    metadata: result,
  };
}

export function createLegalReferenceMatchingHandler(): AsyncJobHandler<MatchingReference> {
  return {
    operation: LEGAL_REFERENCE_MATCHING_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: executeMatching,
  };
}
import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import { admitLegalReferenceOfficialReconciliationInTransaction } from "./neutralIntakeLegalReferenceOfficialReconciliationJob";

import {
  createNormattivaOfficialProvider,
} from "./official-source-lookup/normattiva";
import { createLegalDataHunterProvider } from "./official-source-lookup/legalDataHunter";
import {
  OfficialLegalReferenceProviderError,
  OfficialLegalReferenceProviderRegistry,
  type OfficialLegalReferenceLookupResult,
  type OfficialLegalReferenceProviderIdentity,
} from "./official-source-lookup/providers";

export const LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION = "LEGAL_REFERENCE_OFFICIAL_LOOKUP_V1" as const;
export const LEGAL_REFERENCE_OFFICIAL_LOOKUP_PURPOSE = "LEGAL_REFERENCE_OFFICIAL_LOOKUP" as const;
export const officialLegalReferenceProviderRegistry = new OfficialLegalReferenceProviderRegistry([
  createNormattivaOfficialProvider(),
  createLegalDataHunterProvider(),
]);

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_REFERENCE_OFFICIAL_LOOKUP"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    providerCode: z.string().trim().min(1).max(100),
    lookupVersion: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

type LookupReference = z.output<typeof referenceSchema>;

export type OfficialLookupSourceJob = {
  tenantId: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
  policyDecisionRef: string | null;
  correlationId: string;
};

export function officialLookupLogicalOperationId(
  mentionId: string,
  provider: OfficialLegalReferenceProviderIdentity,
): string {
  return createHash("sha256").update([
    LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
    provider.providerKey,
    provider.lookupVersion,
    mentionId,
  ].join("\n"), "utf8").digest("hex");
}

export function buildLegalReferenceOfficialLookupAdmission(
  mentionId: string,
  provider: OfficialLegalReferenceProviderIdentity,
  provenance: OfficialLookupSourceJob,
): AsyncJobAdmissionInput {
  return {
    operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
    logicalOperationId: officialLookupLogicalOperationId(mentionId, provider),
    purpose: LEGAL_REFERENCE_OFFICIAL_LOOKUP_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: {
      referenceType: "LEGAL_REFERENCE_OFFICIAL_LOOKUP",
      referenceId: mentionId,
      referenceVersion: "V1",
      metadata: {
        providerCode: provider.providerKey,
        lookupVersion: provider.lookupVersion,
      },
    },
    maxAttempts: 3,
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

export function admitLegalReferenceOfficialLookupInTransaction(
  tx: Prisma.TransactionClient,
  mentionId: string,
  provider: OfficialLegalReferenceProviderIdentity,
  provenance: OfficialLookupSourceJob,
) {
  return admitAsyncJobInTransaction(tx, buildLegalReferenceOfficialLookupAdmission(mentionId, provider, provenance));
}

async function prepareLookup(
  tx: Prisma.TransactionClient,
  jobId: string,
  mentionId: string,
  providerIdentity: OfficialLegalReferenceProviderIdentity,
  registry: OfficialLegalReferenceProviderRegistry,
) {
  const [job, mention] = await Promise.all([
    tx.asyncJob.findUnique({
      where: { id: jobId },
      select: {
        operation: true,
        logicalOperationId: true,
        tenantId: true,
        admissionType: true,
        initiatingUserId: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
        policyDecisionRef: true,
        correlationId: true,
      },
    }),
    tx.legalReferenceMention.findUnique({
      where: { id: mentionId },
      select: {
        id: true,
        kind: true,
        actType: true,
        actNumber: true,
        year: true,
        authorityHint: true,
        chamberSection: true,
        extractionAttempt: { select: { neutralIntake: { select: { enteId: true } } } },
        matches: {
          where: { matchingVersion: "LEGAL_REFERENCE_MATCHING_V1" },
          select: { status: true, reason: true },
        },
      },
    }),
  ]);
  const match = mention?.matches[0];
  const provider = registry.resolve(providerIdentity);
  if (
    !job
    || job.operation !== LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION
    || job.logicalOperationId !== officialLookupLogicalOperationId(mentionId, providerIdentity)
    || !mention
    || mention.extractionAttempt.neutralIntake.enteId !== job.tenantId
    || match?.status !== "NO_MATCH"
    || match.reason !== "NO_CATALOG_MATCH"
    || !provider
    || !provider.supports(mention)
  ) {
    throw new AsyncJobExecutionError("LEGAL_REFERENCE_OFFICIAL_LOOKUP", "OFFICIAL_LOOKUP_AUTHORITY_MISMATCH", false);
  }
  const existing = await tx.legalReferenceOfficialLookup.findUnique({
    where: {
      mentionId_provider_lookupVersion: {
        mentionId,
          provider: provider.providerKey,
          lookupVersion: provider.lookupVersion,
      },
    },
    select: { id: true, status: true, resultCount: true },
  });
  const provenance: OfficialLookupSourceJob = {
    tenantId: job.tenantId,
    admissionType: job.admissionType,
    initiatingUserId: job.initiatingUserId,
    actorId: job.actorId,
    actorEmail: job.actorEmail,
    actorRole: job.actorRole,
    policyDecisionRef: job.policyDecisionRef,
    correlationId: job.correlationId,
  };
  if (existing) return { outcome: "EXISTING", existing, provenance } as const;
  return { outcome: "READY", mentionId: mention.id, mention, provider, provenance } as const;
}

async function persistLookup(
  tx: Prisma.TransactionClient,
  mentionId: string,
  provider: OfficialLegalReferenceProviderIdentity,
  result: OfficialLegalReferenceLookupResult,
) {
  const existing = await tx.legalReferenceOfficialLookup.findUnique({
    where: {
      mentionId_provider_lookupVersion: {
        mentionId,
          provider: provider.providerKey,
          lookupVersion: provider.lookupVersion,
      },
    },
    select: { id: true, status: true, resultCount: true },
  });
  if (existing) return existing;
  return tx.legalReferenceOfficialLookup.create({
    data: {
      mentionId,
      provider: provider.providerKey,
      lookupVersion: provider.lookupVersion,
      status: result.status,
      resultCount: result.resultCount,
      hits: {
        create: result.hits.map((hit) => hit.documentKind === "LEGISLATION"
          ? {
              documentKind: hit.documentKind,
              providerRecordId: hit.providerRecordId,
              providerSourceId: hit.providerSourceId,
              denominazioneAtto: hit.sourceType,
              numeroProvvedimento: hit.actNumber,
              annoProvvedimento: hit.actYear,
              dataEmanazione: hit.issuedAt,
              descrizioneAtto: hit.description,
              titoloAtto: hit.title,
              numeroGU: hit.publicationNumber,
              dataGU: hit.publishedAt,
            }
          : {
              documentKind: hit.documentKind,
              providerRecordId: hit.providerRecordId,
              providerSourceId: hit.providerSourceId,
              authority: hit.authority,
              court: hit.court,
              decisionNumber: hit.decisionNumber,
              decisionYear: hit.decisionYear,
              decisionDate: hit.decidedAt,
              chamberSection: hit.chamberSection,
              decisionType: hit.decisionType,
              ecli: hit.ecli,
              publicationDate: hit.publicationDate,
              subject: hit.subject,
              outcome: hit.outcome,
              titoloAtto: hit.title,
              sourceUrl: hit.sourceUrl,
            }),
      },
    },
    select: { id: true, status: true, resultCount: true },
  });
}

function providerFailure(error: unknown): AsyncJobExecutionError {
  if (error instanceof OfficialLegalReferenceProviderError) {
    return new AsyncJobExecutionError("OFFICIAL_PROVIDER", `${error.providerKey}_${error.code}`, error.retryable);
  }
  return new AsyncJobExecutionError("OFFICIAL_PROVIDER", "OFFICIAL_PROVIDER_UNAVAILABLE", true);
}

export function createLegalReferenceOfficialLookupHandler(
  registry: OfficialLegalReferenceProviderRegistry = officialLegalReferenceProviderRegistry,
  admitReconciliation: typeof admitLegalReferenceOfficialReconciliationInTransaction =
    admitLegalReferenceOfficialReconciliationInTransaction,
): AsyncJobHandler<LookupReference> {
  return {
    operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: async (input: LookupReference, context: AsyncJobHandlerContext) => {
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const providerIdentity = {
        providerKey: input.metadata.providerCode,
        lookupVersion: input.metadata.lookupVersion,
      };
      const prepared = await runSerializableTransactionWithRetry((tx) =>
        prepareLookup(tx, context.jobId, input.referenceId, providerIdentity, registry));
      if (prepared.outcome === "EXISTING") {
        if (prepared.existing.status === "FOUND_UNIQUE") {
          await runSerializableTransactionWithRetry((tx) =>
            admitReconciliation(
              tx,
              prepared.existing.id,
              prepared.provenance,
            ));
        }
        return {
          referenceType: "LEGAL_REFERENCE_OFFICIAL_LOOKUP_RESULT",
          referenceId: prepared.existing.id,
          referenceVersion: providerIdentity.lookupVersion,
          metadata: { status: prepared.existing.status, resultCount: prepared.existing.resultCount, reused: true },
        };
      }
      let result: OfficialLegalReferenceLookupResult;
      try {
        result = await prepared.provider.lookup(prepared.mention);
      } catch (error) {
        throw providerFailure(error);
      }
      const persisted = await runSerializableTransactionWithRetry(async (tx) => {
        const lookup = await persistLookup(tx, prepared.mentionId, providerIdentity, result);
        if (lookup.status === "FOUND_UNIQUE") {
          await admitReconciliation(
            tx,
            lookup.id,
            prepared.provenance,
          );
        }
        return lookup;
      });
      return {
        referenceType: "LEGAL_REFERENCE_OFFICIAL_LOOKUP_RESULT",
        referenceId: persisted.id,
        referenceVersion: providerIdentity.lookupVersion,
        metadata: { status: persisted.status, resultCount: persisted.resultCount, reused: false },
      };
    },
  };
}
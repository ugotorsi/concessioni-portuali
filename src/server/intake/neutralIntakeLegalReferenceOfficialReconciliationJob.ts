import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJobInTransaction } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  buildOfficialHitIdentityV1,
  fingerprintOfficialHitEvidenceV1,
  LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
  LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION,
  rebuildOfficialIdentityV2,
  verifiedAssertionsMatchIdentity,
  verifyPersistedOfficialIdentityV2,
  type NormalizedOfficialIdentity,
} from "./official-hit-reconciliation/identity";
import {
  classifyOfficialEvidenceProvider,
  explicitIdentityFactsConflict,
  mergeClassifiedIdentityEvidence,
} from "./official-hit-reconciliation/policy";
import { LEGAL_REFERENCE_IDENTITY_NAMESPACE } from "./legal-reference-matching/matcher";
import type { OfficialLookupSourceJob } from "./neutralIntakeLegalReferenceOfficialLookupJob";

export const LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION =
  "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_V1" as const;
export const LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_PURPOSE =
  "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION" as const;
export const LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION =
  "LEGAL_REFERENCE_MATCHING_V2_OFFICIAL_RECONCILIATION" as const;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function p2002Fields(error: unknown): { modelName: string; fields: string[] } | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const meta = error.meta as {
    modelName?: unknown;
    target?: unknown;
    driverAdapterError?: {
      cause?: { kind?: unknown; originalCode?: unknown; constraint?: { fields?: unknown } };
    };
  } | undefined;
  if (typeof meta?.modelName !== "string") return null;
  const adapterCause = meta.driverAdapterError?.cause;
  const raw = meta.target ?? (
    adapterCause?.kind === "UniqueConstraintViolation" && adapterCause.originalCode === "23505"
      ? adapterCause.constraint?.fields
      : undefined
  );
  const fields = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) return null;
  return { modelName: meta.modelName, fields: fields.map((field) => field.replace(/^"|"$/g, "")) };
}

function sameFields(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((field) => actual.includes(field));
}

export function isOfficialReconciliationRetryableP2002(error: unknown): boolean {
  const violation = p2002Fields(error);
  if (!violation) return false;
  return (violation.modelName === "LegalReferenceOfficialReconciliation"
      && (sameFields(violation.fields, ["mentionId", "identityVersion"])
        || (violation.fields.length === 1 && violation.fields[0] === "mentionId_identityVersion")))
    || (violation.modelName === "LegalReferenceOfficialReconciliationEvidence"
      && (sameFields(violation.fields, ["officialHitId", "identityVersion"])
        || (violation.fields.length === 1 && violation.fields[0] === "officialHitId_identityVersion")));
}

const referenceSchema = z.object({
  referenceType: z.literal("LEGAL_REFERENCE_OFFICIAL_RECONCILIATION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    identityVersion: z.literal(LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION),
    policyVersion: z.literal(LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION),
  }).strict(),
}).strict();

type ReconciliationReference = z.output<typeof referenceSchema>;

function logicalOperationId(lookupId: string): string {
  return createHash("sha256").update([
    LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
    LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
    LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION,
    lookupId,
  ].join("\n"), "utf8").digest("hex");
}

export function buildLegalReferenceOfficialReconciliationAdmission(
  lookupId: string,
  provenance: OfficialLookupSourceJob,
): AsyncJobAdmissionInput {
  return {
    operation: LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
    logicalOperationId: logicalOperationId(lookupId),
    purpose: LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_PURPOSE,
    correlationId: provenance.correlationId,
    policyDecisionRef: provenance.policyDecisionRef,
    inputReference: {
      referenceType: "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
      referenceId: lookupId,
      referenceVersion: "V1",
      metadata: {
        identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
        policyVersion: LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION,
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

export function admitLegalReferenceOfficialReconciliationInTransaction(
  tx: Prisma.TransactionClient,
  lookupId: string,
  provenance: OfficialLookupSourceJob,
) {
  return admitAsyncJobInTransaction(
    tx,
    buildLegalReferenceOfficialReconciliationAdmission(lookupId, provenance),
  );
}

async function appendReconciledMatch(
  tx: Prisma.TransactionClient,
  mentionId: string,
  legalSourceId: string,
): Promise<void> {
  await tx.legalReferenceMatch.createMany({
    data: [{
      mentionId,
      matchingVersion: LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION,
      status: "MATCHED",
      reason: "EXACT_IDENTITY",
      legalSourceId,
      candidateCount: 1,
    }],
    skipDuplicates: true,
  });
}

function requirePersistedIdentityIntegrity(reconciliation: {
  identityVersion: string;
  normalizedIdentity: unknown;
  identityFingerprint: string | null;
}) {
  const verified = verifyPersistedOfficialIdentityV2(reconciliation);
  if (!verified) {
    throw new AsyncJobExecutionError(
      "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
      "OFFICIAL_RECONCILIATION_IDENTITY_INTEGRITY_FAILED",
      false,
    );
  }
  return verified;
}
export async function reconcileOfficialLookupInTransaction(
  tx: Prisma.TransactionClient,
  input: { jobId: string; lookupId: string },
) {
  const [job, lookup] = await Promise.all([
    tx.asyncJob.findUnique({
      where: { id: input.jobId },
      select: { operation: true, logicalOperationId: true, tenantId: true },
    }),
    tx.legalReferenceOfficialLookup.findUnique({
      where: { id: input.lookupId },
      select: {
        id: true,
        provider: true,
        lookupVersion: true,
        status: true,
        resultCount: true,
        completedAt: true,
        mention: {
          select: {
            id: true,
            kind: true,
            extractionAttempt: { select: { neutralIntake: { select: { enteId: true } } } },
          },
        },
        hits: {
          select: {
            id: true,
            documentKind: true,
            providerSourceId: true,
            providerRecordId: true,
            denominazioneAtto: true,
            numeroProvvedimento: true,
            annoProvvedimento: true,
            dataEmanazione: true,
            titoloAtto: true,
            authority: true,
            court: true,
            decisionNumber: true,
            decisionYear: true,
            decisionDate: true,
            chamberSection: true,
            decisionType: true,
            ecli: true,
            publicationDate: true,
            sourceUrl: true,
            reconciliationEvidence: {
              where: { identityVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION },
              select: {
                reconciliationId: true,
                reconciliation: {
                  select: {
                    identityVersion: true,
                    normalizedIdentity: true,
                    identityFingerprint: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);
  if (
    !job
    || job.operation !== LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION
    || job.logicalOperationId !== logicalOperationId(input.lookupId)
    || !lookup
    || lookup.status !== "FOUND_UNIQUE"
    || lookup.resultCount !== 1
    || lookup.hits.length !== 1
    || lookup.mention.extractionAttempt.neutralIntake.enteId !== job.tenantId
  ) {
    throw new AsyncJobExecutionError(
      "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
      "RECONCILIATION_AUTHORITY_MISMATCH",
      false,
    );
  }

  const hit = lookup.hits[0];
  if (hit.reconciliationEvidence[0]) {
    requirePersistedIdentityIntegrity(hit.reconciliationEvidence[0].reconciliation);
    return { reconciliationId: hit.reconciliationEvidence[0].reconciliationId, reused: true };
  }
  if (hit.documentKind !== "LEGISLATION" && hit.documentKind !== "CASE_LAW") {
    throw new AsyncJobExecutionError(
      "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
      "UNSUPPORTED_DOCUMENT_KIND",
      false,
    );
  }
  if (lookup.mention.kind !== hit.documentKind) {
    throw new AsyncJobExecutionError(
      "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
      "HIT_MENTION_KIND_CONFLICT",
      false,
    );
  }

  const identityInput = {
    documentKind: hit.documentKind as "LEGISLATION" | "CASE_LAW",
    denominazioneAtto: hit.denominazioneAtto,
    numeroProvvedimento: hit.numeroProvvedimento,
    annoProvvedimento: hit.annoProvvedimento,
    authority: hit.authority,
    decisionNumber: hit.decisionNumber,
    decisionYear: hit.decisionYear,
    chamberSection: hit.chamberSection,
    court: hit.court,
    decisionType: hit.decisionType,
    ecli: hit.ecli,
  };
  const identity = buildOfficialHitIdentityV1(identityInput);
  const classification = classifyOfficialEvidenceProvider(lookup.provider);
  const evidenceFingerprint = fingerprintOfficialHitEvidenceV1({
    ...identityInput,
    provider: lookup.provider,
    providerRecordId: hit.providerRecordId,
    providerSourceId: hit.providerSourceId,
    issuedAt: hit.documentKind === "LEGISLATION" ? hit.dataEmanazione : hit.decisionDate,
    title: hit.titoloAtto,
    sourceUrl: hit.sourceUrl,
  });

  const persistedReconciliation = await tx.legalReferenceOfficialReconciliation.findUnique({
    where: {
      mentionId_identityVersion: {
        mentionId: lookup.mention.id,
        identityVersion: identity.identityVersion,
      },
    },
    select: {
      identityVersion: true,
      normalizedIdentity: true,
      identityFingerprint: true,
      state: true,
    },
  });
  const persistedIdentity = persistedReconciliation?.identityFingerprint
    ? requirePersistedIdentityIntegrity(persistedReconciliation)
    : null;
  if (persistedReconciliation
    && (persistedReconciliation.identityVersion !== LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION
      || (persistedReconciliation.state !== "INCOMPLETE" && !persistedIdentity))) {
    requirePersistedIdentityIntegrity(persistedReconciliation);
  }

  let legalSourceId: string | null = null;
  if (identity.canonicalKey && (!persistedReconciliation || persistedIdentity)) {
    const source = await tx.legalSource.findUnique({
      where: {
        identityNamespace_identityScopeKey_canonicalKey: {
          identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
          identityScopeKey: "GLOBAL",
          canonicalKey: identity.canonicalKey,
        },
      },
      select: {
        id: true,
        identityAssertions: {
          where: {
            identifierScheme: identity.identityVersion,
            verificationStatus: "VERIFIED",
          },
          select: { normalizedValue: true },
        },
      },
    });
    legalSourceId = source && verifiedAssertionsMatchIdentity(
      source.identityAssertions,
      identity.identityFingerprint!,
    ) ? source.id : null;
  }

  const state = identity.identityConflict
    ? "CONFLICTED" as const
    : identity.identityFingerprint === null
      ? "INCOMPLETE" as const
    : legalSourceId
      ? "LINKED_EXISTING" as const
      : "PENDING_REVIEW" as const;
  let reconciliation = identity.identityFingerprint === null
    ? await tx.legalReferenceOfficialReconciliation.upsert({
        where: {
          mentionId_identityVersion: {
            mentionId: lookup.mention.id,
            identityVersion: identity.identityVersion,
          },
        },
        create: {
          mentionId: lookup.mention.id,
          kind: lookup.mention.kind,
          jurisdiction: identity.normalizedIdentity.jurisdiction,
          ...(identity.normalizedIdentity.kind === "CASE_LAW" ? {
            courtFamily: identity.normalizedIdentity.courtFamily,
            courtLocality: identity.normalizedIdentity.courtLocality,
            courtBranch: identity.normalizedIdentity.courtBranch,
            decisionType: identity.normalizedIdentity.decisionType,
            decisionNumber: identity.normalizedIdentity.decisionNumber,
            decisionYear: identity.normalizedIdentity.year,
            section: identity.normalizedIdentity.section,
            ecli: identity.normalizedIdentity.ecli,
            decisionDate: hit.decisionDate,
            publicationDate: hit.publicationDate,
          } : {}),
          identityVersion: identity.identityVersion,
          normalizedIdentity: identity.normalizedIdentity as Prisma.InputJsonValue,
          identityFingerprint: null,
          policyVersion: LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION,
          state,
        },
        update: {},
      })
    : await tx.legalReferenceOfficialReconciliation.upsert({
        where: {
          mentionId_identityVersion: {
            mentionId: lookup.mention.id,
            identityVersion: identity.identityVersion,
          },
        },
        create: {
          mentionId: lookup.mention.id,
          kind: lookup.mention.kind,
          jurisdiction: identity.normalizedIdentity.jurisdiction,
          ...(identity.normalizedIdentity.kind === "CASE_LAW" ? {
            courtFamily: identity.normalizedIdentity.courtFamily,
            courtLocality: identity.normalizedIdentity.courtLocality,
            courtBranch: identity.normalizedIdentity.courtBranch,
            decisionType: identity.normalizedIdentity.decisionType,
            decisionNumber: identity.normalizedIdentity.decisionNumber,
            decisionYear: identity.normalizedIdentity.year,
            section: identity.normalizedIdentity.section,
            ecli: identity.normalizedIdentity.ecli,
            decisionDate: hit.decisionDate,
            publicationDate: hit.publicationDate,
          } : {}),
          identityVersion: identity.identityVersion,
          normalizedIdentity: identity.normalizedIdentity as Prisma.InputJsonValue,
          identityFingerprint: identity.identityFingerprint,
          policyVersion: LEGAL_REFERENCE_OFFICIAL_POLICY_VERSION,
          state,
          legalSourceId,
        },
        update: {},
      });

  let verifiedReconciliationIdentity = null;
  if (reconciliation.identityFingerprint) {
    verifiedReconciliationIdentity = requirePersistedIdentityIntegrity(reconciliation);
  } else if (reconciliation.identityVersion !== LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION) {
    requirePersistedIdentityIntegrity(reconciliation);
  }

  const priorEvidence = await tx.legalReferenceOfficialReconciliationEvidence.findMany({
    where: { reconciliationId: reconciliation.id },
    orderBy: { evidenceFingerprint: "asc" },
    select: {
      evidenceFingerprint: true,
      classification: true,
      officialHit: {
        select: {
          documentKind: true,
          denominazioneAtto: true,
          numeroProvvedimento: true,
          annoProvvedimento: true,
          authority: true,
          court: true,
          decisionNumber: true,
          decisionYear: true,
          chamberSection: true,
          decisionType: true,
          ecli: true,
        },
      },
    },
  });
  const mergedIdentity = mergeClassifiedIdentityEvidence([
    ...priorEvidence.map((item) => {
      const documentKind = item.officialHit.documentKind;
      if (documentKind !== "LEGISLATION" && documentKind !== "CASE_LAW") {
        throw new AsyncJobExecutionError(
          "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION",
          "UNSUPPORTED_DOCUMENT_KIND",
          false,
        );
      }
      return {
        classification: item.classification,
        evidenceFingerprint: item.evidenceFingerprint,
        identity: buildOfficialHitIdentityV1({
          ...item.officialHit,
          documentKind,
        }).normalizedIdentity as unknown as Record<string, unknown>,
      };
    }),
    {
      classification,
      evidenceFingerprint,
      identity: identity.normalizedIdentity as unknown as Record<string, unknown>,
    },
  ]);
  const terminalAtAdmission = ["LINKED_EXISTING", "ACCEPTED_NEW", "REJECTED"].includes(reconciliation.state);
  const identityConflict = reconciliation.kind !== lookup.mention.kind
    || identity.identityConflict
    || mergedIdentity.outcome === "CONFLICT"
    || (verifiedReconciliationIdentity !== null && explicitIdentityFactsConflict(
      verifiedReconciliationIdentity.normalizedIdentity as unknown as Record<string, unknown>,
      identity.normalizedIdentity as unknown as Record<string, unknown>,
    ))
    || (terminalAtAdmission && explicitIdentityFactsConflict(
      reconciliation.normalizedIdentity as Record<string, unknown>,
      identity.normalizedIdentity as unknown as Record<string, unknown>,
    ));
  const resolvedIdentity = mergedIdentity.outcome === "MERGED"
    ? rebuildOfficialIdentityV2(mergedIdentity.identity as unknown as NormalizedOfficialIdentity)
    : identity;
  const identityEnriched = mergedIdentity.outcome === "MERGED"
    && stableJson(reconciliation.normalizedIdentity) !== stableJson(resolvedIdentity.normalizedIdentity);
  if (identityConflict) {
    reconciliation = await tx.legalReferenceOfficialReconciliation.update({
      where: { id: reconciliation.id },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
  } else if (identityEnriched && ["PENDING_REVIEW", "INCOMPLETE"].includes(reconciliation.state)) {
    const resolvedLegalSourceId = persistedReconciliation?.state === "INCOMPLETE"
      ? null
      : resolvedIdentity.identityFingerprint === identity.identityFingerprint
      ? legalSourceId
      : null;
    reconciliation = await tx.legalReferenceOfficialReconciliation.update({
      where: { id: reconciliation.id },
      data: {
        normalizedIdentity: resolvedIdentity.normalizedIdentity as Prisma.InputJsonValue,
        identityFingerprint: resolvedIdentity.identityFingerprint,
        ...(resolvedIdentity.normalizedIdentity.kind === "CASE_LAW" ? {
          courtFamily: resolvedIdentity.normalizedIdentity.courtFamily,
          courtLocality: resolvedIdentity.normalizedIdentity.courtLocality,
          courtBranch: resolvedIdentity.normalizedIdentity.courtBranch,
          decisionType: resolvedIdentity.normalizedIdentity.decisionType,
          decisionNumber: resolvedIdentity.normalizedIdentity.decisionNumber,
          decisionYear: resolvedIdentity.normalizedIdentity.year,
          section: resolvedIdentity.normalizedIdentity.section,
          ecli: resolvedIdentity.normalizedIdentity.ecli,
        } : {}),
        state: resolvedIdentity.identityFingerprint === null
          ? "INCOMPLETE"
          : resolvedLegalSourceId ? "LINKED_EXISTING" : "PENDING_REVIEW",
        legalSourceId: resolvedLegalSourceId,
        revision: { increment: 1 },
      },
    });
  } else if (
    !identityConflict
    && legalSourceId
    && !reconciliation.legalSourceId
    && ["PENDING_REVIEW", "INCOMPLETE"].includes(reconciliation.state)
  ) {
    reconciliation = await tx.legalReferenceOfficialReconciliation.update({
      where: { id: reconciliation.id },
      data: {
        state: "LINKED_EXISTING",
        legalSourceId,
        revision: { increment: 1 },
      },
    });
  }
  await tx.legalReferenceOfficialReconciliationEvidence.create({
    data: {
      reconciliationId: reconciliation.id,
      officialHitId: hit.id,
      identityVersion: identity.identityVersion,
      evidenceFingerprint,
      classification,
      disposition: identityConflict
          ? "CONFLICTING"
        : terminalAtAdmission
          ? "RECORDED_AFTER_TERMINAL"
          : resolvedIdentity.identityFingerprint === null
            ? "INCOMPLETE"
            : "COMPATIBLE",
      observedAt: lookup.completedAt,
    },
  });

  if (!identityConflict && reconciliation.legalSourceId) {
    await appendReconciledMatch(tx, lookup.mention.id, reconciliation.legalSourceId);
  }
  return { reconciliationId: reconciliation.id, reused: false };
}

export function createLegalReferenceOfficialReconciliationHandler(): AsyncJobHandler<ReconciliationReference> {
  return {
    operation: LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
    parseInput: (input) => referenceSchema.parse(input),
    execute: async (input: ReconciliationReference, context: AsyncJobHandlerContext) => {
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const result = await runSerializableTransactionWithRetry((tx) =>
        reconcileOfficialLookupInTransaction(tx, {
          jobId: context.jobId,
          lookupId: input.referenceId,
        }), { isRetryableError: isOfficialReconciliationRetryableP2002 });
      return {
        referenceType: "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_RESULT",
        referenceId: result.reconciliationId,
        referenceVersion: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
        metadata: { reused: result.reused },
      };
    },
  };
}
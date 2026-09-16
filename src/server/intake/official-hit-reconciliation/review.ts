import { Prisma } from "@/generated/prisma/client";

import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import { requireTenantAccess, type CurrentTenantContext } from "@/lib/tenant-auth";
import { LEGAL_REFERENCE_IDENTITY_NAMESPACE } from "@/server/intake/legal-reference-matching/matcher";
import { LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION } from "@/server/intake/neutralIntakeLegalReferenceOfficialReconciliationJob";
import {
  LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
  verifiedAssertionsMatchIdentity,
  verifyPersistedOfficialIdentityV2,
  type NormalizedOfficialIdentity,
} from "./identity";

export type OfficialReconciliationReviewDecision =
  | { action: "ACCEPT_NEW"; title: string }
  | { action: "LINK_EXISTING"; legalSourceId: string }
  | { action: "REJECT" };

export interface OfficialReconciliationReviewer {
  userId: string | null;
  actorId: string;
  email: string;
  role: string;
}

export interface ReviewOfficialReconciliationInput {
  reconciliationId: string;
  expectedRevision: number;
  decision: OfficialReconciliationReviewDecision;
  reviewNote: string | null;
  reviewer: OfficialReconciliationReviewer;
  tenantContext: Pick<CurrentTenantContext, "isAdmin" | "accessibleTenantIds" | "role">;
}

export class OfficialReconciliationReviewConflictError extends Error {
  readonly code = "OFFICIAL_RECONCILIATION_REVIEW_CONFLICT";

  constructor() {
    super("The reconciliation changed before this review was committed.");
  }
}

function canonicalKey(identity: NormalizedOfficialIdentity): string {
  return identity.kind === "LEGISLATION"
    ? `${identity.actType}:${identity.actNumber}:${identity.year}`
    : [identity.courtFamily, identity.courtLocality, identity.courtBranch,
      identity.decisionType, identity.decisionNumber, identity.year, identity.section, identity.ecli]
        .filter(Boolean)
        .join(":");
}

function legalSourceType(identity: NormalizedOfficialIdentity) {
  if (identity.kind === "CASE_LAW") return "ALTRO" as const;
  if (identity.actType === "LEGGE") return "LEGGE" as const;
  if (identity.actType.startsWith("DECRETO")) return "DECRETO" as const;
  return "ALTRO" as const;
}

function terminalState(action: OfficialReconciliationReviewDecision["action"]) {
  if (action === "ACCEPT_NEW") return "ACCEPTED_NEW" as const;
  if (action === "LINK_EXISTING") return "LINKED_EXISTING" as const;
  return "REJECTED" as const;
}

function isCanonicalLegalSourceRace(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as {
    modelName?: unknown;
    target?: unknown;
    driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown; constraint?: { fields?: unknown } } };
  } | undefined;
  if (meta?.modelName !== "LegalSource") return false;
  const adapterCause = meta.driverAdapterError?.cause;
  const rawFields = meta.target ?? (
    adapterCause?.kind === "UniqueConstraintViolation" && adapterCause.originalCode === "23505"
      ? adapterCause.constraint?.fields
      : undefined
  );
  const fields = typeof rawFields === "string" ? [rawFields] : rawFields;
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) return false;
  const normalized = fields.map((field) => field.replace(/^"|"$/g, ""));
  return (normalized.length === 1
      && ["identityNamespace_identityScopeKey_canonicalKey", "sourceKey"].includes(normalized[0]))
    || (normalized.length === 3
      && ["identityNamespace", "identityScopeKey", "canonicalKey"].every(
        (field) => normalized.includes(field),
      ));
}

export async function reviewOfficialReconciliationInTransaction(
  tx: Prisma.TransactionClient,
  input: ReviewOfficialReconciliationInput,
) {
  const reconciliation = await tx.legalReferenceOfficialReconciliation.findUnique({
    where: { id: input.reconciliationId },
    select: {
      id: true,
      kind: true,
      state: true,
      revision: true,
      identityFingerprint: true,
      normalizedIdentity: true,
      identityVersion: true,
      mention: {
        select: { extractionAttempt: { select: { neutralIntake: { select: { enteId: true } } } } },
      },
      evidence: {
        select: {
          officialHit: {
            select: { lookup: { select: { mentionId: true } } },
          },
        },
      },
    },
  });
  if (!reconciliation || reconciliation.revision !== input.expectedRevision) {
    throw new OfficialReconciliationReviewConflictError();
  }
  requireTenantAccess(
    input.tenantContext,
    reconciliation.mention.extractionAttempt.neutralIntake.enteId,
    { mode: "write", allowWhenEnteMissing: false },
  );
  if (["LINKED_EXISTING", "ACCEPTED_NEW", "REJECTED"].includes(reconciliation.state)) {
    throw new OfficialReconciliationReviewConflictError();
  }

  let identity: NormalizedOfficialIdentity | null = null;
  if (input.decision.action !== "REJECT") {
    if (!reconciliation.identityFingerprint) {
      throw new Error("OFFICIAL_RECONCILIATION_INCOMPLETE_IDENTITY");
    }
    const verifiedIdentity = verifyPersistedOfficialIdentityV2({
      identityVersion: reconciliation.identityVersion,
      normalizedIdentity: reconciliation.normalizedIdentity,
      identityFingerprint: reconciliation.identityFingerprint,
    });
    if (!verifiedIdentity) {
      throw new Error("OFFICIAL_RECONCILIATION_IDENTITY_INTEGRITY_FAILED");
    }
    identity = verifiedIdentity.normalizedIdentity;
  }

  let legalSourceId: string | null = null;
  let createdNewSource = false;
  if (input.decision.action === "LINK_EXISTING") {
    const source = await tx.legalSource.findUnique({
      where: { id: input.decision.legalSourceId },
      select: {
        id: true,
        identityNamespace: true,
        identityScopeKey: true,
        canonicalKey: true,
        identityAssertions: {
          where: {
            identifierScheme: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
            verificationStatus: "VERIFIED",
          },
          select: { normalizedValue: true },
        },
      },
    });
    if (
      !source
      || source.identityNamespace !== LEGAL_REFERENCE_IDENTITY_NAMESPACE
      || source.identityScopeKey !== "GLOBAL"
      || source.canonicalKey !== canonicalKey(identity!)
      || !verifiedAssertionsMatchIdentity(source.identityAssertions, reconciliation.identityFingerprint!)
    ) {
      throw new Error("OFFICIAL_RECONCILIATION_SOURCE_IDENTITY_MISMATCH");
    }
    legalSourceId = source.id;
  } else if (input.decision.action === "ACCEPT_NEW") {
    const key = canonicalKey(identity!);
    const existingSource = await tx.legalSource.findUnique({
      where: {
        identityNamespace_identityScopeKey_canonicalKey: {
          identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
          identityScopeKey: "GLOBAL",
          canonicalKey: key,
        },
      },
      select: {
        id: true,
        identityAssertions: {
          where: {
            identifierScheme: LEGAL_REFERENCE_OFFICIAL_IDENTITY_VERSION,
            verificationStatus: "VERIFIED",
          },
          select: { normalizedValue: true },
        },
      },
    });
    if (existingSource) {
      if (!verifiedAssertionsMatchIdentity(
        existingSource.identityAssertions,
        reconciliation.identityFingerprint!,
      )) {
        throw new Error("OFFICIAL_RECONCILIATION_SOURCE_IDENTITY_MISMATCH");
      }
      legalSourceId = existingSource.id;
    } else {
      const source = await tx.legalSource.create({
          data: {
          sourceKey: `official-reconciliation:${reconciliation.identityFingerprint}`,
          title: input.decision.title,
          sourceType: legalSourceType(identity!),
          resourceSemanticType: identity!.kind === "LEGISLATION"
            ? "NORMATIVE_INSTRUMENT"
            : "JUDICIAL_DECISION",
          legalAuthorityKind: identity!.kind === "LEGISLATION" ? "LEGISLATION" : "CASE_LAW",
          status: "IDENTITY_VERIFIED_PENDING_VALIDITY",
          role: identity!.kind === "LEGISLATION" ? "NORMATIVE" : "CASE_SPECIFIC",
          legalRank: identity!.kind === "LEGISLATION" ? "NATIONAL_LAW" : "OTHER",
          territorialScope: "NATIONAL",
          confidence: "MEDIUM",
          issuingBody: identity!.kind === "CASE_LAW"
            ? [identity!.courtFamily, identity!.courtLocality, identity!.courtBranch].filter(Boolean).join(" ")
            : null,
          sourceNumber: identity!.kind === "LEGISLATION" ? identity!.actNumber : identity!.decisionNumber,
          sourceOrigin: "HUMAN_REVIEWED_OFFICIAL_EVIDENCE",
          humanReviewRequired: false,
          identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
          identityScopeKind: "GLOBAL",
          identityScopeKey: "GLOBAL",
          canonicalKey: key,
          },
          select: { id: true },
      });
      legalSourceId = source.id;
      createdNewSource = true;
    }
  }

  if (legalSourceId && input.decision.action === "ACCEPT_NEW") {
    await tx.legalSourceIdentityAssertion.createMany({
      data: [{
        sourceFamilyId: legalSourceId,
        identifierScheme: reconciliation.identityVersion,
        normalizedValue: reconciliation.identityFingerprint!,
        jurisdiction: "IT",
        verificationStatus: "VERIFIED",
        provenanceReference: `official-reconciliation:${reconciliation.id}`,
        verifiedAt: new Date(),
      }],
      skipDuplicates: true,
    });
  }

  const state = input.decision.action === "ACCEPT_NEW" && !createdNewSource
    ? "LINKED_EXISTING"
    : terminalState(input.decision.action);
  const updated = await tx.legalReferenceOfficialReconciliation.updateMany({
    where: {
      id: reconciliation.id,
      revision: input.expectedRevision,
      state: { in: ["INCOMPLETE", "PENDING_REVIEW", "CONFLICTED"] },
    },
    data: {
      state,
      revision: { increment: 1 },
      legalSourceId,
      reviewedAt: new Date(),
      reviewedByUserId: input.reviewer.userId,
      reviewedByActorId: input.reviewer.actorId,
      reviewedByEmail: input.reviewer.email,
      reviewedByRole: input.reviewer.role,
      reviewNote: input.reviewNote,
    },
  });
  if (updated.count !== 1) throw new OfficialReconciliationReviewConflictError();

  if (legalSourceId) {
    const mentionIds = [...new Set(reconciliation.evidence.map(
      (item) => item.officialHit.lookup.mentionId,
    ))];
    await tx.legalReferenceMatch.createMany({
      data: mentionIds.map((mentionId) => ({
        mentionId,
        matchingVersion: LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION,
        status: "MATCHED" as const,
        reason: "EXACT_IDENTITY" as const,
        legalSourceId,
        candidateCount: 1,
      })),
      skipDuplicates: true,
    });
  }

  await createAuditLogInTransaction(tx, {
    azione: "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_REVIEW",
    entita: "LegalReferenceOfficialReconciliation",
    entitaId: reconciliation.id,
    esito: "SUCCESS",
    actor: {
      userId: input.reviewer.userId,
      userEmail: input.reviewer.email,
      userRole: input.reviewer.role,
    },
    metadata: {
      action: input.decision.action,
      expectedRevision: input.expectedRevision,
      resultingRevision: input.expectedRevision + 1,
      legalSourceId,
      reviewNotePresent: input.reviewNote !== null,
      semanticMarker: "HUMAN_CANONICAL_IDENTITY_DECISION_PROVIDER_HIT_IS_EVIDENCE_ONLY",
    },
  });

  return { reconciliationId: reconciliation.id, state, legalSourceId };
}

export function reviewOfficialReconciliation(input: ReviewOfficialReconciliationInput) {
  return runSerializableTransactionWithRetry((tx) =>
    reviewOfficialReconciliationInTransaction(tx, input), {
      isRetryableError: isCanonicalLegalSourceRace,
    });
}
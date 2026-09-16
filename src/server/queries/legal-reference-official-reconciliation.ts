import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, isTenantContextConstrained } from "@/lib/tenant-auth";
import { LEGAL_REFERENCE_IDENTITY_NAMESPACE } from "@/server/intake/legal-reference-matching/matcher";

interface NormalizedIdentityRecord {
  kind?: unknown;
  actType?: unknown;
  actNumber?: unknown;
  courtFamily?: unknown;
  courtLocality?: unknown;
  courtBranch?: unknown;
  decisionType?: unknown;
  decisionNumber?: unknown;
  year?: unknown;
  section?: unknown;
  ecli?: unknown;
}

function canonicalKey(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const identity = value as NormalizedIdentityRecord;
  if (
    identity.kind === "LEGISLATION"
    && typeof identity.actType === "string"
    && typeof identity.actNumber === "string"
    && typeof identity.year === "number"
  ) {
    return `${identity.actType}:${identity.actNumber}:${identity.year}`;
  }
  if (
    identity.kind === "CASE_LAW"
    && typeof identity.courtFamily === "string"
    && typeof identity.decisionType === "string"
    && typeof identity.decisionNumber === "string"
    && typeof identity.year === "number"
  ) {
    return [identity.courtFamily,
      typeof identity.courtLocality === "string" ? identity.courtLocality : null,
      typeof identity.courtBranch === "string" ? identity.courtBranch : null,
      identity.decisionType, identity.decisionNumber, identity.year,
      typeof identity.section === "string" ? identity.section : null,
      typeof identity.ecli === "string" ? identity.ecli : null]
      .filter(Boolean)
      .join(":");
  }
  return null;
}

export async function getOfficialReconciliationReviewQueue(limit = 30) {
  try {
    const tenantContext = await getCurrentTenantContext();
    if (!tenantContext) throw new Error("OFFICIAL_RECONCILIATION_AUTH_REQUIRED");
    const tenantWhere = isTenantContextConstrained(tenantContext)
      ? {
          mention: {
            extractionAttempt: {
              neutralIntake: { enteId: { in: tenantContext.accessibleTenantIds } },
            },
          },
        }
      : {};
    const candidates = await prisma.legalReferenceOfficialReconciliation.findMany({
      where: {
        state: { in: ["INCOMPLETE", "PENDING_REVIEW", "CONFLICTED"] },
        ...tenantWhere,
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        kind: true,
        state: true,
        revision: true,
        normalizedIdentity: true,
        identityFingerprint: true,
        updatedAt: true,
        evidence: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            classification: true,
            disposition: true,
            observedAt: true,
            officialHit: {
              select: {
                providerRecordId: true,
                providerSourceId: true,
                titoloAtto: true,
                sourceUrl: true,
                lookup: { select: { provider: true } },
              },
            },
          },
        },
      },
    });
    const keys = [...new Set(candidates.map((item) => canonicalKey(item.normalizedIdentity)).filter(
      (key): key is string => key !== null,
    ))];
    const sources = keys.length === 0 ? [] : await prisma.legalSource.findMany({
      where: {
        identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
        identityScopeKey: "GLOBAL",
        canonicalKey: { in: keys },
      },
      select: { id: true, title: true, canonicalKey: true },
      orderBy: [{ title: "asc" }],
    });

    const items = candidates.map((candidate) => ({
      ...candidate,
      canonicalKey: canonicalKey(candidate.normalizedIdentity),
      exactSources: sources.filter((source) =>
        source.canonicalKey === canonicalKey(candidate.normalizedIdentity)),
    }));
    return { status: "READY" as const, items };
  } catch (cause) {
    if (isOfficialReconciliationSchemaUnavailable(cause)) {
      return { status: "SCHEMA_UNAVAILABLE" as const, items: [] };
    }
    throw new OfficialReconciliationReviewQueueError(cause);
  }
}

function isOfficialReconciliationSchemaUnavailable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2021" && error.code !== "P2022") return false;
  const meta = error.meta as { modelName?: unknown; table?: unknown; column?: unknown } | undefined;
  return [meta?.modelName, meta?.table, meta?.column].some((value) =>
    typeof value === "string" && value.includes("LegalReferenceOfficialReconciliation"));
}

export type OfficialReconciliationReviewQueueItem = Awaited<
  ReturnType<typeof getOfficialReconciliationReviewQueue>
>["items"][number];

export class OfficialReconciliationReviewQueueError extends Error {
  readonly code = "OFFICIAL_RECONCILIATION_REVIEW_QUEUE_FAILED" as const;

  constructor(readonly cause: unknown) {
    super("Unable to load the official reconciliation review queue.");
    this.name = "OfficialReconciliationReviewQueueError";
  }
}
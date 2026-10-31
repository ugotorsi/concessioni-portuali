import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

import type { ProceedingIdentityReference, ProceedingKind } from ".";

const proceedingKinds = new Set<ProceedingKind>([
  "ADMINISTRATIVE_ORIGINAL",
  "ADMINISTRATIVE_OTHER",
  "JUDICIAL_REVIEW",
  "JUDICIAL_APPEAL",
  "CRIMINAL",
  "INTERNAL_INSTRUCTION",
  "INCIDENTAL",
  "UNKNOWN",
]);

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function evidenceLinkId(
  evidence: StructuredKnowledgeReadItem["evidence"][number],
): string {
  return `${evidence.documentoId}:${evidence.pageNumber}:${evidence.textSha256}`;
}

export function documentedProceedingIdentity(
  item: StructuredKnowledgeReadItem,
  field: "proceedingIdentity" | "targetProceedingIdentity",
): ProceedingIdentityReference | null {
  const payload = record(item.payload);
  const identity = record(payload?.[field]);
  if (!identity
    || typeof identity.canonicalAnchorSemanticKey !== "string"
    || !/^[a-f0-9]{64}$/i.test(identity.canonicalAnchorSemanticKey)
    || typeof identity.kind !== "string"
    || !proceedingKinds.has(identity.kind as ProceedingKind)
    || !Array.isArray(identity.evidenceBasisRefs)
    || identity.evidenceBasisRefs.length === 0
    || identity.evidenceBasisRefs.some((basisRef) => typeof basisRef !== "string")) {
    return null;
  }
  const basisRefs = new Set(identity.evidenceBasisRefs as string[]);
  const evidence = item.evidence.filter((entry) => (
    entry.basisRef !== null && basisRefs.has(entry.basisRef)
  ));
  if (evidence.length === 0
    || [...basisRefs].some((basisRef) => !evidence.some((entry) => entry.basisRef === basisRef))) {
    return null;
  }
  return {
    canonicalAnchorSemanticKey: identity.canonicalAnchorSemanticKey,
    kind: identity.kind as ProceedingKind,
    verification: "DOCUMENTED",
    evidenceLinkIds: [...new Set(evidence.map(evidenceLinkId))].sort(),
  };
}

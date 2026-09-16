import { LEGAL_DATA_HUNTER_PROVIDER } from "../official-source-lookup/legalDataHunter";
import { NORMATTIVA_PROVIDER } from "../official-source-lookup/normattiva";

export type OfficialEvidenceClassification =
  | "OFFICIAL_AUTHORITY"
  | "COMMERCIAL_CORROBORATION";

export class UnsupportedOfficialEvidenceProviderError extends Error {
  readonly code = "UNSUPPORTED_OFFICIAL_EVIDENCE_PROVIDER" as const;

  constructor() {
    super("UNSUPPORTED_OFFICIAL_EVIDENCE_PROVIDER");
    this.name = "UnsupportedOfficialEvidenceProviderError";
  }
}

export function classifyOfficialEvidenceProvider(
  provider: string,
): OfficialEvidenceClassification {
  if (provider === NORMATTIVA_PROVIDER) return "OFFICIAL_AUTHORITY";
  if (provider === LEGAL_DATA_HUNTER_PROVIDER) return "COMMERCIAL_CORROBORATION";
  throw new UnsupportedOfficialEvidenceProviderError();
}

export function selectFieldByPrecedence<T>(
  evidence: readonly {
    classification: OfficialEvidenceClassification;
    evidenceFingerprint: string;
    value: T | null;
  }[],
): T | null {
  const selected = evidence
    .filter((item) => item.value !== null)
    .sort((left, right) => {
      const leftRank = left.classification === "OFFICIAL_AUTHORITY" ? 0 : 1;
      const rightRank = right.classification === "OFFICIAL_AUTHORITY" ? 0 : 1;
      return leftRank - rightRank
        || left.evidenceFingerprint.localeCompare(right.evidenceFingerprint, "en");
    })[0];
  return selected?.value ?? null;
}

export function mergeIdentityFieldsByPrecedence(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  existingClassification: OfficialEvidenceClassification,
  incomingClassification: OfficialEvidenceClassification,
): { outcome: "MERGED"; identity: Record<string, unknown> } | { outcome: "CONFLICT" } {
  const identity: Record<string, unknown> = {};
  for (const key of [...new Set([...Object.keys(existing), ...Object.keys(incoming)])].sort()) {
    const left = existing[key] ?? null;
    const right = incoming[key] ?? null;
    if (left !== null && right !== null && left !== right) return { outcome: "CONFLICT" };
    identity[key] = selectFieldByPrecedence([
      { classification: existingClassification, evidenceFingerprint: "existing", value: left },
      { classification: incomingClassification, evidenceFingerprint: "incoming", value: right },
    ]);
  }
  return { outcome: "MERGED", identity };
}

export function mergeClassifiedIdentityEvidence(
  evidence: readonly {
    classification: OfficialEvidenceClassification;
    evidenceFingerprint: string;
    identity: Record<string, unknown>;
  }[],
): { outcome: "MERGED"; identity: Record<string, unknown> } | { outcome: "CONFLICT" } {
  const keys = [...new Set(evidence.flatMap((item) => Object.keys(item.identity)))].sort();
  const identity: Record<string, unknown> = {};
  for (const key of keys) {
    const values = evidence.map((item) => ({
      classification: item.classification,
      evidenceFingerprint: item.evidenceFingerprint,
      value: item.identity[key] ?? null,
    }));
    const explicit = [...new Set(values.filter((item) => item.value !== null).map(
      (item) => JSON.stringify(item.value),
    ))];
    if (explicit.length > 1) return { outcome: "CONFLICT" };
    identity[key] = selectFieldByPrecedence(values);
  }
  return { outcome: "MERGED", identity };
}

export function explicitIdentityFactsConflict(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].some((key) => {
    const leftValue = left[key] ?? null;
    const rightValue = right[key] ?? null;
    return leftValue !== null && rightValue !== null && leftValue !== rightValue;
  });
}
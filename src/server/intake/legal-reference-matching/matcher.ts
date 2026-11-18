import { LEGAL_REFERENCE_DISCOVERY_VERSION } from "../legal-reference-discovery/parser";

export const LEGAL_REFERENCE_MATCHING_VERSION = "LEGAL_REFERENCE_MATCHING_V1" as const;
export const LEGAL_REFERENCE_IDENTITY_NAMESPACE = LEGAL_REFERENCE_DISCOVERY_VERSION;
export const LEGAL_REFERENCE_IDENTIFIER_SCHEME = LEGAL_REFERENCE_IDENTITY_NAMESPACE;

export interface MatchableLegalReferenceMention {
  id: string;
  kind: "LEGISLATION" | "CODE" | "CASE_LAW";
  normalizedKey: string;
  authorityHint: string | null;
  actType: string | null;
  actNumber: string | null;
  year: number | null;
  chamberSection: string | null;
}

export interface MatchableLegalSource {
  id: string;
  enteId: string | null;
  sourceType: string;
  legalAuthorityKind: string | null;
  issuingBody: string | null;
  sourceNumber: string | null;
  sourceDate: Date | null;
  identityNamespace: string | null;
  identityScopeKind: string | null;
  identityScopeKey: string | null;
  canonicalKey: string | null;
  identityAssertions: Array<{
    identifierScheme: string;
    normalizedValue: string;
    issuingAuthority: string | null;
    jurisdiction: string | null;
    verificationStatus: string;
  }>;
}

export type LegalReferenceMatchDecision =
  | { status: "MATCHED"; reason: "EXACT_IDENTITY"; legalSourceId: string; candidateCount: 1 }
  | { status: "AMBIGUOUS"; reason: "MULTIPLE_EXACT_MATCHES"; legalSourceId: null; candidateCount: number }
  | {
      status: "NO_MATCH";
      reason: "NO_CATALOG_MATCH" | "INSUFFICIENT_IDENTITY";
      legalSourceId: null;
      candidateCount: 0;
    };

function compactIdentity(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedNumber(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function sourceYear(source: MatchableLegalSource): number | null {
  return source.sourceDate?.getUTCFullYear() ?? null;
}

function regionalJurisdiction(mention: MatchableLegalReferenceMention): string | null {
  if (mention.actType !== "LEGGE_REGIONALE" || !mention.actNumber || mention.year === null) return null;
  const marker = `:${mention.actNumber}:${mention.year}`;
  if (!mention.normalizedKey.startsWith("LEGGE_REGIONALE:") || !mention.normalizedKey.includes(marker)) {
    return null;
  }
  return mention.normalizedKey.slice("LEGGE_REGIONALE:".length, mention.normalizedKey.indexOf(marker)) || null;
}

function normalizedRegion(value: string): string {
  return compactIdentity(value).replace(/^REGIONE/, "");
}

function expectedLegislationSourceType(actType: string | null): string | null {
  if (actType === "LEGGE" || actType === "LEGGE_REGIONALE") return "LEGGE";
  if (
    actType === "DECRETO_LEGISLATIVO"
    || actType === "DECRETO_LEGGE"
    || actType === "DECRETO_PRESIDENTE_REPUBBLICA"
  ) {
    return "DECRETO";
  }
  return null;
}

function sourceMetadataCompatible(
  mention: MatchableLegalReferenceMention,
  source: MatchableLegalSource,
): boolean {
  if (mention.kind === "LEGISLATION" && source.sourceType !== expectedLegislationSourceType(mention.actType)) {
    return false;
  }
  const region = regionalJurisdiction(mention);
  if (region !== null && source.issuingBody !== null && normalizedRegion(source.issuingBody) !== normalizedRegion(region)) {
    return false;
  }
  return mention.kind !== "CASE_LAW"
    || mention.authorityHint === null
    || source.issuingBody === null
    || compactIdentity(source.issuingBody) === compactIdentity(mention.authorityHint);
}

function canonicalScopeCompatible(source: MatchableLegalSource): boolean {
  if (source.identityScopeKind === "GLOBAL") {
    return source.enteId === null && source.identityScopeKey === "GLOBAL";
  }
  if (source.identityScopeKind === "TENANT") {
    return source.enteId !== null && source.identityScopeKey === `TENANT:${source.enteId}`;
  }
  return false;
}

type IdentityEvidenceResult = "POSITIVE" | "NEUTRAL" | "CONTRADICTORY";

function canonicalIdentityEvidence(
  source: MatchableLegalSource,
  expected: string,
): IdentityEvidenceResult {
  if (
    source.identityNamespace !== LEGAL_REFERENCE_IDENTITY_NAMESPACE
    || !canonicalScopeCompatible(source)
    || source.canonicalKey === null
  ) {
    return "NEUTRAL";
  }
  return compactIdentity(source.canonicalKey) === expected ? "POSITIVE" : "CONTRADICTORY";
}

function assertionIdentityEvidence(
  mention: MatchableLegalReferenceMention,
  assertion: MatchableLegalSource["identityAssertions"][number],
  expected: string,
): IdentityEvidenceResult {
  if (
    assertion.verificationStatus !== "VERIFIED"
    || assertion.identifierScheme !== LEGAL_REFERENCE_IDENTIFIER_SCHEME
  ) {
    return "NEUTRAL";
  }
  const region = regionalJurisdiction(mention);
  if (region !== null) {
    if (assertion.jurisdiction === null) return "NEUTRAL";
    if (
      normalizedRegion(assertion.jurisdiction) !== normalizedRegion(region)
      || (assertion.issuingAuthority !== null
        && normalizedRegion(assertion.issuingAuthority) !== normalizedRegion(region))
    ) {
      return "CONTRADICTORY";
    }
  }
  if (mention.kind === "CASE_LAW" && mention.authorityHint !== null) {
    if (assertion.issuingAuthority === null) return "NEUTRAL";
    if (compactIdentity(assertion.issuingAuthority) !== compactIdentity(mention.authorityHint)) {
      return "CONTRADICTORY";
    }
  }
  return compactIdentity(assertion.normalizedValue) === expected ? "POSITIVE" : "CONTRADICTORY";
}

function reconcileIdentityEvidence(
  mention: MatchableLegalReferenceMention,
  source: MatchableLegalSource,
  identity: string,
): IdentityEvidenceResult {
  const expected = compactIdentity(identity);
  const evidence = [
    canonicalIdentityEvidence(source, expected),
    ...source.identityAssertions.map((assertion) => assertionIdentityEvidence(mention, assertion, expected)),
  ];
  if (evidence.includes("CONTRADICTORY")) return "CONTRADICTORY";
  return evidence.includes("POSITIVE") ? "POSITIVE" : "NEUTRAL";
}

function matchesRegion(source: MatchableLegalSource, region: string): boolean {
  const expected = normalizedRegion(region);
  const issuingBody = source.issuingBody ? normalizedRegion(source.issuingBody) : null;
  return issuingBody === expected || source.identityAssertions.some((assertion) =>
    assertion.verificationStatus === "VERIFIED"
    && assertion.identifierScheme === LEGAL_REFERENCE_IDENTIFIER_SCHEME
    && assertion.jurisdiction !== null
    && normalizedRegion(assertion.jurisdiction) === expected);
}

function legislationIdentity(mention: MatchableLegalReferenceMention): string | null {
  if (!mention.actType || !mention.actNumber || mention.year === null) return null;
  const region = mention.actType === "LEGGE_REGIONALE" ? regionalJurisdiction(mention) : null;
  if (mention.actType === "LEGGE_REGIONALE" && !region) return null;
  return [mention.actType, region, normalizedNumber(mention.actNumber), mention.year].filter(Boolean).join(":");
}

function matchesLegislation(
  mention: MatchableLegalReferenceMention,
  source: MatchableLegalSource,
  identity: string,
): boolean {
  if (source.legalAuthorityKind !== null && source.legalAuthorityKind !== "LEGISLATION") return false;
  if (!sourceMetadataCompatible(mention, source)) return false;
  const identityEvidence = reconcileIdentityEvidence(mention, source, identity);
  if (identityEvidence === "CONTRADICTORY") return false;
  if (identityEvidence === "POSITIVE") return true;
  if (!mention.actNumber || mention.year === null) return false;

  const expectedSourceType = mention.actType === "LEGGE" || mention.actType === "LEGGE_REGIONALE"
    ? "LEGGE"
    : null;
  if (
    expectedSourceType === null
    || source.sourceType !== expectedSourceType
    || source.sourceNumber === null
    || normalizedNumber(source.sourceNumber) !== normalizedNumber(mention.actNumber)
    || sourceYear(source) !== mention.year
  ) {
    return false;
  }
  const region = regionalJurisdiction(mention);
  return mention.actType !== "LEGGE_REGIONALE" || (region !== null && matchesRegion(source, region));
}

function caseLawIdentity(mention: MatchableLegalReferenceMention): string | null {
  if (!mention.authorityHint || !mention.actNumber || mention.year === null) return null;
  return [mention.authorityHint, normalizedNumber(mention.actNumber), mention.year, mention.chamberSection]
    .filter(Boolean).join(":");
}

function matchesCaseLaw(
  mention: MatchableLegalReferenceMention,
  source: MatchableLegalSource,
  identity: string,
): boolean {
  if (source.legalAuthorityKind !== "CASE_LAW") return false;
  if (!sourceMetadataCompatible(mention, source)) return false;
  const identityEvidence = reconcileIdentityEvidence(mention, source, identity);
  if (identityEvidence === "CONTRADICTORY") return false;
  if (identityEvidence === "POSITIVE") return true;
  return mention.chamberSection === null
    && source.issuingBody !== null
    && compactIdentity(source.issuingBody) === compactIdentity(mention.authorityHint!)
    && source.sourceNumber !== null
    && normalizedNumber(source.sourceNumber) === normalizedNumber(mention.actNumber!)
    && sourceYear(source) === mention.year;
}

function matchingCandidates(
  mention: MatchableLegalReferenceMention,
  sources: readonly MatchableLegalSource[],
): { sufficient: boolean; sources: MatchableLegalSource[] } {
  if (mention.kind === "LEGISLATION") {
    const identity = legislationIdentity(mention);
    return identity
      ? { sufficient: true, sources: sources.filter((source) => matchesLegislation(mention, source, identity)) }
      : { sufficient: false, sources: [] };
  }
  if (mention.kind === "CASE_LAW") {
    const identity = caseLawIdentity(mention);
    return identity
      ? { sufficient: true, sources: sources.filter((source) => matchesCaseLaw(mention, source, identity)) }
      : { sufficient: false, sources: [] };
  }
  return { sufficient: mention.actType !== null, sources: [] };
}

export function matchLegalReferenceMention(
  mention: MatchableLegalReferenceMention,
  sources: readonly MatchableLegalSource[],
): LegalReferenceMatchDecision {
  const candidates = matchingCandidates(mention, sources);
  const uniqueCandidates = [...new Map(candidates.sources.map((source) => [source.id, source])).values()];
  if (!candidates.sufficient) {
    return { status: "NO_MATCH", reason: "INSUFFICIENT_IDENTITY", legalSourceId: null, candidateCount: 0 };
  }
  if (uniqueCandidates.length === 0) {
    return { status: "NO_MATCH", reason: "NO_CATALOG_MATCH", legalSourceId: null, candidateCount: 0 };
  }
  if (uniqueCandidates.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: "MULTIPLE_EXACT_MATCHES",
      legalSourceId: null,
      candidateCount: uniqueCandidates.length,
    };
  }
  return { status: "MATCHED", reason: "EXACT_IDENTITY", legalSourceId: uniqueCandidates[0].id, candidateCount: 1 };
}
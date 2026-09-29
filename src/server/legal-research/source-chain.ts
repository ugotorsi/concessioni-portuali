import { createHash } from "node:crypto";

import type { ResearchResultSupportDirection } from "./question-results";

export const SOURCE_CHAIN_VERIFICATION_VERSION = "SOURCE_CHAIN_V1" as const;
export const ADVERSE_POLICY_VERSION = "ADVERSE_SUPPORT_WITHOUT_RELIABLE_OPPOSITION_V1" as const;

export type SourceRetrievalState = "RETRIEVAL_REQUIRED" | "RESOLVED" | "BLOCKED";
export type SourceTextState = "METADATA_ONLY" | "SNIPPET_ONLY" | "PARTIAL_TEXT" | "FULL_TEXT";
export type SourceIdentityState = "NOT_ASSESSED" | "VERIFIED" | "MISMATCH" | "INCOMPLETE" | "MANUAL_REVIEW_REQUIRED";
export type SourceContentState = "NOT_ASSESSED" | "VERIFIED" | "MISMATCH" | "INCOMPLETE" | "MANUAL_REVIEW_REQUIRED";
export type SourceTemporalState = "NOT_ASSESSED" | "APPLICABLE" | "NOT_APPLICABLE" | "UNCERTAIN";
export type SourceAdverseState = "NOT_REQUIRED" | "REQUIRED" | "COMPLETED";
export type SourceOfficiality = "OFFICIAL" | "NON_OFFICIAL" | "SECONDARY" | "UNKNOWN";

export interface CitationAnchor {
  page?: number;
  paragraph?: string;
  section?: string;
  anchor?: string;
  span?: { start: number; end: number };
}

export interface ExactSourceMetadata {
  sourceType?: string;
  authority?: string;
  canonicalIdentifier?: string;
  date?: string;
  title?: string;
  jurisdiction?: string;
  docketNumber?: string;
  sourceUrl?: string;
  officiality: SourceOfficiality;
}

export interface SourceChainSnapshot {
  resultId: string;
  tenantId: string;
  caseId: string;
  missionId: string;
  researchQuestionSemanticKey: string;
  missionFingerprint: string;
  referenceDate: string;
  referenceDateBasis: Readonly<Record<string, unknown>>;
  verificationVersion: string;
  sourceIdentityKey: string | null;
  contentSha256: string | null;
  retrievalState: SourceRetrievalState;
  textState: SourceTextState;
  identityState: SourceIdentityState;
  contentState: SourceContentState;
  temporalState: SourceTemporalState;
  adverseState: SourceAdverseState;
  officiality: SourceOfficiality;
  citationAnchors: readonly CitationAnchor[];
  manualReviewRequired: boolean;
  manualReviewReason: string | null;
  currentMission: boolean;
}

export type SourceBlockingReason =
  | "EXACT_RETRIEVAL_REQUIRED"
  | "EXACT_RETRIEVAL_BLOCKED"
  | "MISSING_FULL_TEXT"
  | "IDENTITY_UNVERIFIED"
  | "IDENTITY_MISMATCH"
  | "CONTENT_UNVERIFIED"
  | "CONTENT_MISMATCH"
  | "CITATION_ANCHOR_REQUIRED"
  | "TEMPORAL_NOT_ASSESSED"
  | "TEMPORALLY_NOT_APPLICABLE"
  | "TEMPORAL_UNCERTAIN"
  | "ADVERSE_NOT_COMPLETED"
  | "SECONDARY_NOT_PRIMARY_USABLE"
  | "MANUAL_REVIEW_REQUIRED"
  | "MISSION_NOT_CURRENT";

function normalized(value: string | undefined): string | null {
  return value?.trim().toLocaleLowerCase("it-IT") || null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export function evaluateExactRetrieval(expected: ExactSourceMetadata, retrieved: ExactSourceMetadata | null): {
  state: SourceRetrievalState;
  mismatchFields: readonly string[];
  manualReviewRequired: boolean;
} {
  if (!retrieved) return { state: "RETRIEVAL_REQUIRED", mismatchFields: [], manualReviewRequired: false };
  const fields: readonly (keyof Omit<ExactSourceMetadata, "officiality">)[] = [
    "sourceType", "authority", "canonicalIdentifier", "date", "title", "jurisdiction", "docketNumber",
  ];
  const mismatchFields = fields.filter((field) => {
    const expectedValue = normalized(expected[field]);
    return expectedValue !== null && expectedValue !== normalized(retrieved[field]);
  });
  const expectedOfficial = expected.officiality === "OFFICIAL";
  if (expectedOfficial && retrieved.officiality === "SECONDARY") mismatchFields.push("officiality" as never);
  const hasExactIdentity = Boolean(normalized(retrieved.canonicalIdentifier) || normalized(retrieved.docketNumber));
  if (mismatchFields.length) return { state: "BLOCKED", mismatchFields, manualReviewRequired: true };
  if (!hasExactIdentity) return { state: "RETRIEVAL_REQUIRED", mismatchFields: [], manualReviewRequired: true };
  return { state: "RESOLVED", mismatchFields: [], manualReviewRequired: false };
}

export function preferOfficialExactRetrieval<T extends { officiality: SourceOfficiality }>(candidates: readonly T[]): readonly T[] {
  const rank: Record<SourceOfficiality, number> = { OFFICIAL: 0, NON_OFFICIAL: 1, UNKNOWN: 2, SECONDARY: 3 };
  return [...candidates].sort((left, right) => rank[left.officiality] - rank[right.officiality]);
}

export function classifyAcquiredText(input: {
  metadataOnly?: boolean;
  snippet?: string | null;
  partialText?: string | null;
  fullText?: string | null;
}): SourceTextState {
  if (input.fullText?.trim()) return "FULL_TEXT";
  if (input.partialText?.trim()) return "PARTIAL_TEXT";
  if (input.snippet?.trim()) return "SNIPPET_ONLY";
  return "METADATA_ONLY";
}

export function evaluateIdentityVerification(input: {
  retrievalState: SourceRetrievalState;
  assertionStates: readonly ("VERIFIED" | "REJECTED" | "CONFLICTING" | "UNVERIFIED")[];
}): { state: SourceIdentityState; manualReviewRequired: boolean; reason: string | null } {
  if (input.retrievalState === "BLOCKED" || input.assertionStates.some((state) => state === "REJECTED" || state === "CONFLICTING")) {
    return { state: "MISMATCH", manualReviewRequired: true, reason: "SOURCE_IDENTITY_MISMATCH" };
  }
  if (input.retrievalState !== "RESOLVED") return { state: "NOT_ASSESSED", manualReviewRequired: false, reason: null };
  if (input.assertionStates.length === 0) return { state: "INCOMPLETE", manualReviewRequired: true, reason: "SOURCE_IDENTITY_INCOMPLETE" };
  if (input.assertionStates.every((state) => state === "VERIFIED")) return { state: "VERIFIED", manualReviewRequired: false, reason: null };
  return { state: "MANUAL_REVIEW_REQUIRED", manualReviewRequired: true, reason: "SOURCE_IDENTITY_REVIEW_REQUIRED" };
}

export function evaluateContentVerification(input: {
  textState: SourceTextState;
  acquiredContentSha256: string | null;
  expectedContentSha256: string | null;
  acquiredText: string | null;
  citedText: string | null;
  citationAnchors: readonly CitationAnchor[];
}): { state: SourceContentState; reason: string | null } {
  if (input.textState !== "FULL_TEXT") return { state: "INCOMPLETE", reason: "FULL_TEXT_REQUIRED" };
  if (!input.acquiredContentSha256 || !input.expectedContentSha256) return { state: "INCOMPLETE", reason: "CONTENT_HASH_REQUIRED" };
  if (input.acquiredContentSha256 !== input.expectedContentSha256) return { state: "MISMATCH", reason: "CONTENT_HASH_MISMATCH" };
  if (!input.citationAnchors.length) return { state: "INCOMPLETE", reason: "CITATION_ANCHOR_REQUIRED" };
  if (input.citedText && !input.acquiredText?.includes(input.citedText)) return { state: "MISMATCH", reason: "CITED_TEXT_NOT_FOUND" };
  return { state: "VERIFIED", reason: null };
}

export function temporalStateFromAssessment(input: {
  questionReferenceDate: string;
  assessmentReferenceDate: string;
  applicabilityState: string;
} | null): SourceTemporalState {
  if (!input || input.questionReferenceDate !== input.assessmentReferenceDate) return "NOT_ASSESSED";
  if (input.applicabilityState === "APPLICABLE") return "APPLICABLE";
  if (input.applicabilityState === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  return "UNCERTAIN";
}

export function evaluateUsableSourceGate(snapshot: SourceChainSnapshot): {
  usable: boolean;
  blockingReasons: readonly SourceBlockingReason[];
} {
  const reasons: SourceBlockingReason[] = [];
  if (!snapshot.currentMission) reasons.push("MISSION_NOT_CURRENT");
  if (snapshot.retrievalState === "RETRIEVAL_REQUIRED") reasons.push("EXACT_RETRIEVAL_REQUIRED");
  if (snapshot.retrievalState === "BLOCKED") reasons.push("EXACT_RETRIEVAL_BLOCKED");
  if (snapshot.textState !== "FULL_TEXT") reasons.push("MISSING_FULL_TEXT");
  if (snapshot.identityState === "MISMATCH") reasons.push("IDENTITY_MISMATCH");
  else if (snapshot.identityState !== "VERIFIED") reasons.push("IDENTITY_UNVERIFIED");
  if (snapshot.contentState === "MISMATCH") reasons.push("CONTENT_MISMATCH");
  else if (snapshot.contentState !== "VERIFIED") reasons.push("CONTENT_UNVERIFIED");
  if (!snapshot.citationAnchors.length) reasons.push("CITATION_ANCHOR_REQUIRED");
  if (snapshot.temporalState === "NOT_ASSESSED") reasons.push("TEMPORAL_NOT_ASSESSED");
  if (snapshot.temporalState === "NOT_APPLICABLE") reasons.push("TEMPORALLY_NOT_APPLICABLE");
  if (snapshot.temporalState === "UNCERTAIN") reasons.push("TEMPORAL_UNCERTAIN");
  if (snapshot.adverseState === "REQUIRED") reasons.push("ADVERSE_NOT_COMPLETED");
  if (snapshot.officiality === "SECONDARY") reasons.push("SECONDARY_NOT_PRIMARY_USABLE");
  if (snapshot.manualReviewRequired) reasons.push("MANUAL_REVIEW_REQUIRED");
  return { usable: reasons.length === 0, blockingReasons: [...new Set(reasons)] };
}

export function sourceChainFingerprint(snapshot: SourceChainSnapshot): string {
  return hash({
    resultId: snapshot.resultId,
    missionFingerprint: snapshot.missionFingerprint,
    referenceDate: snapshot.referenceDate,
    referenceDateBasis: snapshot.referenceDateBasis,
    verificationVersion: snapshot.verificationVersion,
    sourceIdentityKey: snapshot.sourceIdentityKey,
    contentSha256: snapshot.contentSha256,
    retrievalState: snapshot.retrievalState,
    textState: snapshot.textState,
    identityState: snapshot.identityState,
    contentState: snapshot.contentState,
    temporalState: snapshot.temporalState,
    adverseState: snapshot.adverseState,
    officiality: snapshot.officiality,
    citationAnchors: snapshot.citationAnchors,
    manualReviewRequired: snapshot.manualReviewRequired,
    manualReviewReason: snapshot.manualReviewReason,
    currentMission: snapshot.currentMission,
  });
}

export function evaluateAdverseRequirement(input: {
  primaryMissionFingerprint: string;
  researchQuestionSemanticKey: string;
  results: readonly { direction: ResearchResultSupportDirection; usable: boolean }[];
}): { required: boolean; policyVersion: string; fingerprint: string; rationale: string } {
  const usableSupport = input.results.some((result) => result.usable && result.direction === "SUPPORTS");
  const usableOpposition = input.results.some((result) => result.usable && result.direction === "OPPOSES");
  const required = usableSupport && !usableOpposition;
  return {
    required,
    policyVersion: ADVERSE_POLICY_VERSION,
    fingerprint: hash({
      primaryMissionFingerprint: input.primaryMissionFingerprint,
      researchQuestionSemanticKey: input.researchQuestionSemanticKey,
      policyVersion: ADVERSE_POLICY_VERSION,
    }),
    rationale: required ? "USABLE_SUPPORT_WITHOUT_USABLE_OPPOSITION" : "NO_ADVERSE_REQUIREMENT",
  };
}

export function deriveSourceCoverage(results: readonly {
  direction: ResearchResultSupportDirection;
  usable: boolean;
  blockingReasons: readonly SourceBlockingReason[];
}[]): {
  discoveryCoverage: "NO_RESULTS" | "DISCOVERED";
  usableCoverage: "NO_USABLE_SOURCE" | "USABLE" | "CONFLICTING";
  usableSupportsCount: number;
  usableOpposesCount: number;
  conflictingUsableAuthorities: boolean;
  gaps: readonly string[];
} {
  const usableSupportsCount = results.filter((result) => result.usable && result.direction === "SUPPORTS").length;
  const usableOpposesCount = results.filter((result) => result.usable && result.direction === "OPPOSES").length;
  const conflictingUsableAuthorities = usableSupportsCount > 0 && usableOpposesCount > 0;
  const gaps: string[] = [...new Set(results.flatMap((result) => result.blockingReasons).map((reason): string => {
    if (reason === "MISSING_FULL_TEXT") return "MISSING_FULL_TEXT";
    if (reason === "IDENTITY_UNVERIFIED" || reason === "IDENTITY_MISMATCH") return "IDENTITY_UNVERIFIED";
    if (reason === "CONTENT_UNVERIFIED" || reason === "CONTENT_MISMATCH") return "CONTENT_UNVERIFIED";
    if (reason.startsWith("TEMPORAL")) return "TEMPORAL_UNCERTAIN";
    if (reason === "ADVERSE_NOT_COMPLETED") return "ADVERSE_NOT_COMPLETED";
    return reason;
  }))];
  if (results.length > 0 && usableSupportsCount + usableOpposesCount === 0) gaps.push("NO_USABLE_SOURCE");
  return {
    discoveryCoverage: results.length ? "DISCOVERED" : "NO_RESULTS",
    usableCoverage: conflictingUsableAuthorities ? "CONFLICTING" : usableSupportsCount + usableOpposesCount > 0 ? "USABLE" : "NO_USABLE_SOURCE",
    usableSupportsCount,
    usableOpposesCount,
    conflictingUsableAuthorities,
    gaps: [...new Set(gaps)],
  };
}
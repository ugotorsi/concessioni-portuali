import { describe, expect, it } from "vitest";

import {
  ADVERSE_POLICY_VERSION,
  SOURCE_CHAIN_VERIFICATION_VERSION,
  classifyAcquiredText,
  deriveSourceCoverage,
  evaluateAdverseRequirement,
  evaluateContentVerification,
  evaluateExactRetrieval,
  evaluateIdentityVerification,
  evaluateUsableSourceGate,
  preferOfficialExactRetrieval,
  sourceChainFingerprint,
  temporalStateFromAssessment,
  type SourceChainSnapshot,
} from "@/server/legal-research/source-chain";

function snapshot(overrides: Partial<SourceChainSnapshot> = {}): SourceChainSnapshot {
  return {
    resultId: "result-1", tenantId: "tenant-1", caseId: "case-1", missionId: "mission-1",
    researchQuestionSemanticKey: "q".repeat(64), missionFingerprint: "m".repeat(64),
    referenceDate: "2025-01-01", referenceDateBasis: { type: "MEASURE_DATE" },
    verificationVersion: SOURCE_CHAIN_VERIFICATION_VERSION, sourceIdentityKey: "cassazione:123/2024",
    contentSha256: "a".repeat(64), retrievalState: "RESOLVED", textState: "FULL_TEXT",
    identityState: "VERIFIED", contentState: "VERIFIED", temporalState: "APPLICABLE",
    adverseState: "COMPLETED", officiality: "OFFICIAL", citationAnchors: [{ page: 4 }],
    manualReviewRequired: false, manualReviewReason: null, currentMission: true, ...overrides,
  };
}

describe("Lotto 5 research source chain", () => {
  it("keeps discovery, acquisition, identity, content, temporal assessment, and usability explicit", () => {
    expect(evaluateUsableSourceGate(snapshot({ retrievalState: "RETRIEVAL_REQUIRED", textState: "METADATA_ONLY", identityState: "NOT_ASSESSED", contentState: "NOT_ASSESSED", temporalState: "NOT_ASSESSED", adverseState: "NOT_REQUIRED", citationAnchors: [] }))).toMatchObject({ usable: false });
    expect(evaluateUsableSourceGate(snapshot({ identityState: "NOT_ASSESSED" })).usable).toBe(false);
    expect(evaluateUsableSourceGate(snapshot({ contentState: "NOT_ASSESSED" })).usable).toBe(false);
    expect(evaluateUsableSourceGate(snapshot({ temporalState: "NOT_ASSESSED" })).usable).toBe(false);
    expect(evaluateUsableSourceGate(snapshot({ adverseState: "REQUIRED" })).usable).toBe(false);
    expect(evaluateUsableSourceGate(snapshot())).toEqual({ usable: true, blockingReasons: [] });
  });

  it("validates exact retrieval and fails closed on missing or mismatched identity", () => {
    const expected = { sourceType: "decision", authority: "Cassazione", canonicalIdentifier: "123/2024", date: "2024-02-01", title: "Decisione", jurisdiction: "IT", docketNumber: "RG-12", officiality: "OFFICIAL" as const };
    expect(evaluateExactRetrieval(expected, null).state).toBe("RETRIEVAL_REQUIRED");
    expect(evaluateExactRetrieval(expected, { ...expected, title: "Altra decisione" }).state).toBe("BLOCKED");
    expect(evaluateExactRetrieval(expected, { ...expected }).state).toBe("RESOLVED");
  });

  it("distinguishes metadata, snippet, partial text, and full text", () => {
    expect(classifyAcquiredText({ metadataOnly: true })).toBe("METADATA_ONLY");
    expect(classifyAcquiredText({ snippet: "estratto" })).toBe("SNIPPET_ONLY");
    expect(classifyAcquiredText({ partialText: "testo parziale" })).toBe("PARTIAL_TEXT");
    expect(classifyAcquiredText({ fullText: "testo integrale" })).toBe("FULL_TEXT");
  });

  it("blocks identity mismatches and escalates incomplete identity", () => {
    expect(evaluateIdentityVerification({ retrievalState: "RESOLVED", assertionStates: ["VERIFIED"] }).state).toBe("VERIFIED");
    expect(evaluateIdentityVerification({ retrievalState: "RESOLVED", assertionStates: ["REJECTED"] })).toMatchObject({ state: "MISMATCH", manualReviewRequired: true });
    expect(evaluateIdentityVerification({ retrievalState: "RESOLVED", assertionStates: [] })).toMatchObject({ state: "INCOMPLETE", manualReviewRequired: true });
  });

  it("never verifies content from snippet-only text and requires a stable citation anchor", () => {
    const base = { acquiredContentSha256: "a".repeat(64), expectedContentSha256: "a".repeat(64), acquiredText: "passaggio rilevante", citedText: "passaggio", citationAnchors: [{ paragraph: "12" }] };
    expect(evaluateContentVerification({ ...base, textState: "SNIPPET_ONLY" }).state).toBe("INCOMPLETE");
    expect(evaluateContentVerification({ ...base, textState: "FULL_TEXT", citationAnchors: [] }).state).toBe("INCOMPLETE");
    expect(evaluateContentVerification({ ...base, textState: "FULL_TEXT" }).state).toBe("VERIFIED");
    expect(evaluateContentVerification({ ...base, textState: "FULL_TEXT", expectedContentSha256: "b".repeat(64) }).state).toBe("MISMATCH");
  });

  it("uses only a temporal assessment for the exact question reference date", () => {
    expect(temporalStateFromAssessment({ questionReferenceDate: "2025-01-01", assessmentReferenceDate: "2025-01-01", applicabilityState: "APPLICABLE" })).toBe("APPLICABLE");
    expect(temporalStateFromAssessment({ questionReferenceDate: "2025-01-01", assessmentReferenceDate: "2025-01-01", applicabilityState: "NOT_APPLICABLE" })).toBe("NOT_APPLICABLE");
    expect(temporalStateFromAssessment({ questionReferenceDate: "2025-01-01", assessmentReferenceDate: "2025-01-01", applicabilityState: "UNCERTAIN" })).toBe("UNCERTAIN");
    expect(temporalStateFromAssessment({ questionReferenceDate: "2025-01-02", assessmentReferenceDate: "2025-01-01", applicabilityState: "APPLICABLE" })).toBe("NOT_ASSESSED");
  });

  it("requires a new snapshot when source content, reference date, mission, or verification version changes", () => {
    const base = snapshot();
    const fingerprint = sourceChainFingerprint(base);
    expect(sourceChainFingerprint({ ...base })).toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, contentSha256: "b".repeat(64) })).not.toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, referenceDate: "2025-01-02" })).not.toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, missionFingerprint: "n".repeat(64) })).not.toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, verificationVersion: "SOURCE_CHAIN_V2" })).not.toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, identityState: "NOT_ASSESSED" })).not.toBe(fingerprint);
    expect(sourceChainFingerprint({ ...base, temporalState: "UNCERTAIN" })).not.toBe(fingerprint);
  });

  it("prefers official exact sources and never promotes secondary material to primary usable", () => {
    expect(preferOfficialExactRetrieval([{ id: "secondary", officiality: "SECONDARY" as const }, { id: "official", officiality: "OFFICIAL" as const }])[0].id).toBe("official");
    expect(evaluateUsableSourceGate(snapshot({ officiality: "SECONDARY" }))).toMatchObject({ usable: false, blockingReasons: expect.arrayContaining(["SECONDARY_NOT_PRIMARY_USABLE"]) });
  });

  it("creates one deterministic adverse requirement only for usable support without usable opposition", () => {
    const input = { primaryMissionFingerprint: "m".repeat(64), researchQuestionSemanticKey: "q".repeat(64) };
    const required = evaluateAdverseRequirement({ ...input, results: [{ direction: "SUPPORTS", usable: true }] });
    expect(required).toMatchObject({ required: true, policyVersion: ADVERSE_POLICY_VERSION });
    expect(evaluateAdverseRequirement({ ...input, results: [{ direction: "SUPPORTS", usable: true }, { direction: "OPPOSES", usable: true }] }).required).toBe(false);
    expect(evaluateAdverseRequirement({ ...input, results: [{ direction: "SUPPORTS", usable: false }] }).required).toBe(false);
    expect(evaluateAdverseRequirement({ ...input, results: [{ direction: "SUPPORTS", usable: true }] }).fingerprint).toBe(required.fingerprint);
  });

  it("keeps support direction separate from usability and reports conflicting usable authorities", () => {
    const coverage = deriveSourceCoverage([
      { direction: "SUPPORTS", usable: true, blockingReasons: [] },
      { direction: "OPPOSES", usable: true, blockingReasons: [] },
      { direction: "SUPPORTS", usable: false, blockingReasons: ["MISSING_FULL_TEXT"] },
    ]);
    expect(coverage).toMatchObject({ discoveryCoverage: "DISCOVERED", usableCoverage: "CONFLICTING", usableSupportsCount: 1, usableOpposesCount: 1, conflictingUsableAuthorities: true });
    expect(coverage.gaps).toContain("MISSING_FULL_TEXT");
  });

  it("distinguishes discovered coverage from usable coverage and exposes source gaps", () => {
    const coverage = deriveSourceCoverage([{ direction: "SUPPORTS", usable: false, blockingReasons: ["IDENTITY_UNVERIFIED", "TEMPORAL_UNCERTAIN", "ADVERSE_NOT_COMPLETED"] }]);
    expect(coverage).toMatchObject({ discoveryCoverage: "DISCOVERED", usableCoverage: "NO_USABLE_SOURCE" });
    expect(coverage.gaps).toEqual(expect.arrayContaining(["IDENTITY_UNVERIFIED", "TEMPORAL_UNCERTAIN", "ADVERSE_NOT_COMPLETED", "NO_USABLE_SOURCE"]));
  });
});
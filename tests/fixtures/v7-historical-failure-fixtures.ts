export const V7_SYNTHETIC_HISTORICAL_FAILURE_FIXTURES = Object.freeze([
  {
    attempt: "ONE-SHOT-01",
    observedFailure: "AI_PROVIDER_TIMEOUT",
    syntheticReplay: "PROVIDER_TIMEOUT",
    expectedBoundary: "FAIL_BEFORE_COMPILATION",
  },
  {
    attempt: "ONE-SHOT-02",
    observedFailure: "INVALID_PROVIDER_OUTPUT at structuredKnowledge; exact provider payload unavailable",
    syntheticReplay: "MALFORMED_STRUCTURED_KNOWLEDGE",
    expectedBoundary: "REJECT_SYNTACTICALLY",
  },
  {
    attempt: "ONE-SHOT-03",
    observedFailure: "INVALID_PROCEEDING_ANCHOR and INVALID_PROCEEDING_IDENTITY_EVIDENCE",
    syntheticReplay: "POISONED_PROVIDER_PROCEEDING_HINTS",
    expectedBoundary: "IGNORE_AND_REBUILD_SERVER_SIDE",
  },
  {
    attempt: "ONE-SHOT-04",
    observedFailure: "NONEXISTENT_SOURCE_QUOTE",
    syntheticReplay: "MODEL_GENERATED_LITERAL_QUOTES",
    expectedBoundary: "QUOTE_FIELD_ABSENT_FROM_WIRE_CONTRACT",
  },
  {
    attempt: "ONE-SHOT-05",
    observedFailure: "V7_OUTPUT_INCOMPLETE with schema-valid empty optional collections",
    syntheticReplay: "EMPTY_OPTIONAL_COLLECTIONS",
    expectedBoundary: "ACCEPT_WHEN_ESSENTIAL_QUALITY_PASSES",
  },
  {
    attempt: "ONE-SHOT-06",
    observedFailure:
      "REFERENCE_DATE_BASIS_KIND_INVALID, DOCUMENT_INVENTORY_EVIDENCE_NOT_VERIFIED, and unverified identity hints",
    syntheticReplay: "POISONED_PROVIDER_DETERMINISTIC_FIELDS",
    expectedBoundary: "IGNORE_AND_REBUILD_SERVER_SIDE",
  },
] as const);

export const V7_HISTORICAL_FIXTURE_PROVENANCE = Object.freeze({
  kind: "SYNTHETIC_RECONSTRUCTION",
  originalProviderOutputsAvailable: false,
  scope:
    "Shapes reproduce only the failure classes and diagnostic paths recorded in the six attempt ledgers; they are not verbatim provider outputs.",
});

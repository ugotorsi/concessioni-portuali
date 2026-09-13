export const B2C9_EXTRACTION_POLICY_V1 = {
  version: "B2C9_EXTRACTION_POLICY_V1",
  maxArtifactBytes: 25 * 1024 * 1024,
  maxPdfPages: 250,
  maxImagePixels: 40_000_000,
  maxRawCharsPerPage: 100_000,
  maxRawCharsPerAttempt: 4_000_000,
  maxNormalizedCharsPerPage: 50_000,
  maxNormalizedCharsPerAttempt: 2_000_000,
  ocrTimeoutMsPerPage: 45_000,
  directText: {
    minNormalizedChars: 40,
    minAlphanumericChars: 20,
    minMeaningfulTokens: 5,
    minPrintableRatio: 0.85,
  },
} as const;

export interface ExtractionPolicy {
  readonly version: string;
  readonly maxArtifactBytes: number;
  readonly maxPdfPages: number;
  readonly maxImagePixels: number;
  readonly maxRawCharsPerPage: number;
  readonly maxRawCharsPerAttempt: number;
  readonly maxNormalizedCharsPerPage: number;
  readonly maxNormalizedCharsPerAttempt: number;
  readonly ocrTimeoutMsPerPage: number;
  readonly directText: {
    readonly minNormalizedChars: number;
    readonly minAlphanumericChars: number;
    readonly minMeaningfulTokens: number;
    readonly minPrintableRatio: number;
  };
}

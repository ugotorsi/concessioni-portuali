import type { ExtractionPolicy } from "./policy";

export type DirectTextDecision = "DIRECT_TEXT_SUFFICIENT" | "OCR_REQUIRED" | "EMPTY_PAGE";

export interface DirectTextAssessment {
  decision: DirectTextDecision;
  normalizedCharacterCount: number;
  alphanumericCharacterCount: number;
  meaningfulTokenCount: number;
  printableRatio: number;
}

export function normalizeExtractedText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assessDirectText(
  normalizedText: string,
  policy: ExtractionPolicy,
): DirectTextAssessment {
  const characters = Array.from(normalizedText);
  const alphanumericCharacterCount = characters.filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  const meaningfulTokenCount = normalizedText
    .split(/\s+/u)
    .filter((token) => Array.from(token).filter((character) => /[\p{L}\p{N}]/u.test(character)).length >= 2)
    .length;
  const printableCharacterCount = characters.filter((character) => character === "\n" || !/\p{Cc}/u.test(character)).length;
  const printableRatio = characters.length === 0 ? 1 : printableCharacterCount / characters.length;

  let decision: DirectTextDecision = "OCR_REQUIRED";
  if (alphanumericCharacterCount === 0) {
    decision = "EMPTY_PAGE";
  } else if (
    characters.length >= policy.directText.minNormalizedChars
    && alphanumericCharacterCount >= policy.directText.minAlphanumericChars
    && meaningfulTokenCount >= policy.directText.minMeaningfulTokens
    && printableRatio >= policy.directText.minPrintableRatio
  ) {
    decision = "DIRECT_TEXT_SUFFICIENT";
  }

  return {
    decision,
    normalizedCharacterCount: characters.length,
    alphanumericCharacterCount,
    meaningfulTokenCount,
    printableRatio,
  };
}

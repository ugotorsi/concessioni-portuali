import { createHash } from "node:crypto";

import { stableStringify } from "@/server/audit/hash";

import type { NeutralIntakeClassificationProjection } from "./classifier";

const BEGINNING_CHARACTER_LIMIT = 4_000;
const ENDING_CHARACTER_LIMIT = 2_000;
const HEADING_LINE_LIMIT = 20;
const HEADING_CHARACTER_LIMIT = 200;

export interface ClassificationExtractionPage {
  pageNumber: number;
  normalizedText: string;
  textSha256: string;
  normalizedCharacterCount: number;
  ocrConfidence: number | null;
  warnings: unknown;
}

export interface ClassificationExtractionEvidence {
  attemptId: string;
  policyVersion: string;
  artifactSha256: string;
  warnings: unknown;
  pages: readonly ClassificationExtractionPage[];
}

function warningStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function buildNeutralIntakeClassificationProjection(
  evidence: ClassificationExtractionEvidence,
): NeutralIntakeClassificationProjection {
  const pages = [...evidence.pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const text = pages.map((page) => page.normalizedText).join("\n");
  const headingLines = pages.flatMap((page) => page.normalizedText.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 3 && line.length <= HEADING_CHARACTER_LIMIT)
    .slice(0, HEADING_LINE_LIMIT);
  const warnings = [...warningStrings(evidence.warnings), ...pages.flatMap((page) => warningStrings(page.warnings))];
  const ocrConfidences = pages.map((page) => page.ocrConfidence).filter((value): value is number => value !== null);
  const lowOcrQuality = ocrConfidences.length > 0
    && ocrConfidences.reduce((sum, value) => sum + value, 0) / ocrConfidences.length < 45;
  return {
    pageCount: pages.length,
    normalizedCharacterCount: pages.reduce((sum, page) => sum + page.normalizedCharacterCount, 0),
    beginningText: text.slice(0, BEGINNING_CHARACTER_LIMIT),
    endingText: text.slice(-ENDING_CHARACTER_LIMIT),
    headingLines,
    extractionQualityInsufficient: lowOcrQuality || warnings.some((warning) => /TRUNCAT|INCOMPLETE|QUALITY_INSUFFICIENT/i.test(warning)),
  };
}

export function hashNeutralIntakeClassificationEvidence(evidence: ClassificationExtractionEvidence): string {
  return createHash("sha256").update(stableStringify({
    policyVersion: evidence.policyVersion,
    artifactSha256: evidence.artifactSha256,
    warnings: warningStrings(evidence.warnings),
    pageCount: evidence.pages.length,
    pages: [...evidence.pages]
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .map((page) => ({
        pageNumber: page.pageNumber,
        normalizedTextSha256: createHash("sha256").update(page.normalizedText, "utf8").digest("hex"),
        normalizedCharacterCount: page.normalizedCharacterCount,
        ocrConfidence: page.ocrConfidence,
        warnings: warningStrings(page.warnings),
      })),
  })).digest("hex");
}
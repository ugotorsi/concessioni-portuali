import { createHash } from "node:crypto";

import { ExtractionFailure } from "./errors";
import { assertImagePixelLimit, readImageDimensions } from "./image";
import { detectArtifactMimeType, isSupportedExtractionMimeType } from "./mime";
import { TesseractItalianOcrAdapter } from "./ocrAdapter";
import { PdfJsExtractionAdapter } from "./pdfAdapter";
import { B2C9_EXTRACTION_POLICY_V1, type ExtractionPolicy } from "./policy";
import { assessDirectText, normalizeExtractedText } from "./text";
import type {
  ExtractedPageEvidence,
  OcrAdapter,
  PdfExtractionAdapter,
  TechnicalExtractionInput,
  TechnicalExtractionResult,
} from "./types";

export interface TechnicalExtractorDependencies {
  pdf: PdfExtractionAdapter;
  ocr: OcrAdapter;
  policy: ExtractionPolicy;
}

function pageEvidence(input: {
  pageNumber: number;
  method: "DIRECT_TEXT" | "OCR";
  text: string;
  confidence?: number | null;
  warnings?: string[];
  policy: ExtractionPolicy;
}): ExtractedPageEvidence {
  const normalizedText = normalizeExtractedText(input.text);
  const normalizedCharacterCount = Array.from(normalizedText).length;
  if (normalizedCharacterCount > input.policy.maxNormalizedCharsPerPage) {
    throw new ExtractionFailure("TEXT_PAYLOAD_LIMIT_EXCEEDED");
  }
  return {
    pageNumber: input.pageNumber,
    method: input.method,
    text: input.text,
    normalizedText,
    normalizedCharacterCount,
    textSha256: createHash("sha256").update(input.text, "utf8").digest("hex"),
    ocrConfidence: input.confidence ?? null,
    warnings: input.warnings ?? [],
  };
}

function validateArtifact(input: TechnicalExtractionInput, policy: ExtractionPolicy) {
  if (input.expectedSizeBytes > policy.maxArtifactBytes || input.bytes.length > policy.maxArtifactBytes) {
    throw new ExtractionFailure("ARTIFACT_TOO_LARGE");
  }
  if (input.bytes.length !== input.expectedSizeBytes) {
    throw new ExtractionFailure("INTEGRITY_SIZE_MISMATCH");
  }
  const actualSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (actualSha256 !== input.expectedSha256) {
    throw new ExtractionFailure("INTEGRITY_SHA256_MISMATCH");
  }
  const detectedMimeType = detectArtifactMimeType(input.bytes);
  if (!isSupportedExtractionMimeType(detectedMimeType)) {
    throw new ExtractionFailure("UNSUPPORTED_MIME");
  }
  if (input.declaredMimeType.trim().toLowerCase() !== detectedMimeType) {
    throw new ExtractionFailure("MIME_MISMATCH");
  }
  return detectedMimeType;
}

function assertTotalTextLimit(pages: readonly ExtractedPageEvidence[], policy: ExtractionPolicy): void {
  const total = pages.reduce((sum, page) => sum + page.normalizedCharacterCount, 0);
  if (total > policy.maxNormalizedCharsPerAttempt) {
    throw new ExtractionFailure("TEXT_PAYLOAD_LIMIT_EXCEEDED");
  }
}

export async function extractTechnicalDocument(
  input: TechnicalExtractionInput,
  dependencies: Partial<TechnicalExtractorDependencies> = {},
): Promise<TechnicalExtractionResult> {
  const policy = dependencies.policy ?? B2C9_EXTRACTION_POLICY_V1;
  const pdf = dependencies.pdf ?? new PdfJsExtractionAdapter();
  const ocr = dependencies.ocr ?? new TesseractItalianOcrAdapter();
  const detectedMimeType = validateArtifact(input, policy);
  const pages: ExtractedPageEvidence[] = [];
  const warnings: string[] = [];
  let ocrUsed = false;
  let totalRawCharacters = 0;

  const addRawCharacters = (text: string) => {
    const count = Array.from(text).length;
    if (count > policy.maxRawCharsPerPage || totalRawCharacters + count > policy.maxRawCharsPerAttempt) {
      throw new ExtractionFailure("RAW_TEXT_LIMIT_EXCEEDED");
    }
    totalRawCharacters += count;
  };

  if (detectedMimeType === "application/pdf") {
    const session = await pdf.open(input.bytes, policy.maxPdfPages);
    try {
      for (const directPage of session.pages) {
        const remainingRawCharacters = policy.maxRawCharsPerAttempt - totalRawCharacters;
        const rawDirectText = await directPage.readText(
          Math.min(policy.maxRawCharsPerPage, remainingRawCharacters),
        );
        addRawCharacters(rawDirectText);
        const normalizedDirectText = normalizeExtractedText(rawDirectText);
        const assessment = assessDirectText(normalizedDirectText, policy);
        if (assessment.decision === "DIRECT_TEXT_SUFFICIENT") {
          pages.push(pageEvidence({
            pageNumber: directPage.pageNumber,
            method: "DIRECT_TEXT",
            text: rawDirectText,
            policy,
          }));
          continue;
        }

        const image = await session.renderPage(directPage.pageNumber, policy.maxImagePixels);
        const recognized = await ocr.recognize(image, policy.ocrTimeoutMsPerPage);
        addRawCharacters(recognized.text);
        ocrUsed = true;
        pages.push(pageEvidence({
          pageNumber: directPage.pageNumber,
          method: "OCR",
          text: recognized.text,
          confidence: recognized.confidence,
          warnings: [assessment.decision, "OCR_FALLBACK_USED"],
          policy,
        }));
      }
    } finally {
      await session.close(Math.min(policy.ocrTimeoutMsPerPage, 5_000));
    }
  } else {
    assertImagePixelLimit(readImageDimensions(input.bytes, detectedMimeType), policy.maxImagePixels);
    const recognized = await ocr.recognize(input.bytes, policy.ocrTimeoutMsPerPage);
    addRawCharacters(recognized.text);
    ocrUsed = true;
    pages.push(pageEvidence({
      pageNumber: 1,
      method: "OCR",
      text: recognized.text,
      confidence: recognized.confidence,
      policy,
    }));
  }

  assertTotalTextLimit(pages, policy);
  return {
    detectedMimeType,
    pages,
    warnings,
    directExtractorName: detectedMimeType === "application/pdf" ? pdf.name : null,
    directExtractorVersion: detectedMimeType === "application/pdf" ? pdf.version : null,
    ocrExtractorName: ocrUsed ? ocr.name : null,
    ocrExtractorVersion: ocrUsed ? ocr.version : null,
    rasterizerName: detectedMimeType === "application/pdf" && ocrUsed ? pdf.rasterizerName : null,
    rasterizerVersion: detectedMimeType === "application/pdf" && ocrUsed ? pdf.rasterizerVersion : null,
  };
}

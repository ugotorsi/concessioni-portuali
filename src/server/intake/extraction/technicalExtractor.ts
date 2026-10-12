import { createHash } from "node:crypto";

import { ExtractionFailure } from "./errors";
import { assertImagePixelLimit, readImageDimensions } from "./image";
import { detectArtifactMimeType, isSupportedExtractionMimeType } from "./mime";
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
  ocrMode: "ENABLED" | "DISABLED";
}

export interface TechnicalExtractionPageSelection {
  readonly firstPage: number;
  readonly lastPage: number;
  readonly skipPageNumbers?: ReadonlySet<number>;
  readonly onPage?: (page: ExtractedPageEvidence) => Promise<void>;
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

async function extractTechnicalDocumentInternal(
  input: TechnicalExtractionInput,
  dependencies: Partial<TechnicalExtractorDependencies> = {},
  selection?: TechnicalExtractionPageSelection,
): Promise<TechnicalExtractionResult> {
  const policy = dependencies.policy ?? B2C9_EXTRACTION_POLICY_V1;
  const pdf = dependencies.pdf ?? new PdfJsExtractionAdapter();
  const ocrMode = dependencies.ocrMode ?? "ENABLED";
  let ocr = dependencies.ocr;
  const getOcr = async (): Promise<OcrAdapter> => {
    if (!ocr) {
      const { TesseractItalianOcrAdapter } = await import("./ocrAdapter");
      ocr = new TesseractItalianOcrAdapter();
    }
    return ocr;
  };
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
      const firstPage = selection?.firstPage ?? 1;
      const lastPage = selection?.lastPage ?? session.pageCount;
      if (
        !Number.isInteger(firstPage)
        || !Number.isInteger(lastPage)
        || firstPage < 1
        || lastPage < firstPage
        || lastPage > session.pageCount
      ) {
        throw new ExtractionFailure("PAGE_LIMIT_EXCEEDED");
      }
      const selectedPages = session.pages.filter((page) => (
        page.pageNumber >= firstPage
        && page.pageNumber <= lastPage
        && !selection?.skipPageNumbers?.has(page.pageNumber)
      ));
      for (const directPage of selectedPages) {
        const remainingRawCharacters = policy.maxRawCharsPerAttempt - totalRawCharacters;
        const rawDirectText = await directPage.readText(
          Math.min(policy.maxRawCharsPerPage, remainingRawCharacters),
        );
        addRawCharacters(rawDirectText);
        const normalizedDirectText = normalizeExtractedText(rawDirectText);
        const assessment = assessDirectText(normalizedDirectText, policy);
        if (assessment.decision === "DIRECT_TEXT_SUFFICIENT") {
          const evidence = pageEvidence({
            pageNumber: directPage.pageNumber,
            method: "DIRECT_TEXT",
            text: rawDirectText,
            policy,
          });
          pages.push(evidence);
          await selection?.onPage?.(evidence);
          continue;
        }

        if (ocrMode === "DISABLED") {
          throw new ExtractionFailure("OCR_REQUIRED");
        }
        const image = await session.renderPage(directPage.pageNumber, policy.maxImagePixels);
        const recognized = await (await getOcr()).recognize(image, policy.ocrTimeoutMsPerPage);
        addRawCharacters(recognized.text);
        ocrUsed = true;
        const evidence = pageEvidence({
          pageNumber: directPage.pageNumber,
          method: "OCR",
          text: recognized.text,
          confidence: recognized.confidence,
          warnings: [assessment.decision, "OCR_FALLBACK_USED"],
          policy,
        });
        pages.push(evidence);
        await selection?.onPage?.(evidence);
      }
    } finally {
      await session.close(Math.min(policy.ocrTimeoutMsPerPage, 5_000));
    }
  } else {
    if (ocrMode === "DISABLED") {
      throw new ExtractionFailure("OCR_REQUIRED");
    }
    assertImagePixelLimit(readImageDimensions(input.bytes, detectedMimeType), policy.maxImagePixels);
    const recognized = await (await getOcr()).recognize(input.bytes, policy.ocrTimeoutMsPerPage);
    addRawCharacters(recognized.text);
    ocrUsed = true;
    const evidence = pageEvidence({
      pageNumber: 1,
      method: "OCR",
      text: recognized.text,
      confidence: recognized.confidence,
      policy,
    });
    pages.push(evidence);
    await selection?.onPage?.(evidence);
  }

  assertTotalTextLimit(pages, policy);
  return {
    detectedMimeType,
    pages,
    warnings,
    directExtractorName: detectedMimeType === "application/pdf" ? pdf.name : null,
    directExtractorVersion: detectedMimeType === "application/pdf" ? pdf.version : null,
    ocrExtractorName: ocrUsed ? ocr?.name ?? null : null,
    ocrExtractorVersion: ocrUsed ? ocr?.version ?? null : null,
    rasterizerName: detectedMimeType === "application/pdf" && ocrUsed ? pdf.rasterizerName : null,
    rasterizerVersion: detectedMimeType === "application/pdf" && ocrUsed ? pdf.rasterizerVersion : null,
  };
}

export function extractTechnicalDocument(
  input: TechnicalExtractionInput,
  dependencies: Partial<TechnicalExtractorDependencies> = {},
): Promise<TechnicalExtractionResult> {
  return extractTechnicalDocumentInternal(input, dependencies);
}

export function extractTechnicalDocumentPageRange(
  input: TechnicalExtractionInput,
  selection: TechnicalExtractionPageSelection,
  dependencies: Partial<TechnicalExtractorDependencies> = {},
): Promise<TechnicalExtractionResult> {
  return extractTechnicalDocumentInternal(input, dependencies, selection);
}

export async function inspectTechnicalPdfPageCount(
  input: TechnicalExtractionInput,
  dependencies: Pick<Partial<TechnicalExtractorDependencies>, "pdf" | "policy"> = {},
): Promise<number> {
  const policy = dependencies.policy ?? B2C9_EXTRACTION_POLICY_V1;
  const detectedMimeType = validateArtifact(input, policy);
  if (detectedMimeType !== "application/pdf") {
    throw new ExtractionFailure("UNSUPPORTED_MIME");
  }
  const pdf = dependencies.pdf ?? new PdfJsExtractionAdapter();
  const session = await pdf.open(input.bytes, policy.maxPdfPages);
  try {
    return session.pageCount;
  } finally {
    await session.close(Math.min(policy.ocrTimeoutMsPerPage, 5_000));
  }
}

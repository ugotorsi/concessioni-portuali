import type { SupportedExtractionMimeType } from "./mime";

export type ExtractionMethod = "DIRECT_TEXT" | "OCR";

export interface ExtractedPageEvidence {
  pageNumber: number;
  method: ExtractionMethod;
  text: string;
  normalizedText: string;
  normalizedCharacterCount: number;
  textSha256: string;
  ocrConfidence: number | null;
  warnings: string[];
}

export interface OcrResult {
  text: string;
  confidence: number | null;
}

export interface OcrAdapter {
  readonly name: string;
  readonly version: string;
  recognize(image: Buffer, timeoutMs: number): Promise<OcrResult>;
}

export interface DirectPdfPage {
  pageNumber: number;
  readText(maxRawCharacters: number): Promise<string>;
}

export interface PdfExtractionSession {
  readonly pageCount: number;
  readonly pages: readonly DirectPdfPage[];
  renderPage(pageNumber: number, maxPixels: number): Promise<Buffer>;
  close(timeoutMs: number): Promise<void>;
}

export interface PdfExtractionAdapter {
  readonly name: string;
  readonly version: string;
  readonly rasterizerName: string;
  readonly rasterizerVersion: string;
  open(bytes: Buffer, maxPages: number): Promise<PdfExtractionSession>;
}

export interface TechnicalExtractionInput {
  bytes: Buffer;
  declaredMimeType: string;
  expectedSha256: string;
  expectedSizeBytes: number;
}

export interface TechnicalExtractionResult {
  detectedMimeType: SupportedExtractionMimeType;
  pages: ExtractedPageEvidence[];
  warnings: string[];
  directExtractorName: string | null;
  directExtractorVersion: string | null;
  ocrExtractorName: string | null;
  ocrExtractorVersion: string | null;
  rasterizerName: string | null;
  rasterizerVersion: string | null;
}

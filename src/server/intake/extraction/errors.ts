export type ExtractionFailureCode =
  | "UNSUPPORTED_MIME"
  | "MIME_MISMATCH"
  | "ARTIFACT_TOO_LARGE"
  | "INTEGRITY_SIZE_MISMATCH"
  | "INTEGRITY_SHA256_MISMATCH"
  | "PAGE_LIMIT_EXCEEDED"
  | "IMAGE_PIXEL_LIMIT_EXCEEDED"
  | "MALFORMED_PDF"
  | "DIRECT_PARSER_FAILURE"
  | "INTERNAL_EXTRACTION_FAILURE"
  | "RASTERIZATION_FAILURE"
  | "OCR_TIMEOUT"
  | "OCR_ENGINE_FAILURE"
  | "RAW_TEXT_LIMIT_EXCEEDED"
  | "TEXT_PAYLOAD_LIMIT_EXCEEDED"
  | "STORAGE_READ_FAILURE";

export class ExtractionFailure extends Error {
  readonly code: ExtractionFailureCode;

  constructor(code: ExtractionFailureCode, message?: string, cause?: unknown) {
    super((message ?? code).slice(0, 500), { cause });
    this.name = "ExtractionFailure";
    this.code = code;
  }
}

export function asBoundedFailureMessage(error: unknown): string {
  if (error instanceof ExtractionFailure) {
    return error.message.slice(0, 500);
  }
  return "Technical extraction failed.";
}

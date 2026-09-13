export const SUPPORTED_EXTRACTION_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type SupportedExtractionMimeType = typeof SUPPORTED_EXTRACTION_MIME_TYPES[number];

export type DetectedArtifactMimeType = SupportedExtractionMimeType | "application/octet-stream";

export function detectArtifactMimeType(bytes: Uint8Array): DetectedArtifactMimeType {
  if (
    bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return "application/octet-stream";
}

export function isSupportedExtractionMimeType(value: string): value is SupportedExtractionMimeType {
  return (SUPPORTED_EXTRACTION_MIME_TYPES as readonly string[]).includes(value);
}

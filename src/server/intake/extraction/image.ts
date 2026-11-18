import { ExtractionFailure } from "./errors";
import type { SupportedExtractionMimeType } from "./mime";

export interface ImageDimensions {
  width: number;
  height: number;
}

function readPngDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length < 24) {
    throw new ExtractionFailure("OCR_ENGINE_FAILURE", "PNG header is incomplete.");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes: Buffer): ImageDimensions {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }
    if (
      marker >= 0xc0
      && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  throw new ExtractionFailure("OCR_ENGINE_FAILURE", "JPEG dimensions are unavailable.");
}

export function readImageDimensions(
  bytes: Buffer,
  mimeType: Extract<SupportedExtractionMimeType, "image/jpeg" | "image/png">,
): ImageDimensions {
  return mimeType === "image/png" ? readPngDimensions(bytes) : readJpegDimensions(bytes);
}

export function assertImagePixelLimit(dimensions: ImageDimensions, maxPixels: number): void {
  if (
    !Number.isSafeInteger(dimensions.width)
    || !Number.isSafeInteger(dimensions.height)
    || dimensions.width <= 0
    || dimensions.height <= 0
    || dimensions.width * dimensions.height > maxPixels
  ) {
    throw new ExtractionFailure("IMAGE_PIXEL_LIMIT_EXCEEDED");
  }
}

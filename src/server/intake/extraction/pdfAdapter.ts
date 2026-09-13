import { createCanvas } from "@napi-rs/canvas";

import { ExtractionFailure } from "./errors";
import type { DirectPdfPage, PdfExtractionAdapter, PdfExtractionSession } from "./types";

interface PdfTextItem {
  str?: unknown;
  hasEOL?: unknown;
}

function pageText(items: unknown[]): string {
  return items.map((item) => {
    const candidate = item as PdfTextItem;
    return typeof candidate.str === "string" ? `${candidate.str}${candidate.hasEOL ? "\n" : " "}` : "";
  }).join("");
}

export async function collectBoundedPdfText(
  stream: ReadableStream<{ items: unknown[] }>,
  maxRawCharacters: number,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  let characterCount = 0;
  let completed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        return chunks.join("");
      }
      const chunk = pageText(next.value.items);
      characterCount += Array.from(chunk).length;
      if (characterCount > maxRawCharacters) {
        throw new ExtractionFailure("RAW_TEXT_LIMIT_EXCEEDED");
      }
      chunks.push(chunk);
    }
  } finally {
    if (!completed) {
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

async function destroyWithin(resource: { destroy(): Promise<void> }, timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.resolve().then(() => resource.destroy()).catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
}

export async function acquirePdfDocument<T>(
  loadingTask: { promise: Promise<T>; destroy(): Promise<void> },
  cleanupTimeoutMs: number,
): Promise<T> {
  try {
    return await loadingTask.promise;
  } catch (error) {
    await destroyWithin(loadingTask, cleanupTimeoutMs);
    throw error;
  }
}

export class PdfJsExtractionAdapter implements PdfExtractionAdapter {
  readonly name = "pdfjs-dist";
  readonly version = "5.4.149";
  readonly rasterizerName = "@napi-rs/canvas";
  readonly rasterizerVersion = "0.1.80";

  async open(bytes: Buffer, maxPages: number): Promise<PdfExtractionSession> {
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      const document = await acquirePdfDocument(loadingTask, 5_000);
      if (document.numPages > maxPages) {
        await destroyWithin(document, 5_000);
        throw new ExtractionFailure("PAGE_LIMIT_EXCEEDED");
      }

      const pages: DirectPdfPage[] = Array.from({ length: document.numPages }, (_, index) => ({
        pageNumber: index + 1,
        readText: async (maxRawCharacters) => {
          const page = await document.getPage(index + 1);
          try {
            return await collectBoundedPdfText(
              page.streamTextContent({ disableNormalization: true }),
              maxRawCharacters,
            );
          } finally {
            try { page.cleanup(); } catch (_cleanupError) {}
          }
        },
      }));

      return {
        pageCount: document.numPages,
        pages,
        renderPage: async (pageNumber, maxPixels) => {
          let page;
          try {
            page = await document.getPage(pageNumber);
            const unscaled = page.getViewport({ scale: 1 });
            const targetWidth = Math.max(1, Math.ceil(unscaled.width * 2));
            const targetHeight = Math.max(1, Math.ceil(unscaled.height * 2));
            if (targetWidth * targetHeight > maxPixels) {
              throw new ExtractionFailure("IMAGE_PIXEL_LIMIT_EXCEEDED");
            }
            const viewport = page.getViewport({ scale: 2 });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext("2d");
            await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
            const rendered = canvas.toBuffer("image/png");
            return rendered;
          } catch (error) {
            if (error instanceof ExtractionFailure) {
              throw error;
            }
            throw new ExtractionFailure("RASTERIZATION_FAILURE", undefined, error);
          } finally {
            if (page) {
              try { page.cleanup(); } catch (_cleanupError) {}
            }
          }
        },
        close: (timeoutMs) => destroyWithin(document, timeoutMs),
      };
    } catch (error) {
      if (error instanceof ExtractionFailure) {
        throw error;
      }
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const code = message.includes("invalid pdf") || message.includes("missing pdf")
        ? "MALFORMED_PDF"
        : "DIRECT_PARSER_FAILURE";
      throw new ExtractionFailure(code, undefined, error);
    }
  }
}

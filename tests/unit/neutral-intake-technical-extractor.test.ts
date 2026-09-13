import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ExtractionFailure } from "@/server/intake/extraction/errors";
import { TesseractItalianOcrAdapter, type OcrExecution } from "@/server/intake/extraction/ocrAdapter";
import { acquirePdfDocument, collectBoundedPdfText } from "@/server/intake/extraction/pdfAdapter";
import { B2C9_EXTRACTION_POLICY_V1 } from "@/server/intake/extraction/policy";
import { extractTechnicalDocument } from "@/server/intake/extraction/technicalExtractor";
import type { OcrAdapter, OcrResult, PdfExtractionAdapter } from "@/server/intake/extraction/types";

function artifact(bytes: Buffer, declaredMimeType = "application/pdf") {
  return {
    bytes,
    declaredMimeType,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    expectedSizeBytes: bytes.length,
  };
}

function adapters(pageTexts: string[]) {
  const renderPage = vi.fn(async () => Buffer.from("raster"));
  const close = vi.fn(async () => undefined);
  const pdf: PdfExtractionAdapter = {
    name: "test-pdf",
    version: "1",
    rasterizerName: "test-raster",
    rasterizerVersion: "1",
    open: vi.fn(async () => ({
      pageCount: pageTexts.length,
      pages: pageTexts.map((text, index) => ({
        pageNumber: index + 1,
        readText: vi.fn(async () => text),
      })),
      renderPage,
      close,
    })),
  };
  const ocr: OcrAdapter = {
    name: "test-ocr",
    version: "1",
    recognize: vi.fn(async () => ({ text: "Testo italiano acquisito tramite OCR", confidence: 91 })),
  };
  return { pdf, ocr, renderPage, close };
}

describe("B2C9 technical extraction orchestration", () => {
  it("keeps sufficient PDF pages direct and OCRs only insufficient pages", async () => {
    const bytes = Buffer.from("%PDF-mocked");
    const sufficient = "Il presente atto disciplina la concessione demaniale portuale numero sette per finalita operative.";
    const dependencies = adapters([sufficient, "pagina"]);

    const result = await extractTechnicalDocument(artifact(bytes), dependencies);

    expect(result.pages.map((page) => page.method)).toEqual(["DIRECT_TEXT", "OCR"]);
    expect(result.pages[1].warnings).toEqual(["OCR_REQUIRED", "OCR_FALLBACK_USED"]);
    expect(dependencies.renderPage).toHaveBeenCalledOnce();
    expect(dependencies.ocr.recognize).toHaveBeenCalledOnce();
    expect(dependencies.close).toHaveBeenCalledOnce();
  });

  it("preserves raw text separately and hashes the raw representation", async () => {
    const bytes = Buffer.from("%PDF-mocked");
    const raw = "  Testo   diretto\r\n della concessione portuale con contenuto tecnico sufficiente.  ";
    const result = await extractTechnicalDocument(artifact(bytes), adapters([raw]));
    expect(result.pages[0].text).toBe(raw);
    expect(result.pages[0].normalizedText).toBe(
      "Testo diretto\ndella concessione portuale con contenuto tecnico sufficiente.",
    );
    expect(result.pages[0].textSha256).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("cancels streamed PDF text as soon as the raw bound is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<{ items: unknown[] }>({
      start(controller) {
        controller.enqueue({ items: [{ str: "12345", hasEOL: false }] });
        controller.enqueue({ items: [{ str: "67890", hasEOL: false }] });
      },
      cancel,
    });
    await expect(collectBoundedPdfText(stream, 7)).rejects.toMatchObject({
      code: "RAW_TEXT_LIMIT_EXCEEDED",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not wait for a hanging PDF stream cancellation", async () => {
    const stream = new ReadableStream<{ items: unknown[] }>({
      start(controller) {
        controller.enqueue({ items: [{ str: "overflow", hasEOL: false }] });
      },
      cancel: () => new Promise<void>(() => undefined),
    });
    await expect(Promise.race([
      collectBoundedPdfText(stream, 1).catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ])).resolves.toMatchObject({ code: "RAW_TEXT_LIMIT_EXCEEDED" });
  });

  it.each([
    ["UNSUPPORTED_MIME", Buffer.from("plain"), "application/octet-stream", {}],
    ["MIME_MISMATCH", Buffer.from("%PDF-1.7"), "image/png", {}],
    ["INTEGRITY_SIZE_MISMATCH", Buffer.from("%PDF-1.7"), "application/pdf", { expectedSizeBytes: 1 }],
    ["INTEGRITY_SHA256_MISMATCH", Buffer.from("%PDF-1.7"), "application/pdf", { expectedSha256: "0".repeat(64) }],
  ])("fails deterministically for %s", async (code, bytes, mime, overrides) => {
    await expect(extractTechnicalDocument({ ...artifact(bytes, mime), ...overrides }))
      .rejects.toMatchObject({ code });
  });

  it("enforces artifact and total text limits without truncation", async () => {
    const bytes = Buffer.from("%PDF-mocked");
    const dependencies = adapters(["contenuto sufficiente per questa pagina con molte parole tecniche verificabili"]);
    const tinyPolicy = {
      ...B2C9_EXTRACTION_POLICY_V1,
      maxArtifactBytes: bytes.length - 1,
    };
    await expect(extractTechnicalDocument(artifact(bytes), { ...dependencies, policy: tinyPolicy }))
      .rejects.toBeInstanceOf(ExtractionFailure);

    const textPolicy = {
      ...B2C9_EXTRACTION_POLICY_V1,
      maxNormalizedCharsPerAttempt: 10,
    };
    await expect(extractTechnicalDocument(artifact(bytes), { ...dependencies, policy: textPolicy }))
      .rejects.toMatchObject({ code: "TEXT_PAYLOAD_LIMIT_EXCEEDED" });
  });

  it("rejects image dimensions above policy before OCR", async () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(50_000, 16);
    png.writeUInt32BE(50_000, 20);
    const dependencies = adapters([]);
    await expect(extractTechnicalDocument(artifact(png, "image/png"), dependencies))
      .rejects.toMatchObject({ code: "IMAGE_PIXEL_LIMIT_EXCEEDED" });
    expect(dependencies.ocr.recognize).not.toHaveBeenCalled();
  });

  it.each(["OCR_TIMEOUT", "OCR_ENGINE_FAILURE"])("preserves the %s taxonomy", async (code) => {
    const bytes = Buffer.from("%PDF-mocked");
    const dependencies = adapters([""]);
    dependencies.ocr.recognize = vi.fn(async () => {
      throw new ExtractionFailure(code as "OCR_TIMEOUT" | "OCR_ENGINE_FAILURE");
    });
    await expect(extractTechnicalDocument(artifact(bytes), dependencies)).rejects.toMatchObject({ code });
    expect(dependencies.close).toHaveBeenCalledOnce();
  });
});

describe("B2C9 OCR lifecycle deadline", () => {
  it.each(["startup", "recognition", "cleanup"])("does not wait beyond the deadline for %s", async () => {
    const terminate = vi.fn(() => new Promise<never>(() => undefined));
    const execution: OcrExecution = {
      result: new Promise<never>(() => undefined),
      terminate,
    };
    const adapter = new TesseractItalianOcrAdapter(() => execution);
    await expect(adapter.recognize(Buffer.from("image"), 10)).rejects.toMatchObject({ code: "OCR_TIMEOUT" });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("classifies execution errors and terminates the isolation boundary", async () => {
    const terminate = vi.fn(async () => undefined);
    const adapter = new TesseractItalianOcrAdapter(() => ({
      result: Promise.reject(new Error("worker startup failed")),
      terminate,
    }));
    await expect(adapter.recognize(Buffer.from("image"), 100)).rejects.toMatchObject({
      code: "OCR_ENGINE_FAILURE",
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("classifies synchronous isolation startup failures", async () => {
    const adapter = new TesseractItalianOcrAdapter(() => {
      throw new Error("worker unavailable");
    });
    await expect(adapter.recognize(Buffer.from("image"), 100)).rejects.toMatchObject({
      code: "OCR_ENGINE_FAILURE",
    });
  });

  it("includes synchronous isolation startup time in the deadline", async () => {
    const terminate = vi.fn(async () => undefined);
    const adapter = new TesseractItalianOcrAdapter(() => {
      const until = Date.now() + 5;
      while (Date.now() < until) {}
      return { result: new Promise<OcrResult>(() => undefined), terminate };
    });
    await expect(adapter.recognize(Buffer.from("image"), 1)).rejects.toMatchObject({
      code: "OCR_TIMEOUT",
    });
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("returns successful OCR only after isolated execution cleanup", async () => {
    const terminate = vi.fn(async () => undefined);
    const adapter = new TesseractItalianOcrAdapter(() => ({
      result: Promise.resolve({ text: "testo grezzo\n", confidence: 94 }),
      terminate,
    }));
    await expect(adapter.recognize(Buffer.from("image"), 100)).resolves.toEqual({
      text: "testo grezzo\n",
      confidence: 94,
    });
    expect(terminate).toHaveBeenCalledOnce();
  });
});

describe("B2C9 PDF loading task ownership", () => {
  it("destroys a failed loading task and preserves the primary parser error", async () => {
    const primaryError = new Error("Invalid PDF structure");
    const destroy = vi.fn(async () => undefined);
    await expect(acquirePdfDocument({
      promise: Promise.reject(primaryError),
      destroy,
    }, 100)).rejects.toBe(primaryError);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ["cleanup rejection", vi.fn(async () => { throw new Error("cleanup failed"); })],
    ["cleanup timeout", vi.fn(() => new Promise<void>(() => undefined))],
  ])("does not replace or indefinitely delay the primary error on %s", async (_case, destroy) => {
    const primaryError = new Error("Invalid PDF structure");
    await expect(Promise.race([
      acquirePdfDocument({ promise: Promise.reject(primaryError), destroy }, 5)
        .catch((error) => error),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 100)),
    ])).resolves.toBe(primaryError);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("transfers ownership without destroying a successfully loaded document", async () => {
    const document = { numPages: 1 };
    const destroy = vi.fn(async () => undefined);
    await expect(acquirePdfDocument({ promise: Promise.resolve(document), destroy }, 100))
      .resolves.toBe(document);
    expect(destroy).not.toHaveBeenCalled();
  });
});
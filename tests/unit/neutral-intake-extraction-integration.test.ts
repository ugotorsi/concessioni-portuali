import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { extractTechnicalDocument } from "@/server/intake/extraction/technicalExtractor";

import { createPdf, createTextImage } from "./helpers/extraction-fixtures";

function artifact(bytes: Buffer, declaredMimeType: string) {
  return {
    bytes,
    declaredMimeType,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    expectedSizeBytes: bytes.length,
  };
}

describe("B2C9 real extraction adapters", () => {
  it("extracts known text directly from a two-page digital PDF", async () => {
    const pdf = await createPdf([
      { type: "text", text: "PRIMA PAGINA DELLA CONCESSIONE PORTUALE CON CONTENUTO DIRETTO VERIFICABILE" },
      { type: "text", text: "SECONDA PAGINA DEL PROCEDIMENTO AMMINISTRATIVO CON TESTO DIRETTO VERIFICABILE" },
    ]);
    const result = await extractTechnicalDocument(artifact(pdf, "application/pdf"));
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page) => page.method)).toEqual(["DIRECT_TEXT", "DIRECT_TEXT"]);
    expect(result.pages[0].normalizedText).toContain("PRIMA PAGINA");
    expect(result.pages[1].normalizedText).toContain("SECONDA PAGINA");
  });

  it.each([
    ["image/png", "png" as const],
    ["image/jpeg", "jpeg" as const],
  ])("performs offline Italian OCR for %s", async (mimeType, format) => {
    const image = createTextImage(format, "CONCESSIONE PORTUALE ITALIANA");
    const result = await extractTechnicalDocument(artifact(image, mimeType));
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].method).toBe("OCR");
    expect(result.pages[0].normalizedText.replace(/\s+/g, " ").toUpperCase())
      .toContain("CONCESSIONE PORTUALE ITALIANA");
  }, 60_000);

  it("OCRs an image-only PDF page", async () => {
    const scan = createTextImage("png", "ATTO PORTUALE SCANSIONATO");
    const pdf = await createPdf([{ type: "image", image: scan }]);
    const result = await extractTechnicalDocument(artifact(pdf, "application/pdf"));
    expect(result.pages[0].method).toBe("OCR");
    expect(result.pages[0].normalizedText.toUpperCase()).toContain("ATTO PORTUALE SCANSIONATO");
    expect(result.pages[0].warnings).toContain("OCR_FALLBACK_USED");
  }, 60_000);

  it("uses direct text and OCR page by page for a mixed PDF", async () => {
    const scan = createTextImage("png", "SECONDA PAGINA SCANSIONATA");
    const pdf = await createPdf([
      { type: "text", text: "PRIMA PAGINA DIRETTA DEL PROCEDIMENTO PORTUALE CON TESTO SUFFICIENTE" },
      { type: "image", image: scan },
    ]);
    const result = await extractTechnicalDocument(artifact(pdf, "application/pdf"));
    expect(result.pages.map((page) => page.method)).toEqual(["DIRECT_TEXT", "OCR"]);
    expect(result.pages[1].normalizedText.toUpperCase()).toContain("SECONDA PAGINA SCANSIONATA");
  }, 60_000);

  it("rejects malformed PDFs", async () => {
    const malformed = Buffer.from("%PDF-not-a-pdf");
    await expect(extractTechnicalDocument(artifact(malformed, "application/pdf")))
      .rejects.toMatchObject({ code: "MALFORMED_PDF" });
  });

  it("rejects PDF page counts above policy before extracting page content", async () => {
    const pdf = await createPdf([
      { type: "text", text: "PRIMA PAGINA" },
      { type: "text", text: "SECONDA PAGINA" },
    ]);
    await expect(extractTechnicalDocument(artifact(pdf, "application/pdf"), {
      policy: {
        maxArtifactBytes: 25 * 1024 * 1024,
        maxPdfPages: 1,
        maxImagePixels: 40_000_000,
        maxRawCharsPerPage: 100_000,
        maxRawCharsPerAttempt: 4_000_000,
        maxNormalizedCharsPerPage: 50_000,
        maxNormalizedCharsPerAttempt: 2_000_000,
        ocrTimeoutMsPerPage: 45_000,
        directText: {
          minNormalizedChars: 40,
          minAlphanumericChars: 20,
          minMeaningfulTokens: 5,
          minPrintableRatio: 0.85,
        },
        version: "B2C9_EXTRACTION_POLICY_V1",
      },
    })).rejects.toMatchObject({ code: "PAGE_LIMIT_EXCEEDED" });
  });
});
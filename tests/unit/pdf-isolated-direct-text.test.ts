import { describe, expect, it } from "vitest";

import { ExtractionFailure } from "@/server/intake/extraction/errors";
import {
  isIsolatedPdfDirectTextEnabled,
  PdfJsExtractionAdapter,
  readPdfDirectTextIsolated,
} from "@/server/intake/extraction/pdfAdapter";

function minimalPdf(text: string): Buffer {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("isolated PDF direct-text extraction", () => {
  it("is opt-in through PDF_DIRECT_TEXT_SUBPROCESS", () => {
    expect(isIsolatedPdfDirectTextEnabled({})).toBe(false);
    expect(isIsolatedPdfDirectTextEnabled({ PDF_DIRECT_TEXT_SUBPROCESS: " TRUE " })).toBe(true);
    expect(isIsolatedPdfDirectTextEnabled({ PDF_DIRECT_TEXT_SUBPROCESS: "false" })).toBe(false);
  });

  it("returns the same page text as the in-process parser", async () => {
    const bytes = minimalPdf("Polizza dimostrativa di prova");
    const isolated = await new PdfJsExtractionAdapter({ isolatedDirectText: true }).open(bytes, 5);
    const inProcess = await new PdfJsExtractionAdapter({ isolatedDirectText: false }).open(bytes, 5);
    try {
      expect(isolated.pageCount).toBe(1);
      const text = await isolated.pages[0]!.readText(10_000);
      expect(text).toContain("Polizza dimostrativa di prova");
      expect(text).toBe(await inProcess.pages[0]!.readText(10_000));
    } finally {
      await isolated.close(1_000);
      await inProcess.close(1_000);
    }
  }, 30_000);

  it.each([
    ["concessione", "Concessione demaniale portuale"],
    ["investimenti", "Piano degli investimenti e PEF"],
    ["canoni", "Canoni e solleciti di pagamento"],
    ["sopralluogo", "Verbale sopralluogo edilizia ambiente"],
    ["controdeduzioni", "Memoria di controdeduzioni"],
  ])("extracts direct text from the %s fixture using the default in-process path", async (_label, text) => {
    const adapter = new PdfJsExtractionAdapter();
    expect(isIsolatedPdfDirectTextEnabled({ NODE_ENV: "production" })).toBe(false);
    const session = await adapter.open(minimalPdf(text), 5);
    try {
      expect(session.pageCount).toBe(1);
      expect(await session.pages[0]!.readText(10_000)).toContain(text);
    } finally {
      await session.close(1_000);
    }
  }, 30_000);

  it("keeps page, character and malformed-input limits", async () => {
    const bytes = minimalPdf("Testo di prova");
    await expect(readPdfDirectTextIsolated(bytes, 0)).rejects.toMatchObject({ code: "DIRECT_PARSER_FAILURE" });
    const session = await new PdfJsExtractionAdapter({ isolatedDirectText: true }).open(bytes, 1);
    await expect(session.pages[0]!.readText(3)).rejects.toMatchObject({ code: "RAW_TEXT_LIMIT_EXCEEDED" });
    await expect(new PdfJsExtractionAdapter({ isolatedDirectText: true }).open(Buffer.from("%PDF-1.4 broken"), 5))
      .rejects.toBeInstanceOf(ExtractionFailure);
    await expect(new PdfJsExtractionAdapter({ isolatedDirectText: true }).open(Buffer.from("%PDF-1.4 broken"), 5))
      .rejects.toMatchObject({ code: "MALFORMED_PDF" });
  }, 30_000);

  it("removes the complete tsx loader option before starting the plain Node parser", async () => {
    const originalNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--import tsx --max-old-space-size=512";
    try {
      const result = await readPdfDirectTextIsolated(minimalPdf("Loader isolato"), 5);
      expect(result.pages[0]?.text).toContain("Loader isolato");
    } finally {
      if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = originalNodeOptions;
    }
  }, 30_000);

  it("reports subprocess startup failures without exposing runtime paths", async () => {
    let error: unknown;
    try {
      await readPdfDirectTextIsolated(
        minimalPdf("Test"),
        5,
        "/tmp/noetra-missing-pdf-direct-text.mjs",
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ExtractionFailure);
    expect(error).toMatchObject({
      code: "DIRECT_PARSER_FAILURE",
      message: "Lo script o una dipendenza del parser PDF non è disponibile.",
    });
    expect((error as Error).message).not.toContain("/tmp/");
    expect((error as Error).message).not.toContain("noetra-missing-pdf-direct-text");
  }, 30_000);
});

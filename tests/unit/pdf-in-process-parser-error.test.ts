import { describe, expect, it } from "vitest";

import { PdfJsExtractionAdapter } from "@/server/intake/extraction/pdfAdapter";

describe("in-process PDF parser diagnostics", () => {
  it("preserves a useful sanitized module-loading failure", async () => {
    let failure: unknown;
    try {
      await new PdfJsExtractionAdapter({
        isolatedDirectText: false,
        loadPdfJs: async () => {
          throw new Error("Cannot find package 'pdfjs-dist' imported from /var/task/.next/server/parser.js");
        },
      }).open(
        Buffer.from("%PDF-1.4"),
        5,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "DIRECT_PARSER_FAILURE",
      message: "Lo script o una dipendenza del parser PDF non è disponibile.",
    });
    expect((failure as Error).message).not.toContain("/var/task/");
    expect((failure as Error).message).not.toContain(".next/server");
  });
});

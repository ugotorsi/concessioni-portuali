import { describe, expect, it } from "vitest";

import { detectArtifactMimeType } from "@/server/intake/extraction/mime";
import { B2C9_EXTRACTION_POLICY_V1 } from "@/server/intake/extraction/policy";
import { assessDirectText, normalizeExtractedText } from "@/server/intake/extraction/text";

describe("B2C9 extraction policy primitives", () => {
  it.each([
    [Buffer.from("%PDF-1.7"), "application/pdf"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [Buffer.from("plain text"), "application/octet-stream"],
  ])("sniffs supported signatures without trusting names %#", (bytes, expected) => {
    expect(detectArtifactMimeType(bytes)).toBe(expected);
  });

  it("normalizes line endings and pathological whitespace without rewriting words", () => {
    expect(normalizeExtractedText("  Atto\r\n\tportuale   n.  7\r\n\r\n\r\n2026  "))
      .toBe("Atto\nportuale n. 7\n\n2026");
  });

  it("makes deterministic page-level sufficiency decisions", () => {
    const sufficient = normalizeExtractedText(
      "Autorita di sistema portuale: il presente atto disciplina la concessione demaniale numero sette.",
    );
    expect(assessDirectText(sufficient, B2C9_EXTRACTION_POLICY_V1).decision)
      .toBe("DIRECT_TEXT_SUFFICIENT");
    expect(assessDirectText("pagina 1", B2C9_EXTRACTION_POLICY_V1).decision).toBe("OCR_REQUIRED");
    expect(assessDirectText(" \n ", B2C9_EXTRACTION_POLICY_V1).decision).toBe("EMPTY_PAGE");
  });
});
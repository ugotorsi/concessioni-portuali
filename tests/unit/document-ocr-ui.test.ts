import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("document OCR interface", () => {
  it("shows the authenticated OCR action only for an eligible current-version attempt", async () => {
    const page = await readFile(
      path.join(process.cwd(), "src/app/documenti/page.tsx"),
      "utf8",
    );
    const query = await readFile(
      path.join(process.cwd(), "src/server/queries/documenti.ts"),
      "utf8",
    );

    expect(page).toContain('role === "ADMIN" || role === "TECNICO"');
    expect(page).toContain("canStartOcr && item.ocrFailedAttemptId");
    expect(page).toContain("Avvia OCR");
    expect(page).toContain("startDocumentoOcrAction");
    expect(query).toContain('policyVersion: "DOCUMENT_DIRECT_TEXT_EXTRACTION_POLICY_V1"');
    expect(query).toContain('failureCode: "OCR_REQUIRED"');
    expect(query).toContain("currentFileVersion");
  });
});

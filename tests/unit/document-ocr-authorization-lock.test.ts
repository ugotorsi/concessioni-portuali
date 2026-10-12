import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("document OCR authorization transaction lock", () => {
  it("returns a supported boolean instead of PostgreSQL void", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/server/documents/documentOcrAuthorization.ts",
      ),
      "utf8",
    );

    expect(source).toContain('SELECT TRUE AS "acquired"');
    expect(source).toContain("FROM pg_advisory_xact_lock");
    expect(source).not.toContain("SELECT pg_advisory_xact_lock");
    expect(source).toContain("DOCUMENT_OCR_AUTHORIZATION_LOCK_FAILED");
  });
});

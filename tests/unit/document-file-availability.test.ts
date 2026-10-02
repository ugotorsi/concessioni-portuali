import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hasVerifiedDocumentFileVersion } from "@/server/documents/file-version-availability";

describe("document file availability", () => {
  it("matches the verified-byte reader current-version criterion", () => {
    expect(hasVerifiedDocumentFileVersion("version-1")).toBe(true);
    expect(hasVerifiedDocumentFileVersion(null)).toBe(false);
    expect(hasVerifiedDocumentFileVersion(undefined)).toBe(false);
  });

  it("exposes only an explicit boolean from both fascicolo read models", () => {
    const legacyQuery = readFileSync("src/server/queries/procedimenti.ts", "utf8");
    const intakeQuery = readFileSync("src/server/queries/fascicolo-intake.ts", "utf8");

    for (const source of [legacyQuery, intakeQuery]) {
      expect(source).toContain("isFileAvailable: hasVerifiedDocumentFileVersion(");
    }
    expect(intakeQuery).toContain("({ currentFileVersionId, ...documento })");
  });

  it("keeps the download reader security logic unchanged", () => {
    const reader = readFileSync("src/server/documents/authorizedVerifiedByteReader.ts", "utf8");

    expect(reader).toContain("documento.currentFileVersionId == null");
    expect(reader).not.toContain("hasVerifiedDocumentFileVersion");
    expect(reader).toContain('const status = hasLegacyFileIndicator(documento) ? "LEGACY_UNVERIFIED" : "NO_FILE_VERSION"');
    expect(reader).toContain("validateManifest({");
    expect(reader).toContain("readDocumentFileFromProvider({");
    expect(reader).toContain('new DocumentReadIntegrityError("SHA256_MISMATCH")');
  });
});
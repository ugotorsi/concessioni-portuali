import { describe, expect, it } from "vitest";

import { legalRulePackManifestSchema } from "@/server/legal-rules/manifest";

function buildValidManifest() {
  return {
    packCode: "adsp-pack-test",
    packVersion: "1.0.0",
    tenantEnteCode: "DEMO-ENTE-ADSP",
    authorities: [
      {
        authorityKey: "ADSP-MTC",
        code: "ADSP-MTC",
        name: "Authority Demo",
        level: "ADSP",
      },
    ],
    ports: [
      {
        portKey: "PORT-NAP-SAL",
        code: "NAPOLI-SALERNO",
        name: "Porto Demo",
        authorityKey: "ADSP-MTC",
      },
    ],
    portAreas: [
      {
        portAreaKey: "AREA-1",
        portKey: "PORT-NAP-SAL",
        code: "AREA-1",
        name: "Area Demo",
      },
    ],
    sources: [
      {
        stableKey: "SRC-1",
        filename: "src-1.pdf",
        relativePath: "src-1.pdf",
        title: "Fonte 1",
        issuingBody: "AdSP",
        documentType: "AUTHORITY_REGULATION",
        sourceNumber: "1/2024",
        sourceDate: "2024-01-01T00:00:00.000Z",
        authorityKey: "ADSP-MTC",
        portKeys: ["PORT-NAP-SAL"],
        portAreaKey: "AREA-1",
        legalRank: "AUTHORITY_REGULATION",
        territorialScope: "PORT_AREA",
        status: "CURRENT_SUBJECT_TO_REVIEW",
        role: "NORMATIVE",
        isConformative: false,
        isExtractable: true,
        sourceOrigin: "LOCAL_CORPUS",
        confidence: "MEDIUM",
        humanReviewRequired: true,
        effectiveFrom: "2024-01-01T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
        checksum: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        size: 123,
        notes: "note",
        tags: ["POT"],
      },
      {
        stableKey: "MAP-1",
        filename: "map-1.jpg",
        relativePath: "map-1.jpg",
        title: "Mappa",
        issuingBody: "AdSP",
        documentType: "SUPPORTING_MAP",
        authorityKey: "ADSP-MTC",
        portKeys: ["PORT-NAP-SAL"],
        legalRank: "CARTOGRAPHIC_SUPPORT",
        territorialScope: "PORT",
        status: "CURRENT_SUBJECT_TO_REVIEW",
        role: "SUPPORTING_MAP",
        isConformative: false,
        isExtractable: false,
        sourceOrigin: "LOCAL_CORPUS",
        confidence: "LOW",
        humanReviewRequired: true,
        effectiveFrom: "2024-01-01T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
        checksum: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        size: 456,
        tags: ["MAPPA"],
      },
    ],
    rules: [
      {
        ruleId: "RULE-1",
        sourceStableKey: "SRC-1",
        title: "Regola 1",
        summary: "Sommario regola 1",
        category: "CANONE",
        outcome: {
          outputSeverity: "MEDIA",
          outcomeTitle: "Outcome",
          outcomeSummary: "Outcome summary",
          humanReviewRequired: true,
        },
      },
    ],
    relations: [
      {
        relationId: "REL-1",
        fromSourceStableKey: "SRC-1",
        toSourceStableKey: "MAP-1",
        relationType: "ALLEGA",
      },
    ],
    gaps: [
      {
        gapKey: "GAP-1",
        title: "Gap 1",
        description: "Descrizione gap 1",
        linkedRuleCode: "RULE-1",
      },
    ],
    duplicates: [
      {
        duplicateFilename: "src-1-copy.pdf",
        duplicateRelativePath: "src-1-copy.pdf",
        duplicateOfStableKey: "SRC-1",
      },
    ],
  };
}

describe("legal rule pack manifest", () => {
  it("accepts a complete valid manifest", () => {
    const parsed = legalRulePackManifestSchema.parse(buildValidManifest());

    expect(parsed.packCode).toBe("adsp-pack-test");
    expect(parsed.rules[0]?.status).toBe("ATTIVA");
    expect(parsed.rules[0]?.outcome.humanReviewRequired).toBe(true);
  });

  it("rejects invalid enum values", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.status = "INVALID" as never;

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects duplicate stableKey", () => {
    const manifest = buildValidManifest();
    manifest.sources[1]!.stableKey = "SRC-1";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Duplicate stableKey/);
  });

  it("rejects duplicate ruleId", () => {
    const manifest = buildValidManifest();
    manifest.rules.push({ ...manifest.rules[0]! });

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Duplicate ruleId/);
  });

  it("rejects duplicate relationId", () => {
    const manifest = buildValidManifest();
    manifest.relations.push({ ...manifest.relations[0]! });

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Duplicate relationId/);
  });

  it("rejects duplicate gapKey", () => {
    const manifest = buildValidManifest();
    manifest.gaps.push({ ...manifest.gaps[0]! });

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Duplicate gapKey/);
  });

  it("rejects relation with dangling source", () => {
    const manifest = buildValidManifest();
    manifest.relations[0]!.toSourceStableKey = "SRC-404";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/unknown source stableKey/i);
  });

  it("rejects rule with dangling source", () => {
    const manifest = buildValidManifest();
    manifest.rules[0]!.sourceStableKey = "SRC-404";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/unknown source stableKey/i);
  });

  it("rejects absolute source paths", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.relativePath = "C:/tmp/src-1.pdf";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/safe relativePath/i);
  });

  it("rejects invalid checksum", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.checksum = "abc";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects invalid size", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.size = -1;

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow();
  });

  it("rejects inconsistent effective dates", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.effectiveFrom = "2025-01-01T00:00:00.000Z";
    manifest.sources[0] = {
      ...manifest.sources[0]!,
      effectiveTo: "2024-01-01T00:00:00.000Z",
    };

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/effectiveTo precedes effectiveFrom/);
  });

  it("rejects unknown portKey in source", () => {
    const manifest = buildValidManifest();
    manifest.sources[0]!.portKeys = ["PORT-UNKNOWN"];

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Unknown portKey/);
  });

  it("rejects raster document marked as conformative", () => {
    const manifest = buildValidManifest();
    manifest.sources[1]!.isConformative = true;

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/Raster source/);
  });

  it("rejects duplicate mapping to unknown source", () => {
    const manifest = buildValidManifest();
    manifest.duplicates[0]!.duplicateOfStableKey = "SRC-404";

    expect(() => legalRulePackManifestSchema.parse(manifest)).toThrow(/unknown stableKey/i);
  });
});

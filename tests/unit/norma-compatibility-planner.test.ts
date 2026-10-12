import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FINGERPRINT_FORMAT_VERSION,
  buildNormaCompatibilityPlan,
  parseNormaFamilyMappingPolicy,
  type CanonicalFamilyCandidate,
  type LegacyNormaFonteInput,
  type NormaFamilyMappingPolicy,
} from "@/server/legal-sources/norma-compatibility-planner";

const root = process.cwd();
const policyPath = path.join(root, "data/legal-source-compatibility/norma-family-mappings.json");
const plannerPath = path.join(root, "src/server/legal-sources/norma-compatibility-planner.ts");
const commandPath = path.join(root, "scripts/db/plan-norma-compatibility.ts");
const policy = parseNormaFamilyMappingPolicy(JSON.parse(readFileSync(policyPath, "utf8")));

const family: CanonicalFamilyCandidate = {
  id: "family-l84",
  sourceKey: "L-84-1994",
  title: "L. 28 gennaio 1994 n. 84",
  sourceType: "LEGGE",
  sourceNumber: "84",
  sourceDate: "1994-01-28T00:00:00.000Z",
  issuingBody: null,
  resourceSemanticType: null,
};

function fonte(overrides: Partial<LegacyNormaFonteInput> = {}): LegacyNormaFonteInput {
  return {
    id: "norma-18",
    codice: "ART_18_L84_1994",
    titolo: "Art. 18 Legge 84/1994",
    enteEmittente: "Stato",
    ambito: "CONCESSIONI",
    descrizione: null,
    legalSourceId: null,
    versioni: [
      {
        id: "versione-18",
        versione: "v2023.2",
        stato: "VIGENTE",
        dataEntrataVigore: "2023-07-01T00:00:00.000Z",
        dataFineVigore: null,
        urlTesto: "https://www.normattiva.it/",
        sintesi: "Article-level summary",
        note: null,
        legalSourceVersionId: null,
        artifactCandidate: null,
      },
    ],
    ...overrides,
  };
}

function plan(options: {
  normaFonti?: LegacyNormaFonteInput[];
  families?: CanonicalFamilyCandidate[];
  selectedPolicy?: NormaFamilyMappingPolicy;
  generatedAt?: string;
  repositoryCommitSha?: string;
} = {}) {
  return buildNormaCompatibilityPlan(
    {
      policy: options.selectedPolicy ?? policy,
      normaFonti: options.normaFonti ?? [fonte()],
      canonicalFamilies: options.families ?? [family],
      scope: { normaFonteCodice: null },
      repositoryCommitSha: options.repositoryCommitSha ?? "commit-a",
    },
    options.generatedAt ?? "2026-09-11T00:00:00.000Z",
  );
}

describe("Norma family compatibility planner", () => {
  it("accepts the exact curated policy", () => {
    expect(policy.policyVersion).toBe("B2C9_BLOCK_2A_V1");
    expect(policy.rules).toHaveLength(1);
  });

  it("rejects duplicate legacy codes", () => {
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [policy.rules[0], policy.rules[0]],
    })).toThrow(/Duplicate normaFonteCodice/);
  });

  it("rejects empty selectors", () => {
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{ ...policy.rules[0], normaFonteCodice: " " }],
    })).toThrow(/non-empty string/);
  });

  it("rejects unknown policy fields and malformed evidence", () => {
    expect(() => parseNormaFamilyMappingPolicy({ ...policy, fuzzy: true })).toThrow(/unknown fields/);
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{ ...policy.rules[0], evidence: { ...policy.rules[0].evidence, references: [] } }],
    })).toThrow(/non-empty array/);
  });

  it("rejects unsupported jurisdiction expectations instead of ignoring them", () => {
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{
        ...policy.rules[0],
        target: { ...policy.rules[0].target, expectedJurisdiction: "IT" },
      }],
    })).toThrow(/unknown fields/);
  });

  it("rejects invalid closed target values", () => {
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{
        ...policy.rules[0],
        target: { ...policy.rules[0].target, expectedSourceType: "NOT_A_SOURCE_TYPE" },
      }],
    })).toThrow(/unsupported/);
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{
        ...policy.rules[0],
        target: { ...policy.rules[0].target, expectedResourceSemanticType: "NOT_A_SEMANTIC_TYPE" },
      }],
    })).toThrow(/unsupported/);
  });

  it("maps ART_18 to exactly one matching family", () => {
    const result = plan().results[0];
    expect(result.familyResolution.outcome).toBe("WOULD_MAP_EXISTING_FAMILY");
    expect(result.familyResolution.candidateFamilyIds).toEqual(["family-l84"]);
  });

  it("does not propose canonical family creation when no raw candidate exists", () => {
    const resolution = plan({ families: [] }).results[0].familyResolution;
    expect(resolution.outcome).toBe("UNRESOLVED_FAMILY");
    expect(resolution.reasons).toContain("NO_EXISTING_CANONICAL_FAMILY_MATCH");
  });

  it("rejects the former source-wide sufficiency creation switch", () => {
    expect(() => parseNormaFamilyMappingPolicy({
      ...policy,
      rules: [{
        ...policy.rules[0],
        evidence: { ...policy.rules[0].evidence, sourceWideIdentitySufficient: true },
      }],
    })).toThrow(/unknown fields/);
  });

  it("leaves a legacy source without an exact rule unresolved", () => {
    const result = plan({ normaFonti: [fonte({ codice: "ART_42_COD_NAV" })] }).results[0];
    expect(result.familyResolution.outcome).toBe("UNRESOLVED_FAMILY");
  });

  it("does not resolve from a fuzzy or identical title", () => {
    const codNav = fonte({ codice: "ART_47_COD_NAV", titolo: family.title });
    expect(plan({ normaFonti: [codNav] }).results[0].familyResolution.outcome).toBe(
      "UNRESOLVED_FAMILY",
    );
  });

  it("reports multiple exact candidates as ambiguous", () => {
    const duplicate = { ...family, id: "family-l84-duplicate" };
    expect(plan({ families: [duplicate, family] }).results[0].familyResolution.outcome).toBe(
      "AMBIGUOUS_IDENTITY",
    );
  });

  it("filters nonmatching raw candidates before deciding ambiguity", () => {
    const nonmatching = { ...family, id: "family-l84-wrong", title: "Wrong title" };
    const resolution = plan({ families: [nonmatching, family] }).results[0].familyResolution;
    expect(resolution.outcome).toBe("WOULD_MAP_EXISTING_FAMILY");
    expect(resolution.candidateFamilyIds).toEqual([family.id]);
  });

  it("reports conflict when raw candidates exist but none pass verification", () => {
    const nonmatching = { ...family, title: "Wrong title" };
    expect(plan({ families: [nonmatching] }).results[0].familyResolution.outcome).toBe("CONFLICT");
  });

  it("verifies a coherent existing bridge", () => {
    const result = plan({ normaFonti: [fonte({ legalSourceId: family.id })] }).results[0];
    expect(result.familyResolution.outcome).toBe("VERIFIED_EXISTING_BRIDGE");
  });

  it("reports an existing bridge to another family as conflict", () => {
    const other = { ...family, id: "other", sourceKey: "OTHER" };
    const result = plan({
      normaFonti: [fonte({ legalSourceId: other.id })],
      families: [family, other],
    }).results[0];
    expect(result.familyResolution.outcome).toBe("BRIDGE_CONFLICT");
  });

  it("does not trust an unavailable existing bridge", () => {
    const result = plan({
      normaFonti: [fonte({ legalSourceId: "missing" })],
      families: [family],
    }).results[0];
    expect(result.familyResolution.outcome).toBe("BRIDGE_UNVERIFIED");
  });

  it("does not trust a bridge with mismatching verification fields", () => {
    const result = plan({
      normaFonti: [fonte({ legalSourceId: family.id })],
      families: [{ ...family, sourceNumber: "85" }],
    }).results[0];
    expect(result.familyResolution.outcome).toBe("BRIDGE_CONFLICT");
  });

  it("keeps expression resolution source-wide and unresolved", () => {
    const version = plan().results[0].versioni[0];
    expect(version.expressionResolution.outcome).toBe("UNRESOLVED_EXPRESSION");
    expect(version.expressionResolution.reasons.join(" ")).toMatch(/Provision-level/);
  });

  it("does not create an expression from a provision effective date", () => {
    const changedDate = fonte();
    changedDate.versioni[0].dataEntrataVigore = "2040-01-01T00:00:00.000Z";
    expect(plan({ normaFonti: [changedDate] }).results[0].versioni[0].expressionResolution.outcome).toBe(
      "UNRESOLVED_EXPRESSION",
    );
  });

  it("does not verify an artifact FK alone", () => {
    const linked = fonte();
    linked.versioni[0].legalSourceVersionId = "artifact-1";
    linked.versioni[0].artifactCandidate = {
      id: "artifact-1",
      sourceFamilyId: family.id,
      observedSha256: "a".repeat(64),
      observedSizeBytes: 100,
      observedMimeType: "application/pdf",
      provisionReference: null,
      provenanceReference: null,
    };
    expect(plan({ normaFonti: [linked] }).results[0].versioni[0].artifactResolution.outcome).toBe(
      "ARTIFACT_CANDIDATE",
    );
  });

  it("does not verify an artifact while family resolution is unresolved", () => {
    const linked = fonte({ codice: "ART_42_COD_NAV" });
    linked.versioni[0].legalSourceVersionId = "artifact-1";
    linked.versioni[0].artifactCandidate = {
      id: "artifact-1",
      sourceFamilyId: family.id,
      observedSha256: "a".repeat(64),
      observedSizeBytes: 100,
      observedMimeType: "application/pdf",
      provisionReference: "article-42",
      provenanceReference: "repository-fixture",
    };
    expect(plan({ normaFonti: [linked] }).results[0].versioni[0].artifactResolution.outcome).toBe(
      "ARTIFACT_CANDIDATE",
    );
  });

  it("does not verify an artifact candidate whose ID differs from the legacy FK", () => {
    const linked = fonte();
    linked.versioni[0].legalSourceVersionId = "artifact-1";
    linked.versioni[0].artifactCandidate = {
      id: "artifact-2",
      sourceFamilyId: family.id,
      observedSha256: "a".repeat(64),
      observedSizeBytes: 100,
      observedMimeType: "application/pdf",
      provisionReference: "article-18",
      provenanceReference: "repository-fixture",
    };
    expect(plan({ normaFonti: [linked] }).results[0].versioni[0].artifactResolution.outcome).toBe(
      "ARTIFACT_CANDIDATE",
    );
  });

  it("verifies artifact evidence only when identity, family and evidence all match", () => {
    const linked = fonte();
    linked.versioni[0].legalSourceVersionId = "artifact-1";
    linked.versioni[0].artifactCandidate = {
      id: "artifact-1",
      sourceFamilyId: family.id,
      observedSha256: "a".repeat(64),
      observedSizeBytes: 100,
      observedMimeType: "application/pdf",
      provisionReference: "article-18",
      provenanceReference: "repository-fixture",
    };
    expect(plan({ normaFonti: [linked] }).results[0].versioni[0].artifactResolution.outcome).toBe(
      "VERIFIED_ARTIFACT_EVIDENCE",
    );
  });

  it("keeps the provision locator compatibility-only in the report", () => {
    expect(plan().results[0].legacyProvisionLocatorCandidate).toEqual({
      article: "18",
      legacyCode: "ART_18_L84_1994",
    });
  });

  it("produces the same fingerprint for the same semantic input", () => {
    expect(plan().fingerprint).toBe(plan().fingerprint);
  });

  it("ignores generatedAt in the fingerprint", () => {
    expect(plan({ generatedAt: "2026-01-01T00:00:00.000Z" }).fingerprint).toBe(
      plan({ generatedAt: "2027-01-01T00:00:00.000Z" }).fingerprint,
    );
  });

  it("ignores repository commit provenance in the fingerprint", () => {
    expect(plan({ repositoryCommitSha: "commit-a" }).fingerprint).toBe(
      plan({ repositoryCommitSha: "commit-b" }).fingerprint,
    );
  });

  it("normalizes array and object ordering for the fingerprint", () => {
    const secondFonte = fonte({ id: "norma-42", codice: "ART_42_COD_NAV", versioni: [] });
    const first = plan({ normaFonti: [fonte(), secondFonte], families: [family] });
    const second = plan({ normaFonti: [secondFonte, fonte()], families: [family] });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("changes the fingerprint on meaningful input drift", () => {
    expect(plan().fingerprint).not.toBe(plan({ normaFonti: [fonte({ titolo: "Changed" })] }).fingerprint);
  });

  it("uses the frozen fingerprint format", () => {
    expect(FINGERPRINT_FORMAT_VERSION).toBe("B2C9_BLOCK_2A_FINGERPRINT_V1");
  });

  it("uses locale-independent canonical ordering", () => {
    const plannerSource = readFileSync(plannerPath, "utf8");
    expect(plannerSource).not.toContain("localeCompare");
    expect(plan({
      normaFonti: [
        fonte({ id: "upper", codice: "Z" }),
        fonte({ id: "lower", codice: "a" }),
      ],
    }).results.map((result) => result.codice)).toEqual(["Z", "a"]);
  });

  it("reports family, expression and artifact layers separately", () => {
    const result = plan().results[0];
    expect(result.familyResolution).toBeDefined();
    expect(result.versioni[0].expressionResolution).toBeDefined();
    expect(result.versioni[0].artifactResolution).toBeDefined();
  });

  it("contains no database mutation capability or mutation flags", () => {
    const implementation = `${readFileSync(plannerPath, "utf8")}\n${readFileSync(commandPath, "utf8")}`;
    const forbiddenCalls = [
      ".create(", ".update(", ".upsert(", ".delete(", ".createMany(",
      ".updateMany(", ".deleteMany(", "$executeRaw", "$executeRawUnsafe",
      "$queryRaw", "$queryRawUnsafe", "$transaction",
    ];
    const forbiddenFlags = [
      "--" + "apply", "--" + "write", "--" + "fix", "--" + "update", "--" + "force",
    ];
    for (const token of [...forbiddenCalls, ...forbiddenFlags]) {
      expect(implementation).not.toContain(token);
    }
    expect(implementation.match(/prisma\.[A-Za-z]+\.[A-Za-z]+/g)?.sort()).toEqual([
      "prisma.legalSource.findMany",
      "prisma.normaFonte.findMany",
    ]);
    expect(implementation).not.toMatch(/prisma\s*\[/);
  });

  it("does not contain provider identity or LegalRule mutation policy", () => {
    const rawPolicy = readFileSync(policyPath, "utf8");
    expect(rawPolicy).not.toMatch(/Simpliciter|LOCAL_CORPUS|official.?web|provider/i);
    expect(rawPolicy).not.toContain("LegalRule");
  });
});
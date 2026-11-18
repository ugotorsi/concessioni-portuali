import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations/20260911_b2c9_block1_source_core_expansion/migration.sql"),
  "utf8",
);
const c2a1Migration = readFileSync(
  resolve("prisma/migrations/20260907_b2c9c2a1_legal_source_grounding_boundary/migration.sql"),
  "utf8",
);

function schemaBlock(kind: "model" | "enum", name: string): string {
  return schema.match(new RegExp(`${kind} ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

const legalSourceModel = schemaBlock("model", "LegalSource");
const expressionModel = schemaBlock("model", "LegalExpressionVersion");
const representationModel = schemaBlock("model", "LegalSourceVersion");
const acquisitionModel = schemaBlock("model", "LegalSourceAcquisition");
const assertionModel = schemaBlock("model", "LegalSourceIdentityAssertion");

describe("B2C9 Block 1 source core expansion", () => {
  it("preserves LegalSource as the only canonical family model", () => {
    expect(legalSourceModel).not.toBe("");
    expect(schema).not.toMatch(/model CanonicalSourceFamily\s+\{/);
    expect(legalSourceModel).toContain("expressions                  LegalExpressionVersion[]");
  });

  it("adds legal expressions with nullable temporal and status metadata", () => {
    expect(expressionModel).toContain("sourceFamilyId        String");
    expect(expressionModel).toContain("expressionKey         String");
    expect(expressionModel).toContain("publicationDate       DateTime?");
    expect(expressionModel).toContain("effectiveFrom         DateTime?");
    expect(expressionModel).toContain("effectiveTo           DateTime?");
    expect(expressionModel).toContain("expressionStatus      String?");
    expect(expressionModel).toContain("correctionMetadata    Json?");
    expect(expressionModel).toContain("consolidationMetadata Json?");
  });

  it("protects expression identity without freezing descriptive metadata", () => {
    const guard = migration.match(
      /CREATE FUNCTION "protect_legal_expression_version_identity"\(\)[\s\S]*?\$\$;/,
    )?.[0] ?? "";

    for (const field of ["id", "sourceFamilyId", "expressionKey", "createdAt"]) {
      expect(guard).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
    for (const field of ["publicationDate", "effectiveFrom", "effectiveTo", "expressionStatus"]) {
      expect(guard).not.toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
    }
  });

  it("allows multiple expressions per family", () => {
    expect(expressionModel).toContain("@@unique([sourceFamilyId, expressionKey])");
    expect(expressionModel).not.toMatch(/sourceFamilyId\s+String\s+@unique/);
    expect(migration).not.toContain('UNIQUE INDEX "LegalExpressionVersion_sourceFamilyId_key"');
  });

  it("links representations to expressions optionally and within the same family", () => {
    expect(representationModel).toContain("legalExpressionVersionId String?");
    expect(representationModel).toContain(
      "fields: [legalExpressionVersionId, sourceFamilyId], references: [id, sourceFamilyId]",
    );
    expect(migration).toContain(
      'FOREIGN KEY ("legalExpressionVersionId", "sourceFamilyId") REFERENCES "LegalExpressionVersion"("id", "sourceFamilyId")',
    );
  });

  it("allows multiple artifact representations per expression", () => {
    expect(representationModel).not.toMatch(/legalExpressionVersionId\s+String\?\s+@unique/);
    expect(migration).not.toContain(
      'UNIQUE INDEX "LegalSourceVersion_legalExpressionVersionId_key"',
    );
  });

  it("keeps resource type, legal authority, and source character independent", () => {
    expect(legalSourceModel).toContain("resourceSemanticType ResourceSemanticType?");
    expect(legalSourceModel).toContain("legalAuthorityKind   LegalAuthorityKind?");
    expect(legalSourceModel).toContain("sourceCharacter      SourceCharacter?");
    expect(schemaBlock("enum", "ResourceSemanticType")).toContain("TECHNICAL_DOCUMENT");
    const authorityKind = schemaBlock("enum", "LegalAuthorityKind");
    expect(authorityKind).toContain("CASE_LAW");
    expect(authorityKind).not.toContain("EVIDENCE_DOCUMENT");
    expect(authorityKind).not.toContain("LOCAL_DOMAIN_DOCUMENT");
    expect(schemaBlock("enum", "SourceCharacter")).toContain("PUBLIC_NON_OFFICIAL");
  });

  it("stores provider-independent identity assertions without global merge uniqueness", () => {
    expect(assertionModel).toContain("sourceFamilyId       String");
    expect(assertionModel).toContain("identifierScheme     String");
    expect(assertionModel).toContain("normalizedValue      String");
    expect(assertionModel).toContain("provenanceReference  String");
    expect(assertionModel).not.toContain("providerId");
    expect(assertionModel).not.toContain("providerSourceKey");
    expect(assertionModel).not.toContain("@@unique([identifierScheme, normalizedValue])");
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX [^;]+\("identifierScheme", "normalizedValue"\)/,
    );
  });

  it("preserves the legacy GLOBAL and TENANT compatibility fields", () => {
    expect(legalSourceModel).toContain("identityNamespace    String?");
    expect(legalSourceModel).toContain("identityScopeKind    LegalSourceIdentityScopeKind?");
    expect(legalSourceModel).toContain("identityScopeKey     String?");
    expect(legalSourceModel).toContain("canonicalKey         String?");
    expect(schemaBlock("enum", "LegalSourceIdentityScopeKind")).toContain("GLOBAL");
    expect(schemaBlock("enum", "LegalSourceIdentityScopeKind")).toContain("TENANT");
  });

  it("preserves NormaFonte and NormaVersione compatibility models", () => {
    expect(schemaBlock("model", "NormaFonte")).not.toBe("");
    expect(schemaBlock("model", "NormaVersione")).not.toBe("");
  });

  it("preserves C2A1 byte identity and composite acquisition integrity", () => {
    expect(representationModel).toContain("@@unique([id, sourceFamilyId, observedSha256])");
    expect(acquisitionModel).toContain(
      "fields: [sourceVersionId, sourceFamilyId, observedSha256]",
    );
    expect(c2a1Migration).toContain(
      'FOREIGN KEY ("sourceVersionId", "sourceFamilyId", "observedSha256") REFERENCES "LegalSourceVersion"("id", "sourceFamilyId", "observedSha256")',
    );
    expect(c2a1Migration).toContain('BEFORE UPDATE ON "LegalSourceAcquisition"');
    expect(c2a1Migration).toContain('BEFORE DELETE ON "LegalSourceAcquisition"');
    expect(c2a1Migration).toContain('BEFORE DELETE ON "LegalSourceVersion"');
  });

  it("retains MATCH SIMPLE behavior for failed acquisitions", () => {
    expect(acquisitionModel).toContain("sourceVersionId          String?");
    expect(acquisitionModel).toContain("observedSha256           String?");
    expect(c2a1Migration).not.toContain("MATCH FULL");
  });

  it("contains no semantic backfill or application-data DML", () => {
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\s+(?:INTO|["\w]|FROM)\b/im);
    expect(migration).not.toMatch(/SELECT[\s\S]+LegalSourceVersion/i);
  });

  it("contains no destructive SQL", () => {
    expect(migration).not.toMatch(/^\s*(?:DROP|TRUNCATE)\b/im);
    expect(migration).not.toMatch(/^\s*ALTER\s+TABLE[\s\S]*?\sDROP\s/im);
  });

  it("introduces no research or provider models", () => {
    for (const model of [
      "LegalResearchRun",
      "ProviderCall",
      "SourceCandidate",
      "LegalIssue",
      "FactClaim",
      "EvidenceLink",
      "LegalProposition",
      "AuthorityTreatment",
      "LegalLocator",
      "SourceVerification",
      "AuthorityAssessment",
      "TemporalApplicability",
    ]) {
      expect(schema).not.toMatch(new RegExp(`model ${model} \\{`));
    }
  });
});
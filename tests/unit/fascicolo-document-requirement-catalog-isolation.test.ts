import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const seedSource = readFileSync(path.join(repositoryRoot, "prisma/seed.ts"), "utf8");
const orchestratorSource = readFileSync(
  path.join(repositoryRoot, "src/server/legal-rules/orchestrator.ts"),
  "utf8",
);
const actionSource = readFileSync(
  path.join(repositoryRoot, "src/server/actions/fascicolo-document-requirements.ts"),
  "utf8",
);
const matcherSource = readFileSync(
  path.join(repositoryRoot, "src/server/fascicolo-document-requirements/matcher.ts"),
  "utf8",
);
const querySource = readFileSync(
  path.join(repositoryRoot, "src/server/queries/fascicolo-document-requirements.ts"),
  "utf8",
);

describe("P1-C1 catalog isolation", () => {
  it("seeds the dedicated rule as BOZZA while the generic resolver selects only ATTIVA", () => {
    expect(seedSource).toMatch(/ruleCode:\s*RULE_CODE,[\s\S]*?status:\s*"BOZZA"/);
    expect(orchestratorSource).toContain('Prisma.LegalRuleWhereInput[] = [{ status: "ATTIVA" }]');
  });

  it("prevents the generic resolver from surfacing the linked gap", () => {
    expect(orchestratorSource).toContain("const matchedRuleIds = matchedRules.map((rule) => rule.id)");
    expect(orchestratorSource).toContain("ruleId: { in: matchedRuleIds }");
    expect(orchestratorSource).toContain('status: { in: ["APERTA", "IN_GESTIONE"] }');
  });

  it("uses direct catalog lookups and never invokes the generic resolver", () => {
    expect(actionSource).toContain("prisma.legalSource.findUnique");
    expect(actionSource).toContain("prisma.legalRule.findUnique");
    expect(actionSource).toContain("prisma.documentGap.findUnique");
    expect(actionSource).not.toContain("resolveApplicableLegalRules");
  });

  it("keeps LegalFramework and free-text inference outside the dedicated matcher", () => {
    expect(matcherSource).not.toContain("LegalFramework");
    expect(matcherSource).not.toContain("RegExp");
    expect(matcherSource).not.toContain("title");
    expect(matcherSource).not.toContain("description");
  });

  it("keeps the query side-effect free and independent from create and generic resolution", () => {
    expect(querySource).not.toContain("createFascicoloDocumentRequirementProposal");
    expect(querySource).not.toContain("resolveApplicableLegalRules");
    expect(querySource).not.toContain("createAuditLog");
    expect(querySource).not.toContain(".create(");
    expect(querySource).not.toContain(".createMany(");
  });
});
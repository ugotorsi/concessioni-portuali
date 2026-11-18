import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync("prisma/migrations/20260930_fascicolo_operational_proposals/migration.sql", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("Lotto 7 operational proposal migration", () => {
  it("is additive and introduces only the three bounded proposal tables", () => {
    expect(migration).not.toMatch(/\bDROP\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration.match(/CREATE TABLE/g)).toHaveLength(3);
    for (const table of [
      "FascicoloOperationalProposal",
      "FascicoloOperationalProposalReviewEvent",
      "FascicoloOperationalProposalMaterialization",
    ]) expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("enforces structured origin, confidence, scoped identity and one target link at the database boundary", () => {
    for (const constraint of [
      "fascicolo_operational_proposal_origin_ck",
      "fascicolo_operational_proposal_confidence_ck",
      "fascicolo_operational_proposal_identity_uq",
      "fascicolo_operational_proposal_scope_uq",
      "fascicolo_operational_proposal_review_version_uq",
      "fascicolo_operational_materialization_proposal_uq",
      "fascicolo_operational_materialization_entity_uq",
    ]) expect(migration).toContain(constraint);
    expect(migration).toContain('FOREIGN KEY ("knowledgeRevisionId", "tenantId", "procedimentoId")');
  });

  it("keeps proposal, review and materialization as separate Prisma concepts", () => {
    expect(schema).toContain("model FascicoloOperationalProposal {");
    expect(schema).toContain("model FascicoloOperationalProposalReviewEvent {");
    expect(schema).toContain("model FascicoloOperationalProposalMaterialization {");
    expect(schema).toContain("proposedPayload");
    expect(schema).toContain("approvedPayload");
    expect(schema).toMatch(/materialization\s+FascicoloOperationalProposalMaterialization\?/);
  });
});
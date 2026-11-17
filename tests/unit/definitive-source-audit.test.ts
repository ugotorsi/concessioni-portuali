import { describe, expect, it } from "vitest";

import {
  DEFINITIVE_SOURCE_AUDIT_ITEMS,
  toAuditedAuthorityCandidate,
} from "@/server/legal-research/definitive-source-audit";

describe("definitive source audit", () => {
  it("keeps all seven previously overclassified sources fail-closed", () => {
    expect(DEFINITIVE_SOURCE_AUDIT_ITEMS).toHaveLength(7);
    expect(new Set(DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) => item.canonicalIdentifier)).size).toBe(7);
    expect(DEFINITIVE_SOURCE_AUDIT_ITEMS.filter((item) => item.classification === "NON_VERIFICABILE")).toHaveLength(5);
    expect(
      DEFINITIVE_SOURCE_AUDIT_ITEMS.filter(
        (item) => item.classification === "PERTINENTE_IN_ASTRATTO_NON_APPLICABILE_ALLO_STATO",
      ),
    ).toHaveLength(2);
  });

  it("normalizes official identities without claiming full official text", () => {
    const candidates = DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) =>
      toAuditedAuthorityCandidate(item, "research-audit-attempt:test"));

    expect(candidates.every((candidate) => candidate.exactReferenceMatch)).toBe(true);
    expect(candidates.every((candidate) => candidate.verificationState === "OFFICIALLY_VERIFIED")).toBe(true);
    expect(candidates.every((candidate) => candidate.fullTextAvailable === false)).toBe(true);
    expect(candidates.map((candidate) => candidate.officialIdentifier)).toEqual(
      DEFINITIVE_SOURCE_AUDIT_ITEMS.map((item) => item.canonicalIdentifier),
    );
  });
});

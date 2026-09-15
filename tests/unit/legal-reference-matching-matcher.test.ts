import { describe, expect, it } from "vitest";

import {
  LEGAL_REFERENCE_IDENTIFIER_SCHEME,
  LEGAL_REFERENCE_IDENTITY_NAMESPACE,
  matchLegalReferenceMention,
  type MatchableLegalReferenceMention,
  type MatchableLegalSource,
} from "@/server/intake/legal-reference-matching/matcher";

function mention(overrides: Partial<MatchableLegalReferenceMention> = {}): MatchableLegalReferenceMention {
  return {
    id: "mention-1",
    kind: "LEGISLATION",
    normalizedKey: "LEGGE:241:1990:21:nonies",
    authorityHint: null,
    actType: "LEGGE",
    actNumber: "241",
    year: 1990,
    chamberSection: null,
    ...overrides,
  };
}

function source(overrides: Partial<MatchableLegalSource> = {}): MatchableLegalSource {
  return {
    id: "source-1",
    enteId: null,
    sourceType: "LEGGE",
    legalAuthorityKind: "LEGISLATION",
    issuingBody: "PARLAMENTO",
    sourceNumber: "241",
    sourceDate: new Date("1990-08-07T00:00:00.000Z"),
    identityNamespace: null,
    identityScopeKind: null,
    identityScopeKey: null,
    canonicalKey: null,
    identityAssertions: [],
    ...overrides,
  };
}

describe("B2C11 Block 3B.6B deterministic local matcher", () => {
  it("matches one legislation source by exact type, number, and year while ignoring article locator", () => {
    expect(matchLegalReferenceMention(mention(), [source()])).toEqual({
      status: "MATCHED",
      reason: "EXACT_IDENTITY",
      legalSourceId: "source-1",
      candidateCount: 1,
    });
  });

  it("supports a legacy legislation row only when its complete structured identity is exact", () => {
    expect(matchLegalReferenceMention(mention(), [source({ legalAuthorityKind: null })]))
      .toMatchObject({ status: "MATCHED", legalSourceId: "source-1" });
    expect(matchLegalReferenceMention(mention(), [source({
      legalAuthorityKind: null,
      sourceDate: new Date("1991-01-01T00:00:00.000Z"),
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("requires the explicit region for regional legislation", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:16:2014:7",
      actType: "LEGGE_REGIONALE",
      actNumber: "16",
      year: 2014,
    });
    const campania = source({
      id: "campania",
      issuingBody: "Regione Campania",
      sourceNumber: "16",
      sourceDate: new Date("2014-01-01T00:00:00.000Z"),
    });
    const lazio = source({
      id: "lazio",
      issuingBody: "Regione Lazio",
      sourceNumber: "16",
      sourceDate: new Date("2014-01-01T00:00:00.000Z"),
    });

    expect(matchLegalReferenceMention(regional, [lazio, campania])).toMatchObject({
      status: "MATCHED",
      legalSourceId: "campania",
    });
  });

  it("matches one judgment by exact authority, number, and year", () => {
    const judgment = mention({
      kind: "CASE_LAW",
      normalizedKey: "CONSIGLIO DI STATO:9414:2025",
      authorityHint: "CONSIGLIO DI STATO",
      actType: null,
      actNumber: "9414",
      year: 2025,
    });
    const judgmentSource = source({
      legalAuthorityKind: "CASE_LAW",
      sourceType: "ALTRO",
      issuingBody: "CONSIGLIO DI STATO",
      sourceNumber: "9414",
      sourceDate: new Date("2025-05-01T00:00:00.000Z"),
    });

    expect(matchLegalReferenceMention(judgment, [judgmentSource])).toMatchObject({
      status: "MATCHED",
      legalSourceId: "source-1",
    });
  });

  it("returns no match without claiming that the source does not exist", () => {
    expect(matchLegalReferenceMention(mention(), [])).toEqual({
      status: "NO_MATCH",
      reason: "NO_CATALOG_MATCH",
      legalSourceId: null,
      candidateCount: 0,
    });
  });

  it("keeps multiple exact candidates ambiguous and never selects one", () => {
    expect(matchLegalReferenceMention(mention(), [source(), source({ id: "source-2" })])).toEqual({
      status: "AMBIGUOUS",
      reason: "MULTIPLE_EXACT_MATCHES",
      legalSourceId: null,
      candidateCount: 2,
    });
  });

  it("does not guess when required identity fields are missing", () => {
    expect(matchLegalReferenceMention(mention({ actNumber: null }), [source()])).toEqual({
      status: "NO_MATCH",
      reason: "INSUFFICIENT_IDENTITY",
      legalSourceId: null,
      candidateCount: 0,
    });
  });

  it("requires exact canonical identity for decree subtypes and explicit judgment sections", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    const genericDecree = source({
      sourceType: "DECRETO",
      sourceNumber: "36",
      sourceDate: new Date("2023-01-01T00:00:00.000Z"),
    });
    expect(matchLegalReferenceMention(decree, [genericDecree])).toMatchObject({ status: "NO_MATCH" });

    const canonicalDecree = source({
      ...genericDecree,
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
    });
    expect(matchLegalReferenceMention(decree, [canonicalDecree])).toMatchObject({ status: "MATCHED" });
  });

  it("accepts exact verified identity assertions but ignores unverified assertions", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    const assertion = {
      identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      normalizedValue: "DECRETO_LEGISLATIVO:36:2023",
      issuingAuthority: null,
      jurisdiction: null,
      verificationStatus: "VERIFIED",
    };
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityAssertions: [assertion],
    })])).toMatchObject({ status: "MATCHED" });
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityAssertions: [{ ...assertion, verificationStatus: "UNVERIFIED" }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("rejects the same canonical key in an unknown namespace or invalid scope", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    const canonical = {
      sourceType: "DECRETO",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
    };
    expect(matchLegalReferenceMention(decree, [source({
      ...canonical,
      identityNamespace: "UNRELATED_NAMESPACE",
    })])).toMatchObject({ status: "NO_MATCH" });
    expect(matchLegalReferenceMention(decree, [source({
      ...canonical,
      identityScopeKey: "TENANT:ente-1",
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("rejects a verified assertion with an unknown identifier scheme", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityAssertions: [{
        identifierScheme: "UNRELATED_SCHEME",
        normalizedValue: "DECRETO_LEGISLATIVO:36:2023",
        issuingAuthority: null,
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("rejects exact evidence for a contradictory source class or an unmapped mention kind", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "LEGGE",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
    })])).toMatchObject({ status: "NO_MATCH" });

    expect(matchLegalReferenceMention(mention({
      kind: "CODE",
      normalizedKey: "CODICE_CIVILE:2043",
      actType: "CODICE_CIVILE",
      actNumber: null,
      year: null,
    }), [source({
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "CODICE_CIVILE",
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("hard-excludes cross-region canonical and assertion evidence", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
    });
    const identity = "LEGGE_REGIONALE:CAMPANIA:5:2021";
    expect(matchLegalReferenceMention(regional, [source({
      issuingBody: "Regione Lazio",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: identity,
    })])).toMatchObject({ status: "NO_MATCH" });
    expect(matchLegalReferenceMention(regional, [source({
      issuingBody: null,
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: identity,
        issuingAuthority: null,
        jurisdiction: "Lazio",
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("hard-excludes cross-authority case-law canonical and assertion evidence", () => {
    const judgment = mention({
      kind: "CASE_LAW",
      normalizedKey: "CASSAZIONE:123:2025",
      authorityHint: "CASSAZIONE",
      actType: null,
      actNumber: "123",
      year: 2025,
    });
    const identity = "CASSAZIONE:123:2025";
    expect(matchLegalReferenceMention(judgment, [source({
      sourceType: "ALTRO",
      legalAuthorityKind: "CASE_LAW",
      issuingBody: "CONSIGLIO DI STATO",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: identity,
    })])).toMatchObject({ status: "NO_MATCH" });
    expect(matchLegalReferenceMention(judgment, [source({
      sourceType: "ALTRO",
      legalAuthorityKind: "CASE_LAW",
      issuingBody: null,
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: identity,
        issuingAuthority: "CONSIGLIO DI STATO",
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("requires explicit compatible assertion metadata for regional and case-law identities", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
    });
    expect(matchLegalReferenceMention(regional, [source({
      issuingBody: null,
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "LEGGE_REGIONALE:CAMPANIA:5:2021",
        issuingAuthority: null,
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });

    const judgment = mention({
      kind: "CASE_LAW",
      normalizedKey: "CASSAZIONE:123:2025",
      authorityHint: "CASSAZIONE",
      actType: null,
      actNumber: "123",
      year: 2025,
    });
    expect(matchLegalReferenceMention(judgment, [source({
      sourceType: "ALTRO",
      legalAuthorityKind: "CASE_LAW",
      issuingBody: null,
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "CASSAZIONE:123:2025",
        issuingAuthority: null,
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("preserves valid tenant canonical identity and compatible assertion evidence", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    expect(matchLegalReferenceMention(decree, [source({
      enteId: "ente-1",
      sourceType: "DECRETO",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "TENANT",
      identityScopeKey: "TENANT:ente-1",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
    })])).toMatchObject({ status: "MATCHED" });
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "DECRETO_LEGISLATIVO:36:2023",
        issuingAuthority: "Ministero delle infrastrutture",
        jurisdiction: "IT",
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "MATCHED" });
  });

  it("keeps valid legacy fallback and deduplicates multiple evidence paths by source", () => {
    expect(matchLegalReferenceMention(mention(), [source({
      identityNamespace: "UNRELATED_NAMESPACE",
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE:241:1990",
    })])).toMatchObject({ status: "MATCHED", candidateCount: 1 });

    expect(matchLegalReferenceMention(mention(), [source({
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE:241:1990",
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "LEGGE:241:1990",
        issuingAuthority: null,
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "MATCHED", candidateCount: 1 });
  });

  it("lets a trusted regional assertion contradiction override positive canonical evidence", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
    });
    expect(matchLegalReferenceMention(regional, [source({
      issuingBody: null,
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "LEGGE_REGIONALE:LAZIO:5:2021",
        issuingAuthority: null,
        jurisdiction: "Lazio",
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("lets a trusted regional canonical contradiction override positive assertion evidence", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
    });
    expect(matchLegalReferenceMention(regional, [source({
      issuingBody: null,
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE_REGIONALE:LAZIO:5:2021",
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "LEGGE_REGIONALE:CAMPANIA:5:2021",
        issuingAuthority: null,
        jurisdiction: "Campania",
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("reconciles conflicting case-law evidence symmetrically", () => {
    const judgment = mention({
      kind: "CASE_LAW",
      normalizedKey: "CASSAZIONE:123:2025",
      authorityHint: "CASSAZIONE",
      actType: null,
      actNumber: "123",
      year: 2025,
    });
    const positiveAssertion = {
      identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      normalizedValue: "CASSAZIONE:123:2025",
      issuingAuthority: "CASSAZIONE",
      jurisdiction: null,
      verificationStatus: "VERIFIED",
    };
    const contradictoryAssertion = {
      ...positiveAssertion,
      normalizedValue: "CONSIGLIO DI STATO:123:2025",
      issuingAuthority: "CONSIGLIO DI STATO",
    };
    const canonical = {
      sourceType: "ALTRO",
      legalAuthorityKind: "CASE_LAW",
      issuingBody: null,
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
    };

    expect(matchLegalReferenceMention(judgment, [source({
      ...canonical,
      canonicalKey: "CASSAZIONE:123:2025",
      identityAssertions: [contradictoryAssertion],
    })])).toMatchObject({ status: "NO_MATCH" });
    expect(matchLegalReferenceMention(judgment, [source({
      ...canonical,
      canonicalKey: "CONSIGLIO DI STATO:123:2025",
      identityAssertions: [positiveAssertion],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("rejects mixed verified assertions independently of their order", () => {
    const regional = mention({
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
    });
    const positive = {
      identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      normalizedValue: "LEGGE_REGIONALE:CAMPANIA:5:2021",
      issuingAuthority: null,
      jurisdiction: "Campania",
      verificationStatus: "VERIFIED",
    };
    const contradictory = {
      ...positive,
      normalizedValue: "LEGGE_REGIONALE:LAZIO:5:2021",
      jurisdiction: "Lazio",
    };
    for (const identityAssertions of [[positive, contradictory], [contradictory, positive]]) {
      expect(matchLegalReferenceMention(regional, [source({
        issuingBody: null,
        identityAssertions,
      })])).toMatchObject({ status: "NO_MATCH" });
    }
  });

  it("ignores untrusted negative evidence but blocks legacy fallback on a trusted contradiction", () => {
    const invalidEvidence = [{
      identifierScheme: "UNRELATED_SCHEME",
      normalizedValue: "LEGGE:999:2099",
      issuingAuthority: null,
      jurisdiction: null,
      verificationStatus: "VERIFIED",
    }, {
      identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      normalizedValue: "LEGGE:999:2099",
      issuingAuthority: null,
      jurisdiction: null,
      verificationStatus: "UNVERIFIED",
    }];
    expect(matchLegalReferenceMention(mention(), [source({
      identityNamespace: "UNRELATED_NAMESPACE",
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE:999:2099",
      identityAssertions: invalidEvidence,
    })])).toMatchObject({ status: "MATCHED" });

    expect(matchLegalReferenceMention(mention(), [source({
      identityAssertions: [{
        ...invalidEvidence[0],
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      }],
    })])).toMatchObject({ status: "NO_MATCH" });
  });

  it("does not let unknown or unverified negative evidence override positive exact evidence", () => {
    const decree = mention({ actType: "DECRETO_LEGISLATIVO", actNumber: "36", year: 2023 });
    const untrustedContradictions = [{
      identifierScheme: "UNRELATED_SCHEME",
      normalizedValue: "DECRETO_LEGISLATIVO:99:2099",
      issuingAuthority: null,
      jurisdiction: null,
      verificationStatus: "VERIFIED",
    }, {
      identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
      normalizedValue: "DECRETO_LEGISLATIVO:99:2099",
      issuingAuthority: null,
      jurisdiction: null,
      verificationStatus: "UNVERIFIED",
    }];
    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityNamespace: LEGAL_REFERENCE_IDENTITY_NAMESPACE,
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "DECRETO_LEGISLATIVO:36:2023",
      identityAssertions: untrustedContradictions,
    })])).toMatchObject({ status: "MATCHED" });

    expect(matchLegalReferenceMention(decree, [source({
      sourceType: "DECRETO",
      identityNamespace: "UNRELATED_NAMESPACE",
      identityScopeKind: "GLOBAL",
      identityScopeKey: "GLOBAL",
      canonicalKey: "DECRETO_LEGISLATIVO:99:2099",
      identityAssertions: [{
        identifierScheme: LEGAL_REFERENCE_IDENTIFIER_SCHEME,
        normalizedValue: "DECRETO_LEGISLATIVO:36:2023",
        issuingAuthority: null,
        jurisdiction: null,
        verificationStatus: "VERIFIED",
      }],
    })])).toMatchObject({ status: "MATCHED" });
  });
});
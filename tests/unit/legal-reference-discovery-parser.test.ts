import { describe, expect, it } from "vitest";

import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";

describe("B2C10 Block 3B.6A local legal reference parser", () => {
  it.each([
    ["L. n. 241/1990", "LEGGE:241:1990"],
    ["D.Lgs. 50/2016", "DECRETO_LEGISLATIVO:50:2016"],
    ["d.lgs. n. 36/2023", "DECRETO_LEGISLATIVO:36:2023"],
    ["D.L. 76/2020", "DECRETO_LEGGE:76:2020"],
    ["D.P.R. 380/2001", "DECRETO_PRESIDENTE_REPUBBLICA:380:2001"],
    ["legge 7 agosto 1990 n. 241", "LEGGE:241:1990"],
  ])("discovers explicit legislation %s", (text, normalizedKey) => {
    expect(discoverItalianLegalReferences(text)).toEqual([
      expect.objectContaining({ kind: "LEGISLATION", observedText: text, normalizedKey }),
    ]);
  });

  it("discovers an article and statute as one reference without overlap", () => {
    expect(discoverItalianLegalReferences("art. 21-nonies L. 241/1990")).toEqual([
      expect.objectContaining({
        kind: "LEGISLATION",
        actType: "LEGGE",
        actNumber: "241",
        year: 1990,
        article: "21",
        subArticle: "nonies",
        normalizedKey: "LEGGE:241:1990:21:nonies",
      }),
    ]);
  });

  it("discovers a full-word article and statute expression", () => {
    expect(discoverItalianLegalReferences("articolo 21 nonies della legge 241/1990")[0]).toMatchObject({
      normalizedKey: "LEGGE:241:1990:21:nonies",
      observedText: "articolo 21 nonies della legge 241/1990",
    });
  });

  it.each([
    ["art. 2043 c.c.", "CODICE_CIVILE:2043"],
    ["articolo 112 c.p.c.", "CODICE_PROCEDURA_CIVILE:112"],
    ["art. 640 c.p.", "CODICE_PENALE:640"],
    ["art. 606 c.p.p.", "CODICE_PROCEDURA_PENALE:606"],
    ["art. 7 c.p.a.", "CODICE_PROCESSO_AMMINISTRATIVO:7"],
  ])("discovers explicit code article %s", (text, normalizedKey) => {
    expect(discoverItalianLegalReferences(text)[0]).toMatchObject({ kind: "CODE", normalizedKey });
  });

  it("discovers a regional law without inventing a canonical authority", () => {
    expect(discoverItalianLegalReferences("L.R. Campania 5/2021")[0]).toMatchObject({
      kind: "LEGISLATION",
      actType: "LEGGE_REGIONALE",
      actNumber: "5",
      year: 2021,
      authorityHint: null,
      normalizedKey: "LEGGE_REGIONALE:CAMPANIA:5:2021",
    });
  });

  it("keeps explicit regional jurisdictions distinct without inferring a missing region", () => {
    const campania = discoverItalianLegalReferences("L.R. Campania 5/2021")[0]!.normalizedKey;
    const lazio = discoverItalianLegalReferences("L.R. Lazio 5/2021")[0]!.normalizedKey;
    const unknown = discoverItalianLegalReferences("L.R. 5/2021")[0]!.normalizedKey;

    expect(new Set([campania, lazio, unknown]).size).toBe(3);
    expect(campania).toBe("LEGGE_REGIONALE:CAMPANIA:5:2021");
    expect(lazio).toBe("LEGGE_REGIONALE:LAZIO:5:2021");
    expect(unknown).toBe("LEGGE_REGIONALE:5:2021");
  });

  it("normalizes equivalent formatting for the same explicit regional jurisdiction", () => {
    expect(discoverItalianLegalReferences("l.r. campania n. 5/2021")[0]!.normalizedKey)
      .toBe(discoverItalianLegalReferences("L.R. Campania 5-2021")[0]!.normalizedKey);
  });

  it.each([
    ["L. 241/1990", 1990],
    ["L. 12/2026", 2026],
  ])("accepts a database-valid year in %s", (text, year) => {
    expect(discoverItalianLegalReferences(text)[0]).toMatchObject({ year });
  });

  it.each(["L. 1/0000", "L. 1/0999", "Cass. n. 1/0000", "Cass. n. 1/0999"])(
    "does not emit a persistable mention for invalid year in %s",
    (text) => expect(discoverItalianLegalReferences(text)).toEqual([]),
  );

  it.each([
    ["Cass. n. 9414/2025", "CASSAZIONE"],
    ["Cassazione civile n. 9414/2025", "CASSAZIONE CIVILE"],
    ["Cons. Stato n. 123/2024", "CONSIGLIO DI STATO"],
    ["TAR Salerno n. 876/2025", "TAR SALERNO"],
    ["TAR Campania, Salerno, n. 44/2023", "TAR CAMPANIA, SALERNO"],
    ["Corte cost. n. 10/2020", "CORTE COSTITUZIONALE"],
  ])("discovers explicit case law %s", (text, authorityHint) => {
    expect(discoverItalianLegalReferences(text)[0]).toMatchObject({
      kind: "CASE_LAW",
      authorityHint,
    });
  });

  it("returns success-compatible empty output for text without explicit references", () => {
    expect(discoverItalianLegalReferences("Istanza relativa alla concessione portuale.")).toEqual([]);
  });

  it("preserves distinct references and repeated occurrences with exact local spans", () => {
    const text = "art. 21-nonies L. 241/1990; art. 21-octies L. 241/1990; art. 21-nonies L. 241/1990";
    const references = discoverItalianLegalReferences(text);

    expect(references.map((reference) => reference.normalizedKey)).toEqual([
      "LEGGE:241:1990:21:nonies",
      "LEGGE:241:1990:21:octies",
      "LEGGE:241:1990:21:nonies",
    ]);
    expect(references.map((reference) => text.slice(reference.characterStart, reference.characterEnd)))
      .toEqual(references.map((reference) => reference.observedText));
  });

  it("keeps normalized identities distinct across articles, statutes, authorities, and years", () => {
    const references = discoverItalianLegalReferences([
      "art. 21-nonies L. 241/1990",
      "art. 21-octies L. 241/1990",
      "art. 21-nonies L. 15/2005",
      "Cass. n. 44/2023",
      "TAR Campania n. 44/2023",
      "Cass. n. 44/2024",
    ].join("; "));

    expect(new Set(references.map((reference) => reference.normalizedKey)).size).toBe(6);
  });

  it("rejects an occurrence whose observed or normalized representation exceeds storage bounds", () => {
    expect(discoverItalianLegalReferences(`L.R. ${"A".repeat(501)} 5/2021`)).toEqual([]);
  });

  it("does not infer legal references from broad subject language", () => {
    expect(discoverItalianLegalReferences("Si discute di autotutela e affidamento del privato.")).toEqual([]);
  });
});
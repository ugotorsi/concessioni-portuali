import { describe, expect, it } from "vitest";

import {
  officialNormattivaUrl,
  officialSourceRelevance,
  parseProviderLegislationReference,
  readOfficialSourceRelevance,
  selectRelevantArticle,
} from "@/server/legal-research/official-source-relevance";
import { providerKeywordQuery, providerResearchQuery } from "@/server/legal-research/provider-research-adapters";

const QUESTION = "Quale disciplina regola i requisiti di garanzia assicurativa e il rinnovo della concessione indicata, e quali effetti sono previsti in caso di mancata o tardiva produzione della polizza?";

describe("parseProviderLegislationReference", () => {
  it("recognizes national acts in real Moonlit titles", () => {
    expect(parseProviderLegislationReference({ title: "Repubblica Italiana 21 December 2001, LEGGE n. 443 (Delega al Governo in materia di infrastrutture)" }))
      .toMatchObject({ kind: "LEGISLATION", actType: "LEGGE", actNumber: "443", year: 2001 });
    expect(parseProviderLegislationReference({ title: "Court of Italy, DECRETO LEGISLATIVO 15 luglio 2015, n. 112 (Attuazione della direttiva 2012/34/UE)" }))
      .toMatchObject({ actType: "DECRETO_LEGISLATIVO", actNumber: "112", year: 2015 });
  });

  it("excludes regional acts and acts cited only in the subject", () => {
    expect(parseProviderLegislationReference({ title: "LEGGE REGIONALE 10 marzo 2020, n. 5 (Norme sul demanio)" })).toBeNull();
    expect(parseProviderLegislationReference({ title: "Delibera n. 4 (in attuazione della LEGGE 28 gennaio 1994, n. 84)" })).toBeNull();
  });
});

describe("officialNormattivaUrl", () => {
  it("maps Gazzetta Ufficiale Serie Generale ELI URLs to Normattiva", () => {
    const result = officialNormattivaUrl({ sourceUrl: "https://www.gazzettaufficiale.it/eli/id/1994/02/04/094G0105/sg", officialIdentifier: "094G0105" });
    expect(result).toEqual({ url: expect.stringContaining("atto.codiceRedazionale=094G0105") });
    expect((result as { url: string }).url).toContain("atto.dataPubblicazioneGazzetta=1994-02-04");
  });

  it("does not verify special series, foreign hosts or mismatching identities", () => {
    expect(officialNormattivaUrl({ sourceUrl: "https://www.gazzettaufficiale.it/eli/id/2020/03/14/20R00123/s3", officialIdentifier: "20R00123" }))
      .toEqual({ reason: "REGIONAL_OR_SPECIAL_SERIES_ACT_NOT_COVERED" });
    expect(officialNormattivaUrl({ sourceUrl: "https://example.com/act", officialIdentifier: "X" }))
      .toEqual({ reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" });
    expect(officialNormattivaUrl({ sourceUrl: "https://www.normattiva.it/atto/caricaDettaglioAtto?atto.codiceRedazionale=OTHER", officialIdentifier: "094G0105" }))
      .toEqual({ reason: "OFFICIAL_IDENTITY_MISMATCH" });
    expect(officialNormattivaUrl({ sourceUrl: "http://www.normattiva.it/x", officialIdentifier: "X" }))
      .toEqual({ reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" });
  });
});

describe("selectRelevantArticle", () => {
  it("rejects an article outside the port domain even when it mentions concessions", () => {
    expect(selectRelevantArticle({
      researchQuestion: QUESTION,
      actTitle: "Attuazione della direttiva 2012/34/UE che istituisce uno spazio ferroviario europeo unico",
      articles: [{ anchor: "art_3", text: "La concessione dell'infrastruttura ferroviaria è subordinata a garanzia assicurativa e rinnovo periodico." }],
    })).toBeNull();
  });

  it("accepts a port-domain concession article matching at least two discriminating terms", () => {
    const selected = selectRelevantArticle({
      researchQuestion: QUESTION,
      actTitle: "Riordino della legislazione in materia portuale",
      articles: [
        { anchor: "art_1", text: "Finalità della legge." },
        { anchor: "art_18", text: "Le concessioni di aree demaniali sono subordinate alla prestazione di garanzia, anche assicurativa; il rinnovo è disposto previa verifica." },
      ],
    });
    expect(selected).toMatchObject({ section: "Art. 18", anchor: "art_18" });
    expect(selected!.matchedTerms.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects an in-domain article matching fewer than two discriminating terms", () => {
    expect(selectRelevantArticle({
      researchQuestion: QUESTION,
      actTitle: "Codice della navigazione",
      articles: [{ anchor: "art_36", text: "L'amministrazione può concedere l'occupazione di beni demaniali marittimi; la concessione è soggetta a canone e garanzia." }],
    })).toBeNull();
  });
});

describe("officialSourceRelevance round trip", () => {
  it("reads only well-formed classifications", () => {
    const relevance = officialSourceRelevance({ status: "NON_PERTINENTE", reason: "OFFICIAL_TEXT_ACQUIRED_NO_RELEVANT_ARTICLE", checkedAt: new Date("2026-10-15T00:00:00Z") });
    expect(readOfficialSourceRelevance({ officialRelevance: relevance })).toEqual(relevance);
    expect(readOfficialSourceRelevance({ officialRelevance: { ...relevance, status: "OK" } })).toBeNull();
    expect(readOfficialSourceRelevance({})).toBeNull();
  });
});

describe("provider queries", () => {
  it("adds the port/maritime domain when the question lacks it", () => {
    expect(providerResearchQuery({ researchQuestion: QUESTION })).toMatch(/demanial|marittim|portual/i);
    expect(providerResearchQuery({ researchQuestion: "Concessione demaniale marittima: durata?" })).toBe("Concessione demaniale marittima: durata?");
  });

  it("builds a focused keyword query", () => {
    const query = providerKeywordQuery({ researchQuestion: QUESTION });
    expect(query.startsWith("concessione demaniale marittima")).toBe(true);
    expect(query.split(/\s+/).length).toBeLessThanOrEqual(9);
  });
});

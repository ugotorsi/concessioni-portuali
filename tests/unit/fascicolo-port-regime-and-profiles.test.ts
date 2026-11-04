import { describe, expect, it } from "vitest";

import { assessIssueProfile } from "@/server/fascicolo-report/legal-issue-profiles";
import { extractIsoDates } from "@/server/fascicolo-report/legal-application";
import { buildPortRegimeCoordination } from "@/server/fascicolo-report/port-regime";
import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

function item(id: string, text: string, pages: number[] = [1], status: StructuredKnowledgeReadItem["status"] = "AI_PROPOSED"): StructuredKnowledgeReadItem {
  return {
    id, kind: "FACT", semanticKey: id, contentFingerprint: id, normalizedText: text, payload: {},
    confidence: 0.9, status, reviewVersion: 1,
    evidence: pages.map((pageNumber) => ({
      basisRef: `DOCUMENT_1.PAGE_${pageNumber}`, documentoId: "doc-1", documentFileVersionId: null, pageNumber, textSha256: `${id}-${pageNumber}`,
    })),
  };
}

const regime = (items: StructuredKnowledgeReadItem[], analysisDate = "2026-11-03", registryGrant: { numeroAtto: string; dataRilascio: string } | null = null) =>
  buildPortRegimeCoordination({ knowledgeItems: items, analysisDate, registryGrant, extractIsoDates });
const statusOf = (result: ReturnType<typeof regime>, sourceId: string) => result.sources.find((source) => source.sourceId === sourceId)?.status;

describe("buildPortRegimeCoordination", () => {
  it("coordinates a 2023 title without assuming it was still in force on 1 March 2026", () => {
    const result = regime([
      item("avv", "Avviso pubblico del 01/03/2023 per il rilascio di concessione ex art. 18 L. 84/1994 di area e banchina.", [7]),
      item("tit", "Atto di concessione n. 17/2023 rilasciato il 14/07/2023 per area portuale e banchina.", [9]),
    ]);
    expect(result.procedureStartDate.date).toBe("2023-03-01");
    expect(result.grantDate.date).toBe("2023-07-14");
    expect(result.grantDate.basis).toMatch(/non è collegato nel registro/);
    expect(statusOf(result, "L84_ART18")).toBe("FULLY_APPLICABLE");
    expect(statusOf(result, "DI_202_2022")).toBe("FULLY_APPLICABLE");
    expect(statusOf(result, "ART_242_2025")).toBe("APPLICABILITY_TO_VERIFY");
    expect(result.sources.find((source) => source.sourceId === "ART_242_2025")?.reasoning).toMatch(/3\.18/);
    expect(result.sources.find((source) => source.sourceId === "ART_242_2025")?.reasoning).toContain("non dimostra che fosse in essere");
  });

  it("limits D.I. 202 to arts. 6-9 and keeps the previous art. 18 text for a title issued before 2023", () => {
    const result = regime([item("tit", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale.")], "2025-06-01");
    expect(statusOf(result, "L84_ART18")).toBe("PREVIOUS_TEXT_APPLICABLE");
    expect(statusOf(result, "DI_202_2022")).toBe("PARTIALLY_APPLICABLE");
    expect(result.sources.find((source) => source.sourceId === "DI_202_2022")?.reasoning).toMatch(/artt\. 6 \(modifica del contenuto\).*9 \(verifiche annuali\)/);
    expect(statusOf(result, "ART_242_2025")).toBe("NOT_APPLICABLE_RATIONE_TEMPORIS");
  });

  it("applies ART 242/2025 in full to a title issued after 1 March 2026", () => {
    const result = regime([item("tit", "Atto di concessione n. 3/2026 rilasciato il 20/06/2026 per banchina portuale.")]);
    expect(statusOf(result, "ART_242_2025")).toBe("FULLY_APPLICABLE");
  });

  it("does not mistake an application for an accomplished subjective change", () => {
    const result = regime([
      item("tit", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale."),
      item("ev", "Istanza di autorizzazione al trasferimento del controllo della società concessionaria presentata il 15/04/2026.", [12]),
    ]);
    expect(result.postReformEvents.map((event) => event.date)).toEqual(["2026-04-15"]);
    const source = result.sources.find((entry) => entry.sourceId === "ART_242_2025");
    expect(source?.status).toBe("APPLICABILITY_TO_VERIFY");
    expect(source?.reasoning).toContain("una domanda non prova da sola una modifica o un trasferimento perfezionati");
    expect(source?.operativeConsequences.join(" ")).not.toContain("applicare l'intero atto");
  });

  it("prefers the registry date and declares missing dates instead of guessing", () => {
    expect(regime([], "2026-11-03", { numeroAtto: "17/2023", dataRilascio: "2023-07-14T00:00:00.000Z" }).grantDate.basis).toMatch(/Registro/);
    const empty = regime([item("x", "Sopralluogo sulla banchina portuale senza indicazione di date.")]);
    expect(empty.grantDate.date).toBeNull();
    expect(statusOf(empty, "DI_202_2022")).toBe("DATE_TO_VERIFY");
    expect(statusOf(empty, "L84_ART18")).toBe("DATE_TO_VERIFY");
  });

  it("reads the grant date from the structured legal act and flags an undocumented procedure start", () => {
    const act: StructuredKnowledgeReadItem = {
      ...item("act", "Atto di concessione demaniale marittima n. 17/2023 per banchina portuale.", [7, 8]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE", number: "17/2023", date: { precision: "EXACT", from: "2023-07-14" } } as never,
    };
    const decadence: StructuredKnowledgeReadItem = {
      ...item("dec", "Determinazione di decadenza n. 149/2026.", [30]),
      kind: "LEGAL_ACT",
      payload: { actType: "DECADENZA", number: "149/2026", date: { precision: "EXACT", from: "2026-09-30" } } as never,
    };
    const result = regime([decadence, act]);
    expect(result.grantDate.date).toBe("2023-07-14");
    expect(result.grantDate.pages).toEqual([7, 8]);
    expect(result.procedureStartDate.date).toBeNull();
    expect(statusOf(result, "L84_ART18")).toBe("APPLICABILITY_TO_VERIFY");
    expect(result.sources.find((source) => source.sourceId === "L84_ART18")?.reasoning).toContain("l'avvio della procedura non è documentato");
    expect(statusOf(result, "ART_57_2018")).toBe("DATE_TO_VERIFY");
  });

  it("does not infer an old title's historical validity from the release date or current state", () => {
    const result = regime([
      item("tit", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale."),
      item("rev", "La concessione è stata revocata con provvedimento del 15/01/2025."),
    ]);
    const source = result.sources.find((entry) => entry.sourceId === "ART_242_2025");
    expect(source?.status).toBe("APPLICABILITY_TO_VERIFY");
    expect(source?.reasoning).toContain("non dimostra che fosse in essere il 01/03/2026");
    expect(source?.operativeConsequences.join(" ")).toContain("eventuali cessazioni");
  });

  it("distinguishes publication of the ministerial decree from the later Gazette notice", () => {
    const title = item("tit", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale.");
    const before = regime([title], "2023-04-20");
    const after = regime([title], "2023-04-25");
    expect(statusOf(before, "DM_110_2023")).toBe("NOT_APPLICABLE_RATIONE_TEMPORIS");
    expect(statusOf(after, "DM_110_2023")).toBe("APPLICABILITY_TO_VERIFY");
    expect(after.sources.find((source) => source.sourceId === "DM_110_2023")?.reasoning)
      .toContain("21/04/2023");
    expect(after.sources.find((source) => source.sourceId === "DM_110_2023")?.reasoning)
      .toContain("Un titolo anteriore non esclude");
  });

  it("does not substitute an unrelated date for the grant or choose among conflicting titles", () => {
    const unrelated = regime([item("x", "Atto di concessione per terminal portuale, programma di investimenti entro il 31/12/2027.")]);
    expect(unrelated.grantDate.date).toBeNull();
    const ambiguous = regime([
      item("one", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale."),
      item("two", "Concessione n. 8/2023 rilasciata il 14/07/2023 per terminal portuale."),
    ]);
    expect(ambiguous.grantDate.date).toBeNull();
    expect(ambiguous.grantDate.basis).toContain("discordanti");
    expect(statusOf(ambiguous, "ART_242_2025")).toBe("DATE_TO_VERIFY");
  });

  it("does not choose among different possible procedure starts or use a start after the title", () => {
    const ambiguous = regime([
      item("one", "Avviso pubblico del 01/03/2023 per concessione portuale."),
      item("two", "Avviso pubblico del 01/04/2023 per concessione portuale."),
      item("tit", "Concessione n. 8/2023 rilasciata il 14/07/2023 per terminal portuale."),
    ]);
    expect(ambiguous.procedureStartDate.date).toBeNull();
    expect(statusOf(ambiguous, "L84_ART18")).toBe("APPLICABILITY_TO_VERIFY");
    const inconsistent = regime([
      item("one", "Avviso pubblico del 01/08/2023 per concessione portuale."),
      item("tit", "Concessione n. 8/2023 rilasciata il 14/07/2023 per terminal portuale."),
    ]);
    expect(inconsistent.limits.join(" ")).toContain("successiva al rilascio");
    expect(statusOf(inconsistent, "L84_ART18")).toBe("APPLICABILITY_TO_VERIFY");
  });

  it("does not apply regulations or future titles to an earlier analysis date", () => {
    const result = regime([], "2022-10-01", { numeroAtto: "8/2024", dataRilascio: "2024-04-04T00:00:00.000Z" });
    expect(statusOf(result, "DI_202_2022")).toBe("NOT_APPLICABLE_RATIONE_TEMPORIS");
    expect(statusOf(result, "ART_242_2025")).toBe("NOT_APPLICABLE_RATIONE_TEMPORIS");
    expect(result.limits.join(" ")).toContain("successiva alla data dell'analisi");
  });
});

describe("assessIssueProfile", () => {
  const procedural = { contestazioneFormaleInviata: false, memorieRicevute: false, controdeduzioniValutate: false };

  it("qualifies third-party use only when use and lack of authorization are both documented", () => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [
        item("u", "La società Beta utilizza il magazzino nord con proprio personale in forza di contratto di locazione.", [14]),
        item("n", "La gestione è stata affidata senza autorizzazione dell'AdSP.", [15]),
      ],
      procedural,
    });
    expect(result?.profileId).toBe("THIRD_PARTY_USE");
    expect(result?.elements.find((element) => element.elementId === "third-party-use")?.status).toBe("INDICATED");
    expect(result?.elements.find((element) => element.elementId === "no-authorization")?.status).toBe("INDICATED");
    expect(result?.qualification).toMatch(/art\. 47, lett\. e/);
    expect(result?.qualification).toMatch(/non è automatica/);
    expect(result?.elements.find((element) => element.elementId === "contraddittorio")?.status).toBe("NOT_PROVEN");
  });

  it("can recognize use and missing authorization expressed in the same documented statement", () => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [item("u", "La società Beta utilizza il magazzino nord con proprio personale senza autorizzazione dell'AdSP.", [14])],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "third-party-use")?.status).toBe("INDICATED");
    expect(result?.elements.find((element) => element.elementId === "no-authorization")?.status).toBe("INDICATED");
  });

  it.each([
    "Non risulta rilasciata alcuna autorizzazione dell'AdSP all'affidamento.",
    "Non è allegata l'autorizzazione all'affidamento.",
    "L'autorizzazione non è presente agli atti.",
    "Il fascicolo è senza documentazione relativa all'autorizzazione.",
  ])("does not equate missing authorization documentation with proof of absence: %s", (text) => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [
        item("u", "La società Beta utilizza il magazzino nord con proprio personale.", [14]),
        item("n", text, [15]),
      ],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "no-authorization")?.status).toBe("NOT_PROVEN");
    expect(result?.qualification).toContain("il solo mancato reperimento del documento");
  });

  it("does not turn a denial that an authorization was absent into proof of its absence", () => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [
        item("u", "La società Beta utilizza il magazzino nord con proprio personale.", [14]),
        item("n", "Non è vero che la gestione sia stata affidata senza autorizzazione.", [15]),
      ],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "no-authorization")?.status).toBe("NOT_PROVEN");
  });

  it("treats a granted authorization as contrary evidence and does not qualify a breach", () => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [
        item("u", "La società Beta utilizza il magazzino nord con proprio personale.", [14]),
        item("a", "Autorizzazione ex art. 45-bis rilasciata con prot. n. 455 del 02/02/2024.", [16]),
      ],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "no-authorization")?.status).toBe("CONTRARY_EVIDENCE");
    expect(result?.qualification).toMatch(/l'addebito non sussiste/);
  });

  it("does not treat the investment default as proven when only the obligation is documented", () => {
    const result = assessIssueProfile({
      issueText: "Mancata esecuzione degli investimenti del programma di attività",
      relatedItems: [item("o", "Il programma di attività prevede investimenti per 2 milioni da completare entro il 2025.", [20])],
      procedural,
    });
    expect(result?.profileId).toBe("INVESTMENT_DEFAULT");
    expect(result?.elements.find((element) => element.elementId === "non-performance")?.status).toBe("NOT_PROVEN");
  });

  it("returns no profile for unrelated issues", () => {
    expect(assessIssueProfile({ issueText: "Rettifica di un errore materiale nella planimetria", relatedItems: [], procedural })).toBeNull();
  });

  it("recognizes a partial fee payment but withholds decadence until the title's rate threshold is verified", () => {
    const result = assessIssueProfile({
      issueText: "Canoni, pagamenti parziali e imputazione",
      relatedItems: [item("f", "Il 27 giugno 2025 è eseguito un bonifico di euro 20.000 qualificato come acconto della II rata 2025, a fronte di rata contrattuale di euro 48.000 con scadenza 1 aprile 2025.", [17])],
      procedural,
    });
    expect(result?.profileId).toBe("FEE_PAYMENT");
    expect(result?.elements.find((element) => element.elementId === "fee-due")?.status).toBe("INDICATED");
    expect(result?.elements.find((element) => element.elementId === "non-payment")?.status).toBe("INDICATED");
    expect(result?.elements.find((element) => element.elementId === "rate-threshold")?.status).toBe("NOT_PROVEN");
    expect(result?.qualification).toMatch(/non consente di ritenere integrata la decadenza/);
  });

  it("does not mistake the title's threshold for proof that enough instalments were omitted", () => {
    const title: StructuredKnowledgeReadItem = {
      ...item("title", "La concessione prevede la decadenza per mancato pagamento di 3 rate di canone.", [2]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE" },
    };
    const result = assessIssueProfile({
      issueText: "Canoni e pagamenti parziali",
      relatedItems: [
        title,
        item("fee", "Il canone annuale è fissato in euro 5.000 con scadenza annuale.", [3]),
        item("ledger", "Alla data del 01/11/2026 risultano 2 rate di canone non pagate.", [8]),
      ],
      analysisDate: "2026-11-03",
      procedural,
    });
    const threshold = result?.elements.find((element) => element.elementId === "rate-threshold");
    expect(threshold?.status).toBe("CONTRARY_EVIDENCE");
    expect(threshold?.reasoning).toContain("2 rate");
    expect(threshold?.reasoning).toContain("3 rate");
    expect(result?.qualification).not.toContain("appare raggiunta");
    expect(result?.qualification).toContain("verificare eventuali omissioni successive");
  });

  it("compares distinct, dated evidence and keeps a reached threshold provisional", () => {
    const title: StructuredKnowledgeReadItem = {
      ...item("title", "La concessione prevede la decadenza per mancato pagamento di tre rate di canone.", [2]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE" },
    };
    const result = assessIssueProfile({
      issueText: "Canoni e pagamenti",
      relatedItems: [
        title,
        item("fee", "Il canone annuale è fissato in euro 5.000 con scadenza annuale.", [3]),
        item("ledger", "Alla data del 01/11/2026 risultano 4 rate di canone non pagate.", [8]),
      ],
      analysisDate: "2026-11-03",
      procedural,
    });
    const threshold = result?.elements.find((element) => element.elementId === "rate-threshold");
    expect(threshold?.status).toBe("INDICATED");
    expect(threshold?.evidence.flatMap((evidence) => evidence.pages)).toEqual([2, 8]);
    expect(threshold?.reasoning).toContain("4 rate");
    expect(threshold?.reasoning).toContain("3 rate");
    expect(threshold?.reasoning).toContain("01/11/2026");
    expect(result?.qualification).toContain("confronto preliminare");
    expect(result?.qualification).toContain("verificare");
  });

  it.each([
    ["no separate count", "Alla data del 01/11/2026 il numero di rate insolute è da verificare."],
    ["future count", "Alla data del 01/11/2027 risultano 4 rate di canone non pagate."],
    ["invalid date", "Alla data del 31/02/2026 risultano 4 rate di canone non pagate."],
    ["undated count", "Risultano 4 rate di canone non pagate."],
    ["negated count", "Alla data del 01/11/2026 non risultano 4 rate di canone non pagate."],
  ])("does not infer a rate threshold from %s", (_description, ledgerText) => {
    const title: StructuredKnowledgeReadItem = {
      ...item("title", "La concessione prevede la decadenza per mancato pagamento di 3 rate di canone.", [2]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE" },
    };
    const result = assessIssueProfile({
      issueText: "Canoni e pagamenti",
      relatedItems: [title, item("ledger", ledgerText, [8])],
      analysisDate: "2026-11-03",
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "rate-threshold")?.status).toBe("NOT_PROVEN");
  });

  it("requires the title's consecutive-instalment condition to be supported by the accounting evidence", () => {
    const title: StructuredKnowledgeReadItem = {
      ...item("title", "La concessione prevede la decadenza per mancato pagamento di 3 rate consecutive di canone.", [2]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE" },
    };
    const evaluate = (ledgerText: string) => assessIssueProfile({
      issueText: "Canoni e pagamenti", relatedItems: [title, item("ledger", ledgerText, [8])],
      analysisDate: "2026-11-03", procedural,
    })?.elements.find((element) => element.elementId === "rate-threshold");
    expect(evaluate("Alla data del 01/11/2026 risultano 4 rate di canone non pagate.")?.status).toBe("NOT_PROVEN");
    expect(evaluate("Alla data del 01/11/2026 risultano 4 rate consecutive di canone non pagate.")?.status).toBe("INDICATED");
  });

  it("withholds the comparison when titles or dated counts conflict", () => {
    const title: StructuredKnowledgeReadItem = {
      ...item("title", "La concessione prevede la decadenza per mancato pagamento di 3 rate di canone.", [2]),
      kind: "LEGAL_ACT",
      payload: { actType: "CONCESSIONE_DEMANIALE" },
    };
    const count = item("ledger", "Alla data del 01/11/2026 risultano 4 rate di canone non pagate.", [8]);
    const evaluate = (relatedItems: StructuredKnowledgeReadItem[]) => assessIssueProfile({
      issueText: "Canoni e pagamenti", relatedItems, analysisDate: "2026-11-03", procedural,
    })?.elements.find((element) => element.elementId === "rate-threshold");
    expect(evaluate([title, { ...title, id: "another-title" }, count])?.status).toBe("NOT_PROVEN");
    expect(evaluate([title, count, item("conflicting", "Alla data del 01/10/2026 risultano 2 rate di canone non pagate.", [9])])?.status).toBe("NOT_PROVEN");
    expect(evaluate([{ ...title, normalizedText: "La concessione non prevede la decadenza per mancato pagamento di 3 rate di canone." }, count])?.status).toBe("NOT_PROVEN");
    expect(evaluate([title, count, { ...item("contradiction", "Dati contabili contrastanti."), kind: "CONTRADICTION" }])?.status).toBe("NOT_PROVEN");
  });

  it("does not turn a denied unpaid count into an affirmative finding of non-payment", () => {
    const result = assessIssueProfile({
      issueText: "Canoni e pagamenti",
      relatedItems: [
        item("fee", "Il canone annuale è fissato in euro 5.000 con scadenza annuale.", [3]),
        item("ledger", "Alla data del 01/11/2026 non risultano 4 rate di canone non pagate.", [8]),
      ],
      analysisDate: "2026-11-03",
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "non-payment")?.status).toBe("NOT_PROVEN");
    expect(result?.qualification).toContain("l'inadempimento non è accertato");
  });

  it("does not treat a negated finding or generic mention of safety as evidence of an urgent risk", () => {
    const result = assessIssueProfile({
      issueText: "Occupazione e sicurezza dell'area portuale",
      relatedItems: [item("survey", "Il verbale non ha rilevato occupazioni; nessun rischio per la sicurezza è stato accertato.", [10])],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "material-finding")?.status).toBe("NOT_PROVEN");
    expect(result?.elements.find((element) => element.elementId === "safety")?.status).toBe("NOT_PROVEN");
    expect(result?.qualification).not.toContain("misure urgenti di sgombero");
  });

  it("preserves a documented finding when the same sentence also notes the absence of authorization", () => {
    const result = assessIssueProfile({
      issueText: "Occupazione dell'area portuale",
      relatedItems: [item("survey", "Il verbale di sopralluogo ha rilevato un container nell'area portuale, senza autorizzazione.", [10])],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "material-finding")?.status).toBe("INDICATED");
  });

  it("does not place an installation outside the title when that location is expressly denied", () => {
    const result = assessIssueProfile({
      issueText: "Occupazione dell'area portuale",
      relatedItems: [item("location", "Il manufatto non è fuori dal perimetro dell'area in concessione.", [10])],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "outside-title")?.status).toBe("NOT_PROVEN");
  });

  it("does not infer an unauthorized location from a bare reference to a safety area", () => {
    const result = assessIssueProfile({
      issueText: "Occupazione dell'area portuale",
      relatedItems: [item("location", "La planimetria comprende un'area di sicurezza.", [10])],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "outside-title")?.status).toBe("NOT_PROVEN");
  });

  it("does not prescribe urgent clearance from a documented risk without assessing urgency and competence", () => {
    const result = assessIssueProfile({
      issueText: "Occupazione e sicurezza dell'area portuale",
      relatedItems: [
        item("survey", "Il verbale di sopralluogo ha rilevato un container nell'area portuale.", [10]),
        item("risk", "Il deposito ostacola le vie di fuga e compromette la sicurezza.", [11]),
      ],
      procedural,
    });
    expect(result?.elements.find((element) => element.elementId === "safety")?.status).toBe("INDICATED");
    expect(result?.qualification).toContain("urgenza");
    expect(result?.qualification).not.toContain("giustifica misure urgenti di sgombero");
  });
});

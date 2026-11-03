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
  it("coordinates a 2023 title (Selvara-like): post-2022 art. 18, full D.I. 202, ART 57 for the procedure, ART 242 only for existing-concession measures", () => {
    const result = regime([
      item("avv", "Avviso pubblico del 01/03/2023 per il rilascio di concessione ex art. 18 L. 84/1994 di area e banchina.", [7]),
      item("tit", "Atto di concessione n. 17/2023 rilasciato il 14/07/2023 per area portuale e banchina.", [9]),
    ]);
    expect(result.procedureStartDate.date).toBe("2023-03-01");
    expect(result.grantDate.date).toBe("2023-07-14");
    expect(result.grantDate.basis).toMatch(/non è collegato nel registro/);
    expect(statusOf(result, "L84_ART18")).toBe("FULLY_APPLICABLE");
    expect(statusOf(result, "DI_202_2022")).toBe("FULLY_APPLICABLE");
    expect(statusOf(result, "ART_242_2025")).toBe("PARTIALLY_APPLICABLE");
    expect(result.sources.find((source) => source.sourceId === "ART_242_2025")?.reasoning).toMatch(/3\.18/);
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

  it("extends ART 242/2025 to a pre-existing title after a subjective change following 1 March 2026", () => {
    const result = regime([
      item("tit", "Concessione n. 4/2019 rilasciata il 10/05/2019 per terminal portuale."),
      item("ev", "Istanza di autorizzazione al trasferimento del controllo della società concessionaria presentata il 15/04/2026.", [12]),
    ]);
    expect(result.postReformEvents.map((event) => event.date)).toEqual(["2026-04-15"]);
    expect(result.sources.find((source) => source.sourceId === "ART_242_2025")?.reasoning).toMatch(/1\.2|vicend|modific/i);
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
    expect(result.sources.find((source) => source.sourceId === "L84_ART18")?.reasoning).toMatch(/avvio della procedura non documentato.*va confermata/);
  });
});

describe("assessIssueProfile", () => {
  const procedural = { contestazioneFormaleInviata: false, memorieRicevute: false, controdeduzioniValutate: false };

  it("qualifies third-party use only when use and lack of authorization are both documented", () => {
    const result = assessIssueProfile({
      issueText: "Uso da parte di terzi di parte dell'area in concessione",
      relatedItems: [
        item("u", "La società Beta utilizza il magazzino nord con proprio personale in forza di contratto di locazione.", [14]),
        item("n", "Non risulta rilasciata alcuna autorizzazione dell'AdSP all'affidamento.", [15]),
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
    expect(result?.qualification).toMatch(/recupero del credito con interessi, non la decadenza/);
  });
});

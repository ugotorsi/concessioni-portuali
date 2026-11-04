import { describe, expect, it } from "vitest";

import { buildLegalApplication, extractIsoDates } from "@/server/fascicolo-report/legal-application";
import type { StructuredKnowledgeReadItem } from "@/server/queries/fascicolo-knowledge";

function item(id: string, kind: StructuredKnowledgeReadItem["kind"], text: string, pages: number[] = [1]): StructuredKnowledgeReadItem {
  return {
    id, kind, semanticKey: id, contentFingerprint: id, normalizedText: text, payload: {},
    confidence: 0.9, status: "AI_PROPOSED", reviewVersion: 1,
    evidence: pages.map((pageNumber) => ({
      basisRef: `DOCUMENT_1.PAGE_${pageNumber}`, documentoId: "doc-1", documentFileVersionId: null, pageNumber, textSha256: `${id}-${pageNumber}`,
    })),
  };
}

const ruleStatus = (result: ReturnType<typeof buildLegalApplication>[number], ruleId: string) =>
  result.rules.find((rule) => rule.ruleId === ruleId)?.temporalStatus;

describe("extractIsoDates", () => {
  it("parses numeric, ISO and Italian textual dates and rejects impossible ones", () => {
    expect(extractIsoDates("atto del 12/03/2024, poi 2025-01-05 e 1° marzo 2026; non 31/02/2024"))
      .toEqual(["2024-03-12", "2025-01-05", "2026-03-01"]);
  });
});

describe("buildLegalApplication", () => {
  it("applies rules by temporal anchor for a concluded concession case with a pending review", () => {
    const knowledge = [
      item("f1", "FACT", "Il concessionario ha installato un container non autorizzato sull'area in concessione dal 10/09/2024.", [3, 4]),
      item("a1", "LEGAL_ACT", "Concessione n. 17/2023 rilasciata il 15/06/2023 per area portuale e banchina."),
    ];
    const [result] = buildLegalApplication({
      issues: [{
        semanticKey: "issue-1",
        text: "Decadenza per inadempimento degli obblighi della concessione portuale",
        originatingItemIds: ["f1", "a1"],
        favorableAuthorities: [],
        contraryAuthorities: [{ title: "Cons. Stato, sez. VI, sentenza verificata", sourceUrl: "https://example.test/s", rationale: "Proporzionalità" }],
      }],
      knowledgeItems: knowledge,
      analysisDate: "2026-10-29",
      context: {
        stato: "CONCLUSO", dataAvvio: "2024-10-01T00:00:00.000Z", dataProvvedimentoFinale: null,
        finalAct: { numeroAtto: "Decreto 5/2025", dataAtto: "2025-04-02T00:00:00.000Z" },
        concessione: null,
        documentTitles: ["Istanza di riesame del concessionario"],
      },
    });

    expect(result.relevantDates.map((date) => [date.label, date.date])).toEqual([
      ["Fatti contestati", "2024-09-10"],
      ["Titolo concessorio", "2023-06-15"],
      ["Provvedimento finale", "2025-04-02"],
      ["Analisi", "2026-10-29"],
    ]);
    expect(ruleStatus(result, "COD_NAV_47")).toBe("APPLICABLE");
    expect(ruleStatus(result, "COD_NAV_54")).toBe("APPLICABLE");
    const argumentsOnAbuse = result.contraryArguments.join(" ");
    expect(argumentsOnAbuse).toContain("assensi pregressi");
    expect(argumentsOnAbuse).toContain("non prova di per sé un titolo o un assenso valido");
    expect(argumentsOnAbuse).not.toContain("tolleranza documentata dell'amministrazione o la natura amovibile e assentita del manufatto escludono");
    expect(ruleStatus(result, "L84_ART18")).toBe("APPLICABILITY_TO_VERIFY");
    expect(ruleStatus(result, "ART_242_2025")).toBe("APPLICABILITY_TO_VERIFY");
    expect(result.rules.find((rule) => rule.ruleId === "COD_NAV_47")!.officialUrl).toContain("!vig=2024-09-10");
    expect(result.conclusionStatus).toBe("GROUNDED_ON_VERIFIED_AUTHORITIES");
    expect(result.conclusion).toContain("occorre prima verificare i presupposti");
    expect(result.contraryArguments.some((argument) => argument.startsWith("Cons. Stato"))).toBe(true);
    expect(result.consequences.join(" ")).toContain("riesame");
    expect(result.consequences.join(" ")).toContain("art. 29 c.p.a.");
    expect(result.consequences.join(" ")).not.toContain("contestazione specifica");
    expect(result.facts[0].pages).toEqual([3, 4]);
  });

  it("uses previous versions and excludes later regulations for older grants in an initial phase", () => {
    const [result] = buildLegalApplication({
      issues: [{
        semanticKey: "issue-2",
        text: "Rilascio e durata della concessione di area portuale; verificare PEF",
        originatingItemIds: [],
        favorableAuthorities: [],
        contraryAuthorities: [],
      }],
      knowledgeItems: [],
      analysisDate: "2026-11-03",
      context: {
        stato: "DA_AVVIARE", dataAvvio: null, dataProvvedimentoFinale: null, finalAct: null,
        concessione: { numeroAtto: "8/2019", dataRilascio: "2019-05-10T00:00:00.000Z" },
        documentTitles: [],
      },
    });

    expect(ruleStatus(result, "L84_ART18")).toBe("APPLICABLE_PREVIOUS_VERSION");
    expect(ruleStatus(result, "DM_202_2022")).toBe("PROSPECTIVE_ONLY");
    expect(result.rules.find((rule) => rule.ruleId === "DM_202_2022")?.temporalReasoning)
      .toMatch(/artt\. 6 \(modifica del contenuto\).*7 \(vicende soggettive\).*8 \(avvicendamento\).*9 \(verifiche annuali\)/);
    expect(ruleStatus(result, "DM_110_2023")).toBe("APPLICABILITY_TO_VERIFY");
    expect(ruleStatus(result, "ART_242_2025")).toBe("APPLICABILITY_TO_VERIFY");
    expect(result.rules.find((rule) => rule.ruleId === "ART_242_2025")?.temporalReasoning)
      .toContain("non dimostra che fosse in essere");
    expect(result.rules.find((rule) => rule.ruleId === "DM_202_2022")!.officialUrl).not.toContain("!vig=");
    expect(result.conclusionStatus).toBe("NORMATIVE_ONLY_PRELIMINARY");
    expect(result.consequences.join(" ")).toContain("contestazione specifica");
  });

  it("requires the relevant date before applying conduct rules when documents do not state it", () => {
    const [result] = buildLegalApplication({
      issues: [{
        semanticKey: "issue-3", text: "Opere abusive sul demanio marittimo", originatingItemIds: [],
        favorableAuthorities: [], contraryAuthorities: [],
      }],
      knowledgeItems: [],
      analysisDate: "2026-11-03",
    });
    expect(ruleStatus(result, "COD_NAV_54")).toBe("DATE_TO_VERIFY");
    expect(result.conclusion).toContain("occorre prima accertare la data rilevante");
  });

  it.each([
    ["17/04/2001", "APPLICABLE_PREVIOUS_VERSION", "il testo richiedeva casi eccezionali"],
    ["18/04/2001", "APPLICABLE", "non richiede più, di per sé, casi eccezionali"],
    ["15/10/2026", "APPLICABLE", "non richiede più, di per sé, casi eccezionali"],
  ] as const)("applies the correct art. 45-bis version for conduct on %s", (date, status, wording) => {
    const [result] = buildLegalApplication({
      issues: [{
        semanticKey: "third-party", text: "Affidamento a terzi nella concessione portuale",
        originatingItemIds: ["fact"], favorableAuthorities: [], contraryAuthorities: [],
      }],
      knowledgeItems: [item("fact", "FACT", `La gestione è stata affidata a terzi il ${date}.`)],
      analysisDate: "2026-11-03",
    });
    const rule = result.rules.find((entry) => entry.ruleId === "COD_NAV_45BIS");
    expect(rule?.temporalStatus).toBe(status);
    expect(rule?.applicationToFacts).toContain(wording);
    expect(rule?.officialUrl).toContain(";327:1~art45bis!vig=");
  });

  it("does not choose a version of art. 45-bis when dates are absent or ambiguous", () => {
    for (const text of [
      "La gestione è stata affidata a terzi, senza data documentata.",
      "La gestione è stata affidata a terzi fra il 17/04/2001 e il 18/04/2001.",
    ]) {
      const [result] = buildLegalApplication({
        issues: [{
          semanticKey: "third-party", text: "Affidamento a terzi nella concessione portuale",
          originatingItemIds: ["fact"], favorableAuthorities: [], contraryAuthorities: [],
        }],
        knowledgeItems: [item("fact", "FACT", text)],
        analysisDate: "2026-11-03",
      });
      const rule = result.rules.find((entry) => entry.ruleId === "COD_NAV_45BIS");
      expect(rule?.referenceDate).toBeNull();
      expect(rule?.temporalStatus).toBe("DATE_TO_VERIFY");
      expect(rule?.applicationToFacts).toContain("individuare prima la versione applicabile");
    }
  });

  it("does not import maritime law into a non-port administrative issue", () => {
    const [result] = buildLegalApplication({
      issues: [{
        semanticKey: "municipal", text: "Decadenza dell'autorizzazione commerciale per lavori abusivi al terminal ferroviario",
        originatingItemIds: [], favorableAuthorities: [], contraryAuthorities: [],
      }],
      knowledgeItems: [],
      analysisDate: "2026-11-03",
    });
    expect(result.rules.map((rule) => rule.ruleId)).not.toContain("COD_NAV_47");
    expect(result.rules.map((rule) => rule.ruleId)).not.toContain("COD_NAV_54");
    expect(result.elementAnalysis).toBeNull();
    expect(result.consequences.join(" ")).not.toMatch(/cod\. nav\.|art\. 54|concessionario/i);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      issues: [{ semanticKey: "x", text: "Decadenza ex art. 47", originatingItemIds: [], favorableAuthorities: [], contraryAuthorities: [] }],
      knowledgeItems: [],
      analysisDate: "2026-11-03",
    };
    expect(buildLegalApplication(input)).toEqual(buildLegalApplication(input));
  });
});

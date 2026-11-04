import { describe, expect, it } from "vitest";

import { commonLegalContent, legalIssueNarrative, legalRuleKey } from "@/lib/legal-report-presentation";
import type { StructuredReportLegalApplication } from "@/server/fascicolo-report/legal-application";

function rule(ruleId: string, applicationToFacts: string): StructuredReportLegalApplication["rules"][number] {
  return {
    ruleId, citation: `Norma ${ruleId}`, subject: "Oggetto", temporalAnchor: "CONDUCT" as never, referenceDate: null,
    temporalStatus: "APPLICABLE", temporalReasoning: "Vigente alla data della condotta.", applicationToFacts, officialUrl: "https://www.normattiva.it/",
  };
}

function item(key: string, overrides: Partial<StructuredReportLegalApplication> = {}): StructuredReportLegalApplication {
  return {
    issueSemanticKey: key,
    issueText: `Questione ${key}`,
    relevantDates: [],
    facts: [{ text: "Il magazzino M4 risulta utilizzato dalla società Beta.", humanConfirmed: false, pages: [12] }],
    rules: [rule("L241-7", "Comunicazione di avvio necessaria."), rule(`R-${key}`, `Applicazione ${key}`)],
    favorableAuthorities: [], contraryAuthorities: [],
    favorableArguments: [],
    contraryArguments: ["Il contraddittorio deve precedere ogni decisione.", `Rischio ${key}`],
    conclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
    conclusion: `Conclusione preliminare per ${key}.`,
    consequences: ["Ogni misura richiede valutazione del professionista."],
    elementAnalysis: {
      profileId: "THIRD_PARTY_USE", label: "Affidamento a terzi senza autorizzazione", qualification: "Qualificazione preliminare: affidamento a terzi da accertare",
      ruleIds: [],
      elements: [
        { elementId: "use", requirement: "Utilizzo del bene da parte di un terzo", legalBasis: "art. 45-bis cod. nav.", core: true, status: "INDICATED", evidence: [], reasoning: "" },
        { elementId: "auth", requirement: "Assenza dell'autorizzazione", legalBasis: "art. 45-bis cod. nav.", core: true, status: "NOT_PROVEN", evidence: [], reasoning: "" },
      ],
    },
    ...overrides,
  };
}

describe("legal report presentation", () => {
  it("writes a discursive exposition distinguishing met, unproven and decisive conditions", () => {
    const text = legalIssueNarrative(item("m4")).join("\n");
    expect(text).toContain("Dai documenti del fascicolo risulta quanto segue: Il magazzino M4 risulta utilizzato dalla società Beta (pag. 12), da confermare");
    expect(text).toContain("Risultano dai documenti: utilizzo del bene da parte di un terzo (tutti ancora da confermare");
    expect(text).toContain("Non sono dimostrati: assenza dell'autorizzazione.");
    expect(text).toContain("Il presupposto determinante ancora da accertare è: assenza dell'autorizzazione");
    expect(text).toContain("l'assenza di un documento non equivale alla prova dell'inesistenza del fatto");
    expect(text).toContain("Conclusione: Conclusione preliminare per m4.");
  });

  it("does not restate in the conclusion the qualification and conditions already exposed", () => {
    const qualification = "Qualificazione preliminare: affidamento a terzi da accertare";
    const paragraphs = legalIssueNarrative(item("m4", {
      conclusion: `Qualificazione proposta: ${qualification}. Condizioni non dimostrate: assenza dell'autorizzazione. Determinanti per la decisione: assenza dell'autorizzazione. La questione va decisa alla luce dell'art. 45-bis cod. nav. nella versione vigente.`,
    }));
    const conclusion = paragraphs.at(-1)!;
    expect(conclusion).toBe("Conclusione: La questione va decisa alla luce dell'art. 45-bis cod. nav. nella versione vigente.");
    expect(paragraphs.join(" ").split(qualification).length - 1).toBe(1);
  });

  it("shows shared rules and warnings once, keeping issue-specific applications", () => {
    const items = [item("a"), item("b")];
    const common = commonLegalContent(items);
    expect([...common.ruleKeys]).toEqual([legalRuleKey(rule("L241-7", "Comunicazione di avvio necessaria."))]);
    expect([...common.arguments]).toEqual(["Il contraddittorio deve precedere ogni decisione."]);
    expect([...common.consequences]).toEqual(["Ogni misura richiede valutazione del professionista."]);
    const differentApplication = commonLegalContent([item("a"), item("b", { rules: [rule("L241-7", "Diversa applicazione.")] })]);
    expect(differentApplication.ruleKeys.size).toBe(0);
    expect(commonLegalContent([item("solo")]).ruleKeys.size).toBe(0);
  });
});

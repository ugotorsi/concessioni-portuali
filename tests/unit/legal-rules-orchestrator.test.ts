import { describe, expect, it } from "vitest";

import { evaluateRuleMatch } from "@/server/legal-rules/orchestrator";

describe("legal rules orchestrator evaluator", () => {
  const baseRule = {
    id: "rule-1",
    ruleCode: "CAN-01",
    title: "Morosita",
    summary: "Regola su morosita",
    category: "CANONE",
    priority: 10,
    outputSeverity: "URGENTE",
    outcomeTitle: "Morosita rilevante",
    outcomeSummary: "Avviare diffida",
    disclaimer: null,
    humanReviewRequired: true,
    matchConcessionVertical: "PORTUALE_ADSP",
    matchObjectType: null,
    matchAttivita: null,
    matchAwardingProcedure: null,
    matchFeeRegime: "PORTUALE",
    matchComparativeStatus: null,
    requiresRilevanzaArt47: null,
    matchArt47Letter: null,
    requiresMorosita: true,
    requiresPolizzaValida: null,
    source: {
      id: "source-1",
      sourceKey: "SRC-1",
      title: "Fonte",
      sourceType: "DELIBERA",
      filePath: null,
    },
  };

  it("matches when all expected criteria are satisfied", () => {
    const evaluation = evaluateRuleMatch(baseRule, {
      concessionVertical: "PORTUALE_ADSP",
      feeRegime: "PORTUALE",
      hasMorosita: true,
    });

    expect(evaluation.applicable).toBe(true);
    expect(evaluation.matchedCriteria).toContain("concessionVertical=PORTUALE_ADSP");
    expect(evaluation.matchedCriteria).toContain("feeRegime=PORTUALE");
    expect(evaluation.matchedCriteria).toContain("hasMorosita=true");
  });

  it("does not match when one required criterion differs", () => {
    const evaluation = evaluateRuleMatch(baseRule, {
      concessionVertical: "PORTUALE_ADSP",
      feeRegime: "ORDINARIO_DEMANIALE",
      hasMorosita: true,
    });

    expect(evaluation.applicable).toBe(false);
    expect(evaluation.matchedCriteria).toEqual([]);
  });
});

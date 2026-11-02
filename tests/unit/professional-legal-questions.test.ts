import { describe, expect, it } from "vitest";

import {
  PROFESSIONAL_RESEARCH_BUDGET,
  professionalQuestionVersionIdentity,
} from "@/server/legal-research/professional-questions";

describe("professional legal questions", () => {
  it("normalizes equivalent text into a stable semantic identity", () => {
    const first = professionalQuestionVersionIdentity({
      questionText: " Quale   disciplina si applica alla concessione? ",
      theme: "Concessione",
      rationale: null,
      referenceDate: new Date("2026-01-15T00:00:00.000Z"),
    });
    const second = professionalQuestionVersionIdentity({
      questionText: "quale disciplina si applica alla concessione?",
      theme: "Concessione",
      rationale: null,
      referenceDate: new Date("2026-01-15T00:00:00.000Z"),
    });

    expect(first.semanticKey).toBe(second.semanticKey);
    expect(first.questionText).toBe("Quale disciplina si applica alla concessione?");
  });

  it("keeps the professional mission inside the bounded provider budget", () => {
    expect(PROFESSIONAL_RESEARCH_BUDGET).toEqual({
      maxTotalResearchCalls: 6,
      maxMoonlitCalls: 2,
      maxSimpliciterCalls: 2,
      maxLegalDataHunterCalls: 2,
    });
    expect(
      PROFESSIONAL_RESEARCH_BUDGET.maxMoonlitCalls
      + PROFESSIONAL_RESEARCH_BUDGET.maxSimpliciterCalls
      + PROFESSIONAL_RESEARCH_BUDGET.maxLegalDataHunterCalls,
    ).toBe(PROFESSIONAL_RESEARCH_BUDGET.maxTotalResearchCalls);
  });
});

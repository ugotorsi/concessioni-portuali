import { describe, expect, it } from "vitest";

import {
  evaluateRuleMatch,
  evaluateSources,
  resolveOverallConfidence,
  type SourceLike,
} from "@/server/legal-rules/orchestrator";
import { ORCHESTRATION_DISCLAIMER } from "@/server/legal-rules/types";

function source(overrides?: Partial<SourceLike>): SourceLike {
  return {
    id: "source-1",
    sourceKey: "SRC-1",
    title: "Fonte",
    sourceType: "REGOLAMENTO",
    status: "CURRENT",
    role: "NORMATIVE",
    legalRank: "AUTHORITY_REGULATION",
    territorialScope: "AUTHORITY",
    confidence: "HIGH",
    issuingBody: "AdSP",
    sourceNumber: null,
    sourceDate: null,
    sourceOrigin: "LOCAL_CORPUS",
    portAreaCode: null,
    tags: [],
    humanReviewRequired: true,
    isConformative: true,
    isExtractable: true,
    filePath: "src-1.pdf",
    effectiveFrom: null,
    effectiveTo: null,
    authorityId: "auth-1",
    authority: { code: "ADSP-MTC" },
    portId: "port-1",
    port: { code: "SALERNO", authorityId: "auth-1" },
    ...overrides,
  };
}

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

  it("classifies national source as potentially applicable", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source({ territorialScope: "NATIONAL", authority: null, port: null })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.applicableSources).toHaveLength(1);
  });

  it("excludes source on authority mismatch", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source({ authority: { code: "ADSP-OTHER" } })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.excludedByTerritory).toHaveLength(1);
    expect(evaluated.excludedByTerritory[0]?.exclusionReasons).toContain("AUTHORITY_MISMATCH");
  });

  it("excludes source on port mismatch", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", portKey: "NAPOLI", referenceDate: "2026-07-24" },
      [source({ territorialScope: "PORT", port: { code: "SALERNO", authorityId: "auth-1" } })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.excludedByTerritory).toHaveLength(1);
    expect(evaluated.excludedByTerritory[0]?.exclusionReasons).toContain("PORT_MISMATCH");
  });

  it("excludes source with future effectiveFrom", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source({ effectiveFrom: new Date("2027-01-01T00:00:00.000Z") })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.excludedByDate[0]?.exclusionReasons).toContain("EFFECTIVE_FROM_FUTURE");
  });

  it("excludes source with expired effectiveTo", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source({ effectiveTo: new Date("2025-12-31T00:00:00.000Z") })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.excludedByDate[0]?.exclusionReasons).toContain("EFFECTIVE_TO_EXPIRED");
  });

  it("handles HISTORICAL, SUPERSEDED, PARTIALLY_SUPERSEDED, PENDING, DRAFT, CASE_SPECIFIC and MISSING_SOURCE", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24", includeHistorical: true, includePending: true },
      [
        source({ id: "h", sourceKey: "H", status: "HISTORICAL" }),
        source({ id: "s", sourceKey: "S", status: "SUPERSEDED" }),
        source({ id: "ps", sourceKey: "PS", status: "PARTIALLY_SUPERSEDED" }),
        source({ id: "p", sourceKey: "P", status: "PENDING_VALIDITY_CHECK" }),
        source({ id: "d", sourceKey: "D", status: "DRAFT_OR_ONGOING_PROCEDURE" }),
        source({ id: "c", sourceKey: "C", status: "CASE_SPECIFIC" }),
        source({ id: "m", sourceKey: "M", status: "MISSING_SOURCE" }),
      ],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.historicalSources).toHaveLength(1);
    expect(evaluated.supersededSources).toHaveLength(1);
    expect(evaluated.partiallySupersededSources).toHaveLength(1);
    expect(evaluated.pendingValiditySources.length).toBeGreaterThanOrEqual(1);
    expect(evaluated.draftOrOngoingSources).toHaveLength(1);
    expect(evaluated.caseSpecificSources).toHaveLength(1);
    expect(evaluated.missingSources.length).toBeGreaterThanOrEqual(1);
  });

  it("flags POT, DPSS, DEASP and map support as non-equivalent/non-conformative conflicts", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [
        source({ sourceKey: "POT", tags: ["POT"] }),
        source({ sourceKey: "DPSS", tags: ["DPSS"] }),
        source({ sourceKey: "DEASP", tags: ["DEASP"] }),
        source({ sourceKey: "MAP", role: "SUPPORTING_MAP", isConformative: false }),
      ],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    const codes = evaluated.potentialConflicts.map((item) => item.code);
    expect(codes).toContain("POT_NOT_EQUIVALENT_TO_PRP");
    expect(codes).toContain("DPSS_NOT_EQUIVALENT_TO_PRP");
    expect(codes).toContain("DEASP_NOT_URBAN_CONFORMATIVE");
    expect(codes).toContain("MAP_SUPPORT_NOT_AUTONOMOUS");
  });

  it("adds PRP/NTA/ATF missing gap when domain context requires essential sources", () => {
    const evaluated = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24", domain: "PORT_CONCESSION" },
      [source({ tags: ["POT"] })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(evaluated.missingSources.some((item) => item.code === "MISSING_PRP_NTA_ATF")).toBe(true);
  });

  it("produces deterministic reasoning trace", () => {
    const first = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source()],
      new Date("2026-07-24T00:00:00.000Z"),
    );
    const second = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source()],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(first.reasoningTrace).toEqual(second.reasoningTrace);
  });

  it("computes confidence HIGH", () => {
    const buckets = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source()],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(resolveOverallConfidence({ authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" }, buckets)).toBe("HIGH");
  });

  it("computes confidence MEDIUM when pending/conflict exists", () => {
    const buckets = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" },
      [source({ status: "PENDING_VALIDITY_CHECK" })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(resolveOverallConfidence({ authorityKey: "ADSP-MTC", referenceDate: "2026-07-24" }, buckets)).toBe("MEDIUM");
  });

  it("computes confidence LOW when context incomplete", () => {
    const buckets = evaluateSources(
      { referenceDate: "2026-07-24" },
      [source()],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(resolveOverallConfidence({ referenceDate: "2026-07-24" }, buckets)).toBe("LOW");
  });

  it("computes confidence INSUFFICIENT when missing essential sources", () => {
    const buckets = evaluateSources(
      { authorityKey: "ADSP-MTC", referenceDate: "2026-07-24", domain: "PORT_CONCESSION" },
      [source({ tags: [] })],
      new Date("2026-07-24T00:00:00.000Z"),
    );

    expect(resolveOverallConfidence({ authorityKey: "ADSP-MTC", referenceDate: "2026-07-24", domain: "PORT_CONCESSION" }, buckets)).toBe("INSUFFICIENT");
  });

  it("keeps mandatory disclaimer text constant", () => {
    expect(ORCHESTRATION_DISCLAIMER).toContain("Verifica professionale richiesta");
  });
});

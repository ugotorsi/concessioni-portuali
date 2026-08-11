import { describe, expect, it } from "vitest";

import {
  buildP1C1ScreeningFingerprint,
  evaluateP1C1DocumentRequirement,
} from "@/server/fascicolo-document-requirements/matcher";

describe("P1-C1 document requirement matcher", () => {
  it("matches only art.18 port operations with deterministic criteria", () => {
    const result = evaluateP1C1DocumentRequirement({
      normaRiferimento: "ART_18_L_84_1994",
      portActivityLegalType: "OPERAZIONI_PORTUALI",
    });

    expect(result).toEqual({
      eligible: true,
      matchedCriteria: [
        {
          field: "Concessione.normaRiferimento",
          operator: "EQ",
          actual: "ART_18_L_84_1994",
          expected: "ART_18_L_84_1994",
          matched: true,
        },
        {
          field: "Concessione.portActivityLegalType",
          operator: "EQ",
          actual: "OPERAZIONI_PORTUALI",
          expected: "OPERAZIONI_PORTUALI",
          matched: true,
        },
      ],
    });
  });

  it.each([
    ["ART_18_L_84_1994", null],
    ["ART_18_L_84_1994", "SERVIZI_PORTUALI"],
    ["ART_18_L_84_1994", "PASSEGGERI"],
    ["ART_18_L_84_1994", "ALTRO"],
    ["ART_36_COD_NAV", "OPERAZIONI_PORTUALI"],
    ["ALTRO", "OPERAZIONI_PORTUALI"],
  ] as const)("does not match %s + %s", (normaRiferimento, portActivityLegalType) => {
    expect(evaluateP1C1DocumentRequirement({ normaRiferimento, portActivityLegalType }).eligible).toBe(false);
  });

  it("produces a stable lowercase SHA-256 fingerprint from contract inputs only", () => {
    const input = {
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      concessioneId: "concessione-1",
      normaRiferimento: "ART_18_L_84_1994" as const,
      portActivityLegalType: "OPERAZIONI_PORTUALI" as const,
    };
    const first = buildP1C1ScreeningFingerprint(input);
    const second = buildP1C1ScreeningFingerprint(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["enteId", "ente-2"],
    ["procedimentoId", "procedimento-2"],
    ["concessioneId", "concessione-2"],
    ["normaRiferimento", "ART_36_COD_NAV"],
    ["portActivityLegalType", "SERVIZI_PORTUALI"],
    ["ruleContractVersion", 2],
  ] as const)("changes fingerprint when %s changes", (field, value) => {
    const input = {
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      concessioneId: "concessione-1",
      normaRiferimento: "ART_18_L_84_1994" as const,
      portActivityLegalType: "OPERAZIONI_PORTUALI" as const,
    };

    expect(buildP1C1ScreeningFingerprint({ ...input, [field]: value })).not.toBe(
      buildP1C1ScreeningFingerprint(input),
    );
  });

  it("ignores date, actor and presentation-only values outside the fingerprint contract", () => {
    const input = {
      enteId: "ente-1",
      procedimentoId: "procedimento-1",
      concessioneId: "concessione-1",
      normaRiferimento: "ART_18_L_84_1994" as const,
      portActivityLegalType: "OPERAZIONI_PORTUALI" as const,
    };
    const withNonContractValues = {
      ...input,
      referenceDate: "2099-12-31",
      currentDate: "2099-12-31",
      actor: "other-user",
      email: "other@example.test",
      role: "VIEWER_ADSP",
      sourceTitleSnapshot: "Changed presentation",
      gapLabelSnapshot: "Changed presentation",
    };

    expect(buildP1C1ScreeningFingerprint(withNonContractValues)).toBe(buildP1C1ScreeningFingerprint(input));
  });
});
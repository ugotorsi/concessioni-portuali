import { describe, expect, it } from "vitest";

import {
  inferDefaultConcessionVertical,
  inferDefaultFeeRegime,
  inferInitialLegalFrameworks,
  mapTipologiaBeneToConcessionObjectType,
} from "@/lib/concession-vertical";

describe("concession vertical helpers", () => {
  it("maps legacy tipologia bene to concession object type", () => {
    expect(mapTipologiaBeneToConcessionObjectType("AREA_SCOPERTA")).toBe("AREA_DEMANIALE");
    expect(mapTipologiaBeneToConcessionObjectType("SPECCHIO_ACQUEO")).toBe("SPECCHIO_ACQUEO");
    expect(mapTipologiaBeneToConcessionObjectType("BOX")).toBe("LOCALE");
  });

  it("infers default vertical conservatively", () => {
    expect(
      inferDefaultConcessionVertical({
        attivita: "LOGISTICA",
        normaRiferimento: "ART_18_L_84_1994",
      }),
    ).toBe("PORTUALE_ADSP");

    expect(
      inferDefaultConcessionVertical({
        attivita: "TURISTICO_RICREATIVA",
        normaRiferimento: "ART_36_COD_NAV",
      }),
    ).toBe("MARITTIMA_TURISTICO_RICREATIVA");
  });

  it("assigns fee regime defaults without breaking legacy data", () => {
    expect(
      inferDefaultFeeRegime({
        concessionVertical: "PORTUALE_ADSP",
        normaRiferimento: "ART_18_L_84_1994",
      }),
    ).toBe("PORTUALE");

    expect(
      inferDefaultFeeRegime({
        concessionVertical: "MARITTIMA_TURISTICO_RICREATIVA",
        normaRiferimento: "ART_36_COD_NAV",
      }),
    ).toBe("TURISTICO_RICREATIVO_DL400");
  });

  it("builds legal framework as multi-value and keeps art.47 non-automatic", () => {
    const withoutArt47 = inferInitialLegalFrameworks({
      normaRiferimento: "ART_36_COD_NAV",
      concessionVertical: "PORTUALE_ADSP",
      hasArt47Signals: false,
    });

    expect(withoutArt47).toContain("ART_36_COD_NAV");
    expect(withoutArt47).not.toContain("ART_47_COD_NAV");

    const withArt47Signals = inferInitialLegalFrameworks({
      normaRiferimento: "ART_36_COD_NAV",
      concessionVertical: "MARITTIMA_TURISTICO_RICREATIVA",
      hasArt47Signals: true,
    });

    expect(withArt47Signals).toContain("ART_37_COD_NAV");
    expect(withArt47Signals).toContain("DL_400_1993");
    expect(withArt47Signals).toContain("DIR_2006_123_ART_12");
    expect(withArt47Signals).toContain("ART_47_COD_NAV");
  });
});

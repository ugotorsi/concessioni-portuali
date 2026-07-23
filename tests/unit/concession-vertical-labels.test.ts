import { describe, expect, it } from "vitest";

import { getConcessionVerticalLabel, getLegalFrameworkLabel } from "@/lib/concession-vertical-labels";

describe("concession vertical labels", () => {
  it("maps expected vertical labels", () => {
    expect(getConcessionVerticalLabel("PORTUALE_ADSP")).toBe("Portuale / AdSP");
    expect(getConcessionVerticalLabel("MARITTIMA_TURISTICO_RICREATIVA")).toBe(
      "Turistico-ricreativa / Comune costiero",
    );
    expect(getConcessionVerticalLabel("ALTRA_CONCESSIONE_DEMANIALE")).toBe("Altro demanio");
  });

  it("maps expected legal framework labels", () => {
    expect(getLegalFrameworkLabel("ART_36_COD_NAV")).toBe("Art. 36 cod. nav.");
    expect(getLegalFrameworkLabel("ART_18_L_84_1994")).toBe("Art. 18 l. 84/1994");
    expect(getLegalFrameworkLabel("ART_37_COD_NAV")).toBe("Art. 37 cod. nav.");
    expect(getLegalFrameworkLabel("ART_47_COD_NAV")).toBe("Art. 47 cod. nav. (profilo istruttorio)");
    expect(getLegalFrameworkLabel("DL_400_1993")).toBe("d.l. 400/1993");
    expect(getLegalFrameworkLabel("DIR_2006_123_ART_12")).toBe("Dir. 2006/123/CE art. 12");
  });
});
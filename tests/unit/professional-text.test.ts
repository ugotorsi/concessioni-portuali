import { describe, expect, it } from "vitest";

import { documentReferenceLabel, humanizeProfessionalText, sourceLimitLabel } from "@/lib/professional-text";

describe("professional text", () => {
  it("renders evidence references and source limits in professional Italian", () => {
    expect(documentReferenceLabel("DOCUMENT_1.PAGE_25")).toBe("documento 1, pag. 25");
    expect(humanizeProfessionalText("Nessuna informazione estratta da DOCUMENT_2.PAGE_7 e DOCUMENT_3."))
      .toBe("Nessuna informazione estratta da documento 2, pag. 7 e documento 3.");
    expect(humanizeProfessionalText("Gap fonti: CONTENT_UNVERIFIED, NO_USABLE_SOURCE"))
      .toBe("Limiti delle fonti: contenuto della fonte non verificato, nessuna fonte utilizzabile");
    expect(sourceLimitLabel("SOME_NEW_CODE")).toBe("some new code");
    expect(humanizeProfessionalText("Art. 47 cod. nav. e L. 84/1994")).toBe("Art. 47 cod. nav. e L. 84/1994");
  });
});

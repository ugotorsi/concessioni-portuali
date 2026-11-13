import { describe, expect, it } from "vitest";

import {
  documentNamesByReference,
  documentReferenceLabel,
  humanizeProfessionalText,
  isInternalProfessionalDiagnostic,
  professionalGapSummaries,
  sourceLimitLabel,
} from "@/lib/professional-text";

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

  it("keeps technical compilation diagnostics out of the report and groups document gaps", () => {
    const summaries = professionalGapSummaries([
      "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_5.",
      "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_2.",
      "DOCUMENT_INVENTORY:server-inventory-123:UNCERTAIN:DOCUMENT_1.PAGE_5:Classificazione server-side prudenziale.",
      "DOCUMENT_INVENTORY:server-inventory-456:MATERIAL:DOCUMENT_1.PAGE_4:Classificazione server-side.",
      "COMPILATION:REBUILT:DOCUMENT_COVERAGE_GAP_ADDED:documentInventory.0",
      "PROCEEDING_IDENTITY:REBUILT:VERIFIED:ISSUE_CANONI",
      "Manca la quietanza per verificare l'imputazione del pagamento.",
    ]);

    expect(summaries).toEqual([
      "Manca la quietanza per verificare l'imputazione del pagamento.",
      "Per il documento 1, non è stato possibile verificare il contenuto interpretativo alle pagine 2, 5. I fatti e i presupposti giuridici eventualmente presenti in queste pagine non possono essere accertati senza verificare il documento originale; l'estrazione incompleta non prova la loro inesistenza.",
      "Per il documento 1, la rilevanza delle pagine 5 richiede una verifica manuale: potrebbero incidere sui fatti, sulle condizioni o sui termini rilevanti e non possono essere escluse dalla valutazione giuridica.",
    ]);
    expect(isInternalProfessionalDiagnostic("COMPILATION:REBUILT:warning")).toBe(true);
    expect(isInternalProfessionalDiagnostic("Manca la quietanza")).toBe(false);
    expect(isInternalProfessionalDiagnostic("COMPILATION warning REBUILT")).toBe(true);
  });

  it("uses document names only when the evidence reference resolves unambiguously", () => {
    const names = documentNamesByReference([
      { evidence: [
        { basisRef: "DOCUMENT_1.PAGE_2", documentoId: "doc-1" },
        { basisRef: "DOCUMENT_2.PAGE_1", documentoId: "doc-1" },
        { basisRef: "DOCUMENT_2.PAGE_2", documentoId: "doc-2" },
      ] },
    ], [{ id: "doc-1", nome: "Titolo.pdf" }, { id: "doc-2", nome: "Istanza.pdf" }]);
    expect(names.get("DOCUMENT_1")).toBe("Titolo.pdf");
    expect(names.has("DOCUMENT_2")).toBe(false);
    expect(professionalGapSummaries([
      "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_2.",
    ], names)[0]).toContain("documento 1 (Titolo.pdf)");
  });

  it("keeps each documented impact with its gap and related documents without exposing diagnostics", () => {
    const summaries = professionalGapSummaries([
      {
        normalizedText: "Manca la planimetria aggiornata",
        payload: { impact: "Il perimetro non può essere confrontato con DOCUMENT_1.PAGE_2." },
        evidence: [{ basisRef: "DOCUMENT_1.PAGE_2" }],
      },
      {
        normalizedText: "Manca la planimetria aggiornata",
        payload: { impact: "Il perimetro non può essere confrontato con DOCUMENT_1.PAGE_2." },
        evidence: [{ basisRef: "DOCUMENT_1.PAGE_2" }],
      },
      {
        normalizedText: "Manca la ricevuta",
        payload: { impact: "Il pagamento non è verificabile." },
        evidence: [{ basisRef: "DOCUMENT_2.PAGE_1" }],
      },
      { normalizedText: "Manca un allegato", payload: null },
      { normalizedText: "Manca un'altra prova", payload: { impact: "COMPILATION:INTERNAL" } },
      { normalizedText: "COMPILATION:INTERNAL", payload: { impact: "Non deve comparire." } },
    ], new Map([["DOCUMENT_1", "Titolo.pdf"], ["DOCUMENT_2", "Conto.pdf"]]));

    expect(summaries).toHaveLength(4);
    expect(summaries[0]).toContain("Riferimenti documentali: documento 1 (Titolo.pdf). Manca la planimetria aggiornata.");
    expect(summaries[0]).toContain("Effetto indicato, da verificare: Il perimetro non può essere confrontato con documento 1, pag. 2.");
    expect(summaries[1]).toContain("documento 2 (Conto.pdf). Manca la ricevuta.");
    expect(summaries[1]).toContain("Il pagamento non è verificabile.");
    expect(summaries[1]).not.toContain("perimetro");
    expect(summaries[2]).toContain("Riferimenti documentali non determinati.");
    expect(summaries[2]).toContain("Effetto sulla valutazione giuridica non specificato: da verificare.");
    expect(summaries[3]).toContain("Effetto sulla valutazione giuridica non specificato: da verificare.");
    expect(summaries.join(" ")).not.toMatch(/COMPILATION|DOCUMENT_\d+|PAGE_\d+/);
  });

  it("groups page gaps by document while keeping specific effects attached to their pages", () => {
    const summaries = professionalGapSummaries([
      { normalizedText: "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_3.",
        payload: { impact: "La data del titolo resta incerta." } },
      { normalizedText: "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_8.",
        payload: { impact: "La superficie resta incerta." } },
      { normalizedText: "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_8.",
        payload: { impact: "La superficie resta incerta." } },
      { normalizedText: "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_2.PAGE_4.",
        payload: { impact: 123 } },
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("documento 1");
    expect(summaries[0]).toContain("pagine 3, 8");
    expect(summaries[0]).toContain("Effetto indicato per la pagina 3, da verificare: La data del titolo resta incerta.");
    expect(summaries[0].match(/La superficie resta incerta/g)).toHaveLength(1);
    expect(summaries[0]).toContain("Effetto indicato per la pagina 8, da verificare: La superficie resta incerta.");
    expect(summaries[1]).toContain("documento 2");
    expect(summaries[1]).not.toContain("Effetto indicato");
    expect(summaries[1]).toContain("l'estrazione incompleta non prova la loro inesistenza");
  });
});

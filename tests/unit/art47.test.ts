import { describe, expect, it } from "vitest";

import {
  getArt47Description,
  getArt47RiskNoteWithRegolarizzazione,
  getArt47Label,
  getEsitoRegolarizzazioneDescription,
  getEsitoRegolarizzazioneLabel,
  getRegolarizzazioneBadgeVariant,
  getRischioDecadenzaBadgeVariant,
  getRischioDecadenzaLabel,
  hasRegolarizzazioneIstruttoriaRilevante,
  inferArt47FromCriticitaTipologia,
} from "@/lib/art47";

describe("art47 helpers", () => {
  it("restituisce label e descrizione per lettera nota", () => {
    expect(getArt47Label("D_OMESSO_PAGAMENTO_CANONE")).toContain("Lettera d");
    expect(getArt47Description("D_OMESSO_PAGAMENTO_CANONE")).toContain("canoni");
  });

  it("gestisce valori nulli", () => {
    expect(getArt47Label(null)).toBe("-");
    expect(getArt47Description(undefined)).toContain("Nessuna");
    expect(getRischioDecadenzaLabel(null)).toBe("-");
    expect(getRischioDecadenzaBadgeVariant(undefined)).toBe("default");
  });

  it("calcola variante badge rischio", () => {
    expect(getRischioDecadenzaBadgeVariant("BASSO")).toBe("success");
    expect(getRischioDecadenzaBadgeVariant("MEDIO")).toBe("warning");
    expect(getRischioDecadenzaBadgeVariant("ALTO")).toBe("danger");
    expect(getRischioDecadenzaBadgeVariant("CRITICO")).toBe("danger");
  });

  it("fornisce inferenza assistiva per morosita", () => {
    const inferred = inferArt47FromCriticitaTipologia("MOROSITA");

    expect(inferred.suggestedLettera).toBe("D_OMESSO_PAGAMENTO_CANONE");
    expect(inferred.suggestedRischio).toBe("ALTO");
    expect(inferred.reason).toContain("assistivo");
  });

  it("espone label e descrizione per esito regolarizzazione", () => {
    expect(getEsitoRegolarizzazioneLabel("COMPLETA")).toBe("Completa");
    expect(getEsitoRegolarizzazioneDescription("PARZIALE")).toContain("parzialmente");
    expect(getEsitoRegolarizzazioneLabel(null)).toBe("-");
  });

  it("calcola badge e rilevanza istruttoria regolarizzazione", () => {
    expect(getRegolarizzazioneBadgeVariant("COMPLETA")).toBe("success");
    expect(getRegolarizzazioneBadgeVariant("PARZIALE")).toBe("warning");
    expect(getRegolarizzazioneBadgeVariant("NON_IDONEA")).toBe("danger");
    expect(hasRegolarizzazioneIstruttoriaRilevante({ regolarizzata: true })).toBe(true);
    expect(hasRegolarizzazioneIstruttoriaRilevante({ regolarizzata: false })).toBe(false);
  });

  it("fornisce nota art.47 con divieto di automatismi", () => {
    const note = getArt47RiskNoteWithRegolarizzazione({
      rilevanzaArt47: true,
      regolarizzata: true,
      esitoRegolarizzazione: "COMPLETA",
      verificataRegolarizzazione: true,
    });

    expect(note).toContain("senza automatismi");
  });
});

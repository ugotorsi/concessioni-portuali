import { describe, expect, it } from "vitest";

import {
  buildCriticitaCreateData,
  createCriticitaSchema,
  ensureTipologiaByRole,
} from "@/server/criticita/criticitaDomain";

function input(overrides: Record<string, unknown> = {}) {
  return {
    concessioneId: "concessione-1",
    tipologia: "GIURIDICA",
    gravita: "MEDIA",
    fonte: "SEGNALAZIONE",
    descrizione: "Descrizione istruttoria completa.",
    rilevanzaArt47: "false",
    regolarizzata: "false",
    verificataRegolarizzazione: "false",
    ...overrides,
  };
}

describe("Criticita shared domain", () => {
  it("preserves normal create defaults and clears inapplicable Art. 47 fields", () => {
    const parsed = createCriticitaSchema.parse(input({
      letteraArt47: "F_INADEMPIMENTO_OBBLIGHI",
      rischioDecadenza: "ALTO",
      motivazioneArt47: "Valore da eliminare",
    }));

    expect(buildCriticitaCreateData(parsed, {
      concessioneId: parsed.concessioneId,
      fonte: parsed.fonte,
      now: new Date("2026-09-20T00:00:00.000Z"),
    })).toMatchObject({
      concessioneId: "concessione-1",
      fonte: "SEGNALAZIONE",
      stato: "APERTA",
      rilevanzaArt47: false,
      letteraArt47: null,
      rischioDecadenza: null,
      motivazioneArt47: null,
      regolarizzata: false,
      verificataRegolarizzazione: false,
    });
  });

  it("keeps the existing Art. 47 required fields", () => {
    const result = createCriticitaSchema.safeParse(input({ rilevanzaArt47: "true" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        "letteraArt47",
        "rischioDecadenza",
        "motivazioneArt47",
      ]);
    }
  });

  it("preserves regolarizzazione normalization", () => {
    const parsed = createCriticitaSchema.parse(input({
      regolarizzata: "true",
      dataRegolarizzazione: "2026-09-20",
      descrizioneRegolarizzazione: "Regolarizzazione documentata.",
      esitoRegolarizzazione: "COMPLETA",
      verificataRegolarizzazione: "false",
      dataVerificaRegolarizzazione: "2026-09-21",
      noteVerificaRegolarizzazione: "Da eliminare",
    }));
    const data = buildCriticitaCreateData(parsed, {
      concessioneId: parsed.concessioneId,
      fonte: parsed.fonte,
    });

    expect(data).toMatchObject({
      regolarizzata: true,
      esitoRegolarizzazione: "COMPLETA",
      verificataRegolarizzazione: false,
      dataVerificaRegolarizzazione: null,
      noteVerificaRegolarizzazione: null,
    });
  });

  it("preserves tecnico and economico tipologia restrictions", () => {
    expect(() => ensureTipologiaByRole("TECNICO", "GIURIDICA")).toThrow("solo criticità tecniche");
    expect(() => ensureTipologiaByRole("ECONOMICO", "TECNICA")).toThrow("economiche o morosità");
    expect(() => ensureTipologiaByRole("TECNICO", "SICUREZZA")).not.toThrow();
    expect(() => ensureTipologiaByRole("ECONOMICO", "MOROSITA")).not.toThrow();
  });
});
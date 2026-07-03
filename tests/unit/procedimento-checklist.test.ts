import { describe, expect, it } from "vitest";

import {
  calculateChecklistCompleteness,
  getMissingChecklistItems,
  getProcedimentoWarningLevel,
  isContraddittorioCompleto,
} from "@/lib/procedimento-checklist";

describe("procedimento checklist helpers", () => {
  it("considers checklist complete for decadenziale flow with required steps", () => {
    const procedimento = {
      tipologia: "AVVIO_DECADENZA",
      comunicazioneAvvioInviata: true,
      termineMemorieGiorni: 30,
      contestazioneFormaleInviata: true,
      controdeduzioniValutate: true,
      motivazioneValutazione: "Valutazione istruttoria completa.",
      propostaEsitoIstruttorio: "DECADENZA_DA_VALUTARE",
    };

    expect(isContraddittorioCompleto(procedimento)).toBe(true);
    expect(calculateChecklistCompleteness(procedimento).requiredCompleted).toBe(
      calculateChecklistCompleteness(procedimento).requiredTotal,
    );
  });

  it("returns missing items for absent avvio or contestazione", () => {
    const missing = getMissingChecklistItems({
      tipologia: "CONTESTAZIONE",
      comunicazioneAvvioInviata: false,
      termineMemorieGiorni: null,
      contestazioneFormaleInviata: false,
      controdeduzioniValutate: false,
      motivazioneValutazione: null,
    });

    expect(missing.some((item) => item.toLowerCase().includes("comunicazione"))).toBe(true);
    expect(missing.some((item) => item.toLowerCase().includes("contestazione"))).toBe(true);
  });

  it("raises danger warning for decadential proposal when checklist is incomplete", () => {
    const level = getProcedimentoWarningLevel({
      tipologia: "AVVIO_DECADENZA",
      comunicazioneAvvioInviata: true,
      termineMemorieGiorni: 30,
      contestazioneFormaleInviata: false,
      controdeduzioniValutate: false,
      propostaEsitoIstruttorio: "DECADENZA_DA_VALUTARE",
      motivazioneValutazione: null,
    });

    expect(level).toBe("danger");
  });

  it("never auto-decides final outcome", () => {
    const complete = isContraddittorioCompleto({
      tipologia: "DIFFIDA",
      comunicazioneAvvioInviata: true,
      termineMemorieGiorni: 20,
      contestazioneFormaleInviata: true,
      controdeduzioniValutate: true,
      motivazioneValutazione: "Motivazione presente.",
    });

    expect(complete).toBe(true);
    expect(getProcedimentoWarningLevel({ tipologia: "DIFFIDA" })).toBe("warning");
  });
});

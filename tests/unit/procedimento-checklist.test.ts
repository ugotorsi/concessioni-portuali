import { describe, expect, it } from "vitest";

import {
  calculateChecklistCompleteness,
  getMissingChecklistItems,
  getProcedimentoWarningLevel,
  isProcedimentoUfficio,
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

  it("procedimento d ufficio non richiede automaticamente preavviso rigetto", () => {
    const procedimento = {
      tipologia: "AVVIO_DECADENZA",
      origineProcedimento: "UFFICIO",
      procedimentoUfficio: true,
      comunicazioneAvvioInviata: true,
      contestazioneFormaleInviata: true,
      termineMemorieGiorni: 30,
      controdeduzioniValutate: true,
      motivazioneValutazione: "Valutazione effettuata.",
      propostaEsitoIstruttorio: "DECADENZA_DA_VALUTARE",
      preavvisoRigettoApplicabile: false,
      statoPreavvisoRigetto: "NON_APPLICABILE",
    };

    expect(isProcedimentoUfficio(procedimento)).toBe(true);
    expect(getProcedimentoWarningLevel(procedimento)).toBe("default");
  });

  it("istanza di parte con preavviso applicabile non inviato genera warning alto", () => {
    const level = getProcedimentoWarningLevel({
      tipologia: "DIFFIDA",
      origineProcedimento: "ISTANZA_PARTE",
      procedimentoUfficio: false,
      preavvisoRigettoApplicabile: true,
      statoPreavvisoRigetto: "APPLICABILE_DA_INVIARE",
      comunicazioneAvvioInviata: true,
      contestazioneFormaleInviata: true,
      termineMemorieGiorni: 20,
    });

    expect(level).toBe("danger");
  });

  it("osservazioni ricevute ma non valutate genera warning alto", () => {
    const level = getProcedimentoWarningLevel({
      tipologia: "CONTESTAZIONE",
      origineProcedimento: "ISTANZA_PARTE",
      procedimentoUfficio: false,
      preavvisoRigettoApplicabile: true,
      statoPreavvisoRigetto: "OSSERVAZIONI_RICEVUTE",
      osservazioniPreavvisoRicevute: true,
      valutazioneOsservazioniPreavviso: null,
    });

    expect(level).toBe("danger");
  });

  it("art.47 d ufficio senza avvio/contestazione evidenzia missing items", () => {
    const missing = getMissingChecklistItems({
      tipologia: "AVVIO_DECADENZA",
      origineProcedimento: "UFFICIO",
      procedimentoUfficio: true,
      comunicazioneAvvioInviata: false,
      contestazioneFormaleInviata: false,
    });

    expect(missing.some((item) => item.toLowerCase().includes("comunicazione"))).toBe(true);
    expect(missing.some((item) => item.toLowerCase().includes("contestazione"))).toBe(true);
  });

  it("checklist completa per istanza parte con osservazioni valutate", () => {
    const procedimento = {
      tipologia: "DIFFIDA",
      origineProcedimento: "ISTANZA_PARTE",
      procedimentoUfficio: false,
      comunicazioneAvvioInviata: true,
      termineMemorieGiorni: 20,
      contestazioneFormaleInviata: true,
      controdeduzioniValutate: true,
      motivazioneValutazione: "Valutazione completa.",
      preavvisoRigettoApplicabile: true,
      statoPreavvisoRigetto: "OSSERVAZIONI_VALUTATE",
      dataPreavvisoRigetto: new Date(),
      termineOsservazioniPreavviso: new Date(),
      osservazioniPreavvisoRicevute: true,
      valutazioneOsservazioniPreavviso: "Osservazioni valutate.",
    };

    expect(isContraddittorioCompleto(procedimento)).toBe(true);
    expect(calculateChecklistCompleteness(procedimento).requiredCompleted).toBe(
      calculateChecklistCompleteness(procedimento).requiredTotal,
    );
  });
});

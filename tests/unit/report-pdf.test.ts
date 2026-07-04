import { describe, expect, it } from "vitest";

import type { ReportDetail } from "@/server/queries/report";
import { buildReportPdfFileName, renderInstitutionalReportPdf } from "@/server/pdf/reportPdf";

function createReportDetailFixture(overrides?: Partial<ReportDetail>): ReportDetail {
  const base: ReportDetail = {
    report: {
      id: "rep-1",
      tipologia: "DOSSIER_ISTRUTTORIO",
      titolo: "Dossier istruttorio concessione D-45",
      contenuto:
        "Analisi istruttoria con evidenze tecniche, economiche e procedimentali a supporto delle determinazioni interne.",
      formato: "PDF",
      validato: true,
      createdAt: new Date("2026-02-10T10:00:00.000Z"),
      updatedAt: new Date("2026-02-11T11:00:00.000Z"),
    },
    concessione: {
      id: "con-1",
      numeroAtto: "D-45/2024",
      stato: "ATTIVA",
      dataRilascio: new Date("2024-01-01T00:00:00.000Z"),
      dataScadenza: new Date("2028-12-31T00:00:00.000Z"),
      tipologiaBene: "AREA_DEMANIALE",
      attivita: "CANTIERISTICA_NAVALE",
      canoneAnnuo: 125000,
      categoriaCanone: "ORDINARIO",
      ubicazione: "Molo Sud",
      descrizioneBene: "Area operativa e piazzale",
    },
    concessionario: {
      id: "conc-1",
      denominazione: "Cantieri Demo S.p.A.",
      codiceFiscale: "12345678901",
      partitaIva: "12345678901",
      sedeLegale: "Genova",
      pec: "cantieri@pec.demo",
      email: "info@demo.local",
    },
    criticitaAperte: [
      {
        id: "crit-1",
        tipologia: "MOROSITA",
        gravita: "ALTA",
        stato: "APERTA",
        descrizione: "Canone annuale non integralmente versato.",
        riferimentoNormativo: "art. 47 cod. nav.",
        dataRilevazione: new Date("2026-01-15T00:00:00.000Z"),
        rilevanzaArt47: true,
        letteraArt47: "D_OMESSO_PAGAMENTO_CANONE",
        rischioDecadenza: "ALTO",
        motivazioneArt47: "Morosita reiterata",
        azioneIstruttoriaArt47: "Avvio contraddittorio",
        regolarizzata: true,
        dataRegolarizzazione: new Date("2026-01-20T00:00:00.000Z"),
        descrizioneRegolarizzazione: "Versamento parziale",
        esitoRegolarizzazione: "PARZIALE",
        verificataRegolarizzazione: false,
        dataVerificaRegolarizzazione: null,
        noteVerificaRegolarizzazione: "In verifica istruttoria",
      },
    ],
    scadenzeRilevanti: [
      {
        id: "scad-1",
        tipologia: "CANONE",
        stato: "SCADUTA",
        dataScadenza: new Date("2026-02-01T00:00:00.000Z"),
        descrizione: "Scadenza canone primo trimestre",
      },
    ],
    pagamentiCritici: [
      {
        id: "pag-1",
        annoRiferimento: 2026,
        importoDovuto: 50000,
        importoVersato: 10000,
        residuo: 40000,
        stato: "PARZIALE",
        dataScadenza: new Date("2026-02-01T00:00:00.000Z"),
        dataVersamento: null,
        interessiMora: 450.5,
        note: "Sollecito inviato",
      },
    ],
    procedimentiInCorso: [
      {
        id: "proc-1",
        tipologia: "RECUPERO_CANONI",
        stato: "IN_CORSO",
        riferimentoNormativo: "Art. 47 cod. nav.",
        dataAvvio: new Date("2026-01-20T00:00:00.000Z"),
        dataScadenzaContraddittorio: new Date("2026-02-20T00:00:00.000Z"),
        origineProcedimento: "ISTANZA_PARTE",
        procedimentoUfficio: false,
        comunicazioneAvvioInviata: true,
        dataComunicazioneAvvio: new Date("2026-01-21T00:00:00.000Z"),
        termineMemorieGiorni: 15,
        termineMemorieScadenza: new Date("2026-02-05T00:00:00.000Z"),
        memorieRicevute: true,
        dataRicezioneMemorie: new Date("2026-02-04T00:00:00.000Z"),
        audizioneRichiesta: true,
        audizioneSvolta: true,
        dataAudizione: new Date("2026-02-06T00:00:00.000Z"),
        contestazioneFormaleInviata: true,
        dataContestazioneFormale: new Date("2026-01-22T00:00:00.000Z"),
        controdeduzioniValutate: true,
        propostaEsitoIstruttorio: "DIFFIDA",
        preavvisoRigettoApplicabile: true,
        statoPreavvisoRigetto: "OSSERVAZIONI_RICEVUTE",
        dataPreavvisoRigetto: new Date("2026-01-25T00:00:00.000Z"),
        termineOsservazioniPreavviso: new Date("2026-02-10T00:00:00.000Z"),
        osservazioniPreavvisoRicevute: true,
        dataOsservazioniPreavviso: new Date("2026-02-08T00:00:00.000Z"),
        valutazioneOsservazioniPreavviso: "Osservazioni in valutazione.",
        checklistContraddittorioCompleta: true,
        noteChecklistContraddittorio: "Checklist completa",
      },
    ],
    sopralluoghiRecenti: [
      {
        id: "sop-1",
        data: new Date("2026-02-01T00:00:00.000Z"),
        esito: "CON_RILIEVI",
        operatori: "Squadra A",
        conformitaPlanimetrica: false,
        statoManutentivo: "Da migliorare",
        sicurezza: "Parzialmente conforme",
        occupazione: "Regolare",
        interferenze: "Limitate",
        descrizione: "Prescrizioni manutentive",
      },
    ],
    documentiPrincipali: [],
  };

  return {
    ...base,
    ...overrides,
  };
}

describe("report pdf service", () => {
  it("compone un nome file istituzionale", () => {
    expect(buildReportPdfFileName("abc123")).toBe("report-istituzionale-abc123.pdf");
  });

  it("genera un buffer PDF non vuoto", async () => {
    const detail = createReportDetailFixture();
    const norme = [
      {
        codice: "ART47",
        titolo: "Decadenza della concessione",
        ambito: "DEMANIO",
        severita: "ALTA",
        descrizione: "Rilevanza elevata in caso di morosita reiterata.",
      },
    ];

    const buffer = await renderInstitutionalReportPdf({
      detail,
      norme,
      generatedAt: new Date("2026-02-12T09:00:00.000Z"),
    });

    expect(buffer.length).toBeGreaterThan(3500);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("gestisce report senza concessione collegata", async () => {
    const detail = createReportDetailFixture({
      concessione: null,
      concessionario: null,
    });

    const buffer = await renderInstitutionalReportPdf({
      detail,
      norme: [],
    });

    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("non esplode con campi null/undefined", async () => {
    const detail = createReportDetailFixture({
      report: {
        ...createReportDetailFixture().report,
        contenuto: "",
      },
      criticitaAperte: [
        {
          ...createReportDetailFixture().criticitaAperte[0],
          descrizione: "",
          letteraArt47: null,
          rischioDecadenza: null,
          motivazioneArt47: null,
          azioneIstruttoriaArt47: null,
          dataRegolarizzazione: null,
          descrizioneRegolarizzazione: null,
          esitoRegolarizzazione: null,
          dataVerificaRegolarizzazione: null,
          noteVerificaRegolarizzazione: null,
        },
      ],
      procedimentiInCorso: [
        {
          ...createReportDetailFixture().procedimentiInCorso[0],
          riferimentoNormativo: null,
          dataAvvio: null,
          dataScadenzaContraddittorio: null,
          dataComunicazioneAvvio: null,
          termineMemorieGiorni: null,
          termineMemorieScadenza: null,
          dataRicezioneMemorie: null,
          dataAudizione: null,
          dataContestazioneFormale: null,
          propostaEsitoIstruttorio: null,
          dataPreavvisoRigetto: null,
          termineOsservazioniPreavviso: null,
          dataOsservazioniPreavviso: null,
          valutazioneOsservazioniPreavviso: null,
          noteChecklistContraddittorio: null,
        },
      ],
    });

    const buffer = await renderInstitutionalReportPdf({ detail, norme: [] });
    expect(buffer.length).toBeGreaterThan(2500);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});

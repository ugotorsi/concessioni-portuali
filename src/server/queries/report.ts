import { startOfMonth } from "date-fns";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";

export const REPORT_TIPOLOGIA_VALUES = [
  "REPORT_MENSILE",
  "REPORT_CRITICITA",
  "REPORT_MOROSITA",
  "REPORT_SCADENZE",
  "SCHEDA_CONCESSIONE",
  "SCHEDA_CRITICITA",
  "DOSSIER_ISTRUTTORIO",
  "RELAZIONE_TECNICA",
  "RELAZIONE_ECONOMICA",
  "PROPOSTA_BANDO",
  "ALTRO",
] as const;

export const REPORT_VALIDATO_VALUES = ["SI", "NO", "TUTTI"] as const;

export type ReportTipologiaValue = (typeof REPORT_TIPOLOGIA_VALUES)[number];
export type ReportValidatoValue = (typeof REPORT_VALIDATO_VALUES)[number];

export interface GetReportListParams {
  search?: string;
  tipologia?: ReportTipologiaValue;
  validato?: ReportValidatoValue;
  concessioneId?: string;
}

export interface ReportListItem {
  id: string;
  tipologia: string;
  titolo: string;
  formato: string;
  validato: boolean;
  createdAt: Date;
  updatedAt: Date;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    ubicazione: string | null;
    concessionario: {
      denominazione: string;
    };
  } | null;
}

export interface GetReportListResult {
  items: ReportListItem[];
}

export interface ReportFiltersData {
  concessioni: Array<{ id: string; label: string }>;
  tipologie: Array<{ value: ReportTipologiaValue; label: string }>;
  validato: Array<{ value: ReportValidatoValue; label: string }>;
}

export interface ReportDashboardSummary {
  totaleReport: number;
  reportValidati: number;
  reportNonValidati: number;
  reportMensili: number;
  dossierIstruttori: number;
  reportCriticita: number;
  reportMorosita: number;
  proposteBando: number;
}

export interface ReportPreviewOperativo {
  finalita: string;
  destinatarioOperativo: string;
  utilizzoConsigliato: string;
  avvertenza: string;
}

export interface ReportDetail {
  report: {
    id: string;
    tipologia: string;
    titolo: string;
    contenuto: string;
    formato: string;
    validato: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataRilascio: Date;
    dataScadenza: Date;
    tipologiaBene: string;
    attivita: string;
    canoneAnnuo: number | null;
    categoriaCanone: string | null;
    ubicazione: string | null;
    descrizioneBene: string | null;
  } | null;
  concessionario: {
    id: string;
    denominazione: string;
    codiceFiscale: string | null;
    partitaIva: string | null;
    sedeLegale: string | null;
    pec: string | null;
    email: string | null;
  } | null;
  criticitaAperte: Array<{
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    dataRilevazione: Date;
  }>;
  scadenzeRilevanti: Array<{
    id: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    descrizione: string | null;
  }>;
  pagamentiCritici: Array<{
    id: string;
    annoRiferimento: number;
    importoDovuto: number;
    importoVersato: number;
    residuo: number;
    stato: string;
    dataScadenza: Date;
  }>;
  procedimentiInCorso: Array<{
    id: string;
    tipologia: string;
    stato: string;
    riferimentoNormativo: string | null;
    dataAvvio: Date | null;
    dataScadenzaContraddittorio: Date | null;
  }>;
  sopralluoghiRecenti: Array<{
    id: string;
    data: Date;
    esito: string;
    operatori: string;
    conformitaPlanimetrica: boolean;
    descrizione: string | null;
  }>;
  documentiPrincipali: Array<{
    id: string;
    nome: string;
    tipologia: string;
    url: string;
    dataDocumento: Date | null;
    createdAt: Date;
  }>;
}

function buildWhere(params: GetReportListParams): Prisma.ReportWhereInput {
  const search = params.search?.trim();

  return {
    ...(search
      ? {
          OR: [
            { titolo: { contains: search } },
            { contenuto: { contains: search } },
            { formato: { contains: search } },
            { concessione: { is: { numeroAtto: { contains: search } } } },
            { concessione: { is: { ubicazione: { contains: search } } } },
            { concessione: { is: { concessionario: { denominazione: { contains: search } } } } },
          ],
        }
      : {}),
    ...(params.tipologia ? { tipologia: params.tipologia } : {}),
    ...(params.validato === "SI"
      ? { validato: true }
      : params.validato === "NO"
        ? { validato: false }
        : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
  };
}

function tipologiaPriority(tipologia: string): number {
  if (tipologia === "DOSSIER_ISTRUTTORIO") {
    return 0;
  }
  if (tipologia === "REPORT_MOROSITA") {
    return 1;
  }
  if (tipologia === "PROPOSTA_BANDO") {
    return 2;
  }
  if (tipologia === "REPORT_CRITICITA") {
    return 3;
  }
  return 4;
}

export async function getReportList(params: GetReportListParams): Promise<GetReportListResult> {
  const rows = await prisma.report.findMany({
    where: buildWhere(params),
    select: {
      id: true,
      tipologia: true,
      titolo: true,
      formato: true,
      validato: true,
      createdAt: true,
      updatedAt: true,
      concessione: {
        select: {
          id: true,
          numeroAtto: true,
          stato: true,
          ubicazione: true,
          concessionario: {
            select: {
              denominazione: true,
            },
          },
        },
      },
    },
  });

  const items = rows
    .map((row) => ({
      id: row.id,
      tipologia: row.tipologia,
      titolo: row.titolo,
      formato: row.formato,
      validato: row.validato,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      concessione: row.concessione
        ? {
            id: row.concessione.id,
            numeroAtto: row.concessione.numeroAtto,
            stato: row.concessione.stato,
            ubicazione: row.concessione.ubicazione,
            concessionario: {
              denominazione: row.concessione.concessionario.denominazione,
            },
          }
        : null,
    }))
    .sort((a, b) => {
      const byValidato = Number(a.validato) - Number(b.validato);
      if (byValidato !== 0) {
        return byValidato;
      }

      const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime();
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }

      const byTipologia = tipologiaPriority(a.tipologia) - tipologiaPriority(b.tipologia);
      if (byTipologia !== 0) {
        return byTipologia;
      }

      return a.tipologia.localeCompare(b.tipologia);
    });

  return { items };
}

export async function getReportDetail(id: string): Promise<ReportDetail | null> {
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      concessione: {
        include: {
          concessionario: {
            select: {
              id: true,
              denominazione: true,
              codiceFiscale: true,
              partitaIva: true,
              sedeLegale: true,
              pec: true,
              email: true,
            },
          },
          criticita: {
            where: { stato: { in: ["APERTA", "IN_GESTIONE"] } },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            take: 12,
          },
          scadenze: {
            where: { stato: { in: ["APERTA", "SCADUTA"] } },
            orderBy: [{ dataScadenza: "asc" }],
            take: 12,
          },
          pagamenti: {
            where: { stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] } },
            orderBy: [{ dataScadenza: "asc" }],
            take: 12,
          },
          procedimenti: {
            where: { stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
            orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
            take: 12,
          },
          sopralluoghi: {
            orderBy: [{ data: "desc" }],
            take: 8,
          },
          documenti: {
            orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
            take: 12,
          },
        },
      },
    },
  });

  if (!report) {
    return null;
  }

  const concessione = report.concessione
    ? {
        id: report.concessione.id,
        numeroAtto: report.concessione.numeroAtto,
        stato: report.concessione.stato,
        dataRilascio: report.concessione.dataRilascio,
        dataScadenza: report.concessione.dataScadenza,
        tipologiaBene: report.concessione.tipologiaBene,
        attivita: report.concessione.attivita,
        canoneAnnuo: report.concessione.canoneAnnuo !== null ? Number(report.concessione.canoneAnnuo) : null,
        categoriaCanone: report.concessione.categoriaCanone,
        ubicazione: report.concessione.ubicazione,
        descrizioneBene: report.concessione.descrizioneBene,
      }
    : null;

  const concessionario = report.concessione
    ? {
        id: report.concessione.concessionario.id,
        denominazione: report.concessione.concessionario.denominazione,
        codiceFiscale: report.concessione.concessionario.codiceFiscale,
        partitaIva: report.concessione.concessionario.partitaIva,
        sedeLegale: report.concessione.concessionario.sedeLegale,
        pec: report.concessione.concessionario.pec,
        email: report.concessione.concessionario.email,
      }
    : null;

  return {
    report: {
      id: report.id,
      tipologia: report.tipologia,
      titolo: report.titolo,
      contenuto: report.contenuto,
      formato: report.formato,
      validato: report.validato,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    },
    concessione,
    concessionario,
    criticitaAperte:
      report.concessione?.criticita.map((item) => ({
        id: item.id,
        tipologia: item.tipologia,
        gravita: item.gravita,
        stato: item.stato,
        descrizione: item.descrizione,
        dataRilevazione: item.dataRilevazione,
      })) ?? [],
    scadenzeRilevanti:
      report.concessione?.scadenze.map((item) => ({
        id: item.id,
        tipologia: item.tipologia,
        stato: item.stato,
        dataScadenza: item.dataScadenza,
        descrizione: item.descrizione,
      })) ?? [],
    pagamentiCritici:
      report.concessione?.pagamenti.map((item) => {
        const importoDovuto = Number(item.importoDovuto);
        const importoVersato = Number(item.importoVersato);

        return {
          id: item.id,
          annoRiferimento: item.annoRiferimento,
          importoDovuto,
          importoVersato,
          residuo: Math.max(importoDovuto - importoVersato, 0),
          stato: item.stato,
          dataScadenza: item.dataScadenza,
        };
      }) ?? [],
    procedimentiInCorso:
      report.concessione?.procedimenti.map((item) => ({
        id: item.id,
        tipologia: item.tipologia,
        stato: item.stato,
        riferimentoNormativo: item.riferimentoNormativo,
        dataAvvio: item.dataAvvio,
        dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
      })) ?? [],
    sopralluoghiRecenti:
      report.concessione?.sopralluoghi.map((item) => ({
        id: item.id,
        data: item.data,
        esito: item.esito,
        operatori: item.operatori,
        conformitaPlanimetrica: item.conformitaPlanimetrica,
        descrizione: item.descrizione,
      })) ?? [],
    documentiPrincipali:
      report.concessione?.documenti.map((item) => ({
        id: item.id,
        nome: item.nome,
        tipologia: item.tipologia,
        url: item.url,
        dataDocumento: item.dataDocumento,
        createdAt: item.createdAt,
      })) ?? [],
  };
}

export async function getReportFilters(): Promise<ReportFiltersData> {
  const concessioni = await prisma.concessione.findMany({
    orderBy: [{ dataScadenza: "asc" }],
    select: {
      id: true,
      numeroAtto: true,
      concessionario: {
        select: {
          denominazione: true,
        },
      },
    },
  });

  return {
    concessioni: concessioni.map((item) => ({
      id: item.id,
      label: `${item.numeroAtto} - ${item.concessionario.denominazione}`,
    })),
    tipologie: REPORT_TIPOLOGIA_VALUES.map((value) => ({
      value,
      label: formatEnumLabel(value),
    })),
    validato: [
      { value: "TUTTI", label: "Tutti" },
      { value: "SI", label: "Si" },
      { value: "NO", label: "No" },
    ],
  };
}

export async function getReportDashboardSummary(): Promise<ReportDashboardSummary> {
  const monthStart = startOfMonth(new Date());

  const [
    totaleReport,
    reportValidati,
    reportNonValidati,
    reportMensili,
    dossierIstruttori,
    reportCriticita,
    reportMorosita,
    proposteBando,
  ] = await Promise.all([
    prisma.report.count(),
    prisma.report.count({ where: { validato: true } }),
    prisma.report.count({ where: { validato: false } }),
    prisma.report.count({ where: { tipologia: "REPORT_MENSILE", createdAt: { gte: monthStart } } }),
    prisma.report.count({ where: { tipologia: "DOSSIER_ISTRUTTORIO" } }),
    prisma.report.count({ where: { tipologia: "REPORT_CRITICITA" } }),
    prisma.report.count({ where: { tipologia: "REPORT_MOROSITA" } }),
    prisma.report.count({ where: { tipologia: "PROPOSTA_BANDO" } }),
  ]);

  return {
    totaleReport,
    reportValidati,
    reportNonValidati,
    reportMensili,
    dossierIstruttori,
    reportCriticita,
    reportMorosita,
    proposteBando,
  };
}

export function getReportPreviewOperativo(report: {
  tipologia: string;
  validato: boolean;
}): ReportPreviewOperativo {
  const avvertenza =
    "Output istruttorio interno della societa a supporto dell Autorita, non provvedimento amministrativo.";

  switch (report.tipologia) {
    case "REPORT_MENSILE":
      return {
        finalita: "Sintesi periodica dello stato concessorio con evidenza di trend, adempimenti e criticita.",
        destinatarioOperativo: "Coordinamento servizio monitoraggio e direzione operativa.",
        utilizzoConsigliato: "Usare per pianificazione mensile priorita, controllo backlog e assegnazione attivita.",
        avvertenza,
      };
    case "REPORT_CRITICITA":
      return {
        finalita: "Quadro delle anomalie tecniche, giuridiche ed economiche con livelli di gravita.",
        destinatarioOperativo: "Funzioni giuridica, tecnica ed economica.",
        utilizzoConsigliato: "Usare per priorita di intervento, istruttorie e monitoraggio chiusura criticita.",
        avvertenza,
      };
    case "REPORT_MOROSITA":
      return {
        finalita: "Esposizione economica e stato delle azioni di recupero canoni e garanzie.",
        destinatarioOperativo: "Funzione economica e coordinamento procedimenti.",
        utilizzoConsigliato: "Usare per solleciti, diffide, piani di rientro e valutazione recupero coattivo.",
        avvertenza,
      };
    case "REPORT_SCADENZE":
      return {
        finalita: "Agenda operativa adempimenti con termini prossimi e scaduti.",
        destinatarioOperativo: "PM, segreteria tecnica e responsabili di area.",
        utilizzoConsigliato: "Usare per prevenire ritardi su concessioni, polizze, cauzioni e termini procedimentali.",
        avvertenza,
      };
    case "SCHEDA_CONCESSIONE":
      return {
        finalita: "Fascicolo sintetico del rapporto concessorio con quadro anagrafico e stato attuale.",
        destinatarioOperativo: "Istruttori e referenti concessioni.",
        utilizzoConsigliato: "Usare come vista unificata per briefing e consultazioni operative.",
        avvertenza,
      };
    case "SCHEDA_CRITICITA":
      return {
        finalita: "Scheda istruttoria focalizzata su singola anomalia e relativi impatti.",
        destinatarioOperativo: "Istruttori tecnici e giuridici.",
        utilizzoConsigliato: "Usare per documentare stato, evidenze e azioni consigliate su criticita specifica.",
        avvertenza,
      };
    case "DOSSIER_ISTRUTTORIO":
      return {
        finalita: "Raccolta organica di elementi a supporto di procedimento conseguente.",
        destinatarioOperativo: "Gruppo istruttorio multidisciplinare.",
        utilizzoConsigliato: "Usare come base documentale per avvio, gestione e proposta conclusiva.",
        avvertenza,
      };
    case "RELAZIONE_TECNICA":
      return {
        finalita: "Verifica stato luoghi su sopralluoghi, conformita e difformita riscontrate.",
        destinatarioOperativo: "Area tecnica e supporto giuridico.",
        utilizzoConsigliato: "Usare per qualificazione tecnica delle risultanze e prescrizioni operative.",
        avvertenza,
      };
    case "RELAZIONE_ECONOMICA":
      return {
        finalita: "Analisi canoni, residui e garanzie con focus su sostenibilita e rischi.",
        destinatarioOperativo: "Area economica e direzione operativa.",
        utilizzoConsigliato: "Usare per pianificare recupero economico e verificare impatti finanziari.",
        avvertenza,
      };
    case "PROPOSTA_BANDO":
      return {
        finalita: "Definizione elementi base per nuova procedura o avviso di valorizzazione.",
        destinatarioOperativo: "Direzione e uffici preposti alla procedura.",
        utilizzoConsigliato: "Usare per impostare criteri, documentazione e perimetro tecnico-economico.",
        avvertenza,
      };
    default:
      return {
        finalita: "Output descrittivo a supporto del monitoraggio concessorio.",
        destinatarioOperativo: "Servizio monitoraggio concessioni.",
        utilizzoConsigliato: report.validato
          ? "Usare come riferimento operativo consolidato."
          : "Completare revisione interna prima di diffusione operativa.",
        avvertenza,
      };
  }
}

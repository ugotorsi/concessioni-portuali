import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/prisma";

function hasNormativaDelegates(): boolean {
  const runtimePrisma = prisma as unknown as Record<string, unknown>;
  return Boolean(runtimePrisma.normaFonte && runtimePrisma.normaVersione);
}

export interface DashboardSummary {
  totaleConcessioni: number;
  concessioniAttive: number;
  concessioniInScadenza90: number;
  criticitaAperte: number;
  criticitaUrgenti: number;
  morositaAperte: number;
  pagamentiCritici: number;
  procedimentiInCorso: number;
  garanziePolizzeCritiche: number;
  fontiNormative: number;
  versioniNormativeInConsultazione: number;
}

export interface DashboardCriticitaItem {
  id: string;
  gravita: string;
  tipologia: string;
  concessione: string;
  descrizione: string;
  riferimentoNormativo: string | null;
  stato: string;
  dataRilevazione: Date;
}

export interface DashboardScadenzaItem {
  id: string;
  data: Date;
  tipologia: string;
  concessione: string;
  stato: string;
  giorniDelta: number;
}

export interface DashboardPagamentoItem {
  id: string;
  concessione: string;
  anno: number;
  importoDovuto: number;
  importoVersato: number;
  residuo: number;
  stato: string;
  dataScadenza: Date;
}

export interface DashboardProcedimentoItem {
  id: string;
  tipologia: string;
  concessione: string;
  stato: string;
  termineContraddittorio: Date | null;
  riferimentoNormativo: string | null;
}

export interface DashboardData {
  summary: DashboardSummary;
  criticitaPrioritarie: DashboardCriticitaItem[];
  scadenzeImminenti: DashboardScadenzaItem[];
  pagamentiCritici: DashboardPagamentoItem[];
  procedimentiInCorso: DashboardProcedimentoItem[];
  azioniConsigliate: string[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const oggi = startOfDay(new Date());
  const in90Giorni = addDays(oggi, 90);
  const in60Giorni = addDays(oggi, 60);
  const normativaEnabled = hasNormativaDelegates();

  const [
    totaleConcessioni,
    concessioniAttive,
    concessioniInScadenza90,
    criticitaAperte,
    criticitaUrgenti,
    morositaAperte,
    pagamentiCritici,
    procedimentiInCorsoCount,
    garanziePolizzeCritiche,
    fontiNormative,
    versioniNormativeInConsultazione,
    criticitaPrioritarieRows,
    scadenzeImminentiRows,
    pagamentiCriticiRows,
    procedimentiRows,
  ] = await Promise.all([
    prisma.concessione.count(),
    prisma.concessione.count({ where: { stato: "ATTIVA" } }),
    prisma.concessione.count({
      where: {
        dataScadenza: {
          gte: oggi,
          lte: in90Giorni,
        },
      },
    }),
    prisma.criticita.count({ where: { stato: { in: ["APERTA", "IN_GESTIONE"] } } }),
    prisma.criticita.count({
      where: {
        gravita: "URGENTE",
        stato: { in: ["APERTA", "IN_GESTIONE"] },
      },
    }),
    prisma.criticita.count({
      where: {
        tipologia: "MOROSITA",
        stato: { in: ["APERTA", "IN_GESTIONE"] },
      },
    }),
    prisma.pagamento.count({
      where: {
        stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] },
      },
    }),
    prisma.procedimento.count({
      where: {
        stato: "IN_CORSO",
      },
    }),
    prisma.scadenza.count({
      where: {
        tipologia: {
          in: ["POLIZZA", "FIDEIUSSIONE", "CAUZIONE"],
        },
        OR: [
          { stato: "SCADUTA" },
          {
            stato: "APERTA",
            dataScadenza: {
              lte: in60Giorni,
            },
          },
        ],
      },
    }),
    normativaEnabled ? prisma.normaFonte.count() : Promise.resolve(0),
    normativaEnabled ? prisma.normaVersione.count({ where: { stato: "IN_CONSULTAZIONE" } }) : Promise.resolve(0),
    prisma.criticita.findMany({
      where: {
        stato: { in: ["APERTA", "IN_GESTIONE"] },
      },
      orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
      take: 6,
      select: {
        id: true,
        gravita: true,
        tipologia: true,
        descrizione: true,
        riferimentoNormativo: true,
        stato: true,
        dataRilevazione: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
    prisma.scadenza.findMany({
      where: {
        stato: {
          in: ["APERTA", "SCADUTA"],
        },
      },
      orderBy: [{ dataScadenza: "asc" }],
      take: 8,
      select: {
        id: true,
        dataScadenza: true,
        tipologia: true,
        stato: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
    prisma.pagamento.findMany({
      where: {
        stato: {
          in: ["NON_PAGATO", "PARZIALE", "SCADUTO"],
        },
      },
      orderBy: [{ dataScadenza: "asc" }],
      select: {
        id: true,
        annoRiferimento: true,
        importoDovuto: true,
        importoVersato: true,
        stato: true,
        dataScadenza: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
    prisma.procedimento.findMany({
      where: {
        stato: {
          in: ["DA_AVVIARE", "IN_CORSO"],
        },
      },
      orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
      take: 5,
      select: {
        id: true,
        tipologia: true,
        stato: true,
        riferimentoNormativo: true,
        dataScadenzaContraddittorio: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
    }),
  ]);

  const criticitaPrioritarie: DashboardCriticitaItem[] = criticitaPrioritarieRows.map((item) => ({
    id: item.id,
    gravita: item.gravita,
    tipologia: item.tipologia,
    concessione: item.concessione.numeroAtto,
    descrizione: item.descrizione,
    riferimentoNormativo: item.riferimentoNormativo,
    stato: item.stato,
    dataRilevazione: item.dataRilevazione,
  }));

  const scadenzeImminenti: DashboardScadenzaItem[] = scadenzeImminentiRows.map((item) => ({
    id: item.id,
    data: item.dataScadenza,
    tipologia: item.tipologia,
    concessione: item.concessione.numeroAtto,
    stato: item.stato,
    giorniDelta: differenceInCalendarDays(item.dataScadenza, oggi),
  }));

  const pagamentiCriticiData: DashboardPagamentoItem[] = pagamentiCriticiRows.map((item) => {
    const dovuto = Number(item.importoDovuto);
    const versato = Number(item.importoVersato);

    return {
      id: item.id,
      concessione: item.concessione.numeroAtto,
      anno: item.annoRiferimento,
      importoDovuto: dovuto,
      importoVersato: versato,
      residuo: Math.max(dovuto - versato, 0),
      stato: item.stato,
      dataScadenza: item.dataScadenza,
    };
  });

  const procedimentiInCorso: DashboardProcedimentoItem[] = procedimentiRows.map((item) => ({
    id: item.id,
    tipologia: item.tipologia,
    concessione: item.concessione.numeroAtto,
    stato: item.stato,
    termineContraddittorio: item.dataScadenzaContraddittorio,
    riferimentoNormativo: item.riferimentoNormativo,
  }));

  const azioniConsigliate: string[] = [];

  if (criticitaUrgenti > 0) {
    azioniConsigliate.push(
      "Attivare verifica immediata delle schede istruttorie per le criticità urgenti aperte.",
    );
  }

  if (pagamentiCritici > 0) {
    azioniConsigliate.push(
      "Valutare azioni di recupero canoni o avvio diffida sulle posizioni con pagamenti scaduti/non pagati.",
    );
  }

  if (concessioniInScadenza90 > 0) {
    azioniConsigliate.push(
      "Programmare rinnovi o nuova procedura per le concessioni in scadenza entro 90 giorni.",
    );
  }

  if (garanziePolizzeCritiche > 0) {
    azioniConsigliate.push(
      "Richiedere aggiornamento tempestivo di polizze e fideiussioni in scadenza o già scadute.",
    );
  }

  if (azioniConsigliate.length === 0) {
    azioniConsigliate.push(
      "Nessuna criticità prioritaria rilevata: il quadro operativo corrente risulta sotto controllo.",
    );
  }

  return {
    summary: {
      totaleConcessioni,
      concessioniAttive,
      concessioniInScadenza90,
      criticitaAperte,
      criticitaUrgenti,
      morositaAperte,
      pagamentiCritici,
      procedimentiInCorso: procedimentiInCorsoCount,
      garanziePolizzeCritiche,
      fontiNormative,
      versioniNormativeInConsultazione,
    },
    criticitaPrioritarie,
    scadenzeImminenti,
    pagamentiCritici: pagamentiCriticiData,
    procedimentiInCorso,
    azioniConsigliate,
  };
}

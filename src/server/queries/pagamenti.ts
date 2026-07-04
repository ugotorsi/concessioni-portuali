import { differenceInCalendarDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

export const PAGAMENTO_STATO_VALUES = ["PAGATO", "PARZIALE", "NON_PAGATO", "SCADUTO"] as const;

export const PAGAMENTI_CRITICITA_VALUES = [
  "SOLO_CRITICI",
  "MOROSITA",
  "PARZIALI",
  "SCADUTI",
] as const;

export type PagamentoStatoValue = (typeof PAGAMENTO_STATO_VALUES)[number];
export type PagamentiCriticitaFilter = (typeof PAGAMENTI_CRITICITA_VALUES)[number];

export interface GetPagamentiListParams {
  search?: string;
  stato?: PagamentoStatoValue;
  anno?: number;
  concessioneId?: string;
  concessionarioId?: string;
  criticita?: PagamentiCriticitaFilter;
}

export interface PagamentoListItem {
  id: string;
  annoRiferimento: number;
  importoDovuto: number;
  importoVersato: number;
  residuo: number;
  dataScadenza: Date;
  dataVersamento: Date | null;
  stato: string;
  interessiMora: number | null;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataScadenza: Date;
    ubicazione: string | null;
    concessionario: {
      denominazione: string;
    };
  };
  giorniRitardo: number | null;
}

export interface GetPagamentiListResult {
  items: PagamentoListItem[];
}

export interface PagamentiSummary {
  totaleDovuto: number;
  totaleVersato: number;
  esposizioneResidua: number;
  pagamentiCritici: number;
  pagamentiScadutiONonPagati: number;
  pagamentiParziali: number;
  concessioniConMorosita: number;
}

export interface PagamentiFiltersData {
  concessioni: Array<{ id: string; label: string }>;
  concessionari: Array<{ id: string; denominazione: string }>;
  anni: number[];
  stati: Array<{ value: PagamentoStatoValue; label: string }>;
  criticita: Array<{ value: PagamentiCriticitaFilter; label: string }>;
}

export interface PagamentoDetail {
  pagamento: {
    id: string;
    annoRiferimento: number;
    importoDovuto: number;
    importoVersato: number;
    residuo: number;
    dataScadenza: Date;
    dataVersamento: Date | null;
    stato: string;
    interessiMora: number | null;
    giorniRitardo: number | null;
    note: string | null;
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
  };
  concessionario: {
    id: string;
    denominazione: string;
    codiceFiscale: string | null;
    partitaIva: string | null;
    sedeLegale: string | null;
    pec: string | null;
    email: string | null;
  };
  criticitaEconomicheMorosita: Array<{
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    dataRilevazione: Date;
    riferimentoNormativo: string | null;
  }>;
  scadenzeRilevanti: Array<{
    id: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    descrizione: string | null;
  }>;
  procedimentiCollegati: Array<{
    id: string;
    tipologia: string;
    stato: string;
    riferimentoNormativo: string | null;
    dataAvvio: Date | null;
    dataScadenzaContraddittorio: Date | null;
    dataProvvedimentoFinale: Date | null;
  }>;
  documentiPrincipali: Array<{
    id: string;
    nome: string;
    tipologia: string;
    statoDocumento: string;
    url: string;
    dataDocumento: Date | null;
    createdAt: Date;
  }>;
}

function getCriticitaPagamentoWhere(criticita?: PagamentiCriticitaFilter): Prisma.PagamentoWhereInput {
  switch (criticita) {
    case "SOLO_CRITICI":
      return { OR: [{ stato: "NON_PAGATO" }, { stato: "SCADUTO" }, { stato: "PARZIALE" }] };
    case "MOROSITA":
      return { OR: [{ stato: "NON_PAGATO" }, { stato: "SCADUTO" }] };
    case "PARZIALI":
      return { stato: "PARZIALE" };
    case "SCADUTI":
      return { stato: "SCADUTO" };
    default:
      return {};
  }
}

function paymentPriority(stato: string): number {
  if (stato === "SCADUTO" || stato === "NON_PAGATO") {
    return 0;
  }
  if (stato === "PARZIALE") {
    return 1;
  }
  return 2;
}

function toPagamentoItem(
  item: {
    id: string;
    annoRiferimento: number;
    importoDovuto: Prisma.Decimal;
    importoVersato: Prisma.Decimal;
    dataScadenza: Date;
    dataVersamento: Date | null;
    stato: string;
    interessiMora: Prisma.Decimal | null;
    concessione: {
      id: string;
      numeroAtto: string;
      stato: string;
      dataScadenza: Date;
      ubicazione: string | null;
      concessionario: {
        denominazione: string;
      };
    };
  },
  today: Date,
): PagamentoListItem {
  const importoDovuto = Number(item.importoDovuto);
  const importoVersato = Number(item.importoVersato);
  const residuo = Math.max(importoDovuto - importoVersato, 0);

  const isInRitardo =
    item.stato === "SCADUTO" || item.stato === "NON_PAGATO" || (residuo > 0 && item.dataScadenza < today);

  return {
    id: item.id,
    annoRiferimento: item.annoRiferimento,
    importoDovuto,
    importoVersato,
    residuo,
    dataScadenza: item.dataScadenza,
    dataVersamento: item.dataVersamento,
    stato: item.stato,
    interessiMora: item.interessiMora ? Number(item.interessiMora) : null,
    concessione: item.concessione,
    giorniRitardo: isInRitardo ? Math.abs(differenceInCalendarDays(item.dataScadenza, today)) : null,
  };
}

function buildWhere(params: GetPagamentiListParams): Prisma.PagamentoWhereInput {
  const search = params.search?.trim();

  return {
    ...(search
      ? {
          OR: [
            { concessione: { numeroAtto: { contains: search } } },
            { concessione: { ubicazione: { contains: search } } },
            { concessione: { concessionario: { denominazione: { contains: search } } } },
          ],
        }
      : {}),
    ...(params.stato ? { stato: params.stato } : {}),
    ...(typeof params.anno === "number" ? { annoRiferimento: params.anno } : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
    ...(params.concessionarioId ? { concessione: { concessionarioId: params.concessionarioId } } : {}),
    ...getCriticitaPagamentoWhere(params.criticita),
  };
}

export async function getPagamentiList(params: GetPagamentiListParams): Promise<GetPagamentiListResult> {
  const today = startOfDay(new Date());
  const where = buildWhere(params);

  const rows = await prisma.pagamento.findMany({
    where,
    select: {
      id: true,
      annoRiferimento: true,
      importoDovuto: true,
      importoVersato: true,
      dataScadenza: true,
      dataVersamento: true,
      stato: true,
      interessiMora: true,
      concessione: {
        select: {
          id: true,
          numeroAtto: true,
          stato: true,
          dataScadenza: true,
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
    .map((item) => toPagamentoItem(item, today))
    .sort((a, b) => {
      const byPriority = paymentPriority(a.stato) - paymentPriority(b.stato);
      if (byPriority !== 0) {
        return byPriority;
      }

      const byScadenza = a.dataScadenza.getTime() - b.dataScadenza.getTime();
      if (byScadenza !== 0) {
        return byScadenza;
      }

      return b.annoRiferimento - a.annoRiferimento;
    });

  return { items };
}

export async function getPagamentiSummary(params: GetPagamentiListParams): Promise<PagamentiSummary> {
  const where = buildWhere(params);

  const rows = await prisma.pagamento.findMany({
    where,
    select: {
      stato: true,
      importoDovuto: true,
      importoVersato: true,
      concessioneId: true,
    },
  });

  let totaleDovuto = 0;
  let totaleVersato = 0;
  let pagamentiCritici = 0;
  let pagamentiScadutiONonPagati = 0;
  let pagamentiParziali = 0;
  const concessioniMorose = new Set<string>();

  for (const item of rows) {
    const dovuto = Number(item.importoDovuto);
    const versato = Number(item.importoVersato);
    const residuo = Math.max(dovuto - versato, 0);

    totaleDovuto += dovuto;
    totaleVersato += versato;

    const isCritico = item.stato === "SCADUTO" || item.stato === "NON_PAGATO" || item.stato === "PARZIALE";
    if (isCritico) {
      pagamentiCritici += 1;
    }

    if (item.stato === "SCADUTO" || item.stato === "NON_PAGATO") {
      pagamentiScadutiONonPagati += 1;
      concessioniMorose.add(item.concessioneId);
    }

    if (item.stato === "PARZIALE") {
      pagamentiParziali += 1;
      if (residuo > 0) {
        concessioniMorose.add(item.concessioneId);
      }
    }
  }

  return {
    totaleDovuto,
    totaleVersato,
    esposizioneResidua: Math.max(totaleDovuto - totaleVersato, 0),
    pagamentiCritici,
    pagamentiScadutiONonPagati,
    pagamentiParziali,
    concessioniConMorosita: concessioniMorose.size,
  };
}

export async function getPagamentiFilters(): Promise<PagamentiFiltersData> {
  const [concessioni, concessionari, anniRows] = await Promise.all([
    prisma.concessione.findMany({
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
    }),
    prisma.concessionario.findMany({
      orderBy: [{ denominazione: "asc" }],
      select: {
        id: true,
        denominazione: true,
      },
    }),
    prisma.pagamento.findMany({
      select: { annoRiferimento: true },
      distinct: ["annoRiferimento"],
      orderBy: [{ annoRiferimento: "desc" }],
    }),
  ]);

  return {
    concessioni: concessioni.map((item) => ({
      id: item.id,
      label: `${item.numeroAtto} - ${item.concessionario.denominazione}`,
    })),
    concessionari,
    anni: anniRows.map((item) => item.annoRiferimento),
    stati: PAGAMENTO_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    criticita: [
      { value: "SOLO_CRITICI", label: "Solo critici" },
      { value: "MOROSITA", label: "Morosita" },
      { value: "PARZIALI", label: "Parziali" },
      { value: "SCADUTI", label: "Scaduti" },
    ],
  };
}

export async function getPagamentoDetail(id: string): Promise<PagamentoDetail | null> {
  const pagamento = await prisma.pagamento.findUnique({
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
            where: {
              OR: [{ tipologia: "ECONOMICA" }, { tipologia: "MOROSITA" }],
            },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            take: 10,
          },
          scadenze: {
            where: {
              OR: [
                { tipologia: "PAGAMENTO_CANONE" },
                { tipologia: "POLIZZA" },
                { tipologia: "FIDEIUSSIONE" },
                { tipologia: "CAUZIONE" },
              ],
            },
            orderBy: [{ dataScadenza: "asc" }],
            take: 12,
          },
          procedimenti: {
            where: {
              OR: [
                { tipologia: "RECUPERO_CANONI" },
                { tipologia: "DIFFIDA" },
                { tipologia: "AVVIO_DECADENZA" },
              ],
            },
            orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
            take: 12,
          },
        },
      },
    },
  });

  if (!pagamento) {
    return null;
  }

  const today = startOfDay(new Date());
  const documentiCollegati = await prisma.documento.findMany({
    where: {
      OR: [{ pagamentoId: pagamento.id }, { concessioneId: pagamento.concessioneId }],
    },
    orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
    take: 20,
    distinct: ["id"],
  });

  const importoDovuto = Number(pagamento.importoDovuto);
  const importoVersato = Number(pagamento.importoVersato);
  const residuo = Math.max(importoDovuto - importoVersato, 0);
  const isInRitardo =
    pagamento.stato === "SCADUTO" ||
    pagamento.stato === "NON_PAGATO" ||
    (pagamento.dataScadenza < today && residuo > 0);

  return {
    pagamento: {
      id: pagamento.id,
      annoRiferimento: pagamento.annoRiferimento,
      importoDovuto,
      importoVersato,
      residuo,
      dataScadenza: pagamento.dataScadenza,
      dataVersamento: pagamento.dataVersamento,
      stato: pagamento.stato,
      interessiMora: pagamento.interessiMora ? Number(pagamento.interessiMora) : null,
      giorniRitardo: isInRitardo ? Math.abs(differenceInCalendarDays(pagamento.dataScadenza, today)) : null,
      note: pagamento.note,
    },
    concessione: {
      id: pagamento.concessione.id,
      numeroAtto: pagamento.concessione.numeroAtto,
      stato: pagamento.concessione.stato,
      dataRilascio: pagamento.concessione.dataRilascio,
      dataScadenza: pagamento.concessione.dataScadenza,
      tipologiaBene: pagamento.concessione.tipologiaBene,
      attivita: pagamento.concessione.attivita,
      canoneAnnuo: pagamento.concessione.canoneAnnuo ? Number(pagamento.concessione.canoneAnnuo) : null,
      categoriaCanone: pagamento.concessione.categoriaCanone,
      ubicazione: pagamento.concessione.ubicazione,
    },
    concessionario: pagamento.concessione.concessionario,
    criticitaEconomicheMorosita: pagamento.concessione.criticita.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      dataRilevazione: item.dataRilevazione,
      riferimentoNormativo: item.riferimentoNormativo,
    })),
    scadenzeRilevanti: pagamento.concessione.scadenze.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      descrizione: item.descrizione,
    })),
    procedimentiCollegati: pagamento.concessione.procedimenti.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      dataAvvio: item.dataAvvio,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
      dataProvvedimentoFinale: item.dataProvvedimentoFinale,
    })),
    documentiPrincipali: documentiCollegati.map((item) => ({
      id: item.id,
      nome: item.nome,
      tipologia: item.tipologia,
      statoDocumento: item.statoDocumento,
      url: item.url ?? `/documenti/${item.id}/download`,
      dataDocumento: item.dataDocumento,
      createdAt: item.createdAt,
    })),
  };
}

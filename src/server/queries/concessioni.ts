import { addDays, startOfDay } from "date-fns";

import { formatEnumLabel } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const STATO_CONCESSIONE_VALUES = [
  "ATTIVA",
  "SCADUTA",
  "IN_PROROGA",
  "SOSPESA",
  "REVOCATA",
  "DECADUTA",
  "ARCHIVIATA",
] as const;

export const TIPOLOGIA_BENE_VALUES = [
  "AREA_SCOPERTA",
  "BANCHINA",
  "MOLO",
  "SPECCHIO_ACQUEO",
  "BOX",
  "LOCALE",
  "MANUFATTO",
  "ALTRO",
] as const;

export const ATTIVITA_CONCESSIONE_VALUES = [
  "DIPORTO",
  "COMMERCIALE",
  "TURISTICO_RICREATIVA",
  "LOGISTICA",
  "CANTIERISTICA",
  "SERVIZI_PORTUALI",
  "PASSEGGERI",
  "ALTRO",
] as const;

type StatoConcessioneValue = (typeof STATO_CONCESSIONE_VALUES)[number];
type TipologiaBeneValue = (typeof TIPOLOGIA_BENE_VALUES)[number];
type AttivitaConcessioneValue = (typeof ATTIVITA_CONCESSIONE_VALUES)[number];

export type ConcessioniScadenzaFilter =
  | "SCADUTE"
  | "ENTRO_30_GIORNI"
  | "ENTRO_90_GIORNI"
  | "FUTURE";

export interface GetConcessioniListParams {
  search?: string;
  stato?: StatoConcessioneValue;
  tipologiaBene?: TipologiaBeneValue;
  attivita?: AttivitaConcessioneValue;
  concessionarioId?: string;
  scadenza?: ConcessioniScadenzaFilter;
}

export interface ConcessioneListItem {
  id: string;
  numeroAtto: string;
  dataRilascio: Date;
  dataScadenza: Date;
  stato: string;
  normaRiferimento: string;
  tipologiaBene: string;
  attivita: string;
  superficieMq: number | null;
  canoneAnnuo: number | null;
  ubicazione: string | null;
  concessionarioDenominazione: string;
  criticitaAperteCount: number;
  scadenzeAperteScaduteCount: number;
  pagamentiCriticiCount: number;
  isScaduta: boolean;
  isInScadenza90: boolean;
}

export interface ConcessioniListSummary {
  totale: number;
  attive: number;
  scadute: number;
  inScadenza90: number;
}

export interface GetConcessioniListResult {
  items: ConcessioneListItem[];
  summary: ConcessioniListSummary;
}

export interface ConcessioneDetail {
  id: string;
  numeroAtto: string;
  dataRilascio: Date;
  dataScadenza: Date;
  normaRiferimento: string;
  tipologiaBene: string;
  attivita: string;
  superficieMq: number | null;
  coordinateGis: string | null;
  canoneAnnuo: number | null;
  categoriaCanone: string | null;
  stato: string;
  descrizioneBene: string | null;
  ubicazione: string | null;
  note: string | null;
  concessionario: {
    id: string;
    denominazione: string;
    codiceFiscale: string | null;
    partitaIva: string | null;
    sedeLegale: string | null;
    pec: string | null;
    email: string | null;
    telefono: string | null;
    legaleRappresentante: string | null;
  };
  obblighi: Array<{
    id: string;
    tipologia: string;
    stato: string;
    descrizione: string;
    frequenza: string | null;
    dataProssimaVerifica: Date | null;
  }>;
  scadenze: Array<{
    id: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    preavvisoGiorni: number;
    descrizione: string | null;
  }>;
  criticita: Array<{
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    riferimentoNormativo: string | null;
    dataRilevazione: Date;
  }>;
  pagamenti: Array<{
    id: string;
    annoRiferimento: number;
    importoDovuto: number;
    importoVersato: number;
    residuo: number;
    stato: string;
    dataScadenza: Date;
    dataVersamento: Date | null;
  }>;
  documenti: Array<{
    id: string;
    nome: string;
    tipologia: string;
    url: string;
    dataDocumento: Date | null;
    createdAt: Date;
  }>;
  sopralluoghi: Array<{
    id: string;
    data: Date;
    esito: string;
    operatori: string;
    conformitaPlanimetrica: boolean;
    descrizione: string | null;
  }>;
  procedimenti: Array<{
    id: string;
    tipologia: string;
    stato: string;
    riferimentoNormativo: string | null;
    dataScadenzaContraddittorio: Date | null;
    createdAt: Date;
  }>;
  report: Array<{
    id: string;
    tipologia: string;
    titolo: string;
    formato: string;
    validato: boolean;
    createdAt: Date;
  }>;
}

export interface ConcessioniFiltersData {
  concessionari: Array<{
    id: string;
    denominazione: string;
  }>;
  stati: Array<{ value: string; label: string }>;
  tipologieBene: Array<{ value: string; label: string }>;
  attivita: Array<{ value: string; label: string }>;
  scadenze: Array<{ value: ConcessioniScadenzaFilter; label: string }>;
}

function getScadenzaWhere(scadenza?: ConcessioniScadenzaFilter) {
  const oggi = startOfDay(new Date());
  const in30 = addDays(oggi, 30);
  const in90 = addDays(oggi, 90);

  switch (scadenza) {
    case "SCADUTE":
      return { lt: oggi };
    case "ENTRO_30_GIORNI":
      return { gte: oggi, lte: in30 };
    case "ENTRO_90_GIORNI":
      return { gte: oggi, lte: in90 };
    case "FUTURE":
      return { gt: in90 };
    default:
      return undefined;
  }
}

function getScadenzaPriority(dataScadenza: Date, today: Date): number {
  if (dataScadenza < today) {
    return 0;
  }

  if (dataScadenza <= addDays(today, 90)) {
    return 1;
  }

  return 2;
}

export async function getConcessioniList(
  params: GetConcessioniListParams,
): Promise<GetConcessioniListResult> {
  const today = startOfDay(new Date());
  const in90Days = addDays(today, 90);

  const search = params.search?.trim();
  const scadenzaWhere = getScadenzaWhere(params.scadenza);

  const where: Prisma.ConcessioneWhereInput = {
    ...(search
      ? {
          OR: [
            { numeroAtto: { contains: search } },
            { ubicazione: { contains: search } },
            { descrizioneBene: { contains: search } },
            {
              concessionario: {
                denominazione: { contains: search },
              },
            },
          ],
        }
      : {}),
    ...(params.stato ? { stato: params.stato } : {}),
    ...(params.tipologiaBene ? { tipologiaBene: params.tipologiaBene } : {}),
    ...(params.attivita ? { attivita: params.attivita } : {}),
    ...(params.concessionarioId ? { concessionarioId: params.concessionarioId } : {}),
    ...(scadenzaWhere ? { dataScadenza: scadenzaWhere } : {}),
  };

  const [concessioniRows, summary] = await Promise.all([
    prisma.concessione.findMany({
      where,
      select: {
        id: true,
        numeroAtto: true,
        dataRilascio: true,
        dataScadenza: true,
        stato: true,
        normaRiferimento: true,
        tipologiaBene: true,
        attivita: true,
        superficieMq: true,
        canoneAnnuo: true,
        ubicazione: true,
        concessionario: {
          select: {
            denominazione: true,
          },
        },
      },
    }),
    Promise.all([
      prisma.concessione.count(),
      prisma.concessione.count({ where: { stato: "ATTIVA" } }),
      prisma.concessione.count({ where: { dataScadenza: { lt: today } } }),
      prisma.concessione.count({
        where: {
          dataScadenza: {
            gte: today,
            lte: in90Days,
          },
        },
      }),
    ]),
  ]);

  const concessioneIds = concessioniRows.map((item) => item.id);

  if (concessioneIds.length === 0) {
    return {
      items: [],
      summary: {
        totale: summary[0],
        attive: summary[1],
        scadute: summary[2],
        inScadenza90: summary[3],
      },
    };
  }

  const [criticitaGrouped, scadenzeGrouped, pagamentiGrouped] = await Promise.all([
    prisma.criticita.groupBy({
      by: ["concessioneId"],
      where: {
        concessioneId: { in: concessioneIds },
        stato: { in: ["APERTA", "IN_GESTIONE"] },
      },
      _count: { _all: true },
    }),
    prisma.scadenza.groupBy({
      by: ["concessioneId"],
      where: {
        concessioneId: { in: concessioneIds },
        stato: { in: ["APERTA", "SCADUTA"] },
      },
      _count: { _all: true },
    }),
    prisma.pagamento.groupBy({
      by: ["concessioneId"],
      where: {
        concessioneId: { in: concessioneIds },
        stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] },
      },
      _count: { _all: true },
    }),
  ]);

  const criticitaMap = new Map(criticitaGrouped.map((item) => [item.concessioneId, item._count._all]));
  const scadenzeMap = new Map(scadenzeGrouped.map((item) => [item.concessioneId, item._count._all]));
  const pagamentiMap = new Map(pagamentiGrouped.map((item) => [item.concessioneId, item._count._all]));

  const items = concessioniRows
    .map((item) => {
      const isScaduta = item.dataScadenza < today;
      const isInScadenza90 = item.dataScadenza >= today && item.dataScadenza <= in90Days;

      return {
        id: item.id,
        numeroAtto: item.numeroAtto,
        dataRilascio: item.dataRilascio,
        dataScadenza: item.dataScadenza,
        stato: item.stato,
        normaRiferimento: item.normaRiferimento,
        tipologiaBene: item.tipologiaBene,
        attivita: item.attivita,
        superficieMq: item.superficieMq ? Number(item.superficieMq) : null,
        canoneAnnuo: item.canoneAnnuo ? Number(item.canoneAnnuo) : null,
        ubicazione: item.ubicazione,
        concessionarioDenominazione: item.concessionario.denominazione,
        criticitaAperteCount: criticitaMap.get(item.id) ?? 0,
        scadenzeAperteScaduteCount: scadenzeMap.get(item.id) ?? 0,
        pagamentiCriticiCount: pagamentiMap.get(item.id) ?? 0,
        isScaduta,
        isInScadenza90,
      } satisfies ConcessioneListItem;
    })
    .sort((a, b) => {
      const priorityDiff = getScadenzaPriority(a.dataScadenza, today) - getScadenzaPriority(b.dataScadenza, today);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.dataScadenza.getTime() - b.dataScadenza.getTime();
    });

  return {
    items,
    summary: {
      totale: summary[0],
      attive: summary[1],
      scadute: summary[2],
      inScadenza90: summary[3],
    },
  };
}

export async function getConcessioneDetail(id: string): Promise<ConcessioneDetail | null> {
  const concessione = await prisma.concessione.findUnique({
    where: { id },
    include: {
      concessionario: true,
      obblighi: {
        orderBy: [{ dataProssimaVerifica: "asc" }, { createdAt: "desc" }],
      },
      scadenze: {
        orderBy: { dataScadenza: "asc" },
      },
      criticita: true,
      pagamenti: {
        orderBy: { annoRiferimento: "desc" },
      },
      documenti: {
        orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
      },
      sopralluoghi: {
        orderBy: { data: "desc" },
      },
      procedimenti: {
        orderBy: { createdAt: "desc" },
      },
      report: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!concessione) {
    return null;
  }

  const gravitaOrder: Record<string, number> = {
    URGENTE: 0,
    ALTA: 1,
    MEDIA: 2,
    BASSA: 3,
  };

  const statoOrder: Record<string, number> = {
    APERTA: 0,
    IN_GESTIONE: 1,
    RISOLTA: 2,
    ARCHIVIATA: 3,
  };

  const criticita = [...concessione.criticita]
    .sort((a, b) => {
      const gravitaDiff = (gravitaOrder[a.gravita] ?? 99) - (gravitaOrder[b.gravita] ?? 99);
      if (gravitaDiff !== 0) {
        return gravitaDiff;
      }

      const statoDiff = (statoOrder[a.stato] ?? 99) - (statoOrder[b.stato] ?? 99);
      if (statoDiff !== 0) {
        return statoDiff;
      }

      return b.dataRilevazione.getTime() - a.dataRilevazione.getTime();
    })
    .map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      riferimentoNormativo: item.riferimentoNormativo,
      dataRilevazione: item.dataRilevazione,
    }));

  return {
    id: concessione.id,
    numeroAtto: concessione.numeroAtto,
    dataRilascio: concessione.dataRilascio,
    dataScadenza: concessione.dataScadenza,
    normaRiferimento: concessione.normaRiferimento,
    tipologiaBene: concessione.tipologiaBene,
    attivita: concessione.attivita,
    superficieMq: concessione.superficieMq ? Number(concessione.superficieMq) : null,
    coordinateGis: concessione.coordinateGis,
    canoneAnnuo: concessione.canoneAnnuo ? Number(concessione.canoneAnnuo) : null,
    categoriaCanone: concessione.categoriaCanone,
    stato: concessione.stato,
    descrizioneBene: concessione.descrizioneBene,
    ubicazione: concessione.ubicazione,
    note: concessione.note,
    concessionario: {
      id: concessione.concessionario.id,
      denominazione: concessione.concessionario.denominazione,
      codiceFiscale: concessione.concessionario.codiceFiscale,
      partitaIva: concessione.concessionario.partitaIva,
      sedeLegale: concessione.concessionario.sedeLegale,
      pec: concessione.concessionario.pec,
      email: concessione.concessionario.email,
      telefono: concessione.concessionario.telefono,
      legaleRappresentante: concessione.concessionario.legaleRappresentante,
    },
    obblighi: concessione.obblighi.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      descrizione: item.descrizione,
      frequenza: item.frequenza,
      dataProssimaVerifica: item.dataProssimaVerifica,
    })),
    scadenze: concessione.scadenze.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      preavvisoGiorni: item.preavvisoGiorni,
      descrizione: item.descrizione,
    })),
    criticita,
    pagamenti: concessione.pagamenti.map((item) => {
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
        dataVersamento: item.dataVersamento,
      };
    }),
    documenti: concessione.documenti.map((item) => ({
      id: item.id,
      nome: item.nome,
      tipologia: item.tipologia,
      url: item.url,
      dataDocumento: item.dataDocumento,
      createdAt: item.createdAt,
    })),
    sopralluoghi: concessione.sopralluoghi.map((item) => ({
      id: item.id,
      data: item.data,
      esito: item.esito,
      operatori: item.operatori,
      conformitaPlanimetrica: item.conformitaPlanimetrica,
      descrizione: item.descrizione,
    })),
    procedimenti: concessione.procedimenti.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
      createdAt: item.createdAt,
    })),
    report: concessione.report.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      titolo: item.titolo,
      formato: item.formato,
      validato: item.validato,
      createdAt: item.createdAt,
    })),
  };
}

export async function getConcessioniFilters(): Promise<ConcessioniFiltersData> {
  const concessionari = await prisma.concessionario.findMany({
    orderBy: { denominazione: "asc" },
    select: {
      id: true,
      denominazione: true,
    },
  });

  return {
    concessionari,
    stati: STATO_CONCESSIONE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    tipologieBene: TIPOLOGIA_BENE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    attivita: ATTIVITA_CONCESSIONE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    scadenze: [
      { value: "SCADUTE", label: "Scadute" },
      { value: "ENTRO_30_GIORNI", label: "Entro 30 giorni" },
      { value: "ENTRO_90_GIORNI", label: "Entro 90 giorni" },
      { value: "FUTURE", label: "Oltre 90 giorni" },
    ],
  };
}

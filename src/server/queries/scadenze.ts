import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import { formatEnumLabel } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import {
  buildTenantConcessioneWhere,
  getCurrentTenantContext,
  isTenantContextConstrained,
  requireTenantAccess,
} from "@/lib/tenant-auth";
import type { Prisma } from "@/generated/prisma/client";

export const SCADENZA_TIPOLOGIA_VALUES = [
  "CONCESSIONE",
  "PAGAMENTO_CANONE",
  "POLIZZA",
  "CAUZIONE",
  "FIDEIUSSIONE",
  "VERIFICA_PERIODICA",
  "SOPRALLUOGO",
  "TERMINE_ADEMPIMENTO",
  "TERMINE_PROCEDIMENTALE",
  "ALTRO",
] as const;

export const SCADENZA_STATO_VALUES = ["APERTA", "GESTITA", "SCADUTA", "ARCHIVIATA"] as const;

export type ScadenzePeriodoFilter =
  | "SCADUTE"
  | "ENTRO_30_GIORNI"
  | "ENTRO_60_GIORNI"
  | "ENTRO_90_GIORNI"
  | "FUTURE";

type ScadenzaTipologiaValue = (typeof SCADENZA_TIPOLOGIA_VALUES)[number];
type ScadenzaStatoValue = (typeof SCADENZA_STATO_VALUES)[number];

export interface GetScadenzeListParams {
  search?: string;
  tipologia?: ScadenzaTipologiaValue;
  stato?: ScadenzaStatoValue;
  concessioneId?: string;
  periodo?: ScadenzePeriodoFilter;
}

export interface ScadenzaListItem {
  id: string;
  tipologia: string;
  dataScadenza: Date;
  preavvisoGiorni: number;
  stato: string;
  descrizione: string | null;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataScadenza: Date;
    concessionarioDenominazione: string;
    ubicazione: string | null;
    tipologiaBene: string;
  };
  giorniResidui: number | null;
  giorniRitardo: number | null;
}

export interface ScadenzeListSummary {
  totale: number;
  scadute: number;
  entro30: number;
  entro60: number;
  entro90: number;
  gestite: number;
}

export interface GetScadenzeListResult {
  items: ScadenzaListItem[];
  summary: ScadenzeListSummary;
}

export interface ScadenzaDetail {
  id: string;
  tipologia: string;
  stato: string;
  dataScadenza: Date;
  preavvisoGiorni: number;
  descrizione: string | null;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataScadenza: Date;
    tipologiaBene: string;
    ubicazione: string | null;
    canoneAnnuo: number | null;
    concessionario: {
      denominazione: string;
      codiceFiscale: string | null;
      partitaIva: string | null;
    };
  };
  criticitaAperte: Array<{
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    dataRilevazione: Date;
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
    dataScadenzaContraddittorio: Date | null;
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

export interface ScadenzeFiltersData {
  concessioni: Array<{ id: string; label: string }>;
  tipologie: Array<{ value: ScadenzaTipologiaValue; label: string }>;
  stati: Array<{ value: ScadenzaStatoValue; label: string }>;
  periodi: Array<{ value: ScadenzePeriodoFilter; label: string }>;
}

function getPeriodWhere(periodo?: ScadenzePeriodoFilter): Prisma.DateTimeFilter | undefined {
  const today = startOfDay(new Date());
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);
  const in90 = addDays(today, 90);

  switch (periodo) {
    case "SCADUTE":
      return { lt: today };
    case "ENTRO_30_GIORNI":
      return { gte: today, lte: in30 };
    case "ENTRO_60_GIORNI":
      return { gte: today, lte: in60 };
    case "ENTRO_90_GIORNI":
      return { gte: today, lte: in90 };
    case "FUTURE":
      return { gt: in90 };
    default:
      return undefined;
  }
}

function scadenzaPriority(dataScadenza: Date, today: Date): number {
  if (dataScadenza < today) {
    return 0;
  }
  if (dataScadenza <= addDays(today, 30)) {
    return 1;
  }
  if (dataScadenza <= addDays(today, 60)) {
    return 2;
  }
  if (dataScadenza <= addDays(today, 90)) {
    return 3;
  }
  return 4;
}

export async function getScadenzeList(params: GetScadenzeListParams): Promise<GetScadenzeListResult> {
  const today = startOfDay(new Date());
  const in30 = addDays(today, 30);
  const in60 = addDays(today, 60);
  const in90 = addDays(today, 90);
  const tenantContext = await getCurrentTenantContext();
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  const hasConcessioneTenantScope = Object.keys(concessioneTenantWhere).length > 0;
  const search = params.search?.trim();
  const periodWhere = getPeriodWhere(params.periodo);

  const where: Prisma.ScadenzaWhereInput = {
    ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
    ...(search
      ? {
          OR: [
            { descrizione: { contains: search } },
            {
              concessione: {
                numeroAtto: { contains: search },
              },
            },
            {
              concessione: {
                ubicazione: { contains: search },
              },
            },
            {
              concessione: {
                concessionario: {
                  denominazione: { contains: search },
                },
              },
            },
          ],
        }
      : {}),
    ...(params.tipologia ? { tipologia: params.tipologia } : {}),
    ...(params.stato ? { stato: params.stato } : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
    ...(periodWhere ? { dataScadenza: periodWhere } : {}),
  };

  const [rows, summary] = await Promise.all([
    prisma.scadenza.findMany({
      where,
      select: {
        id: true,
        tipologia: true,
        dataScadenza: true,
        preavvisoGiorni: true,
        stato: true,
        descrizione: true,
        concessione: {
          select: {
            id: true,
            numeroAtto: true,
            stato: true,
            dataScadenza: true,
            ubicazione: true,
            tipologiaBene: true,
            concessionario: {
              select: {
                denominazione: true,
              },
            },
          },
        },
      },
    }),
    Promise.all([
      prisma.scadenza.count({
        where: hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : undefined,
      }),
      prisma.scadenza.count({
        where: {
          dataScadenza: { lt: today },
          ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
        },
      }),
      prisma.scadenza.count({
        where: {
          dataScadenza: { gte: today, lte: in30 },
          ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
        },
      }),
      prisma.scadenza.count({
        where: {
          dataScadenza: { gte: today, lte: in60 },
          ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
        },
      }),
      prisma.scadenza.count({
        where: {
          dataScadenza: { gte: today, lte: in90 },
          ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
        },
      }),
      prisma.scadenza.count({
        where: {
          stato: "GESTITA",
          ...(hasConcessioneTenantScope ? { concessione: concessioneTenantWhere } : {}),
        },
      }),
    ]),
  ]);

  const items = rows
    .map((item) => {
      const diff = differenceInCalendarDays(item.dataScadenza, today);
      const isScaduta = diff < 0;

      return {
        id: item.id,
        tipologia: item.tipologia,
        dataScadenza: item.dataScadenza,
        preavvisoGiorni: item.preavvisoGiorni,
        stato: item.stato,
        descrizione: item.descrizione,
        concessione: {
          id: item.concessione.id,
          numeroAtto: item.concessione.numeroAtto,
          stato: item.concessione.stato,
          dataScadenza: item.concessione.dataScadenza,
          concessionarioDenominazione: item.concessione.concessionario.denominazione,
          ubicazione: item.concessione.ubicazione,
          tipologiaBene: item.concessione.tipologiaBene,
        },
        giorniResidui: isScaduta ? null : diff,
        giorniRitardo: isScaduta ? Math.abs(diff) : null,
      } satisfies ScadenzaListItem;
    })
    .sort((a, b) => {
      const priorityDiff = scadenzaPriority(a.dataScadenza, today) - scadenzaPriority(b.dataScadenza, today);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.dataScadenza.getTime() - b.dataScadenza.getTime();
    });

  return {
    items,
    summary: {
      totale: summary[0],
      scadute: summary[1],
      entro30: summary[2],
      entro60: summary[3],
      entro90: summary[4],
      gestite: summary[5],
    },
  };
}

export async function getScadenzaDetail(id: string): Promise<ScadenzaDetail | null> {
  const tenantContext = await getCurrentTenantContext();
  const scadenza = await prisma.scadenza.findUnique({
    where: { id },
    include: {
      concessione: {
        include: {
          concessionario: {
            select: {
              denominazione: true,
              codiceFiscale: true,
              partitaIva: true,
            },
          },
          criticita: {
            where: { stato: { in: ["APERTA", "IN_GESTIONE"] } },
            orderBy: [{ gravita: "desc" }, { dataRilevazione: "desc" }],
            take: 10,
          },
          pagamenti: {
            where: { stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] } },
            orderBy: [{ dataScadenza: "asc" }],
            take: 10,
          },
          procedimenti: {
            where: { stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
            orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
            take: 10,
          },
          documenti: {
            orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
            take: 12,
          },
        },
      },
    },
  });

  if (!scadenza) {
    return null;
  }

  if (tenantContext && isTenantContextConstrained(tenantContext)) {
    try {
      requireTenantAccess(tenantContext, scadenza.concessione.enteId, {
        mode: "read",
        allowWhenEnteMissing: true,
      });
    } catch {
      return null;
    }
  }

  return {
    id: scadenza.id,
    tipologia: scadenza.tipologia,
    stato: scadenza.stato,
    dataScadenza: scadenza.dataScadenza,
    preavvisoGiorni: scadenza.preavvisoGiorni,
    descrizione: scadenza.descrizione,
    concessione: {
      id: scadenza.concessione.id,
      numeroAtto: scadenza.concessione.numeroAtto,
      stato: scadenza.concessione.stato,
      dataScadenza: scadenza.concessione.dataScadenza,
      tipologiaBene: scadenza.concessione.tipologiaBene,
      ubicazione: scadenza.concessione.ubicazione,
      canoneAnnuo: scadenza.concessione.canoneAnnuo ? Number(scadenza.concessione.canoneAnnuo) : null,
      concessionario: {
        denominazione: scadenza.concessione.concessionario.denominazione,
        codiceFiscale: scadenza.concessione.concessionario.codiceFiscale,
        partitaIva: scadenza.concessione.concessionario.partitaIva,
      },
    },
    criticitaAperte: scadenza.concessione.criticita.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      dataRilevazione: item.dataRilevazione,
    })),
    pagamentiCritici: scadenza.concessione.pagamenti.map((item) => {
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
    }),
    procedimentiInCorso: scadenza.concessione.procedimenti.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
    })),
    documentiPrincipali: scadenza.concessione.documenti.map((item) => ({
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

export async function getScadenzeFilters(): Promise<ScadenzeFiltersData> {
  const tenantContext = await getCurrentTenantContext();
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  const concessioni = await prisma.concessione.findMany({
    where: concessioneTenantWhere,
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
    tipologie: SCADENZA_TIPOLOGIA_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    stati: SCADENZA_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    periodi: [
      { value: "SCADUTE", label: "Scadute" },
      { value: "ENTRO_30_GIORNI", label: "Entro 30 giorni" },
      { value: "ENTRO_60_GIORNI", label: "Entro 60 giorni" },
      { value: "ENTRO_90_GIORNI", label: "Entro 90 giorni" },
      { value: "FUTURE", label: "Future oltre 90 giorni" },
    ],
  };
}

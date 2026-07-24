import { endOfYear, startOfDay, startOfYear, subDays } from "date-fns";

import { prisma } from "@/lib/prisma";
import {
  buildTenantConcessioneWhere,
  getCurrentTenantContext,
  isTenantContextConstrained,
  requireTenantAccess,
} from "@/lib/tenant-auth";
import { formatEnumLabel } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

export const SOPRALLUOGO_ESITO_VALUES = ["POSITIVO", "CON_RILIEVI", "NEGATIVO"] as const;

export const SOPRALLUOGHI_PERIODO_VALUES = [
  "ULTIMI_30_GIORNI",
  "ULTIMI_90_GIORNI",
  "ANNO_CORRENTE",
  "TUTTI",
] as const;

export type SopralluogoEsitoValue = (typeof SOPRALLUOGO_ESITO_VALUES)[number];
export type SopralluoghiPeriodoValue = (typeof SOPRALLUOGHI_PERIODO_VALUES)[number];

export interface GetSopralluoghiListParams {
  search?: string;
  esito?: SopralluogoEsitoValue;
  concessioneId?: string;
  periodo?: SopralluoghiPeriodoValue;
}

export interface SopralluogoListItem {
  id: string;
  data: Date;
  operatori: string;
  esito: string;
  conformitaPlanimetrica: boolean;
  statoManutentivo: string | null;
  sicurezza: string | null;
  occupazione: string | null;
  interferenze: string | null;
  descrizione: string | null;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    ubicazione: string | null;
    tipologiaBene: string;
    concessionario: {
      denominazione: string;
    };
  };
  criticitaCollegateCount: number;
}

export interface GetSopralluoghiListResult {
  items: SopralluogoListItem[];
}

export interface SopralluoghiFiltersData {
  concessioni: Array<{ id: string; label: string }>;
  esiti: Array<{ value: SopralluogoEsitoValue; label: string }>;
  periodi: Array<{ value: SopralluoghiPeriodoValue; label: string }>;
}

export interface SopralluogoDetail {
  sopralluogo: {
    id: string;
    data: Date;
    operatori: string;
    esito: string;
    conformitaPlanimetrica: boolean;
    latitudineGis: number | null;
    longitudineGis: number | null;
    localizzazioneDescrizione: string | null;
    statoManutentivo: string | null;
    sicurezza: string | null;
    occupazione: string | null;
    interferenze: string | null;
    descrizione: string | null;
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
    ubicazione: string | null;
    latitudineGis: number | null;
    longitudineGis: number | null;
    coordinateGis: string | null;
    areaDescrizione: string | null;
    zonaPortuale: string | null;
    riferimentoCatastale: string | null;
    descrizioneBene: string | null;
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
  criticitaAperte: Array<{
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
  documentiPrincipali: Array<{
    id: string;
    nome: string;
    tipologia: string;
    statoDocumento: string;
    url: string;
    dataDocumento: Date | null;
    createdAt: Date;
  }>;
  procedimentiInCorso: Array<{
    id: string;
    tipologia: string;
    stato: string;
    riferimentoNormativo: string | null;
    dataAvvio: Date | null;
    dataScadenzaContraddittorio: Date | null;
  }>;
}

export interface LetturaTecnicaSopralluogo {
  qualificazioneTecnica: string;
  livelloAttenzione: string;
  azioneConsigliata: string;
  collegamentoCriticita: string;
}

function getPeriodoWhere(periodo?: SopralluoghiPeriodoValue): Prisma.DateTimeFilter | undefined {
  const today = startOfDay(new Date());

  switch (periodo) {
    case "ULTIMI_30_GIORNI":
      return { gte: subDays(today, 30) };
    case "ULTIMI_90_GIORNI":
      return { gte: subDays(today, 90) };
    case "ANNO_CORRENTE":
      return { gte: startOfYear(today), lte: endOfYear(today) };
    case "TUTTI":
    default:
      return undefined;
  }
}

function esitoPriority(esito: string): number {
  if (esito === "NEGATIVO") {
    return 0;
  }
  if (esito === "CON_RILIEVI") {
    return 1;
  }
  return 2;
}

function hasIssueText(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();

  if (lower.includes("ok") || lower.includes("regolare") || lower.includes("nessuna")) {
    return false;
  }

  return [
    "critic",
    "risch",
    "elevat",
    "non conform",
    "difform",
    "manc",
    "inadegu",
    "violaz",
    "interferenz",
    "ostru",
    "sicurez",
    "occupaz",
  ].some((token) => lower.includes(token));
}

function buildWhere(params: GetSopralluoghiListParams): Prisma.SopralluogoWhereInput {
  const search = params.search?.trim();
  const periodoWhere = getPeriodoWhere(params.periodo);

  return {
    ...(search
      ? {
          OR: [
            { operatori: { contains: search } },
            { descrizione: { contains: search } },
            { statoManutentivo: { contains: search } },
            { localizzazioneDescrizione: { contains: search } },
            { sicurezza: { contains: search } },
            { occupazione: { contains: search } },
            { interferenze: { contains: search } },
            { concessione: { numeroAtto: { contains: search } } },
            { concessione: { ubicazione: { contains: search } } },
            { concessione: { concessionario: { denominazione: { contains: search } } } },
          ],
        }
      : {}),
    ...(params.esito ? { esito: params.esito } : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
    ...(periodoWhere ? { data: periodoWhere } : {}),
  };
}

function applyConcessioneTenantScope(
  where: Prisma.SopralluogoWhereInput,
  tenantContext: Awaited<ReturnType<typeof getCurrentTenantContext>>,
): Prisma.SopralluogoWhereInput {
  const concessioneTenantWhere = buildTenantConcessioneWhere(tenantContext);
  if (Object.keys(concessioneTenantWhere).length === 0) {
    return where;
  }

  return {
    AND: [where, { concessione: concessioneTenantWhere }],
  };
}

export async function getSopralluoghiList(
  params: GetSopralluoghiListParams,
): Promise<GetSopralluoghiListResult> {
  const tenantContext = await getCurrentTenantContext();
  const where = applyConcessioneTenantScope(buildWhere(params), tenantContext);

  const rows = await prisma.sopralluogo.findMany({
    where,
    select: {
      id: true,
      data: true,
      operatori: true,
      esito: true,
      conformitaPlanimetrica: true,
      statoManutentivo: true,
      sicurezza: true,
      occupazione: true,
      interferenze: true,
      descrizione: true,
      concessione: {
        select: {
          id: true,
          numeroAtto: true,
          stato: true,
          ubicazione: true,
          tipologiaBene: true,
          _count: {
            select: {
              criticita: true,
            },
          },
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
    .map((item) => ({
      id: item.id,
      data: item.data,
      operatori: item.operatori,
      esito: item.esito,
      conformitaPlanimetrica: item.conformitaPlanimetrica,
      statoManutentivo: item.statoManutentivo,
      sicurezza: item.sicurezza,
      occupazione: item.occupazione,
      interferenze: item.interferenze,
      descrizione: item.descrizione,
      concessione: {
        id: item.concessione.id,
        numeroAtto: item.concessione.numeroAtto,
        stato: item.concessione.stato,
        ubicazione: item.concessione.ubicazione,
        tipologiaBene: item.concessione.tipologiaBene,
        concessionario: {
          denominazione: item.concessione.concessionario.denominazione,
        },
      },
      criticitaCollegateCount: item.concessione._count.criticita,
    }))
    .sort((a, b) => {
      const byEsito = esitoPriority(a.esito) - esitoPriority(b.esito);
      if (byEsito !== 0) {
        return byEsito;
      }

      return b.data.getTime() - a.data.getTime();
    });

  return { items };
}

export async function getSopralluogoDetail(id: string): Promise<SopralluogoDetail | null> {
  const tenantContext = await getCurrentTenantContext();
  const sopralluogo = await prisma.sopralluogo.findUnique({
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
          procedimenti: {
            where: { stato: { in: ["DA_AVVIARE", "IN_CORSO"] } },
            orderBy: [{ dataScadenzaContraddittorio: "asc" }, { createdAt: "desc" }],
            take: 12,
          },
        },
      },
    },
  });

  if (!sopralluogo) {
    return null;
  }

  if (tenantContext && isTenantContextConstrained(tenantContext)) {
    try {
      requireTenantAccess(tenantContext, sopralluogo.concessione.enteId, {
        mode: "read",
        allowWhenEnteMissing: true,
      });
    } catch {
      return null;
    }
  }

  const documentiCollegati = await prisma.documento.findMany({
    where: {
      OR: [{ sopralluogoId: sopralluogo.id }, { concessioneId: sopralluogo.concessioneId }],
    },
    orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
    take: 20,
    distinct: ["id"],
  });

  return {
    sopralluogo: {
      id: sopralluogo.id,
      data: sopralluogo.data,
      operatori: sopralluogo.operatori,
      esito: sopralluogo.esito,
      conformitaPlanimetrica: sopralluogo.conformitaPlanimetrica,
      latitudineGis: sopralluogo.latitudineGis ? Number(sopralluogo.latitudineGis) : null,
      longitudineGis: sopralluogo.longitudineGis ? Number(sopralluogo.longitudineGis) : null,
      localizzazioneDescrizione: sopralluogo.localizzazioneDescrizione,
      statoManutentivo: sopralluogo.statoManutentivo,
      sicurezza: sopralluogo.sicurezza,
      occupazione: sopralluogo.occupazione,
      interferenze: sopralluogo.interferenze,
      descrizione: sopralluogo.descrizione,
      createdAt: sopralluogo.createdAt,
      updatedAt: sopralluogo.updatedAt,
    },
    concessione: {
      id: sopralluogo.concessione.id,
      numeroAtto: sopralluogo.concessione.numeroAtto,
      stato: sopralluogo.concessione.stato,
      dataRilascio: sopralluogo.concessione.dataRilascio,
      dataScadenza: sopralluogo.concessione.dataScadenza,
      tipologiaBene: sopralluogo.concessione.tipologiaBene,
      attivita: sopralluogo.concessione.attivita,
      ubicazione: sopralluogo.concessione.ubicazione,
      latitudineGis: sopralluogo.concessione.latitudineGis ? Number(sopralluogo.concessione.latitudineGis) : null,
      longitudineGis: sopralluogo.concessione.longitudineGis ? Number(sopralluogo.concessione.longitudineGis) : null,
      coordinateGis: sopralluogo.concessione.coordinateGis,
      areaDescrizione: sopralluogo.concessione.areaDescrizione,
      zonaPortuale: sopralluogo.concessione.zonaPortuale,
      riferimentoCatastale: sopralluogo.concessione.riferimentoCatastale,
      descrizioneBene: sopralluogo.concessione.descrizioneBene,
    },
    concessionario: sopralluogo.concessione.concessionario,
    criticitaAperte: sopralluogo.concessione.criticita.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      dataRilevazione: item.dataRilevazione,
      riferimentoNormativo: item.riferimentoNormativo,
    })),
    scadenzeRilevanti: sopralluogo.concessione.scadenze.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      descrizione: item.descrizione,
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
    procedimentiInCorso: sopralluogo.concessione.procedimenti.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      dataAvvio: item.dataAvvio,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
    })),
  };
}

export async function getSopralluoghiFilters(): Promise<SopralluoghiFiltersData> {
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
    esiti: SOPRALLUOGO_ESITO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    periodi: [
      { value: "TUTTI", label: "Tutti" },
      { value: "ULTIMI_30_GIORNI", label: "Ultimi 30 giorni" },
      { value: "ULTIMI_90_GIORNI", label: "Ultimi 90 giorni" },
      { value: "ANNO_CORRENTE", label: "Anno corrente" },
    ],
  };
}

export function getLetturaTecnicaSopralluogo(sopralluogo: {
  esito: string;
  conformitaPlanimetrica: boolean;
  sicurezza: string | null;
  occupazione: string | null;
  interferenze: string | null;
}): LetturaTecnicaSopralluogo {
  const messaggi: string[] = [];

  let qualificazioneTecnica = "Verifica tecnica regolare.";
  let livelloAttenzione = "BASSO";

  if (sopralluogo.esito === "NEGATIVO") {
    qualificazioneTecnica = "Sopralluogo con esito negativo e necessità di presidio tecnico immediato.";
    livelloAttenzione = "ALTO";
    messaggi.push(
      "Trattare il sopralluogo con priorità: valutare apertura/aggiornamento criticità e supporto istruttorio.",
    );
  } else if (sopralluogo.esito === "CON_RILIEVI") {
    qualificazioneTecnica = "Sopralluogo con rilievi che richiede follow-up tecnico.";
    livelloAttenzione = "MEDIO";
    messaggi.push("Programmare follow-up tecnico e verifica puntuale delle prescrizioni.");
  } else {
    messaggi.push("Esito positivo: mantenere tracciamento storico della verifica effettuata.");
  }

  if (!sopralluogo.conformitaPlanimetrica) {
    livelloAttenzione = livelloAttenzione === "ALTO" ? "ALTO" : "MEDIO_ALTO";
    messaggi.push(
      "Conformità planimetrica non positiva: confrontare planimetria e area occupata, con verifica di possibile occupazione difforme.",
    );
  }

  if (hasIssueText(sopralluogo.sicurezza)) {
    livelloAttenzione = "ALTO";
    messaggi.push("Sono emersi profili di sicurezza: attivare verifica urgente delle prescrizioni tecniche.");
  }

  if (hasIssueText(sopralluogo.occupazione)) {
    livelloAttenzione = livelloAttenzione === "BASSO" ? "MEDIO" : livelloAttenzione;
    messaggi.push(
      "Rilievi sull'occupazione: verificare art. 54 cod. nav. e possibile attivazione di criticità tecnica/giuridica.",
    );
  }

  if (hasIssueText(sopralluogo.interferenze)) {
    livelloAttenzione = livelloAttenzione === "BASSO" ? "MEDIO" : livelloAttenzione;
    messaggi.push(
      "Interferenze presenti: verificare coordinamento con altri concessionari e viabilità portuale.",
    );
  }

  if (messaggi.length === 0) {
    messaggi.push("Quadro tecnico regolare sui dati disponibili.");
  }

  return {
    qualificazioneTecnica,
    livelloAttenzione,
    azioneConsigliata: messaggi.join(" "),
    collegamentoCriticita:
      sopralluogo.esito === "NEGATIVO" || !sopralluogo.conformitaPlanimetrica || hasIssueText(sopralluogo.occupazione)
        ? "Valutare apertura o aggiornamento criticità collegate alla concessione."
        : "Nessun collegamento critico immediato emerso dai dati correnti.",
  };
}

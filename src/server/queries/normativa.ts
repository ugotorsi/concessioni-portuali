import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

function hasNormativaDelegates(): boolean {
  const runtimePrisma = prisma as unknown as Record<string, unknown>;
  return Boolean(runtimePrisma.normaFonte && runtimePrisma.normaVersione && runtimePrisma.normaImpatto);
}

export const NORMA_AMBITO_VALUES = [
  "CONCESSIONI",
  "PROCEDIMENTI",
  "CANONI",
  "SICUREZZA",
  "AMBIENTE",
  "DOCUMENTAZIONE",
  "ALTRO",
] as const;

export const NORMA_STATO_VALUES = ["VIGENTE", "SUPERATA", "IN_CONSULTAZIONE"] as const;

export type NormaAmbitoValue = (typeof NORMA_AMBITO_VALUES)[number];
export type NormaStatoValue = (typeof NORMA_STATO_VALUES)[number];

export interface GetNormativaListParams {
  search?: string;
  ambito?: NormaAmbitoValue;
  stato?: NormaStatoValue;
}

export interface NormativaListItem {
  id: string;
  codice: string;
  titolo: string;
  enteEmittente: string | null;
  ambito: string;
  versioneCorrente: string | null;
  statoCorrente: string | null;
  dataEntrataVigore: Date | null;
  impattiCount: number;
}

export interface NormativaListSummary {
  totaleFonti: number;
  versioniVigenti: number;
  versioniInConsultazione: number;
  impattiAperti: number;
}

export interface NormativaFiltersData {
  ambiti: Array<{ value: NormaAmbitoValue; label: string }>;
  stati: Array<{ value: NormaStatoValue; label: string }>;
}

export interface NormativaDetail {
  fonte: {
    id: string;
    codice: string;
    titolo: string;
    enteEmittente: string | null;
    ambito: string;
    descrizione: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  versioni: Array<{
    id: string;
    versione: string;
    stato: string;
    dataEntrataVigore: Date;
    dataFineVigore: Date | null;
    urlTesto: string | null;
    sintesi: string;
    note: string | null;
  }>;
  impatti: Array<{
    id: string;
    modulo: string;
    severita: string;
    descrizione: string;
    azioneRichiesta: string | null;
    concessione: { id: string; numeroAtto: string } | null;
    criticita: { id: string; tipologia: string; stato: string } | null;
    procedimento: { id: string; tipologia: string; stato: string } | null;
    report: { id: string; titolo: string; validato: boolean } | null;
    versione: { id: string; versione: string; stato: string } | null;
  }>;
}

function buildWhere(params: GetNormativaListParams): Prisma.NormaFonteWhereInput {
  const search = params.search?.trim();

  return {
    ...(search
      ? {
          OR: [
            { codice: { contains: search } },
            { titolo: { contains: search } },
            { enteEmittente: { contains: search } },
            { descrizione: { contains: search } },
          ],
        }
      : {}),
    ...(params.ambito ? { ambito: params.ambito } : {}),
    ...(params.stato
      ? {
          versioni: {
            some: {
              stato: params.stato,
            },
          },
        }
      : {}),
  };
}

export async function getNormativaList(params: GetNormativaListParams): Promise<{
  items: NormativaListItem[];
  summary: NormativaListSummary;
}> {
  if (!hasNormativaDelegates()) {
    return {
      items: [],
      summary: {
        totaleFonti: 0,
        versioniVigenti: 0,
        versioniInConsultazione: 0,
        impattiAperti: 0,
      },
    };
  }

  const [rows, totaleFonti, versioniVigenti, versioniInConsultazione, impattiAperti] = await Promise.all([
    prisma.normaFonte.findMany({
      where: buildWhere(params),
      select: {
        id: true,
        codice: true,
        titolo: true,
        enteEmittente: true,
        ambito: true,
        versioni: {
          orderBy: [{ dataEntrataVigore: "desc" }],
          take: 1,
          select: {
            versione: true,
            stato: true,
            dataEntrataVigore: true,
          },
        },
        _count: {
          select: {
            impatti: true,
          },
        },
      },
      orderBy: [{ codice: "asc" }],
    }),
    prisma.normaFonte.count(),
    prisma.normaVersione.count({ where: { stato: "VIGENTE" } }),
    prisma.normaVersione.count({ where: { stato: "IN_CONSULTAZIONE" } }),
    prisma.normaImpatto.count(),
  ]);

  return {
    items: rows.map((item) => ({
      id: item.id,
      codice: item.codice,
      titolo: item.titolo,
      enteEmittente: item.enteEmittente,
      ambito: item.ambito,
      versioneCorrente: item.versioni[0]?.versione ?? null,
      statoCorrente: item.versioni[0]?.stato ?? null,
      dataEntrataVigore: item.versioni[0]?.dataEntrataVigore ?? null,
      impattiCount: item._count.impatti,
    })),
    summary: {
      totaleFonti,
      versioniVigenti,
      versioniInConsultazione,
      impattiAperti,
    },
  };
}

export async function getNormativaFilters(): Promise<NormativaFiltersData> {
  return {
    ambiti: NORMA_AMBITO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    stati: NORMA_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
  };
}

export async function getNormativaDetail(id: string): Promise<NormativaDetail | null> {
  if (!hasNormativaDelegates()) {
    return null;
  }

  const fonte = await prisma.normaFonte.findUnique({
    where: { id },
    include: {
      versioni: {
        orderBy: [{ dataEntrataVigore: "desc" }],
      },
      impatti: {
        orderBy: [{ createdAt: "desc" }],
        include: {
          normaVersione: {
            select: {
              id: true,
              versione: true,
              stato: true,
            },
          },
          concessione: {
            select: {
              id: true,
              numeroAtto: true,
            },
          },
          criticita: {
            select: {
              id: true,
              tipologia: true,
              stato: true,
            },
          },
          procedimento: {
            select: {
              id: true,
              tipologia: true,
              stato: true,
            },
          },
          report: {
            select: {
              id: true,
              titolo: true,
              validato: true,
            },
          },
        },
      },
    },
  });

  if (!fonte) {
    return null;
  }

  return {
    fonte: {
      id: fonte.id,
      codice: fonte.codice,
      titolo: fonte.titolo,
      enteEmittente: fonte.enteEmittente,
      ambito: fonte.ambito,
      descrizione: fonte.descrizione,
      createdAt: fonte.createdAt,
      updatedAt: fonte.updatedAt,
    },
    versioni: fonte.versioni.map((item) => ({
      id: item.id,
      versione: item.versione,
      stato: item.stato,
      dataEntrataVigore: item.dataEntrataVigore,
      dataFineVigore: item.dataFineVigore,
      urlTesto: item.urlTesto,
      sintesi: item.sintesi,
      note: item.note,
    })),
    impatti: fonte.impatti.map((item) => ({
      id: item.id,
      modulo: item.modulo,
      severita: item.severita,
      descrizione: item.descrizione,
      azioneRichiesta: item.azioneRichiesta,
      concessione: item.concessione,
      criticita: item.criticita,
      procedimento: item.procedimento,
      report: item.report,
      versione: item.normaVersione,
    })),
  };
}

export async function getNormeForCriticita(criticitaId: string): Promise<Array<{
  id: string;
  codice: string;
  titolo: string;
  ambito: string;
  severita: string;
  descrizione: string;
}>> {
  if (!hasNormativaDelegates()) {
    return [];
  }

  const rows = await prisma.normaImpatto.findMany({
    where: { criticitaId },
    include: {
      normaFonte: {
        select: {
          id: true,
          codice: true,
          titolo: true,
          ambito: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return rows.map((item) => ({
    id: item.id,
    codice: item.normaFonte.codice,
    titolo: item.normaFonte.titolo,
    ambito: item.normaFonte.ambito,
    severita: item.severita,
    descrizione: item.descrizione,
  }));
}

export async function getNormeForProcedimento(procedimentoId: string): Promise<Array<{
  id: string;
  codice: string;
  titolo: string;
  ambito: string;
  severita: string;
  descrizione: string;
}>> {
  if (!hasNormativaDelegates()) {
    return [];
  }

  const rows = await prisma.normaImpatto.findMany({
    where: { procedimentoId },
    include: {
      normaFonte: {
        select: {
          id: true,
          codice: true,
          titolo: true,
          ambito: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return rows.map((item) => ({
    id: item.id,
    codice: item.normaFonte.codice,
    titolo: item.normaFonte.titolo,
    ambito: item.normaFonte.ambito,
    severita: item.severita,
    descrizione: item.descrizione,
  }));
}

export async function getNormeForReport(reportId: string): Promise<Array<{
  id: string;
  codice: string;
  titolo: string;
  ambito: string;
  severita: string;
  descrizione: string;
}>> {
  if (!hasNormativaDelegates()) {
    return [];
  }

  const rows = await prisma.normaImpatto.findMany({
    where: { reportId },
    include: {
      normaFonte: {
        select: {
          id: true,
          codice: true,
          titolo: true,
          ambito: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return rows.map((item) => ({
    id: item.id,
    codice: item.normaFonte.codice,
    titolo: item.normaFonte.titolo,
    ambito: item.normaFonte.ambito,
    severita: item.severita,
    descrizione: item.descrizione,
  }));
}

import { startOfDay } from "date-fns";

import { formatEnumLabel } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const CRITICITA_TIPOLOGIA_VALUES = [
  "GIURIDICA",
  "TECNICA",
  "ECONOMICA",
  "DOCUMENTALE",
  "MANUTENTIVA",
  "SICUREZZA",
  "OCCUPAZIONE_DIFFORME",
  "USO_NON_CONFORME",
  "MOROSITA",
  "RISCHIO_DECADENZA",
  "RISCHIO_REVOCA",
  "ALTRO",
] as const;

export const CRITICITA_GRAVITA_VALUES = ["URGENTE", "ALTA", "MEDIA", "BASSA"] as const;
export const CRITICITA_STATO_VALUES = ["APERTA", "IN_GESTIONE", "RISOLTA", "ARCHIVIATA"] as const;
export const CRITICITA_FONTE_VALUES = [
  "SOPRALLUOGO",
  "VERIFICA_DOCUMENTALE",
  "SEGNALAZIONE",
  "ALERT_AUTOMATICO",
  "ALTRO",
] as const;

type CriticitaTipologiaValue = (typeof CRITICITA_TIPOLOGIA_VALUES)[number];
type CriticitaGravitaValue = (typeof CRITICITA_GRAVITA_VALUES)[number];
type CriticitaStatoValue = (typeof CRITICITA_STATO_VALUES)[number];
type CriticitaFonteValue = (typeof CRITICITA_FONTE_VALUES)[number];

export interface GetCriticitaListParams {
  search?: string;
  tipologia?: CriticitaTipologiaValue;
  gravita?: CriticitaGravitaValue;
  stato?: CriticitaStatoValue;
  fonte?: CriticitaFonteValue;
  concessioneId?: string;
}

export interface CriticitaListItem {
  id: string;
  tipologia: string;
  gravita: string;
  fonte: string;
  descrizione: string;
  riferimentoNormativo: string | null;
  azioneConsigliata: string | null;
  stato: string;
  dataRilevazione: Date;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataScadenza: Date;
    tipologiaBene: string;
    ubicazione: string | null;
    concessionarioDenominazione: string;
  };
  procedimentiCount: number;
}

export interface CriticitaListSummary {
  totale: number;
  aperte: number;
  urgenti: number;
  alte: number;
  inGestione: number;
  risolte: number;
}

export interface GetCriticitaListResult {
  items: CriticitaListItem[];
  summary: CriticitaListSummary;
}

export interface CriticitaDetail {
  id: string;
  tipologia: string;
  gravita: string;
  fonte: string;
  descrizione: string;
  riferimentoNormativo: string | null;
  azioneConsigliata: string | null;
  stato: string;
  dataRilevazione: Date;
  concessione: {
    id: string;
    numeroAtto: string;
    stato: string;
    dataScadenza: Date;
    tipologiaBene: string;
    ubicazione: string | null;
    canoneAnnuo: number | null;
    categoriaCanone: string | null;
    concessionario: {
      denominazione: string;
      codiceFiscale: string | null;
      partitaIva: string | null;
    };
  };
  procedimenti: Array<{
    id: string;
    tipologia: string;
    stato: string;
    riferimentoNormativo: string | null;
    dataScadenzaContraddittorio: Date | null;
    createdAt: Date;
    noteIstruttorie: string | null;
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
  scadenzeCritiche: Array<{
    id: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    descrizione: string | null;
  }>;
  documenti: Array<{
    id: string;
    nome: string;
    tipologia: string;
    url: string;
    dataDocumento: Date | null;
    createdAt: Date;
  }>;
  sopralluoghiRecenti: Array<{
    id: string;
    data: Date;
    esito: string;
    operatori: string;
    descrizione: string | null;
    conformitaPlanimetrica: boolean;
  }>;
}

export interface CriticitaFiltersData {
  concessioni: Array<{
    id: string;
    label: string;
  }>;
  tipologie: Array<{ value: CriticitaTipologiaValue; label: string }>;
  gravita: Array<{ value: CriticitaGravitaValue; label: string }>;
  stati: Array<{ value: CriticitaStatoValue; label: string }>;
  fonti: Array<{ value: CriticitaFonteValue; label: string }>;
}

export interface CriticitaIstruttoria {
  qualificazioneOperativa: string;
  riferimentoNormativoSuggerito: string;
  azioneIstruttoriaConsigliata: string;
  livelloAttenzione: string;
  avvertenza: string;
}

function gravitaOrderValue(value: string): number {
  const map: Record<string, number> = {
    URGENTE: 0,
    ALTA: 1,
    MEDIA: 2,
    BASSA: 3,
  };

  return map[value] ?? 99;
}

function statoOrderValue(value: string): number {
  const map: Record<string, number> = {
    APERTA: 0,
    IN_GESTIONE: 1,
    RISOLTA: 2,
    ARCHIVIATA: 3,
  };

  return map[value] ?? 99;
}

export async function getCriticitaList(
  params: GetCriticitaListParams,
): Promise<GetCriticitaListResult> {
  const search = params.search?.trim();

  const where: Prisma.CriticitaWhereInput = {
    ...(search
      ? {
          OR: [
            { descrizione: { contains: search } },
            { riferimentoNormativo: { contains: search } },
            { azioneConsigliata: { contains: search } },
            {
              concessione: {
                numeroAtto: { contains: search },
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
    ...(params.gravita ? { gravita: params.gravita } : {}),
    ...(params.stato ? { stato: params.stato } : {}),
    ...(params.fonte ? { fonte: params.fonte } : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
  };

  const [rows, summary] = await Promise.all([
    prisma.criticita.findMany({
      where,
      select: {
        id: true,
        tipologia: true,
        gravita: true,
        fonte: true,
        descrizione: true,
        riferimentoNormativo: true,
        azioneConsigliata: true,
        stato: true,
        dataRilevazione: true,
        concessione: {
          select: {
            id: true,
            numeroAtto: true,
            stato: true,
            dataScadenza: true,
            tipologiaBene: true,
            ubicazione: true,
            concessionario: {
              select: {
                denominazione: true,
              },
            },
          },
        },
        _count: {
          select: {
            procedimenti: true,
          },
        },
      },
    }),
    Promise.all([
      prisma.criticita.count(),
      prisma.criticita.count({ where: { stato: "APERTA" } }),
      prisma.criticita.count({ where: { gravita: "URGENTE" } }),
      prisma.criticita.count({ where: { gravita: "ALTA" } }),
      prisma.criticita.count({ where: { stato: "IN_GESTIONE" } }),
      prisma.criticita.count({ where: { stato: "RISOLTA" } }),
    ]),
  ]);

  const items = rows
    .map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      fonte: item.fonte,
      descrizione: item.descrizione,
      riferimentoNormativo: item.riferimentoNormativo,
      azioneConsigliata: item.azioneConsigliata,
      stato: item.stato,
      dataRilevazione: item.dataRilevazione,
      concessione: {
        id: item.concessione.id,
        numeroAtto: item.concessione.numeroAtto,
        stato: item.concessione.stato,
        dataScadenza: item.concessione.dataScadenza,
        tipologiaBene: item.concessione.tipologiaBene,
        ubicazione: item.concessione.ubicazione,
        concessionarioDenominazione: item.concessione.concessionario.denominazione,
      },
      procedimentiCount: item._count.procedimenti,
    }))
    .sort((a, b) => {
      const gravitaDiff = gravitaOrderValue(a.gravita) - gravitaOrderValue(b.gravita);
      if (gravitaDiff !== 0) {
        return gravitaDiff;
      }

      const statoDiff = statoOrderValue(a.stato) - statoOrderValue(b.stato);
      if (statoDiff !== 0) {
        return statoDiff;
      }

      return b.dataRilevazione.getTime() - a.dataRilevazione.getTime();
    });

  return {
    items,
    summary: {
      totale: summary[0],
      aperte: summary[1],
      urgenti: summary[2],
      alte: summary[3],
      inGestione: summary[4],
      risolte: summary[5],
    },
  };
}

export async function getCriticitaDetail(id: string): Promise<CriticitaDetail | null> {
  const criticita = await prisma.criticita.findUnique({
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
          scadenze: {
            where: { stato: { in: ["APERTA", "SCADUTA"] } },
            orderBy: { dataScadenza: "asc" },
          },
          pagamenti: {
            where: { stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] } },
            orderBy: [{ dataScadenza: "asc" }],
          },
          documenti: {
            orderBy: [{ dataDocumento: "desc" }, { createdAt: "desc" }],
            take: 12,
          },
          sopralluoghi: {
            orderBy: { data: "desc" },
            take: 6,
          },
        },
      },
      procedimenti: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!criticita) {
    return null;
  }

  return {
    id: criticita.id,
    tipologia: criticita.tipologia,
    gravita: criticita.gravita,
    fonte: criticita.fonte,
    descrizione: criticita.descrizione,
    riferimentoNormativo: criticita.riferimentoNormativo,
    azioneConsigliata: criticita.azioneConsigliata,
    stato: criticita.stato,
    dataRilevazione: criticita.dataRilevazione,
    concessione: {
      id: criticita.concessione.id,
      numeroAtto: criticita.concessione.numeroAtto,
      stato: criticita.concessione.stato,
      dataScadenza: criticita.concessione.dataScadenza,
      tipologiaBene: criticita.concessione.tipologiaBene,
      ubicazione: criticita.concessione.ubicazione,
      canoneAnnuo: criticita.concessione.canoneAnnuo ? Number(criticita.concessione.canoneAnnuo) : null,
      categoriaCanone: criticita.concessione.categoriaCanone,
      concessionario: {
        denominazione: criticita.concessione.concessionario.denominazione,
        codiceFiscale: criticita.concessione.concessionario.codiceFiscale,
        partitaIva: criticita.concessione.concessionario.partitaIva,
      },
    },
    procedimenti: criticita.procedimenti.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      riferimentoNormativo: item.riferimentoNormativo,
      dataScadenzaContraddittorio: item.dataScadenzaContraddittorio,
      createdAt: item.createdAt,
      noteIstruttorie: item.noteIstruttorie,
    })),
    pagamentiCritici: criticita.concessione.pagamenti.map((item) => {
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
    scadenzeCritiche: criticita.concessione.scadenze.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      descrizione: item.descrizione,
    })),
    documenti: criticita.concessione.documenti.map((item) => ({
      id: item.id,
      nome: item.nome,
      tipologia: item.tipologia,
      url: item.url,
      dataDocumento: item.dataDocumento,
      createdAt: item.createdAt,
    })),
    sopralluoghiRecenti: criticita.concessione.sopralluoghi.map((item) => ({
      id: item.id,
      data: item.data,
      esito: item.esito,
      operatori: item.operatori,
      descrizione: item.descrizione,
      conformitaPlanimetrica: item.conformitaPlanimetrica,
    })),
  };
}

export async function getCriticitaFilters(): Promise<CriticitaFiltersData> {
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
    tipologie: CRITICITA_TIPOLOGIA_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    gravita: CRITICITA_GRAVITA_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    stati: CRITICITA_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    fonti: CRITICITA_FONTE_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
  };
}

export function getCriticitaIstruttoria(criticita: {
  tipologia: string;
  gravita: string;
  stato: string;
  riferimentoNormativo: string | null;
  azioneConsigliata: string | null;
}): CriticitaIstruttoria {
  const map: Record<
    string,
    {
      qualificazioneOperativa: string;
      riferimentoNormativoSuggerito: string;
      azioneIstruttoriaConsigliata: string;
      livelloAttenzione: string;
    }
  > = {
    MOROSITA: {
      qualificazioneOperativa: "Inadempienza economica con possibile impatto sul rapporto concessorio.",
      riferimentoNormativoSuggerito: "art. 47 lett. d cod. nav.",
      azioneIstruttoriaConsigliata:
        "Verificare stato rate/canoni, esposizione residua e valutare diffida o recupero canoni.",
      livelloAttenzione: "ALTO",
    },
    USO_NON_CONFORME: {
      qualificazioneOperativa: "Scostamento tra titolo assentito e attivita effettivamente svolta.",
      riferimentoNormativoSuggerito: "art. 47 lett. c/f cod. nav.",
      azioneIstruttoriaConsigliata:
        "Confrontare titolo e uso reale, avviare contraddittorio tecnico-giuridico con riscontro documentale.",
      livelloAttenzione: "ALTO",
    },
    OCCUPAZIONE_DIFFORME: {
      qualificazioneOperativa: "Occupazione di aree non coerente con planimetrie e perimetro assentito.",
      riferimentoNormativoSuggerito: "art. 54 cod. nav. e possibile art. 47 lett. b/f",
      azioneIstruttoriaConsigliata:
        "Disporre sopralluogo con riscontro planimetrico e valutare ordine di ripristino.",
      livelloAttenzione: "ALTO",
    },
    RISCHIO_DECADENZA: {
      qualificazioneOperativa: "Profilo potenziale di decadenza con necessita di istruttoria rafforzata.",
      riferimentoNormativoSuggerito: "art. 47 cod. nav.",
      azioneIstruttoriaConsigliata:
        "Verificare gravita, proporzionalita, contraddittorio e acquisire pareri ove necessario.",
      livelloAttenzione: "MOLTO ALTO",
    },
    RISCHIO_REVOCA: {
      qualificazioneOperativa: "Profilo di possibile revoca legato a interesse pubblico sopravvenuto.",
      riferimentoNormativoSuggerito: "art. 42 cod. nav.",
      azioneIstruttoriaConsigliata:
        "Valutare interesse pubblico, durata residua, opere e possibile indennizzo.",
      livelloAttenzione: "MOLTO ALTO",
    },
    DOCUMENTALE: {
      qualificazioneOperativa: "Incompleta compliance documentale su obblighi concessori.",
      riferimentoNormativoSuggerito: "obblighi concessori / art. 47 lett. f cod. nav.",
      azioneIstruttoriaConsigliata: "Richiedere integrazione documentale con termini certi di riscontro.",
      livelloAttenzione: "MEDIO",
    },
    SICUREZZA: {
      qualificazioneOperativa: "Possibile rischio su presidio sicurezza e conformita tecnica.",
      riferimentoNormativoSuggerito: "prescrizioni tecniche e sicurezza operativa",
      azioneIstruttoriaConsigliata: "Attivare sopralluogo urgente e definire prescrizioni tecniche puntuali.",
      livelloAttenzione: "ALTO",
    },
    MANUTENTIVA: {
      qualificazioneOperativa: "Scostamento dagli obblighi manutentivi previsti in concessione.",
      riferimentoNormativoSuggerito: "obblighi manutentivi del titolo concessorio",
      azioneIstruttoriaConsigliata: "Verificare stato manutentivo, termini di adeguamento e possibile diffida.",
      livelloAttenzione: "MEDIO-ALTO",
    },
    TECNICA: {
      qualificazioneOperativa: "Anomalia tecnica su beni/aree in concessione.",
      riferimentoNormativoSuggerito: "prescrizioni tecniche del titolo concessorio",
      azioneIstruttoriaConsigliata: "Programmare sopralluogo e confronto con planimetrie e prescrizioni.",
      livelloAttenzione: "MEDIO",
    },
    GIURIDICA: {
      qualificazioneOperativa: "Potenziale criticita di legittimita e tenuta del titolo.",
      riferimentoNormativoSuggerito: "disciplina del titolo concessorio e cod. nav.",
      azioneIstruttoriaConsigliata:
        "Verificare titolo, subingressi, proroghe e affidamenti a terzi non autorizzati.",
      livelloAttenzione: "MEDIO-ALTO",
    },
    ECONOMICA: {
      qualificazioneOperativa: "Possibile anomalia nel presidio economico-finanziario della concessione.",
      riferimentoNormativoSuggerito: "disciplina canoni, garanzie e cauzioni",
      azioneIstruttoriaConsigliata:
        "Verificare canone dovuto, adeguamenti, garanzie, cauzioni e copertura fideiussoria.",
      livelloAttenzione: "MEDIO-ALTO",
    },
  };

  const fallback = {
    qualificazioneOperativa: "Criticita da approfondire in istruttoria con analisi tecnica e giuridica.",
    riferimentoNormativoSuggerito: "verifica normativa specifica del caso",
    azioneIstruttoriaConsigliata: "Predisporre istruttoria dedicata con raccolta elementi oggettivi.",
    livelloAttenzione: "MEDIO",
  };

  const template = map[criticita.tipologia] ?? fallback;
  const livelloAttenzione =
    criticita.gravita === "URGENTE"
      ? "MOLTO ALTO"
      : criticita.gravita === "ALTA"
        ? "ALTO"
        : criticita.gravita === "MEDIA"
          ? "MEDIO"
          : template.livelloAttenzione;

  return {
    qualificazioneOperativa: template.qualificazioneOperativa,
    riferimentoNormativoSuggerito:
      criticita.riferimentoNormativo && criticita.riferimentoNormativo.trim() !== ""
        ? criticita.riferimentoNormativo
        : template.riferimentoNormativoSuggerito,
    azioneIstruttoriaConsigliata:
      criticita.azioneConsigliata && criticita.azioneConsigliata.trim() !== ""
        ? criticita.azioneConsigliata
        : template.azioneIstruttoriaConsigliata,
    livelloAttenzione,
    avvertenza:
      "La piattaforma supporta l istruttoria interna e non sostituisce la valutazione e le decisioni dell Autorita competente.",
  };
}

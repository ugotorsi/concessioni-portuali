import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import { prisma } from "@/lib/prisma";
import { formatEnumLabel } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

export const PROCEDIMENTO_TIPOLOGIA_VALUES = [
  "CHIARIMENTI",
  "DIFFIDA",
  "CONTESTAZIONE",
  "ORDINE_RIPRISTINO",
  "RECUPERO_CANONI",
  "ESCUSSIONE_GARANZIA",
  "AVVIO_DECADENZA",
  "AVVIO_REVOCA",
  "NUOVA_PROCEDURA",
  "ALTRO",
] as const;

export const PROCEDIMENTO_STATO_VALUES = ["DA_AVVIARE", "IN_CORSO", "CONCLUSO", "ARCHIVIATO"] as const;

export const PROCEDIMENTI_PERIODO_VALUES = [
  "APERTI",
  "IN_SCADENZA",
  "SCADUTI",
  "CONCLUSI",
  "TUTTI",
] as const;

export type ProcedimentoTipologiaValue = (typeof PROCEDIMENTO_TIPOLOGIA_VALUES)[number];
export type ProcedimentoStatoValue = (typeof PROCEDIMENTO_STATO_VALUES)[number];
export type ProcedimentiPeriodoValue = (typeof PROCEDIMENTI_PERIODO_VALUES)[number];

export interface GetProcedimentiListParams {
  search?: string;
  tipologia?: ProcedimentoTipologiaValue;
  stato?: ProcedimentoStatoValue;
  concessioneId?: string;
  criticitaId?: string;
  periodo?: ProcedimentiPeriodoValue;
}

export interface ProcedimentoListItem {
  id: string;
  tipologia: string;
  riferimentoNormativo: string | null;
  dataAvvio: Date | null;
  dataScadenzaContraddittorio: Date | null;
  dataProvvedimentoFinale: Date | null;
  stato: string;
  noteIstruttorie: string | null;
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
  criticita: {
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
  } | null;
  giorniResiduiContraddittorio: number | null;
  giorniRitardoContraddittorio: number | null;
}

export interface GetProcedimentiListResult {
  items: ProcedimentoListItem[];
}

export interface ProcedimentiFiltersData {
  concessioni: Array<{ id: string; label: string }>;
  criticita: Array<{ id: string; label: string }>;
  tipologie: Array<{ value: ProcedimentoTipologiaValue; label: string }>;
  stati: Array<{ value: ProcedimentoStatoValue; label: string }>;
  periodi: Array<{ value: ProcedimentiPeriodoValue; label: string }>;
}

export interface ProcedimentoDetail {
  procedimento: {
    id: string;
    tipologia: string;
    riferimentoNormativo: string | null;
    dataAvvio: Date | null;
    dataScadenzaContraddittorio: Date | null;
    dataProvvedimentoFinale: Date | null;
    stato: string;
    noteIstruttorie: string | null;
    giorniResiduiContraddittorio: number | null;
    giorniRitardoContraddittorio: number | null;
    createdAt: Date;
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
    canoneAnnuo: number | null;
    categoriaCanone: string | null;
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
  criticitaCollegata: {
    id: string;
    tipologia: string;
    gravita: string;
    stato: string;
    descrizione: string;
    riferimentoNormativo: string | null;
    dataRilevazione: Date;
  } | null;
  altreCriticitaAperte: Array<{
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
  scadenzeRilevanti: Array<{
    id: string;
    tipologia: string;
    stato: string;
    dataScadenza: Date;
    descrizione: string | null;
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
  reportCollegati: Array<{
    id: string;
    tipologia: string;
    titolo: string;
    formato: string;
    validato: boolean;
    createdAt: Date;
  }>;
}

export interface LetturaProcedimentale {
  qualificazioneProcedimentale: string;
  livelloAttenzione: string;
  passaggiIstruttoriConsigliati: string;
  riferimentiNormativiSuggeriti: string;
  avvertenza: string;
}

function getPeriodoWhere(periodo?: ProcedimentiPeriodoValue): Prisma.ProcedimentoWhereInput {
  const today = startOfDay(new Date());
  const in30 = addDays(today, 30);

  switch (periodo) {
    case "APERTI":
      return { stato: { in: ["DA_AVVIARE", "IN_CORSO"] } };
    case "IN_SCADENZA":
      return {
        stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
        dataScadenzaContraddittorio: { gte: today, lte: in30 },
      };
    case "SCADUTI":
      return {
        stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
        dataScadenzaContraddittorio: { lt: today },
      };
    case "CONCLUSI":
      return { stato: { in: ["CONCLUSO", "ARCHIVIATO"] } };
    case "TUTTI":
    default:
      return {};
  }
}

function buildWhere(params: GetProcedimentiListParams): Prisma.ProcedimentoWhereInput {
  const search = params.search?.trim();

  return {
    ...(search
      ? {
          OR: [
            { riferimentoNormativo: { contains: search } },
            { noteIstruttorie: { contains: search } },
            { concessione: { numeroAtto: { contains: search } } },
            { concessione: { ubicazione: { contains: search } } },
            { concessione: { concessionario: { denominazione: { contains: search } } } },
            { criticita: { is: { descrizione: { contains: search } } } },
          ],
        }
      : {}),
    ...(params.tipologia ? { tipologia: params.tipologia } : {}),
    ...(params.stato ? { stato: params.stato } : {}),
    ...(params.concessioneId ? { concessioneId: params.concessioneId } : {}),
    ...(params.criticitaId ? { criticitaId: params.criticitaId } : {}),
    ...getPeriodoWhere(params.periodo),
  };
}

function statoPriority(stato: string): number {
  if (stato === "DA_AVVIARE") {
    return 0;
  }
  if (stato === "IN_CORSO") {
    return 1;
  }
  return 2;
}

function toListItem(
  row: {
    id: string;
    tipologia: string;
    riferimentoNormativo: string | null;
    dataAvvio: Date | null;
    dataScadenzaContraddittorio: Date | null;
    dataProvvedimentoFinale: Date | null;
    stato: string;
    noteIstruttorie: string | null;
    createdAt: Date;
    concessione: {
      id: string;
      numeroAtto: string;
      stato: string;
      dataScadenza: Date;
      ubicazione: string | null;
      concessionario: { denominazione: string };
    };
    criticita: {
      id: string;
      tipologia: string;
      gravita: string;
      stato: string;
      descrizione: string;
    } | null;
  },
  today: Date,
): ProcedimentoListItem & { createdAt: Date; hasTermineScaduto: boolean } {
  const hasTermineScaduto =
    row.dataScadenzaContraddittorio !== null &&
    row.dataScadenzaContraddittorio < today &&
    ["DA_AVVIARE", "IN_CORSO"].includes(row.stato);

  const giorniResiduiContraddittorio =
    row.dataScadenzaContraddittorio && !hasTermineScaduto
      ? Math.max(differenceInCalendarDays(row.dataScadenzaContraddittorio, today), 0)
      : null;

  const giorniRitardoContraddittorio =
    row.dataScadenzaContraddittorio && hasTermineScaduto
      ? Math.abs(differenceInCalendarDays(row.dataScadenzaContraddittorio, today))
      : null;

  return {
    id: row.id,
    tipologia: row.tipologia,
    riferimentoNormativo: row.riferimentoNormativo,
    dataAvvio: row.dataAvvio,
    dataScadenzaContraddittorio: row.dataScadenzaContraddittorio,
    dataProvvedimentoFinale: row.dataProvvedimentoFinale,
    stato: row.stato,
    noteIstruttorie: row.noteIstruttorie,
    concessione: row.concessione,
    criticita: row.criticita,
    giorniResiduiContraddittorio,
    giorniRitardoContraddittorio,
    createdAt: row.createdAt,
    hasTermineScaduto,
  };
}

export async function getProcedimentiList(
  params: GetProcedimentiListParams,
): Promise<GetProcedimentiListResult> {
  const today = startOfDay(new Date());

  const rows = await prisma.procedimento.findMany({
    where: buildWhere(params),
    select: {
      id: true,
      tipologia: true,
      riferimentoNormativo: true,
      dataAvvio: true,
      dataScadenzaContraddittorio: true,
      dataProvvedimentoFinale: true,
      stato: true,
      noteIstruttorie: true,
      createdAt: true,
      concessione: {
        select: {
          id: true,
          numeroAtto: true,
          stato: true,
          dataScadenza: true,
          ubicazione: true,
          concessionario: { select: { denominazione: true } },
        },
      },
      criticita: {
        select: {
          id: true,
          tipologia: true,
          gravita: true,
          stato: true,
          descrizione: true,
        },
      },
    },
  });

  const items = rows
    .map((row) => toListItem(row, today))
    .sort((a, b) => {
      const byStato = statoPriority(a.stato) - statoPriority(b.stato);
      if (byStato !== 0) {
        return byStato;
      }

      const byScaduto = (a.hasTermineScaduto ? 0 : 1) - (b.hasTermineScaduto ? 0 : 1);
      if (byScaduto !== 0) {
        return byScaduto;
      }

      const aTermine = a.dataScadenzaContraddittorio ? a.dataScadenzaContraddittorio.getTime() : Number.MAX_SAFE_INTEGER;
      const bTermine = b.dataScadenzaContraddittorio ? b.dataScadenzaContraddittorio.getTime() : Number.MAX_SAFE_INTEGER;
      if (aTermine !== bTermine) {
        return aTermine - bTermine;
      }

      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .map(({ createdAt: _createdAt, hasTermineScaduto: _hasTermineScaduto, ...item }) => item);

  return { items };
}

export async function getProcedimentoDetail(id: string): Promise<ProcedimentoDetail | null> {
  const today = startOfDay(new Date());

  const procedimento = await prisma.procedimento.findUnique({
    where: { id },
    include: {
      criticita: {
        select: {
          id: true,
          tipologia: true,
          gravita: true,
          stato: true,
          descrizione: true,
          riferimentoNormativo: true,
          dataRilevazione: true,
        },
      },
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
          pagamenti: {
            where: { stato: { in: ["NON_PAGATO", "PARZIALE", "SCADUTO"] } },
            orderBy: [{ dataScadenza: "asc" }],
            take: 12,
          },
          scadenze: {
            where: { stato: { in: ["APERTA", "SCADUTA"] } },
            orderBy: [{ dataScadenza: "asc" }],
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
          report: {
            orderBy: [{ createdAt: "desc" }],
            take: 10,
          },
        },
      },
    },
  });

  if (!procedimento) {
    return null;
  }

  const termineScaduto =
    procedimento.dataScadenzaContraddittorio !== null &&
    procedimento.dataScadenzaContraddittorio < today &&
    ["DA_AVVIARE", "IN_CORSO"].includes(procedimento.stato);

  const giorniResiduiContraddittorio =
    procedimento.dataScadenzaContraddittorio && !termineScaduto
      ? Math.max(differenceInCalendarDays(procedimento.dataScadenzaContraddittorio, today), 0)
      : null;

  const giorniRitardoContraddittorio =
    procedimento.dataScadenzaContraddittorio && termineScaduto
      ? Math.abs(differenceInCalendarDays(procedimento.dataScadenzaContraddittorio, today))
      : null;

  const altreCriticitaAperte = procedimento.concessione.criticita
    .filter((item) => item.id !== procedimento.criticitaId)
    .map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      gravita: item.gravita,
      stato: item.stato,
      descrizione: item.descrizione,
      dataRilevazione: item.dataRilevazione,
    }));

  return {
    procedimento: {
      id: procedimento.id,
      tipologia: procedimento.tipologia,
      riferimentoNormativo: procedimento.riferimentoNormativo,
      dataAvvio: procedimento.dataAvvio,
      dataScadenzaContraddittorio: procedimento.dataScadenzaContraddittorio,
      dataProvvedimentoFinale: procedimento.dataProvvedimentoFinale,
      stato: procedimento.stato,
      noteIstruttorie: procedimento.noteIstruttorie,
      giorniResiduiContraddittorio,
      giorniRitardoContraddittorio,
      createdAt: procedimento.createdAt,
    },
    concessione: {
      id: procedimento.concessione.id,
      numeroAtto: procedimento.concessione.numeroAtto,
      stato: procedimento.concessione.stato,
      dataRilascio: procedimento.concessione.dataRilascio,
      dataScadenza: procedimento.concessione.dataScadenza,
      tipologiaBene: procedimento.concessione.tipologiaBene,
      attivita: procedimento.concessione.attivita,
      ubicazione: procedimento.concessione.ubicazione,
      canoneAnnuo: procedimento.concessione.canoneAnnuo ? Number(procedimento.concessione.canoneAnnuo) : null,
      categoriaCanone: procedimento.concessione.categoriaCanone,
    },
    concessionario: procedimento.concessione.concessionario,
    criticitaCollegata: procedimento.criticita,
    altreCriticitaAperte,
    pagamentiCritici: procedimento.concessione.pagamenti.map((item) => {
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
    scadenzeRilevanti: procedimento.concessione.scadenze.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      descrizione: item.descrizione,
    })),
    sopralluoghiRecenti: procedimento.concessione.sopralluoghi.map((item) => ({
      id: item.id,
      data: item.data,
      esito: item.esito,
      operatori: item.operatori,
      conformitaPlanimetrica: item.conformitaPlanimetrica,
      descrizione: item.descrizione,
    })),
    documentiPrincipali: procedimento.concessione.documenti.map((item) => ({
      id: item.id,
      nome: item.nome,
      tipologia: item.tipologia,
      url: item.url,
      dataDocumento: item.dataDocumento,
      createdAt: item.createdAt,
    })),
    reportCollegati: procedimento.concessione.report.map((item) => ({
      id: item.id,
      tipologia: item.tipologia,
      titolo: item.titolo,
      formato: item.formato,
      validato: item.validato,
      createdAt: item.createdAt,
    })),
  };
}

export async function getProcedimentiFilters(): Promise<ProcedimentiFiltersData> {
  const [concessioni, criticita] = await Promise.all([
    prisma.concessione.findMany({
      orderBy: [{ dataScadenza: "asc" }],
      select: {
        id: true,
        numeroAtto: true,
        concessionario: {
          select: { denominazione: true },
        },
      },
    }),
    prisma.criticita.findMany({
      orderBy: [{ dataRilevazione: "desc" }],
      select: {
        id: true,
        tipologia: true,
        gravita: true,
        concessione: {
          select: {
            numeroAtto: true,
          },
        },
      },
      take: 200,
    }),
  ]);

  return {
    concessioni: concessioni.map((item) => ({
      id: item.id,
      label: `${item.numeroAtto} - ${item.concessionario.denominazione}`,
    })),
    criticita: criticita.map((item) => ({
      id: item.id,
      label: `${item.concessione.numeroAtto} - ${formatEnumLabel(item.tipologia)} (${formatEnumLabel(item.gravita)})`,
    })),
    tipologie: PROCEDIMENTO_TIPOLOGIA_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    stati: PROCEDIMENTO_STATO_VALUES.map((value) => ({ value, label: formatEnumLabel(value) })),
    periodi: [
      { value: "TUTTI", label: "Tutti" },
      { value: "APERTI", label: "Aperti" },
      { value: "IN_SCADENZA", label: "In scadenza" },
      { value: "SCADUTI", label: "Scaduti" },
      { value: "CONCLUSI", label: "Conclusi" },
    ],
  };
}

export function getLetturaProcedimentale(procedimento: {
  tipologia: string;
  stato: string;
  riferimentoNormativo: string | null;
  giorniRitardoContraddittorio: number | null;
}): LetturaProcedimentale {
  const base = {
    avvertenza:
      "La piattaforma supporta l istruttoria e non sostituisce le determinazioni dell Autorita competente.",
  };

  const ritardoHint = procedimento.giorniRitardoContraddittorio !== null
    ? "Termine di contraddittorio scaduto: attribuire priorita alta alla chiusura del passaggio istruttorio."
    : "";

  switch (procedimento.tipologia) {
    case "CHIARIMENTI":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento ricognitivo finalizzato all acquisizione di elementi dal concessionario.",
        livelloAttenzione: "MEDIO",
        passaggiIstruttoriConsigliati:
          `Acquisire elementi dal concessionario e fissare termine di riscontro. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Titolo concessorio e obblighi specifici.",
      };
    case "DIFFIDA":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento di intimazione formale su obblighi concessori non adempiuti.",
        livelloAttenzione: "ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare obbligo violato, termine assegnato e documentazione probatoria. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Art. 47 cod. nav. e clausole del titolo concessorio.",
      };
    case "CONTESTAZIONE":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento di contestazione con ricostruzione dei fatti e contraddittorio.",
        livelloAttenzione: "ALTO",
        passaggiIstruttoriConsigliati:
          `Ricostruire fatto, titolo, norma violata, evidenze e contraddittorio. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Norma sostanziale violata e disposizioni del titolo concessorio.",
      };
    case "ORDINE_RIPRISTINO":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento tecnico-ripristinatorio su difformita dello stato dei luoghi.",
        livelloAttenzione: "ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare art. 54 cod. nav., stato dei luoghi, planimetrie e sopralluogo. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Art. 54 cod. nav. e prescrizioni tecniche applicabili.",
      };
    case "RECUPERO_CANONI":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento economico per recupero crediti canoni e accessori.",
        livelloAttenzione: "ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare importi, scadenze, pagamenti parziali, interessi e titolo. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Titolo concessorio, disciplina canoni e mora applicabile.",
      };
    case "ESCUSSIONE_GARANZIA":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento economico-garantistico per escussione garanzia.",
        livelloAttenzione: "ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare garanzia attiva, importo, scadenza e presupposti. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Clausole garanzia e condizioni di escussione del titolo.",
      };
    case "AVVIO_DECADENZA":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento incidente sul rapporto concessorio con possibile decadenza.",
        livelloAttenzione: "MOLTO ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare art. 47 cod. nav., gravita, proporzionalita, contraddittorio ed eventuale parere Comitato Portuale ove necessario. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Art. 47 cod. nav.",
      };
    case "AVVIO_REVOCA":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento per sopravvenuto interesse pubblico con possibile revoca.",
        livelloAttenzione: "MOLTO ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare art. 42 cod. nav., interesse pubblico, durata concessione, opere e indennizzo potenziale. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Art. 42 cod. nav.",
      };
    case "NUOVA_PROCEDURA":
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento preparatorio a nuova procedura concessoria.",
        livelloAttenzione: "MEDIO_ALTO",
        passaggiIstruttoriConsigliati:
          `Verificare stato bene, criticita pregresse, valore economico, clausole da rafforzare e documenti di gara. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Normativa concessoria applicabile e linee guida interne.",
      };
    default:
      return {
        ...base,
        qualificazioneProcedimentale: "Procedimento amministrativo da inquadrare nel fascicolo istruttorio.",
        livelloAttenzione: "MEDIO",
        passaggiIstruttoriConsigliati:
          `Raccolta documenti, verifica titolo, comunicazione/richiesta chiarimenti, termine riscontro, valutazione esiti e proposta conclusiva. ${ritardoHint}`.trim(),
        riferimentiNormativiSuggeriti: procedimento.riferimentoNormativo ?? "Titolo concessorio e disciplina procedimentale applicabile.",
      };
  }
}

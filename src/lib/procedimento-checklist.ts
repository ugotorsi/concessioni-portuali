export type ProcedimentoWarningLevel = "default" | "warning" | "danger";

export interface ProcedimentoChecklistInput {
  tipologia?: string | null;
  origineProcedimento?: string | null;
  procedimentoUfficio?: boolean | null;
  comunicazioneAvvioInviata?: boolean | null;
  termineMemorieGiorni?: number | null;
  termineMemorieScadenza?: Date | null;
  memorieRicevute?: boolean | null;
  dataRicezioneMemorie?: Date | null;
  audizioneRichiesta?: boolean | null;
  audizioneSvolta?: boolean | null;
  dataAudizione?: Date | null;
  contestazioneFormaleInviata?: boolean | null;
  dataContestazioneFormale?: Date | null;
  controdeduzioniValutate?: boolean | null;
  motivazioneValutazione?: string | null;
  propostaEsitoIstruttorio?: string | null;
  preavvisoRigettoApplicabile?: boolean | null;
  statoPreavvisoRigetto?: string | null;
  dataPreavvisoRigetto?: Date | null;
  termineOsservazioniPreavviso?: Date | null;
  osservazioniPreavvisoRicevute?: boolean | null;
  dataOsservazioniPreavviso?: Date | null;
  valutazioneOsservazioniPreavviso?: string | null;
  motivazioneMancatoPreavviso?: string | null;
}

export interface ChecklistItemStatus {
  key: string;
  label: string;
  required: boolean;
  completed: boolean;
}

const SANZIONATORI_O_DECADENZIALI = new Set([
  "DIFFIDA",
  "CONTESTAZIONE",
  "ORDINE_RIPRISTINO",
  "RECUPERO_CANONI",
  "ESCUSSIONE_GARANZIA",
  "AVVIO_DECADENZA",
  "AVVIO_REVOCA",
]);

const DECADENZIALI = new Set(["AVVIO_DECADENZA", "AVVIO_REVOCA"]);
const ESITI_DECADENZIALI = new Set(["DECADENZA_DA_VALUTARE", "REVOCA_DA_VALUTARE"]);
const ESITI_SFAVOREVOLI_O_RILEVANTI = new Set([
  "DECADENZA_DA_VALUTARE",
  "REVOCA_DA_VALUTARE",
  "DIFFIDA",
]);

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function isProcedimentoUfficio(procedimento: ProcedimentoChecklistInput): boolean {
  if (procedimento.origineProcedimento === "UFFICIO") {
    return true;
  }

  if (procedimento.origineProcedimento === "ISTANZA_PARTE") {
    return false;
  }

  return Boolean(procedimento.procedimentoUfficio);
}

export function isProcedimentoIstanzaParte(procedimento: ProcedimentoChecklistInput): boolean {
  if (procedimento.origineProcedimento === "ISTANZA_PARTE") {
    return true;
  }

  if (procedimento.origineProcedimento === "UFFICIO") {
    return false;
  }

  return procedimento.procedimentoUfficio === false;
}

export function getOrigineProcedimentoLabel(origine: string | null | undefined): string {
  if (!origine) {
    return "-";
  }

  const labels: Record<string, string> = {
    UFFICIO: "D ufficio",
    ISTANZA_PARTE: "A istanza di parte",
    ALTRO: "Altro",
  };

  return labels[origine] ?? origine;
}

export function getStatoPreavvisoRigettoLabel(stato: string | null | undefined): string {
  if (!stato) {
    return "-";
  }

  const labels: Record<string, string> = {
    NON_VALUTATO: "Non valutato",
    NON_APPLICABILE: "Non applicabile",
    APPLICABILE_DA_INVIARE: "Applicabile da inviare",
    INVIATO: "Inviato",
    OSSERVAZIONI_RICEVUTE: "Osservazioni ricevute",
    OSSERVAZIONI_VALUTATE: "Osservazioni valutate",
  };

  return labels[stato] ?? stato;
}

export function getStatoPreavvisoRigettoDescription(stato: string | null | undefined): string {
  if (!stato) {
    return "Stato preavviso non valorizzato: elemento istruttorio da verificare.";
  }

  const descriptions: Record<string, string> = {
    NON_VALUTATO: "Applicabilita del preavviso non ancora valutata in istruttoria.",
    NON_APPLICABILE: "Preavviso indicato come non applicabile secondo valutazione istruttoria.",
    APPLICABILE_DA_INVIARE: "Preavviso ritenuto applicabile, invio ancora da completare.",
    INVIATO: "Preavviso inviato: monitorare eventuali osservazioni e relativi termini.",
    OSSERVAZIONI_RICEVUTE: "Osservazioni ricevute: necessaria valutazione istruttoria motivata.",
    OSSERVAZIONI_VALUTATE: "Osservazioni valutate e integrate nella motivazione istruttoria.",
  };

  return descriptions[stato] ?? "Stato preavviso da verificare caso per caso.";
}

function isRequiredForTipologia(key: string, tipologia: string | null | undefined): boolean {
  const isSanzionatorio = Boolean(tipologia && SANZIONATORI_O_DECADENZIALI.has(tipologia));
  const isDecadenziale = Boolean(tipologia && DECADENZIALI.has(tipologia));

  if (!isSanzionatorio) {
    return false;
  }

  if (key === "audizioneSvolta") {
    return false;
  }

  if (key === "contestazioneFormaleInviata") {
    return true;
  }

  if (key === "propostaEsitoIstruttorio") {
    return isDecadenziale;
  }

  return [
    "comunicazioneAvvioInviata",
    "termineMemorie",
    "controdeduzioniValutate",
    "motivazioneValutazione",
  ].includes(key);
}

function isCompleted(key: string, procedimento: ProcedimentoChecklistInput): boolean {
  switch (key) {
    case "comunicazioneAvvioInviata":
      return Boolean(procedimento.comunicazioneAvvioInviata);
    case "termineMemorie":
      return (
        (procedimento.termineMemorieGiorni ?? 0) > 0 ||
        procedimento.termineMemorieScadenza instanceof Date
      );
    case "memorieRicevute":
      return Boolean(procedimento.memorieRicevute);
    case "audizioneSvolta":
      if (!procedimento.audizioneRichiesta) {
        return true;
      }
      return Boolean(procedimento.audizioneSvolta);
    case "contestazioneFormaleInviata":
      return Boolean(procedimento.contestazioneFormaleInviata);
    case "controdeduzioniValutate":
      return Boolean(procedimento.controdeduzioniValutate);
    case "motivazioneValutazione":
      return hasText(procedimento.motivazioneValutazione);
    case "propostaEsitoIstruttorio":
      return hasText(procedimento.propostaEsitoIstruttorio);
    default:
      return false;
  }
}

export function formatChecklistItemLabel(key: string): string {
  const labels: Record<string, string> = {
    comunicazioneAvvioInviata: "Comunicazione di avvio inviata",
    termineMemorie: "Termine memorie definito",
    memorieRicevute: "Memorie ricevute",
    audizioneSvolta: "Audizione (se richiesta) svolta",
    contestazioneFormaleInviata: "Contestazione formale inviata",
    controdeduzioniValutate: "Controdeduzioni valutate",
    motivazioneValutazione: "Motivazione finale disponibile",
    propostaEsitoIstruttorio: "Proposta esito istruttorio presente",
  };

  return labels[key] ?? key;
}

export function getPreavvisoRigettoChecklistItems(
  procedimento: ProcedimentoChecklistInput,
): ChecklistItemStatus[] {
  if (!isProcedimentoIstanzaParte(procedimento)) {
    return [];
  }

  const applicabile = Boolean(procedimento.preavvisoRigettoApplicabile);
  const stato = procedimento.statoPreavvisoRigetto;
  const osservazioniRicevute = Boolean(procedimento.osservazioniPreavvisoRicevute);

  return [
    {
      key: "preavvisoValutato",
      label: "Valutazione applicabilita preavviso art. 10-bis",
      required: true,
      completed: stato !== null && stato !== undefined && stato !== "NON_VALUTATO",
    },
    {
      key: "preavvisoInviato",
      label: "Preavviso di rigetto inviato (se applicabile)",
      required: applicabile,
      completed:
        !applicabile ||
        stato === "INVIATO" ||
        stato === "OSSERVAZIONI_RICEVUTE" ||
        stato === "OSSERVAZIONI_VALUTATE" ||
        procedimento.dataPreavvisoRigetto instanceof Date,
    },
    {
      key: "termineOsservazioniPreavviso",
      label: "Termine osservazioni preavviso definito",
      required: applicabile,
      completed: !applicabile || procedimento.termineOsservazioniPreavviso instanceof Date,
    },
    {
      key: "osservazioniPreavvisoValutate",
      label: "Osservazioni preavviso valutate (se ricevute)",
      required: applicabile && osservazioniRicevute,
      completed:
        !applicabile ||
        !osservazioniRicevute ||
        stato === "OSSERVAZIONI_VALUTATE" ||
        hasText(procedimento.valutazioneOsservazioniPreavviso),
    },
    {
      key: "motivazioneMancatoPreavviso",
      label: "Motivazione mancato preavviso / non applicabilita",
      required: !applicabile,
      completed:
        applicabile ||
        stato === "NON_APPLICABILE" ||
        hasText(procedimento.motivazioneMancatoPreavviso),
    },
  ];
}

export function getProcedimentoChecklistGuidance(procedimento: ProcedimentoChecklistInput): string {
  if (isProcedimentoUfficio(procedimento)) {
    if (procedimento.tipologia === "AVVIO_DECADENZA") {
      return "Procedimento d ufficio con profilo art. 47: presidiare comunicazione avvio, contestazione formale, termini memorie e motivazione valutativa. Nessun automatismo decisorio.";
    }

    return "Procedimento d ufficio: verificare completezza del contraddittorio (avvio, contestazione, memorie, eventuale audizione, valutazione finale) come supporto istruttorio.";
  }

  if (isProcedimentoIstanzaParte(procedimento)) {
    if (procedimento.preavvisoRigettoApplicabile) {
      return "Procedimento a istanza di parte: il preavviso di rigetto e tracciato come elemento istruttorio quando applicabile secondo valutazione del responsabile.";
    }

    return "Procedimento a istanza di parte: se il preavviso non e applicabile, indicare stato/motivazione istruttoria del mancato preavviso.";
  }

  return "Distinguere origine del procedimento e completezza checklist per supportare la ricostruzione istruttoria del caso.";
}

export function getChecklistContraddittorioItems(
  procedimento: ProcedimentoChecklistInput,
): ChecklistItemStatus[] {
  const keys = [
    "comunicazioneAvvioInviata",
    "termineMemorie",
    "memorieRicevute",
    "audizioneSvolta",
    "contestazioneFormaleInviata",
    "controdeduzioniValutate",
    "motivazioneValutazione",
    "propostaEsitoIstruttorio",
  ];

  const baseItems = keys.map((key) => ({
    key,
    label: formatChecklistItemLabel(key),
    required: isRequiredForTipologia(key, procedimento.tipologia),
    completed: isCompleted(key, procedimento),
  }));

  const preavvisoItems = getPreavvisoRigettoChecklistItems(procedimento);
  return [...baseItems, ...preavvisoItems];
}

export function calculateChecklistCompleteness(procedimento: ProcedimentoChecklistInput): {
  completed: number;
  total: number;
  percentage: number;
  requiredCompleted: number;
  requiredTotal: number;
} {
  const items = getChecklistContraddittorioItems(procedimento);
  const completed = items.filter((item) => item.completed).length;
  const total = items.length;
  const requiredItems = items.filter((item) => item.required);
  const requiredCompleted = requiredItems.filter((item) => item.completed).length;
  const requiredTotal = requiredItems.length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  return {
    completed,
    total,
    percentage,
    requiredCompleted,
    requiredTotal,
  };
}

export function getMissingChecklistItems(procedimento: ProcedimentoChecklistInput): string[] {
  return getChecklistContraddittorioItems(procedimento)
    .filter((item) => item.required && !item.completed)
    .map((item) => item.label);
}

export function isContraddittorioCompleto(procedimento: ProcedimentoChecklistInput): boolean {
  const { requiredCompleted, requiredTotal } = calculateChecklistCompleteness(procedimento);

  if (requiredTotal === 0) {
    return false;
  }

  return requiredCompleted === requiredTotal;
}

export function getProcedimentoWarningLevel(
  procedimento: ProcedimentoChecklistInput,
): ProcedimentoWarningLevel {
  const missingRequired = getMissingChecklistItems(procedimento);
  const incomplete = missingRequired.length > 0;
  const hasEsitoDecadenziale = Boolean(
    procedimento.propostaEsitoIstruttorio && ESITI_DECADENZIALI.has(procedimento.propostaEsitoIstruttorio),
  );
  const hasEsitoSfavorevole = Boolean(
    procedimento.propostaEsitoIstruttorio && ESITI_SFAVOREVOLI_O_RILEVANTI.has(procedimento.propostaEsitoIstruttorio),
  );
  const istanzaParte = isProcedimentoIstanzaParte(procedimento);
  const ufficio = isProcedimentoUfficio(procedimento);
  const preavvisoApplicabile = Boolean(procedimento.preavvisoRigettoApplicabile);
  const statoPreavviso = procedimento.statoPreavvisoRigetto;
  const preavvisoInviato =
    statoPreavviso === "INVIATO" ||
    statoPreavviso === "OSSERVAZIONI_RICEVUTE" ||
    statoPreavviso === "OSSERVAZIONI_VALUTATE" ||
    procedimento.dataPreavvisoRigetto instanceof Date;
  const osservazioniRicevute = Boolean(procedimento.osservazioniPreavvisoRicevute);
  const osservazioniValutate =
    statoPreavviso === "OSSERVAZIONI_VALUTATE" || hasText(procedimento.valutazioneOsservazioniPreavviso);
  const art47UfficioCritico = ufficio && procedimento.tipologia === "AVVIO_DECADENZA";
  const hasAvvioContestazioneMinima =
    Boolean(procedimento.comunicazioneAvvioInviata) && Boolean(procedimento.contestazioneFormaleInviata);

  if (hasEsitoDecadenziale && incomplete) {
    return "danger";
  }

  if (hasEsitoSfavorevole && incomplete) {
    return "danger";
  }

  if (istanzaParte && preavvisoApplicabile && !preavvisoInviato) {
    return "danger";
  }

  if (osservazioniRicevute && !osservazioniValutate) {
    return "danger";
  }

  if (art47UfficioCritico && !hasAvvioContestazioneMinima) {
    return "danger";
  }

  if (incomplete) {
    return "warning";
  }

  return "default";
}

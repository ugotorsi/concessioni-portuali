export type ProcedimentoWarningLevel = "default" | "warning" | "danger";

export interface ProcedimentoChecklistInput {
  tipologia?: string | null;
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

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
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

  return keys.map((key) => ({
    key,
    label: formatChecklistItemLabel(key),
    required: isRequiredForTipologia(key, procedimento.tipologia),
    completed: isCompleted(key, procedimento),
  }));
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

  if (hasEsitoDecadenziale && incomplete) {
    return "danger";
  }

  if (incomplete) {
    return "warning";
  }

  return "default";
}

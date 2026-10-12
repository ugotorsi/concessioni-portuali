import { formatEnumLabel } from "@/lib/utils";

export const DECISIONE_PROCEDIMENTO_TIPO_VALUES = [
  "DECADENZA_DICHIARATA",
  "REVOCA_DISPOSTA",
  "ARCHIVIAZIONE",
  "CHIUSURA_SENZA_EFFETTO",
] as const;

export const EFFETTO_TITOLO_PROCEDIMENTO_VALUES = [
  "NESSUNO",
  "CONCESSIONE_DECADUTA",
  "CONCESSIONE_REVOCATA",
] as const;

export type DecisioneProcedimentoTipoValue = (typeof DECISIONE_PROCEDIMENTO_TIPO_VALUES)[number];
export type EffettoTitoloProcedimentoValue = (typeof EFFETTO_TITOLO_PROCEDIMENTO_VALUES)[number];

export interface DecisionOutcome {
  tipoDecisione: DecisioneProcedimentoTipoValue;
  statoFinaleProcedimento: "CONCLUSO" | "ARCHIVIATO";
  effettoTitolo: EffettoTitoloProcedimentoValue;
  statoConcessioneSuccessivo: "DECADUTA" | "REVOCATA" | null;
  requiresChecklist: boolean;
  requiresDocumento: boolean;
}

export interface DecisionRulePreview extends DecisionOutcome {
  label: string;
  effettoLabel: string;
}

function getAllowedDecisionTypes(
  tipologiaProcedimento: string,
): DecisioneProcedimentoTipoValue[] {
  if (tipologiaProcedimento === "AVVIO_DECADENZA") {
    return ["DECADENZA_DICHIARATA", "ARCHIVIAZIONE"];
  }

  if (tipologiaProcedimento === "AVVIO_REVOCA") {
    return ["REVOCA_DISPOSTA", "ARCHIVIAZIONE"];
  }

  return ["CHIUSURA_SENZA_EFFETTO", "ARCHIVIAZIONE"];
}

export function isChecklistMandatoryForTipologia(tipologiaProcedimento: string): boolean {
  return tipologiaProcedimento === "AVVIO_DECADENZA" || tipologiaProcedimento === "AVVIO_REVOCA";
}

export function resolveDecisionOutcome(input: {
  tipologiaProcedimento: string;
  tipoDecisione: DecisioneProcedimentoTipoValue;
}): DecisionOutcome {
  const allowed = getAllowedDecisionTypes(input.tipologiaProcedimento);

  if (!allowed.includes(input.tipoDecisione)) {
    throw new Error("Decisione non consentita per la tipologia di procedimento selezionata.");
  }

  const requiresChecklist = isChecklistMandatoryForTipologia(input.tipologiaProcedimento);

  switch (input.tipoDecisione) {
    case "DECADENZA_DICHIARATA":
      return {
        tipoDecisione: input.tipoDecisione,
        statoFinaleProcedimento: "CONCLUSO",
        effettoTitolo: "CONCESSIONE_DECADUTA",
        statoConcessioneSuccessivo: "DECADUTA",
        requiresChecklist,
        requiresDocumento: true,
      };
    case "REVOCA_DISPOSTA":
      return {
        tipoDecisione: input.tipoDecisione,
        statoFinaleProcedimento: "CONCLUSO",
        effettoTitolo: "CONCESSIONE_REVOCATA",
        statoConcessioneSuccessivo: "REVOCATA",
        requiresChecklist,
        requiresDocumento: true,
      };
    case "ARCHIVIAZIONE":
      return {
        tipoDecisione: input.tipoDecisione,
        statoFinaleProcedimento: "ARCHIVIATO",
        effettoTitolo: "NESSUNO",
        statoConcessioneSuccessivo: null,
        requiresChecklist,
        requiresDocumento: false,
      };
    case "CHIUSURA_SENZA_EFFETTO":
      return {
        tipoDecisione: input.tipoDecisione,
        statoFinaleProcedimento: "CONCLUSO",
        effettoTitolo: "NESSUNO",
        statoConcessioneSuccessivo: null,
        requiresChecklist: false,
        requiresDocumento: false,
      };
    default:
      throw new Error("Decisione non supportata.");
  }
}

export function getDecisionRulePreviewForTipologia(tipologiaProcedimento: string): DecisionRulePreview[] {
  return getAllowedDecisionTypes(tipologiaProcedimento).map((tipoDecisione) => {
    const outcome = resolveDecisionOutcome({ tipologiaProcedimento, tipoDecisione });
    const effettoLabel =
      outcome.effettoTitolo === "NESSUNO"
        ? "Nessun effetto sul titolo"
        : outcome.effettoTitolo === "CONCESSIONE_DECADUTA"
          ? "Aggiorna concessione a DECADUTA"
          : "Aggiorna concessione a REVOCATA";

    return {
      ...outcome,
      label: formatEnumLabel(tipoDecisione),
      effettoLabel,
    };
  });
}

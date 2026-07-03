const LETTERA_LABELS: Record<string, string> = {
  A_MANCATA_ESECUZIONE_OPERE: "Lettera a - Mancata esecuzione opere prescritte",
  B_NON_USO_O_CATTIVO_USO: "Lettera b - Non uso o cattivo uso della concessione",
  C_MUTAMENTO_SCOPO_NON_AUTORIZZATO: "Lettera c - Mutamento scopo non autorizzato",
  D_OMESSO_PAGAMENTO_CANONE: "Lettera d - Omesso pagamento canone",
  E_SUBINGRESSO_ABUSIVO: "Lettera e - Subingresso abusivo",
  F_INADEMPIMENTO_OBBLIGHI: "Lettera f - Inadempimento obblighi concessori",
  ALTRO_PROFILO_ISTRUTTORIO: "Altro profilo istruttorio art. 47",
};

const LETTERA_DESCRIPTIONS: Record<string, string> = {
  A_MANCATA_ESECUZIONE_OPERE:
    "Possibile inadempimento su opere o adeguamenti imposti nel titolo concessorio.",
  B_NON_USO_O_CATTIVO_USO:
    "Possibile scostamento tra uso assentito e uso effettivo o mancato utilizzo dell'area.",
  C_MUTAMENTO_SCOPO_NON_AUTORIZZATO:
    "Possibile utilizzo del bene per finalita diverse rispetto a quelle autorizzate.",
  D_OMESSO_PAGAMENTO_CANONE:
    "Possibile morosita su canoni o somme dovute correlate al titolo concessorio.",
  E_SUBINGRESSO_ABUSIVO:
    "Possibile subentro o affidamento a terzi senza il necessario titolo autorizzativo.",
  F_INADEMPIMENTO_OBBLIGHI:
    "Possibile inadempimento di obblighi tecnici, manutentivi o documentali previsti dal titolo.",
  ALTRO_PROFILO_ISTRUTTORIO:
    "Profilo istruttorio riconducibile ad art. 47 da qualificare in sede di approfondimento.",
};

const RISCHIO_LABELS: Record<string, string> = {
  BASSO: "Basso",
  MEDIO: "Medio",
  ALTO: "Alto",
  CRITICO: "Critico",
};

export function getArt47Label(lettera: string | null | undefined): string {
  if (!lettera) {
    return "-";
  }

  return LETTERA_LABELS[lettera] ?? lettera;
}

export function getArt47Description(lettera: string | null | undefined): string {
  if (!lettera) {
    return "Nessuna fattispecie art. 47 selezionata.";
  }

  return LETTERA_DESCRIPTIONS[lettera] ?? "Fattispecie da approfondire in istruttoria.";
}

export function getRischioDecadenzaLabel(rischio: string | null | undefined): string {
  if (!rischio) {
    return "-";
  }

  return RISCHIO_LABELS[rischio] ?? rischio;
}

export function getRischioDecadenzaBadgeVariant(
  rischio: string | null | undefined,
): "default" | "success" | "warning" | "danger" {
  if (!rischio) {
    return "default";
  }

  if (rischio === "CRITICO" || rischio === "ALTO") {
    return "danger";
  }

  if (rischio === "MEDIO") {
    return "warning";
  }

  if (rischio === "BASSO") {
    return "success";
  }

  return "default";
}

export function inferArt47FromCriticitaTipologia(tipologia: string): {
  suggestedLettera: string | null;
  suggestedRischio: string | null;
  reason: string;
} {
  switch (tipologia) {
    case "MOROSITA":
      return {
        suggestedLettera: "D_OMESSO_PAGAMENTO_CANONE",
        suggestedRischio: "ALTO",
        reason: "Suggerimento assistivo basato su profilo morosita: richiede verifica istruttoria umana.",
      };
    case "OCCUPAZIONE_DIFFORME":
    case "USO_NON_CONFORME":
      return {
        suggestedLettera: "B_NON_USO_O_CATTIVO_USO",
        suggestedRischio: "MEDIO",
        reason: "Suggerimento assistivo su uso/occupazione: non costituisce valutazione provvedimentale.",
      };
    case "DOCUMENTALE":
    case "MANUTENTIVA":
      return {
        suggestedLettera: "F_INADEMPIMENTO_OBBLIGHI",
        suggestedRischio: "MEDIO",
        reason: "Suggerimento assistivo per inadempimenti obblighi: da confermare in istruttoria.",
      };
    default:
      return {
        suggestedLettera: null,
        suggestedRischio: null,
        reason: "Nessuna inferenza automatica: classificazione demandata all'operatore.",
      };
  }
}

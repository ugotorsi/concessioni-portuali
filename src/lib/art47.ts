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
    "Possibile utilizzo del bene per finalità diverse rispetto a quelle autorizzate.",
  D_OMESSO_PAGAMENTO_CANONE:
    "Possibile morosità su canoni o somme dovute correlate al titolo concessorio.",
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

const ESITO_REGOLARIZZAZIONE_LABELS: Record<string, string> = {
  DA_VERIFICARE: "Da verificare",
  PARZIALE: "Parziale",
  COMPLETA: "Completa",
  NON_IDONEA: "Non idonea",
  SUPERATA_DA_PROVVEDIMENTO: "Superata da provvedimento",
};

const ESITO_REGOLARIZZAZIONE_DESCRIPTIONS: Record<string, string> = {
  DA_VERIFICARE: "La regolarizzazione è dichiarata ma richiede ancora verifica istruttoria.",
  PARZIALE: "Sono stati adottati interventi solo parzialmente risolutivi.",
  COMPLETA: "Risultano elementi di regolarizzazione completa, da confermare in istruttoria.",
  NON_IDONEA: "La regolarizzazione non è ritenuta idonea rispetto ai rilievi istruttori.",
  SUPERATA_DA_PROVVEDIMENTO: "La posizione è stata superata da successivo provvedimento amministrativo.",
};

export interface CriticitaRegolarizzazioneInput {
  rilevanzaArt47?: boolean | null;
  regolarizzata?: boolean | null;
  esitoRegolarizzazione?: string | null;
  verificataRegolarizzazione?: boolean | null;
}

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

export function getEsitoRegolarizzazioneLabel(esito: string | null | undefined): string {
  if (!esito) {
    return "-";
  }

  return ESITO_REGOLARIZZAZIONE_LABELS[esito] ?? esito;
}

export function getEsitoRegolarizzazioneDescription(esito: string | null | undefined): string {
  if (!esito) {
    return "Nessun esito di regolarizzazione indicato.";
  }

  return ESITO_REGOLARIZZAZIONE_DESCRIPTIONS[esito] ?? "Esito da approfondire in istruttoria.";
}

export function getRegolarizzazioneBadgeVariant(
  esito: string | null | undefined,
): "default" | "success" | "warning" | "danger" {
  if (!esito) {
    return "default";
  }

  if (esito === "COMPLETA") {
    return "success";
  }

  if (esito === "PARZIALE" || esito === "DA_VERIFICARE") {
    return "warning";
  }

  if (esito === "NON_IDONEA") {
    return "danger";
  }

  return "default";
}

export function hasRegolarizzazioneIstruttoriaRilevante(
  criticita: CriticitaRegolarizzazioneInput,
): boolean {
  return Boolean(criticita.regolarizzata);
}

export function getArt47RiskNoteWithRegolarizzazione(
  criticita: CriticitaRegolarizzazioneInput,
): string {
  if (!criticita.rilevanzaArt47) {
    return "La regolarizzazione è un elemento informativo utile al fascicolo istruttorio.";
  }

  if (!criticita.regolarizzata) {
    return "La criticità art. 47 risulta non regolarizzata allo stato degli atti istruttori.";
  }

  if (criticita.esitoRegolarizzazione === "NON_IDONEA") {
    return "La regolarizzazione risulta non idonea e richiede approfondimento istruttorio prima di eventuali determinazioni finali.";
  }

  if (criticita.esitoRegolarizzazione === "DA_VERIFICARE" || !criticita.verificataRegolarizzazione) {
    return "La regolarizzazione è un elemento istruttorio rilevante da valutare prima di eventuali determinazioni finali. Verifica tecnica ancora pendente.";
  }

  if (criticita.esitoRegolarizzazione === "COMPLETA" && criticita.verificataRegolarizzazione) {
    return "La regolarizzazione completa e verificata costituisce elemento istruttorio favorevole, da valutare senza automatismi rispetto a eventuali determinazioni decadenziali.";
  }

  return "La regolarizzazione è un elemento istruttorio rilevante da valutare prima di eventuali determinazioni finali.";
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
        reason: "Suggerimento assistivo basato su profilo morosità: richiede verifica istruttoria umana.",
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

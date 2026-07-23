export const CONCESSION_VERTICAL_VALUES = [
  "PORTUALE_ADSP",
  "MARITTIMA_TURISTICO_RICREATIVA",
  "ALTRA_CONCESSIONE_DEMANIALE",
] as const;

export const LEGAL_FRAMEWORK_VALUES = [
  "ART_36_COD_NAV",
  "ART_18_L_84_1994",
  "ART_37_COD_NAV",
  "ART_47_COD_NAV",
  "DL_400_1993",
  "DIR_2006_123_ART_12",
  "ALTRO",
] as const;

export const CONCESSION_OBJECT_TYPE_VALUES = [
  "AREA_DEMANIALE",
  "BANCHINA",
  "MOLO",
  "SPECCHIO_ACQUEO",
  "PERTINENZA_DEMANIALE",
  "MANUFATTO",
  "LOCALE",
  "ALTRO",
] as const;

export const AWARDING_PROCEDURE_TYPE_VALUES = [
  "DIRETTA",
  "COMPARATIVA_ART37",
  "EVIDENZA_PUBBLICA",
  "RINNOVO",
  "PROROGA_TECNICA",
  "ALTRO",
] as const;

export const REMOVABLE_WORKS_PROFILE_VALUES = [
  "NON_RILEVATO",
  "PREVALENTE_AMOVIBILE",
  "MISTO",
  "PREVALENTE_NON_AMOVIBILE",
] as const;

export const SEASONALITY_PROFILE_VALUES = ["ANNUALE", "STAGIONALE", "MISTO", "NON_RILEVATO"] as const;

export const FEE_REGIME_VALUES = ["PORTUALE", "TURISTICO_RICREATIVO_DL400", "ORDINARIO_DEMANIALE", "ALTRO"] as const;

export const COMPARATIVE_PROCEDURE_STATUS_VALUES = [
  "NON_APPLICABILE",
  "DA_AVVIARE",
  "IN_CORSO",
  "CONCLUSA",
  "CONTENZIOSO",
] as const;

export const THIRD_PARTY_MANAGEMENT_STATUS_VALUES = [
  "DIRETTA",
  "AFFIDAMENTO_AUTORIZZATO",
  "AFFIDAMENTO_DA_VERIFICARE",
  "AFFIDAMENTO_NON_AUTORIZZATO",
] as const;

export const CHECKLIST_PROFILE_VALUES = ["CORE", "PORTUALE_ADSP", "TURISTICO_RICREATIVO", "MISTO"] as const;

type TipologiaBeneValue =
  | "AREA_SCOPERTA"
  | "BANCHINA"
  | "MOLO"
  | "SPECCHIO_ACQUEO"
  | "BOX"
  | "LOCALE"
  | "MANUFATTO"
  | "ALTRO";

type NormaRiferimentoValue = "ART_36_COD_NAV" | "ART_18_L_84_1994" | "ALTRO";

type AttivitaConcessioneValue =
  | "DIPORTO"
  | "COMMERCIALE"
  | "TURISTICO_RICREATIVA"
  | "LOGISTICA"
  | "CANTIERISTICA"
  | "SERVIZI_PORTUALI"
  | "PASSEGGERI"
  | "ALTRO";

export function mapTipologiaBeneToConcessionObjectType(
  tipologiaBene: TipologiaBeneValue,
): (typeof CONCESSION_OBJECT_TYPE_VALUES)[number] {
  switch (tipologiaBene) {
    case "AREA_SCOPERTA":
      return "AREA_DEMANIALE";
    case "BANCHINA":
      return "BANCHINA";
    case "MOLO":
      return "MOLO";
    case "SPECCHIO_ACQUEO":
      return "SPECCHIO_ACQUEO";
    case "BOX":
    case "LOCALE":
      return "LOCALE";
    case "MANUFATTO":
      return "MANUFATTO";
    default:
      return "ALTRO";
  }
}

export function inferDefaultConcessionVertical(input: {
  attivita: AttivitaConcessioneValue;
  normaRiferimento: NormaRiferimentoValue;
}): (typeof CONCESSION_VERTICAL_VALUES)[number] {
  if (input.attivita === "TURISTICO_RICREATIVA" && input.normaRiferimento === "ART_36_COD_NAV") {
    return "MARITTIMA_TURISTICO_RICREATIVA";
  }

  return "PORTUALE_ADSP";
}

export function inferDefaultFeeRegime(input: {
  concessionVertical: (typeof CONCESSION_VERTICAL_VALUES)[number];
  normaRiferimento: NormaRiferimentoValue;
}): (typeof FEE_REGIME_VALUES)[number] {
  if (input.concessionVertical === "MARITTIMA_TURISTICO_RICREATIVA") {
    return "TURISTICO_RICREATIVO_DL400";
  }

  if (input.normaRiferimento === "ART_18_L_84_1994") {
    return "PORTUALE";
  }

  return "ALTRO";
}

export function inferInitialLegalFrameworks(input: {
  normaRiferimento: NormaRiferimentoValue;
  concessionVertical: (typeof CONCESSION_VERTICAL_VALUES)[number];
  hasArt47Signals: boolean;
}): Array<(typeof LEGAL_FRAMEWORK_VALUES)[number]> {
  const frameworks: Array<(typeof LEGAL_FRAMEWORK_VALUES)[number]> = [];

  if (input.normaRiferimento === "ART_18_L_84_1994") {
    frameworks.push("ART_18_L_84_1994", "ART_36_COD_NAV");
  } else if (input.normaRiferimento === "ART_36_COD_NAV") {
    frameworks.push("ART_36_COD_NAV");
  } else {
    frameworks.push("ALTRO");
  }

  if (input.concessionVertical === "MARITTIMA_TURISTICO_RICREATIVA") {
    frameworks.push("ART_37_COD_NAV", "DL_400_1993", "DIR_2006_123_ART_12");
  }

  if (input.hasArt47Signals) {
    frameworks.push("ART_47_COD_NAV");
  }

  return [...new Set(frameworks)];
}

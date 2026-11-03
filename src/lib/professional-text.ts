const SOURCE_LIMIT_LABELS: Record<string, string> = {
  NO_USABLE_SOURCE: "nessuna fonte utilizzabile",
  ADVERSE_NOT_COMPLETED: "ricerca degli orientamenti contrari non completata",
  TEMPORAL_UNCERTAIN: "applicabilità temporale incerta",
  TEMPORAL_NOT_ASSESSED: "vigenza temporale non valutata",
  TEMPORALLY_NOT_APPLICABLE: "non applicabile ratione temporis",
  MANUAL_REVIEW_REQUIRED: "revisione manuale necessaria",
  IDENTITY_UNVERIFIED: "identità della fonte non verificata",
  IDENTITY_MISMATCH: "identità della fonte non corrispondente",
  CONTENT_UNVERIFIED: "contenuto della fonte non verificato",
  CONTENT_MISMATCH: "contenuto della fonte non corrispondente",
  EXACT_RETRIEVAL_REQUIRED: "recupero del testo ufficiale necessario",
  EXACT_RETRIEVAL_BLOCKED: "recupero del testo ufficiale non riuscito",
  MISSING_FULL_TEXT: "testo integrale mancante",
  CITATION_ANCHOR_REQUIRED: "passaggio citato da individuare",
  SECONDARY_NOT_PRIMARY_USABLE: "fonte secondaria non utilizzabile come primaria",
  MISSION_NOT_CURRENT: "ricerca non aggiornata",
  AUTHORITY_CONFLICT: "autorità favorevoli e contrarie in conflitto",
  PROFESSIONAL_REVIEW_REQUIRED: "revisione professionale necessaria",
};

export function sourceLimitLabel(code: string): string {
  return SOURCE_LIMIT_LABELS[code] ?? code.toLocaleLowerCase("it-IT").replaceAll("_", " ");
}

export function documentReferenceLabel(basisRef: string): string {
  return humanizeProfessionalText(basisRef);
}

/** Converts internal evidence references and status codes into professional Italian wording. */
export function humanizeProfessionalText(text: string): string {
  return text
    .replace(/\bDOCUMENT_(\d+)\.PAGE_(\d+)\b/g, "documento $1, pag. $2")
    .replace(/\bDOCUMENT_(\d+)\b/g, "documento $1")
    .replace(/\bGap fonti:/g, "Limiti delle fonti:")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (code) => sourceLimitLabel(code));
}

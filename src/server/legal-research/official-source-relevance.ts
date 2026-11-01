import { discoverItalianLegalReferences } from "@/server/intake/legal-reference-discovery/parser";

export const OFFICIAL_SOURCE_RELEVANCE_VERSION = "OFFICIAL_SOURCE_RELEVANCE_V2" as const;

export type OfficialSourceRelevanceStatus =
  | "PERTINENTE_VERIFICATA"
  | "NON_PERTINENTE"
  | "NON_VERIFICABILE";

export type OfficialSourceRelevanceReason =
  | "OFFICIAL_TEXT_ACQUIRED_RELEVANT_ARTICLE"
  | "OFFICIAL_TEXT_ACQUIRED_NO_RELEVANT_ARTICLE"
  | "OFFICIAL_SOURCE_TEMPORAL_OR_IDENTITY_REVIEW_REQUIRED"
  | "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE"
  | "REGIONAL_OR_SPECIAL_SERIES_ACT_NOT_COVERED"
  | "LEGISLATIVE_REFERENCE_NOT_RECOGNIZED"
  | "OFFICIAL_LOOKUP_NOT_UNIQUE"
  | "OFFICIAL_IDENTITY_MISMATCH"
  | "OFFICIAL_ACQUISITION_FAILED"
  | "OFFICIAL_ACQUISITION_LIMIT_REACHED";

export type OfficialSourceRelevance = Readonly<{
  version: typeof OFFICIAL_SOURCE_RELEVANCE_VERSION;
  status: OfficialSourceRelevanceStatus;
  reason: OfficialSourceRelevanceReason;
  checkedAt: string;
  officialUrl: string | null;
  citation: string | null;
  failureCode?: string;
}>;

export const OFFICIAL_SOURCE_RELEVANCE_LABELS: Readonly<Record<OfficialSourceRelevanceReason, string>> = {
  OFFICIAL_TEXT_ACQUIRED_RELEVANT_ARTICLE: "Testo ufficiale acquisito da Normattiva; articolo pertinente individuato.",
  OFFICIAL_TEXT_ACQUIRED_NO_RELEVANT_ARTICLE: "Testo ufficiale acquisito da Normattiva, ma nessun articolo pertinente al quesito: fonte esclusa.",
  OFFICIAL_SOURCE_TEMPORAL_OR_IDENTITY_REVIEW_REQUIRED: "Testo ufficiale acquisito, ma vigenza alla data di riferimento o identità non confermate.",
  SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE: "Fonte non pubblicata su un sito ufficiale coperto dalla verifica automatica.",
  REGIONAL_OR_SPECIAL_SERIES_ACT_NOT_COVERED: "Atto regionale o di serie speciale: non verificabile automaticamente su Normattiva.",
  LEGISLATIVE_REFERENCE_NOT_RECOGNIZED: "Estremi dell'atto non riconoscibili: verifica ufficiale impossibile.",
  OFFICIAL_LOOKUP_NOT_UNIQUE: "Atto non individuato in modo univoco sul servizio ufficiale Normattiva.",
  OFFICIAL_IDENTITY_MISMATCH: "Gli estremi ufficiali non coincidono con quelli indicati dal fornitore.",
  OFFICIAL_ACQUISITION_FAILED: "Acquisizione del testo ufficiale non riuscita.",
  OFFICIAL_ACQUISITION_LIMIT_REACHED: "Limite autorizzato di acquisizioni ufficiali raggiunto: fonte non verificata.",
};

const NATIONAL_ACT_TYPES = [
  ["DECRETO DEL PRESIDENTE DELLA REPUBBLICA", "DECRETO_PRESIDENTE_REPUBBLICA"],
  ["DECRETO LEGISLATIVO", "DECRETO_LEGISLATIVO"],
  ["DECRETO-LEGGE", "DECRETO_LEGGE"],
  ["DECRETO LEGGE", "DECRETO_LEGGE"],
  ["LEGGE", "LEGGE"],
] as const;

export type ProviderLegislationReference = Readonly<{
  kind: "LEGISLATION";
  authorityHint: null;
  chamberSection: null;
  actType: string;
  actNumber: string;
  year: number;
}>;

/**
 * Recognizes national acts in provider titles such as
 * "Repubblica Italiana 21 December 2001, LEGGE n. 443 (...)" or
 * "DECRETO LEGISLATIVO 15 luglio 2015, n. 112". Regional and provincial acts are excluded.
 */
export function parseProviderLegislationReference(input: {
  title?: string | null;
  officialIdentifier?: string | null;
}): ProviderLegislationReference | null {
  const head = (input.title ?? "").split("(")[0];
  const text = [input.officialIdentifier, head].filter(Boolean).join(" ");
  const discovered = discoverItalianLegalReferences(text)
    .find((reference) => reference.kind === "LEGISLATION" && reference.actType && reference.actNumber && reference.year);
  if (discovered) {
    return {
      kind: "LEGISLATION",
      authorityHint: null,
      chamberSection: null,
      actType: discovered.actType!,
      actNumber: discovered.actNumber!,
      year: discovered.year!,
    };
  }
  // Only the act heading is considered: parenthetical subjects often cite other acts.
  const title = head.toUpperCase();
  if (/LEGGE\s+(REGIONALE|PROVINCIALE|COSTITUZIONALE)|REGIONE\s|PROVINCIA\s/.test(title)) return null;
  for (const [label, actType] of NATIONAL_ACT_TYPES) {
    const index = title.indexOf(label);
    if (index < 0) continue;
    const after = title.slice(index + label.length);
    const number = /^\s*(?:\d{1,2}\s+[A-ZÀ-Ü]+\s+\d{4})?\s*,?\s*N\.\s*(\d+[A-Z]?)\b/.exec(after);
    if (!number) return null;
    const dates = [...title.matchAll(/\b\d{1,2}\s+[A-ZÀ-Ü]+\s+(\d{4})\b/g)];
    const year = dates.length > 0 ? Number(dates[0][1]) : NaN;
    if (!Number.isInteger(year) || year < 1800 || year > 2100) return null;
    return { kind: "LEGISLATION", authorityHint: null, chamberSection: null, actType, actNumber: number[1], year };
  }
  return null;
}

/**
 * Returns the Normattiva detail URL for a candidate published on Normattiva or, for
 * national acts (Serie Generale), on the Gazzetta Ufficiale ELI endpoint.
 */
export function officialNormattivaUrl(input: {
  sourceUrl?: string | null;
  officialIdentifier: string;
}): { url: string } | { reason: OfficialSourceRelevanceReason } {
  let url: URL;
  try {
    url = new URL(input.sourceUrl ?? "");
  } catch {
    return { reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" };
  }
  if (url.protocol !== "https:") return { reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" };
  if (url.hostname === "www.normattiva.it") {
    return url.searchParams.get("atto.codiceRedazionale") === input.officialIdentifier
      ? { url: url.toString() }
      : { reason: "OFFICIAL_IDENTITY_MISMATCH" };
  }
  if (url.hostname === "www.gazzettaufficiale.it") {
    const eli = /^\/eli\/id\/(\d{4})\/(\d{2})\/(\d{2})\/([A-Z0-9]+)\/([a-z0-9]+)\/?$/i.exec(url.pathname);
    if (!eli) return { reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" };
    if (eli[5].toLowerCase() !== "sg") return { reason: "REGIONAL_OR_SPECIAL_SERIES_ACT_NOT_COVERED" };
    if (eli[4] !== input.officialIdentifier) return { reason: "OFFICIAL_IDENTITY_MISMATCH" };
    const detail = new URL("https://www.normattiva.it/atto/caricaDettaglioAtto");
    detail.searchParams.set("atto.dataPubblicazioneGazzetta", `${eli[1]}-${eli[2]}-${eli[3]}`);
    detail.searchParams.set("atto.codiceRedazionale", eli[4]);
    return { url: detail.toString() };
  }
  return { reason: "SOURCE_NOT_ON_SUPPORTED_OFFICIAL_SITE" };
}

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("it-IT");
}

// Generic interrogative or procedural words that never establish legal pertinence on their own.
const NON_DISCRIMINATING_STEMS = new Set([
  "concess", "discipl", "regola", "indicat", "effetti", "previst", "prevista", "relativ", "normati",
  "eventua", "applica", "second", "quale", "quali", "rispett", "riferim", "ambito", "materia",
  "caso", "modalit", "present", "proprio", "partico", "general", "termini",
]);

const PORT_DOMAIN_MARKERS = /(demani|marittim|portual|\bport[oi]\b|navigazion|autorita di sistema portuale)/;

export type RelevantArticle = Readonly<{
  section: string;
  anchor: string;
  relevantText: string;
  matchedTerms: readonly string[];
}>;

/**
 * Selects the article most pertinent to the research question. An article is pertinent only if it
 * concerns concessions, belongs to the port/maritime domain (by its own text or the act title) and
 * matches at least two discriminating terms of the question.
 */
export function selectRelevantArticle(input: {
  articles: readonly Readonly<{ anchor: string; text: string }>[];
  researchQuestion: string;
  actTitle: string | null;
}): RelevantArticle | null {
  const terms = [...new Set(normalized(input.researchQuestion)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 6)
    .map((term) => term.slice(0, 7))
    .filter((term) => !NON_DISCRIMINATING_STEMS.has(term)))];
  const actInDomain = PORT_DOMAIN_MARKERS.test(normalized(input.actTitle ?? ""));
  const ranked = input.articles
    .map((article) => {
      const text = normalized(article.text);
      const matchedTerms = terms.filter((term) => text.includes(term));
      const inDomain = actInDomain || PORT_DOMAIN_MARKERS.test(text);
      return { anchor: article.anchor, original: article.text, text, matchedTerms, inDomain };
    })
    .filter((article) => article.text.includes("concession") && article.inDomain && article.matchedTerms.length >= 2)
    .sort((left, right) => right.matchedTerms.length - left.matchedTerms.length
      || left.anchor.localeCompare(right.anchor));
  const selected = ranked[0];
  if (!selected) return null;
  const articleNumber = /^art_(.+)$/.exec(selected.anchor)?.[1]?.replace(/_/g, "-");
  return {
    section: articleNumber ? `Art. ${articleNumber}` : selected.anchor,
    anchor: selected.anchor,
    relevantText: selected.original.replace(/\s+/g, " ").trim().slice(0, 4000),
    matchedTerms: selected.matchedTerms,
  };
}

export function officialSourceRelevance(input: {
  status: OfficialSourceRelevanceStatus;
  reason: OfficialSourceRelevanceReason;
  checkedAt: Date;
  officialUrl?: string | null;
  citation?: string | null;
  failureCode?: string;
}): OfficialSourceRelevance {
  return {
    version: OFFICIAL_SOURCE_RELEVANCE_VERSION,
    status: input.status,
    reason: input.reason,
    checkedAt: input.checkedAt.toISOString(),
    officialUrl: input.officialUrl ?? null,
    citation: input.citation ?? null,
    ...(input.failureCode ? { failureCode: input.failureCode.slice(0, 120) } : {}),
  };
}

export function readOfficialSourceRelevance(candidate: unknown): OfficialSourceRelevance | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = (candidate as { officialRelevance?: unknown }).officialRelevance;
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<OfficialSourceRelevance>;
  return record.version === OFFICIAL_SOURCE_RELEVANCE_VERSION
    && (record.status === "PERTINENTE_VERIFICATA" || record.status === "NON_PERTINENTE" || record.status === "NON_VERIFICABILE")
    && typeof record.reason === "string"
    && record.reason in OFFICIAL_SOURCE_RELEVANCE_LABELS
    ? record as OfficialSourceRelevance
    : null;
}

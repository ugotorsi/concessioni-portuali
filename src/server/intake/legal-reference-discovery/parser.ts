export const LEGAL_REFERENCE_DISCOVERY_VERSION = "LEGAL_REFERENCE_DISCOVERY_V1" as const;

export type LegalReferenceKind = "LEGISLATION" | "CODE" | "CASE_LAW";

export interface DiscoveredLegalReference {
  kind: LegalReferenceKind;
  observedText: string;
  characterStart: number;
  characterEnd: number;
  normalizedKey: string;
  authorityHint: string | null;
  actType: string | null;
  actNumber: string | null;
  year: number | null;
  article: string | null;
  subArticle: string | null;
  chamberSection: string | null;
}

type Candidate = DiscoveredLegalReference & { priority: number };

const ARTICLE_SUFFIX = "bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies";
const ARTICLE = `(\\d+)(?:\\s*[- ]\\s*(${ARTICLE_SUFFIX}))?`;
const ACT = "legge|l\\.?|d\\.?\\s*lgs\\.?|d\\.?\\s*l\\.?|d\\.?\\s*p\\.?\\s*r\\.?|l\\.?\\s*r\\.?";
const CODE = "(c\\.?\\s*p\\.?\\s*c\\.?|c\\.?\\s*p\\.?\\s*p\\.?|c\\.?\\s*p\\.?\\s*a\\.?|c\\.?\\s*c\\.?|c\\.?\\s*p\\.?)";

function cleanToken(value: string): string {
  return value.toLowerCase().replace(/[.\s]/g, "");
}

function normalizeActType(value: string): string {
  const token = cleanToken(value);
  if (token === "legge" || token === "l") return "LEGGE";
  if (token === "dlgs") return "DECRETO_LEGISLATIVO";
  if (token === "dl") return "DECRETO_LEGGE";
  if (token === "dpr") return "DECRETO_PRESIDENTE_REPUBBLICA";
  return "LEGGE_REGIONALE";
}

function normalizeCode(value: string): string {
  const token = cleanToken(value);
  if (token === "cc") return "CODICE_CIVILE";
  if (token === "cpc") return "CODICE_PROCEDURA_CIVILE";
  if (token === "cp") return "CODICE_PENALE";
  if (token === "cpp") return "CODICE_PROCEDURA_PENALE";
  return "CODICE_PROCESSO_AMMINISTRATIVO";
}

function normalizeAuthority(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^CASS/.test(compact)) {
    if (compact.includes("CIVILE")) return "CASSAZIONE CIVILE";
    if (compact.includes("PENALE")) return "CASSAZIONE PENALE";
    return "CASSAZIONE";
  }
  if (/^CONS\.? STATO$/.test(compact)) return "CONSIGLIO DI STATO";
  if (/^CORTE COST\.?$/.test(compact)) return "CORTE COSTITUZIONALE";
  return compact.replace(/,$/, "");
}

function normalizeYear(value: string): number | null {
  const year = Number(value);
  return year >= 1000 && year <= 9999 ? year : null;
}

function normalizeRegionalJurisdiction(value: string | undefined): string | null {
  return value?.normalize("NFKC").replace(/[^\p{L}]+/gu, " ").trim().toUpperCase() || null;
}

function addMatches(
  text: string,
  expression: RegExp,
  priority: number,
  build: (match: RegExpExecArray) => Omit<Candidate, "observedText" | "characterStart" | "characterEnd" | "priority"> | null,
  candidates: Candidate[],
): void {
  for (const match of text.matchAll(expression)) {
    const characterStart = match.index;
    const observedText = match[0];
    const normalized = build(match);
    if (
      !normalized
      || observedText.length > 500
      || normalized.normalizedKey.length > 500
      || (normalized.authorityHint?.length ?? 0) > 200
      || (normalized.actType?.length ?? 0) > 100
      || (normalized.actNumber?.length ?? 0) > 100
      || (normalized.article?.length ?? 0) > 100
      || (normalized.subArticle?.length ?? 0) > 50
      || (normalized.chamberSection?.length ?? 0) > 100
    ) {
      continue;
    }
    candidates.push({
      ...normalized,
      observedText,
      characterStart,
      characterEnd: characterStart + observedText.length,
      priority,
    });
  }
}

function legislationCandidate(input: {
  actType: string;
  actNumber: string;
  year: string;
  regionalJurisdiction?: string;
  article?: string;
  subArticle?: string;
}): Omit<Candidate, "observedText" | "characterStart" | "characterEnd" | "priority"> | null {
  const actType = normalizeActType(input.actType);
  const year = normalizeYear(input.year);
  if (year === null) return null;

  const regionalJurisdiction = actType === "LEGGE_REGIONALE"
    ? normalizeRegionalJurisdiction(input.regionalJurisdiction)
    : null;
  const article = input.article ?? null;
  const subArticle = input.subArticle?.toLowerCase() ?? null;
  return {
    kind: "LEGISLATION",
    normalizedKey: [actType, regionalJurisdiction, input.actNumber, input.year, article, subArticle]
      .filter(Boolean).join(":"),
    authorityHint: null,
    actType,
    actNumber: input.actNumber,
    year,
    article,
    subArticle,
    chamberSection: null,
  };
}

function collectLegislation(text: string, candidates: Candidate[]): void {
  addMatches(
    text,
    new RegExp(`\\b(?:art\\.?|articolo)\\s+${ARTICLE}\\s*(?:,?\\s*(?:della|del|dello|dell['’])\\s+)?(${ACT})\\s*(?:([A-Za-zÀ-ÿ]+)\\s+)?(?:n\\.?\\s*)?(\\d+)\\s*[/\\-]\\s*(\\d{4})`, "giu"),
    40,
    (match) => legislationCandidate({
      article: match[1], subArticle: match[2], actType: match[3]!, regionalJurisdiction: match[4],
      actNumber: match[5]!, year: match[6]!,
    }),
    candidates,
  );
  addMatches(
    text,
    /\blegge\s+\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+(\d{4})\s*,?\s*n\.?\s*(\d+)\b/giu,
    30,
    (match) => legislationCandidate({ actType: "legge", actNumber: match[2]!, year: match[1]! }),
    candidates,
  );
  addMatches(
    text,
    new RegExp(`\\b(${ACT})\\s*(?:([A-Za-zÀ-ÿ]+)\\s+)?(?:n\\.?\\s*)?(\\d+)\\s*[/\\-]\\s*(\\d{4})`, "giu"),
    20,
    (match) => legislationCandidate({
      actType: match[1]!, regionalJurisdiction: match[2], actNumber: match[3]!, year: match[4]!,
    }),
    candidates,
  );
}

function collectCodes(text: string, candidates: Candidate[]): void {
  addMatches(
    text,
    new RegExp(`\\b(?:art\\.?|articolo)\\s+${ARTICLE}\\s*(?:del|dello|della)?\\s*${CODE}`, "giu"),
    40,
    (match) => {
      const actType = normalizeCode(match[3]!);
      const subArticle = match[2]?.toLowerCase() ?? null;
      return {
        kind: "CODE",
        normalizedKey: [actType, match[1], subArticle].filter(Boolean).join(":"),
        authorityHint: null,
        actType,
        actNumber: null,
        year: null,
        article: match[1]!,
        subArticle,
        chamberSection: null,
      };
    },
    candidates,
  );
}

function collectCaseLaw(text: string, candidates: Candidate[]): void {
  const expression = /\b(Cass(?:azione)?\.?(?:\s+civile|\s+penale)?|Cons\.?\s*Stato|TAR(?:\s+[A-Za-zÀ-ÿ]+)?(?:\s*,\s*[A-Za-zÀ-ÿ]+)?|Corte\s+cost\.?)\s*,?\s*(?:sez\.?\s*([A-Za-z0-9-]+)\s*,?\s*)?n\.?\s*(\d+)\s*[/\-]\s*(\d{4})/giu;
  addMatches(text, expression, 30, (match) => {
    const authorityHint = normalizeAuthority(match[1]!);
    const chamberSection = match[2]?.toUpperCase() ?? null;
    const year = normalizeYear(match[4]!);
    if (year === null) return null;
    return {
      kind: "CASE_LAW",
      normalizedKey: [authorityHint.replace(/[.,]/g, ""), match[3], match[4], chamberSection]
        .filter(Boolean).join(":"),
      authorityHint,
      actType: null,
      actNumber: match[3]!,
      year,
      article: null,
      subArticle: null,
      chamberSection,
    };
  }, candidates);
}

export function discoverItalianLegalReferences(
  text: string,
  maximumReferences = Number.POSITIVE_INFINITY,
): DiscoveredLegalReference[] {
  const candidates: Candidate[] = [];
  collectLegislation(text, candidates);
  collectCodes(text, candidates);
  collectCaseLaw(text, candidates);

  const accepted: Candidate[] = [];
  for (const candidate of candidates.sort((left, right) =>
    right.priority - left.priority || left.characterStart - right.characterStart)) {
    if (accepted.some((item) =>
      candidate.characterStart < item.characterEnd && candidate.characterEnd > item.characterStart)) {
      continue;
    }
    accepted.push(candidate);
    if (accepted.length > maximumReferences) break;
  }

  return accepted
    .sort((left, right) => left.characterStart - right.characterStart)
    .map(({ priority: _priority, ...reference }) => reference);
}
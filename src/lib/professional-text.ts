import type { DocumentCoverageEntry } from "./document-coverage";

function compactPages(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index]!;
    let end = start;
    while (sorted[index + 1] === end + 1) { end += 1; index += 1; }
    parts.push(end > start + 1 ? `${start}-${end}` : end === start + 1 ? `${start}, ${end}` : `${start}`);
  }
  return parts.join(", ");
}

/** Professional summary of how much of each document was actually read. */
export function documentCoverageSummaries(coverage: readonly DocumentCoverageEntry[]): string[] {
  return coverage.map((entry) => {
    const name = humanizeProfessionalText(entry.name);
    if (entry.status !== "AVAILABLE") return `${name}: testo non disponibile per l'analisi.`;
    const parts = [`${entry.pageCount} pagine nel file, ${entry.textPages.length} con testo letto`];
    if (entry.pagesWithoutText.length) parts.push(`senza testo: pag. ${compactPages(entry.pagesWithoutText)}`);
    if (entry.missingOriginalPages.length) parts.push(`pagine dell'originale assenti dal file: ${compactPages(entry.missingOriginalPages)}`);
    return `${name}: ${parts.join("; ")}.`;
  });
}

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

export function isInternalProfessionalDiagnostic(text: string): boolean {
  return /\b(?:COMPILATION|DOCUMENT_INVENTORY|PROCEEDING_IDENTITY)\b/i.test(text);
}

export function documentNamesByReference(
  items: ReadonlyArray<{ evidence: ReadonlyArray<{ basisRef: string | null; documentoId: string }> }>,
  documents: ReadonlyArray<{ id: string; nome: string }>,
): Map<string, string> {
  const namesById = new Map(documents.map((document) => [document.id, document.nome]));
  const candidates = new Map<string, Set<string>>();
  for (const item of items) {
    for (const evidence of item.evidence) {
      const reference = /\bDOCUMENT_\d+\b/i.exec(evidence.basisRef ?? "")?.[0].toUpperCase();
      const name = namesById.get(evidence.documentoId);
      if (!reference || !name) continue;
      const names = candidates.get(reference) ?? new Set<string>();
      names.add(name);
      candidates.set(reference, names);
    }
  }
  return new Map([...candidates].flatMap(([reference, names]) =>
    names.size === 1 ? [[reference, [...names][0]] as const] : []));
}

type ProfessionalGap = string | {
  normalizedText: string;
  payload?: unknown;
  evidence?: ReadonlyArray<{ basisRef: string | null }>;
};

function gapImpact(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("impact" in payload)) return null;
  const impact = payload.impact;
  if (typeof impact !== "string" || !impact.trim() || isInternalProfessionalDiagnostic(impact)) return null;
  if (/^[A-Z][A-Z0-9_]+(?::|$)/.test(impact.trim())) return null;
  return humanizeProfessionalText(impact.trim());
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function professionalGapSummaries(
  gaps: readonly ProfessionalGap[],
  documentNames: ReadonlyMap<string, string> = new Map(),
  coverage: readonly DocumentCoverageEntry[] = [],
): string[] {
  type PageGroup = { pages: Set<number>; impacts: Map<string, Set<number>> };
  const unverifiedPages = new Map<string, PageGroup>();
  const uncertainPages = new Map<string, PageGroup>();
  const pagesNotInFile = new Map<string, Set<number>>();
  const coverageByReference = new Map(coverage.map((entry) => [entry.reference.toUpperCase(), entry]));
  const readable = new Map<string, { impacts: Set<string>; structured: boolean }>();
  const label = (document: string) => {
    const documentNumber = document.match(/\d+/)?.[0] ?? document;
    const name = documentNames.get(document) ?? coverageByReference.get(document)?.name;
    return `documento ${documentNumber}${name ? ` (${humanizeProfessionalText(name)})` : ""}`;
  };
  const addPage = (groups: Map<string, PageGroup>, document: string, page: number, impact: string | null) => {
    const group = groups.get(document) ?? { pages: new Set<number>(), impacts: new Map<string, Set<number>>() };
    group.pages.add(page);
    if (impact) {
      const pages = group.impacts.get(impact) ?? new Set<number>();
      pages.add(page);
      group.impacts.set(impact, pages);
    }
    groups.set(document, group);
  };

  for (const gap of gaps) {
    const text = typeof gap === "string" ? gap : gap.normalizedText;
    const impact = typeof gap === "string" ? null : gapImpact(gap.payload);
    const inventory = /^DOCUMENT_INVENTORY:[^:]+:(UNCERTAIN|MATERIAL):(DOCUMENT_(\d+)\.PAGE_(\d+)):/i.exec(text);
    if (inventory) {
      if (inventory[1].toUpperCase() === "UNCERTAIN") {
        addPage(uncertainPages, `DOCUMENT_${inventory[3]}`, Number(inventory[4]), impact);
      }
      continue;
    }

    if (isInternalProfessionalDiagnostic(text)) continue;
    const pageGap = /(?:nessuna informazione interpretativa verificata.*?estratta da\s+)(DOCUMENT_(\d+))\.PAGE_(\d+)/i.exec(text);
    if (pageGap) {
      const reference = pageGap[1].toUpperCase();
      const page = Number(pageGap[3]);
      const entry = coverageByReference.get(reference);
      if (entry?.status === "AVAILABLE") {
        // The page text was read: the provider found nothing to verify there, which is not a documentary gap.
        if (entry.textPages.includes(page)) continue;
        if (page > entry.pageCount) {
          const pages = pagesNotInFile.get(reference) ?? new Set<number>();
          pages.add(page);
          pagesNotInFile.set(reference, pages);
          continue;
        }
        // Pages without extractable text are reported once from the coverage below.
        if (entry.pagesWithoutText.includes(page)) continue;
      }
      addPage(unverifiedPages, reference, page, impact);
      continue;
    }

    if (/^[A-Z][A-Z0-9_]+(?::|$)/.test(text)) continue;
    const humanized = humanizeProfessionalText(text.trim());
    if (!humanized) continue;
    const refs = typeof gap === "string" ? [] : [
      ...[...text.matchAll(/\bDOCUMENT_\d+\b/gi)].map((match) => match[0].toUpperCase()),
      ...(gap.evidence ?? []).flatMap((evidence) =>
        [...(evidence.basisRef ?? "").matchAll(/\bDOCUMENT_\d+\b/gi)].map((match) => match[0].toUpperCase())),
    ];
    const references = [...new Set(refs)];
    const context = typeof gap === "string" ? ""
      : references.length ? `Riferimenti documentali: ${references.map(label).join(", ")}. `
        : "Riferimenti documentali non determinati. ";
    const description = `${context}${humanized}`;
    const entry = readable.get(description) ?? { impacts: new Set<string>(), structured: false };
    entry.structured ||= typeof gap !== "string";
    if (impact && impact !== humanized) entry.impacts.add(impact);
    readable.set(description, entry);
  }

  const summaries = [...readable].map(([description, entry]) => {
    if (entry.impacts.size) {
      return `${sentence(description)} ${[...entry.impacts].map((impact) => `Effetto indicato, da verificare: ${sentence(impact)}`).join(" ")}`;
    }
    return entry.structured
      ? `${sentence(description)} Effetto sulla valutazione giuridica non specificato: da verificare.`
      : description;
  });
  const pageImpacts = (group: PageGroup) => [...group.impacts].map(([impact, pages]) => {
    const numbers = [...pages].sort((a, b) => a - b).join(", ");
    const prefix = pages.size === 1 ? "la pagina" : "le pagine";
    return ` Effetto indicato per ${prefix} ${numbers}, da verificare: ${sentence(impact)}`;
  }).join("");
  const pageNumbers = (group: PageGroup) => {
    return [...group.pages].sort((a, b) => a - b).join(", ");
  };
  for (const [document, group] of unverifiedPages) {
    summaries.push(
      `Per il ${label(document)}, non è stato possibile verificare il contenuto interpretativo alle pagine ${pageNumbers(group)}. I fatti e i presupposti giuridici eventualmente presenti in queste pagine non possono essere accertati senza verificare il documento originale; l'estrazione incompleta non prova la loro inesistenza.${pageImpacts(group)}`,
    );
  }
  for (const [document, group] of uncertainPages) {
    summaries.push(
      `Per il ${label(document)}, la rilevanza delle pagine ${pageNumbers(group)} richiede una verifica manuale: potrebbero incidere sui fatti, sulle condizioni o sui termini rilevanti e non possono essere escluse dalla valutazione giuridica.${pageImpacts(group)}`,
    );
  }
  for (const entry of coverage) {
    const reference = entry.reference.toUpperCase();
    if (entry.status !== "AVAILABLE") {
      summaries.push(`Il testo del ${label(reference)} non è disponibile (${entry.status === "OCR_REQUIRED" ? "occorre il riconoscimento ottico" : entry.status === "NO_CURRENT_VERSION" ? "nessuna versione corrente del file" : "estrazione non eseguita o non riuscita"}): il suo contenuto non è stato considerato nella valutazione giuridica e non può esserne dedotta l'assenza di fatti rilevanti.`);
      continue;
    }
    if (entry.missingOriginalPages.length) {
      const single = entry.missingOriginalPages.length === 1;
      summaries.push(`Il ${label(reference)} è incompleto: ${single ? "manca" : "mancano"} nel file acquisito ${single ? "la pagina" : "le pagine"} ${compactPages(entry.missingOriginalPages)} dell'originale${entry.internalNumberingEvidence ? ` (${entry.internalNumberingEvidence})` : ""}. ${single ? "Tale pagina non è mai stata disponibile" : "Tali pagine non sono mai state disponibili"} per l'analisi: occorre acquisire il documento integrale prima di trarre conclusioni sui fatti che vi potrebbero essere riportati.`);
    }
    if (entry.pagesWithoutText.length) {
      const single = entry.pagesWithoutText.length === 1;
      summaries.push(`Nel ${label(reference)} ${single ? "la pagina" : "le pagine"} ${compactPages(entry.pagesWithoutText)} ${single ? "è presente nel file ma priva" : "sono presenti nel file ma prive"} di testo estraibile: il contenuto non è stato analizzato. Occorre il riconoscimento ottico o la lettura dell'originale; l'assenza di testo non prova l'assenza di fatti.`);
    }
    const notInFile = pagesNotInFile.get(reference);
    if (notInFile?.size) {
      const single = notInFile.size === 1;
      summaries.push(`L'analisi richiama ${single ? "la pagina" : "le pagine"} ${compactPages([...notInFile])} del ${label(reference)}, che non ${single ? "esiste" : "esistono"} nel file acquisito (${entry.pageCount} pagine): il riferimento va verificato.`);
    }
  }

  return [...new Set(summaries)];
}

/** Converts internal evidence references and status codes into professional Italian wording. */
export function humanizeProfessionalText(text: string): string {
  return text
    .replace(/\bDOCUMENT_(\d+)\.PAGE_(\d+)\b/gi, "documento $1, pag. $2")
    .replace(/\bDOCUMENT_(\d+)\b/gi, "documento $1")
    .replace(/\bGap fonti:/g, "Limiti delle fonti:")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (code) => sourceLimitLabel(code));
}

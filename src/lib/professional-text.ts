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
): string[] {
  type PageGroup = { pages: Set<number>; impacts: Map<string, Set<number>> };
  const unverifiedPages = new Map<string, PageGroup>();
  const uncertainPages = new Map<string, PageGroup>();
  const readable = new Map<string, { impacts: Set<string>; structured: boolean }>();
  const label = (document: string) => {
    const documentNumber = document.match(/\d+/)?.[0] ?? document;
    const name = documentNames.get(document);
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
      addPage(unverifiedPages, pageGap[1].toUpperCase(), Number(pageGap[3]), impact);
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

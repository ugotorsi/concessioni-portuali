export interface DocumentCoverageEntry {
  /** Corpus reference used by Knowledge evidence, e.g. DOCUMENT_1. */
  readonly reference: string;
  readonly documentoId: string;
  readonly name: string;
  readonly status: "AVAILABLE" | "NOT_EXTRACTED" | "OCR_REQUIRED" | "EXTRACTION_FAILED" | "NO_CURRENT_VERSION";
  /** Pages contained in the acquired file (from the successful extraction). */
  readonly pageCount: number;
  readonly textPages: readonly number[];
  /** Pages present in the file whose text could not be extracted. */
  readonly pagesWithoutText: readonly number[];
  /** Pages of the original document missing from the file, inferred only from a consistent internal page numbering. */
  readonly missingOriginalPages: readonly number[];
  readonly internalNumberingEvidence: string | null;
}

interface CoverageCorpusInput {
  readonly documents: ReadonlyArray<{
    readonly reference: string;
    readonly documentoId: string;
    readonly name: string;
    readonly status: DocumentCoverageEntry["status"];
    readonly pageCount: number;
  }>;
  readonly excerpts: ReadonlyArray<{ readonly documentoId: string; readonly pageNumber: number; readonly text: string }>;
}

const INTERNAL_PAGE = /\b(?:PAG(?:INA)?|PAGE)\.?\s*(\d{1,4})(?:\s*(?:DI|OF|\/)\s*\d{1,4})?\b/i;

function internalPageNumber(text: string): number | null {
  const trimmed = text.trim();
  // Only headers and footers: references inside the body ("vedi pag. 7") must not count.
  for (const zone of [trimmed.slice(0, 160), trimmed.slice(-160)]) {
    const match = INTERNAL_PAGE.exec(zone);
    if (match) return Number(match[1]);
  }
  return null;
}

function range(from: number, to: number): number[] {
  return from > to ? [] : Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function missingFromNumbering(pairs: ReadonlyArray<{ filePage: number; internal: number }>): { pages: number[]; evidence: string | null } {
  if (pairs.length < 2) return { pages: [], evidence: null };
  const offsets = pairs.map((pair) => pair.internal - pair.filePage);
  const missing: number[] = [];
  const evidence: string[] = [];
  const first = pairs[0]!;
  if (offsets[0]! > 0 && offsets[1] === offsets[0]) {
    missing.push(...range(1, offsets[0]!));
    evidence.push(`la pagina ${first.filePage} del file reca la numerazione interna ${first.internal}`);
  }
  for (let index = 1; index < pairs.length; index += 1) {
    const jump = offsets[index]! - offsets[index - 1]!;
    const confirmed = index + 1 < pairs.length && offsets[index + 1] === offsets[index];
    if (jump > 0 && confirmed) {
      const previous = pairs[index - 1]!;
      const current = pairs[index]!;
      missing.push(...range(previous.internal + (current.filePage - previous.filePage), current.internal - 1));
      evidence.push(`dopo la pagina interna ${previous.internal} la numerazione prosegue da ${current.internal}`);
    }
  }
  return { pages: [...new Set(missing)].sort((a, b) => a - b), evidence: evidence.length ? evidence.join("; ") : null };
}

export function buildDocumentCoverage(corpus: CoverageCorpusInput): DocumentCoverageEntry[] {
  return corpus.documents.map((document) => {
    const excerpts = corpus.excerpts
      .filter((excerpt) => excerpt.documentoId === document.documentoId && excerpt.text.trim())
      .sort((left, right) => left.pageNumber - right.pageNumber);
    const textPages = excerpts.map((excerpt) => excerpt.pageNumber);
    const textSet = new Set(textPages);
    const pagesWithoutText = document.status === "AVAILABLE"
      ? range(1, document.pageCount).filter((page) => !textSet.has(page))
      : [];
    const pairs = excerpts.flatMap((excerpt) => {
      const internal = internalPageNumber(excerpt.text);
      return internal === null ? [] : [{ filePage: excerpt.pageNumber, internal }];
    });
    const numbering = missingFromNumbering(pairs);
    return {
      reference: document.reference,
      documentoId: document.documentoId,
      name: document.name,
      status: document.status,
      pageCount: document.pageCount,
      textPages,
      pagesWithoutText,
      missingOriginalPages: numbering.pages,
      internalNumberingEvidence: numbering.evidence,
    };
  });
}

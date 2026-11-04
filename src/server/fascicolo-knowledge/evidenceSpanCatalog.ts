import { createHash } from "node:crypto";

export const FASCICOLO_EVIDENCE_SPAN_CATALOG_VERSION =
  "FASCICOLO_EVIDENCE_SPAN_CATALOG_V1" as const;

export interface EvidenceSpanSource {
  readonly reference: string;
  readonly pageNumber: number;
  readonly documentVersionId: string;
  readonly text: string;
  readonly textSha256: string;
}

export interface FascicoloEvidenceSpan {
  readonly id: string;
  readonly basisRef: string;
  readonly documentVersionId: string;
  readonly pageNumber: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly textSha256: string;
  readonly quoteSha256: string;
}

const MAX_SPAN_CHARACTERS = 900;
const MIN_SOFT_BREAK_CHARACTERS = 180;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function trimmedRange(text: string, startOffset: number, endOffset: number) {
  let start = startOffset;
  let end = endOffset;
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

function preferredBreak(text: string, startOffset: number, hardEnd: number): number {
  const minimum = Math.min(hardEnd, startOffset + MIN_SOFT_BREAK_CHARACTERS);
  for (let index = hardEnd; index > minimum; index -= 1) {
    const previous = text[index - 1];
    const current = text[index];
    if (previous === "\n") return index;
    if (current && /\s/u.test(current) && /[.!?;:]/u.test(previous)) return index;
  }
  for (let index = hardEnd; index > minimum; index -= 1) {
    if (/\s/u.test(text[index] ?? "")) return index;
  }
  return hardEnd;
}

function spanId(input: {
  basisRef: string;
  documentVersionId: string;
  startOffset: number;
  endOffset: number;
  textSha256: string;
  quoteSha256: string;
}): string {
  return `EVIDENCE_${digest(JSON.stringify(input))}`;
}

export function buildFascicoloEvidenceSpanCatalog(
  sources: readonly EvidenceSpanSource[],
): readonly FascicoloEvidenceSpan[] {
  const spans: FascicoloEvidenceSpan[] = [];
  for (const source of sources) {
    let cursor = 0;
    while (cursor < source.text.length) {
      const hardEnd = Math.min(source.text.length, cursor + MAX_SPAN_CHARACTERS);
      const candidateEnd = hardEnd === source.text.length
        ? hardEnd
        : preferredBreak(source.text, cursor, hardEnd);
      const range = trimmedRange(source.text, cursor, candidateEnd);
      if (range.end > range.start) {
        const text = source.text.slice(range.start, range.end);
        const quoteSha256 = digest(text);
        const identity = {
          basisRef: source.reference,
          documentVersionId: source.documentVersionId,
          startOffset: range.start,
          endOffset: range.end,
          textSha256: source.textSha256,
          quoteSha256,
        };
        spans.push({
          id: spanId(identity),
          ...identity,
          pageNumber: source.pageNumber,
          text,
        });
      }
      cursor = Math.max(candidateEnd, cursor + 1);
    }
  }
  return spans;
}

export function evidenceSpanCatalogFingerprint(
  spans: readonly FascicoloEvidenceSpan[],
): string {
  return digest(JSON.stringify({
    version: FASCICOLO_EVIDENCE_SPAN_CATALOG_VERSION,
    spans: spans.map((span) => ({
      id: span.id,
      basisRef: span.basisRef,
      documentVersionId: span.documentVersionId,
      pageNumber: span.pageNumber,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      textSha256: span.textSha256,
      quoteSha256: span.quoteSha256,
    })),
  }));
}

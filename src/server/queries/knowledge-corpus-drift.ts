import type { FascicoloDocumentCorpus } from "./fascicolo-document-corpus";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "./fascicolo-knowledge";

export type KnowledgeCorpusDriftKind =
  | "NEW_DOCUMENT_VERSION"
  | "NEW_EXTRACTION"
  | "PAGE_TEXT_CHANGED"
  | "PAGE_NO_LONGER_AVAILABLE"
  | "DOCUMENT_NOT_ANALYSED"
  | "DOCUMENT_REMOVED"
  | "EXTRACTION_NOT_AVAILABLE";

export interface KnowledgeCorpusDriftEntry {
  readonly kind: KnowledgeCorpusDriftKind;
  readonly documentoId: string;
  readonly documentName: string | null;
  readonly pageNumbers: readonly number[];
  readonly explanation: string;
}

export interface KnowledgeCorpusDrift {
  readonly current: boolean;
  readonly entries: readonly KnowledgeCorpusDriftEntry[];
  readonly affectedKnowledgeItemCount: number;
}

function allItems(knowledge: StructuredKnowledgeReadModel): readonly StructuredKnowledgeReadItem[] {
  return [
    ...knowledge.partyRoles, ...knowledge.facts, ...knowledge.events, ...knowledge.legalActs,
    ...knowledge.measures, ...knowledge.contradictions, ...knowledge.gaps, ...knowledge.deadlineCandidates,
    ...knowledge.legalIssues, ...knowledge.researchQuestions,
  ];
}

function pagesLabel(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  return sorted.length === 1 ? `pagina ${sorted[0]}` : `pagine ${sorted.join(", ")}`;
}

/**
 * Explains, per document, why a knowledge revision no longer matches the current corpus.
 * Revisions persist only the corpus fingerprint, so the cause is reconstructed from the
 * evidence each knowledge item cites (document version, extraction attempt, page text hash).
 */
export function diagnoseKnowledgeCorpusDrift(
  knowledge: StructuredKnowledgeReadModel | null,
  corpus: Pick<FascicoloDocumentCorpus, "corpusFingerprint" | "documents" | "excerpts">,
): KnowledgeCorpusDrift {
  if (!knowledge) {
    return {
      current: false,
      affectedKnowledgeItemCount: 0,
      entries: corpus.documents.map((document) => ({
        kind: "DOCUMENT_NOT_ANALYSED" as const,
        documentoId: document.documentoId,
        documentName: document.name,
        pageNumbers: [],
        explanation: `Il documento «${document.name}» non è ancora stato analizzato.`,
      })),
    };
  }
  if (knowledge.revision.corpusFingerprint === corpus.corpusFingerprint) {
    return { current: true, entries: [], affectedKnowledgeItemCount: 0 };
  }

  const documents = new Map(corpus.documents.map((document) => [document.documentoId, document]));
  const excerptByPage = new Map(corpus.excerpts.map((excerpt) => [`${excerpt.documentoId}\n${excerpt.pageNumber}`, excerpt]));
  const cited = new Map<string, { versions: Set<string>; attempts: Set<string> }>();
  const changedPages = new Map<string, number[]>();
  const missingPages = new Map<string, number[]>();
  const affectedItems = new Set<string>();

  for (const item of allItems(knowledge)) {
    for (const evidence of item.evidence) {
      const entry = cited.get(evidence.documentoId) ?? { versions: new Set(), attempts: new Set() };
      if (evidence.documentFileVersionId) entry.versions.add(evidence.documentFileVersionId);
      const attempt = evidence.documentExtractionAttemptId ?? evidence.extractionAttemptId ?? null;
      if (attempt) entry.attempts.add(attempt);
      cited.set(evidence.documentoId, entry);
      const document = documents.get(evidence.documentoId);
      if (!document) { affectedItems.add(item.id); continue; }
      const excerpt = excerptByPage.get(`${evidence.documentoId}\n${evidence.pageNumber}`);
      if (!excerpt) {
        missingPages.set(evidence.documentoId, [...(missingPages.get(evidence.documentoId) ?? []), evidence.pageNumber]);
        affectedItems.add(item.id);
      } else if (excerpt.textSha256 !== evidence.textSha256) {
        changedPages.set(evidence.documentoId, [...(changedPages.get(evidence.documentoId) ?? []), evidence.pageNumber]);
        affectedItems.add(item.id);
      }
    }
  }

  const entries: KnowledgeCorpusDriftEntry[] = [];
  for (const document of corpus.documents) {
    const name = document.name;
    const evidence = cited.get(document.documentoId);
    if (document.status !== "AVAILABLE") {
      entries.push({
        kind: "EXTRACTION_NOT_AVAILABLE", documentoId: document.documentoId, documentName: name, pageNumbers: [],
        explanation: `Il testo di «${name}» non è attualmente disponibile (stato ${document.status === "OCR_REQUIRED" ? "riconoscimento ottico necessario" : document.status === "NOT_EXTRACTED" ? "estrazione non eseguita" : "estrazione non riuscita"}).`,
      });
      continue;
    }
    if (!evidence) {
      entries.push({
        kind: "DOCUMENT_NOT_ANALYSED", documentoId: document.documentoId, documentName: name, pageNumbers: [],
        explanation: `Il documento «${name}» è presente nel fascicolo ma non è richiamato dall'analisi corrente: va incluso nella nuova analisi.`,
      });
      continue;
    }
    if (document.documentFileVersionId && evidence.versions.size > 0 && !evidence.versions.has(document.documentFileVersionId)) {
      entries.push({
        kind: "NEW_DOCUMENT_VERSION", documentoId: document.documentoId, documentName: name, pageNumbers: [],
        explanation: `È stata caricata una nuova versione di «${name}» dopo l'analisi.`,
      });
    } else if (document.extractionAttemptId && evidence.attempts.size > 0 && !evidence.attempts.has(document.extractionAttemptId)) {
      entries.push({
        kind: "NEW_EXTRACTION", documentoId: document.documentoId, documentName: name, pageNumbers: [],
        explanation: `Il testo di «${name}» è stato estratto nuovamente dopo l'analisi.`,
      });
    }
    const changed = changedPages.get(document.documentoId) ?? [];
    if (changed.length > 0) {
      entries.push({
        kind: "PAGE_TEXT_CHANGED", documentoId: document.documentoId, documentName: name, pageNumbers: [...new Set(changed)].sort((a, b) => a - b),
        explanation: `Il testo delle ${pagesLabel(changed)} di «${name}» è cambiato rispetto a quello analizzato.`,
      });
    }
    const missing = missingPages.get(document.documentoId) ?? [];
    if (missing.length > 0) {
      entries.push({
        kind: "PAGE_NO_LONGER_AVAILABLE", documentoId: document.documentoId, documentName: name, pageNumbers: [...new Set(missing)].sort((a, b) => a - b),
        explanation: `Le ${pagesLabel(missing)} di «${name}» citate dall'analisi non hanno più testo estratto.`,
      });
    }
  }
  for (const documentoId of cited.keys()) {
    if (!documents.has(documentoId)) {
      entries.push({
        kind: "DOCUMENT_REMOVED", documentoId, documentName: null, pageNumbers: [],
        explanation: "Un documento citato dall'analisi non è più presente fra i documenti correnti del fascicolo.",
      });
    }
  }
  if (entries.length === 0) {
    entries.push({
      kind: "NEW_EXTRACTION", documentoId: "", documentName: null, pageNumbers: [],
      explanation: "L'inventario documentale è cambiato (stato o identità delle estrazioni) senza modificare le pagine citate dall'analisi.",
    });
  }
  return { current: false, entries, affectedKnowledgeItemCount: affectedItems.size };
}

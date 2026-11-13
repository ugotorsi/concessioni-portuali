import { describe, expect, it } from "vitest";

import type { FascicoloDocumentCorpus } from "@/server/queries/fascicolo-document-corpus";
import type { StructuredKnowledgeReadItem, StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";
import { diagnoseKnowledgeCorpusDrift } from "@/server/queries/knowledge-corpus-drift";

const hash = (char: string) => char.repeat(64);

function item(id: string, documentoId: string, pageNumber: number, textSha256: string, version = "v1", attempt = "att-1"): StructuredKnowledgeReadItem {
  return {
    id, kind: "FACT", semanticKey: id, contentFingerprint: hash("0"), normalizedText: id, payload: {}, confidence: null,
    status: "PROPOSED" as StructuredKnowledgeReadItem["status"], reviewVersion: 0,
    evidence: [{ basisRef: null, documentoId, documentFileVersionId: version, documentExtractionAttemptId: attempt, pageNumber, textSha256 }],
  };
}

function knowledge(fingerprint: string, facts: StructuredKnowledgeReadItem[]): StructuredKnowledgeReadModel {
  return {
    revision: { id: "rev", corpusFingerprint: fingerprint, contractVersion: "V1", createdAt: new Date(0), completedAt: null, warnings: [] },
    subjects: [], partyRoles: [], facts, events: [], legalActs: [], measures: [], contradictions: [], gaps: [],
    deadlineCandidates: [], legalIssues: [], researchQuestions: [], timeline: [],
  };
}

function corpus(fingerprint: string, documents: Array<{ id: string; name: string; version: string; attempt: string; status?: FascicoloDocumentCorpus["documents"][number]["status"]; pages: Array<[number, string]> }>):
  Pick<FascicoloDocumentCorpus, "corpusFingerprint" | "documents" | "excerpts"> {
  return {
    corpusFingerprint: fingerprint,
    documents: documents.map((document, index) => ({
      reference: `DOCUMENT_${index + 1}`, documentoId: document.id, name: document.name, documentFileVersionId: document.version,
      extractionAttemptId: document.attempt, sourceSha256: hash("f"), status: document.status ?? "AVAILABLE", failureCode: null,
      pageCount: document.pages.length, characterCount: 100,
    })),
    excerpts: documents.flatMap((document, index) => document.pages.map(([pageNumber, textSha256]) => ({
      reference: `DOCUMENT_${index + 1}.PAGE_${pageNumber}`, documentoId: document.id, extractionAttemptId: document.attempt,
      pageNumber, documentVersionId: document.version, artifactSha256: hash("f"), text: "x", sourceText: "x", textSha256,
      extractionMethod: "PDF_TEXT", ocrConfidence: null,
    }))),
  };
}

describe("knowledge corpus drift diagnosis", () => {
  it("is current when fingerprints match", () => {
    const result = diagnoseKnowledgeCorpusDrift(knowledge(hash("a"), []), corpus(hash("a"), []));
    expect(result).toEqual({ current: true, entries: [], affectedKnowledgeItemCount: 0 });
  });

  it("explains per document which revision invalidated the analysis", () => {
    const k = knowledge(hash("a"), [
      item("f1", "dossier", 7, hash("1")),
      item("f2", "dossier", 8, hash("2")),
      item("f3", "contratto", 1, hash("3"), "v1", "att-c"),
    ]);
    const c = corpus(hash("b"), [
      { id: "dossier", name: "Dossier Selvara.pdf", version: "v1", attempt: "att-2", pages: [[7, hash("1")], [8, hash("9")]] },
      { id: "contratto", name: "Contratto M4.pdf", version: "v2", attempt: "att-d", pages: [[1, hash("3")]] },
      { id: "verbale", name: "Verbale sopralluogo.pdf", version: "v1", attempt: "att-v", pages: [[1, hash("4")]] },
      { id: "scan", name: "Scansione.pdf", version: "v1", attempt: "att-s", status: "OCR_REQUIRED", pages: [] },
    ]);
    const result = diagnoseKnowledgeCorpusDrift(k, c);
    expect(result.current).toBe(false);
    expect(result.affectedKnowledgeItemCount).toBe(1);
    expect(result.entries.map((entry) => [entry.kind, entry.documentName])).toEqual([
      ["NEW_EXTRACTION", "Dossier Selvara.pdf"],
      ["PAGE_TEXT_CHANGED", "Dossier Selvara.pdf"],
      ["NEW_DOCUMENT_VERSION", "Contratto M4.pdf"],
      ["DOCUMENT_NOT_ANALYSED", "Verbale sopralluogo.pdf"],
      ["EXTRACTION_NOT_AVAILABLE", "Scansione.pdf"],
    ]);
    expect(result.entries[1]!.explanation).toContain("pagina 8");
  });

  it("reports removed documents and missing pages without inventing causes", () => {
    const k = knowledge(hash("a"), [item("f1", "old", 1, hash("1")), item("f2", "dossier", 3, hash("2"))]);
    const result = diagnoseKnowledgeCorpusDrift(k, corpus(hash("b"), [
      { id: "dossier", name: "Dossier.pdf", version: "v1", attempt: "att-1", pages: [[4, hash("5")]] },
    ]));
    expect(result.entries.map((entry) => entry.kind)).toEqual(["PAGE_NO_LONGER_AVAILABLE", "DOCUMENT_REMOVED"]);
    expect(result.affectedKnowledgeItemCount).toBe(2);
  });
});

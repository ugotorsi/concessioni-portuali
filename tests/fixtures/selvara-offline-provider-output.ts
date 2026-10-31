import { createHash } from "node:crypto";

import { buildFascicoloEvidenceSpanCatalog } from "@/server/fascicolo-knowledge";

import {
  selvaraOfflinePages,
  selvaraOfflineStructuredKnowledge,
} from "./selvara-offline-corpus";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELVARA_OFFLINE_FIXTURE_INVALID");
  }
  return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("SELVARA_OFFLINE_FIXTURE_INVALID");
  return value.map(record);
}

export function buildSelvaraOfflineProviderOutput(
  documentVersionId = "attempt-selvara-offline",
): Record<string, unknown> {
  const knowledge = record(structuredClone(selvaraOfflineStructuredKnowledge));
  const sourceQuotes = records(knowledge.sourceQuotes);
  delete knowledge.sourceQuotes;
  delete knowledge.documentInventory;
  knowledge.items = records(knowledge.items).map((item) => {
    if (item.kind !== "FACT" && item.kind !== "EVENT") return item;
    const payload = { ...record(item.payload) };
    delete payload.proceedingIdentityHint;
    return { ...item, payload };
  });
  knowledge.legalIssues = records(knowledge.legalIssues).map((issue) => {
    const next = { ...issue };
    delete next.referenceDateBasis;
    delete next.targetProceedingHint;
    return next;
  });
  knowledge.researchQuestions = records(knowledge.researchQuestions).map((question) => {
    const next = { ...question };
    delete next.referenceDate;
    delete next.referenceDateBasis;
    return next;
  });
  const spans = buildFascicoloEvidenceSpanCatalog(selvaraOfflinePages.map((page) => ({
    reference: `DOCUMENT_1.PAGE_${page.pageNumber}`,
    pageNumber: page.pageNumber,
    documentVersionId,
    text: page.text,
    textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
  })));
  knowledge.evidenceCandidates = sourceQuotes.map((sourceQuote) => {
    const itemLocalId = sourceQuote.itemLocalId;
    const basisRef = sourceQuote.basisRef;
    if (typeof itemLocalId !== "string" || typeof basisRef !== "string") {
      throw new Error("SELVARA_OFFLINE_FIXTURE_INVALID");
    }
    const span = spans.find((candidate) => candidate.basisRef === basisRef);
    if (!span) throw new Error(`SELVARA_OFFLINE_EVIDENCE_SPAN_MISSING:${itemLocalId}`);
    return { itemLocalId, evidenceSpanId: span.id };
  });
  return {
    summary: {
      text: "Il fascicolo sintetico documenta concessione, esecuzione e criticita.",
      basisRefs: ["DOCUMENT_1.PAGE_7"],
    },
    timeline: [{
      recordedAt: "2023-07-14T00:00:00.000Z",
      text: "Rilascio della concessione sintetica.",
      basisRefs: ["DOCUMENT_1.PAGE_7"],
    }],
    recordedState: [{
      text: "Il fascicolo sintetico contiene quaranta pagine estratte.",
      basisRefs: ["DOCUMENT_1.PAGE_1"],
    }],
    signals: [{
      type: "VERIFY",
      text: "Verificare le lacune documentali censite.",
      basisRefs: ["DOCUMENT_1.PAGE_28"],
    }],
    investigativeQuestions: [{
      text: "Acquisire gli atti mancanti.",
      basisRefs: ["DOCUMENT_1.PAGE_28"],
    }],
    suggestedActivities: [{
      text: "Completare l'istruttoria documentale.",
      basisRefs: ["DOCUMENT_1.PAGE_28"],
    }],
    legalResearchQuestions: [{
      text: "Verificare la disciplina applicabile.",
      basisRefs: ["DOCUMENT_1.PAGE_7"],
    }],
    structuredKnowledge: knowledge,
  };
}

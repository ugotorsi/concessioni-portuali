import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  FascicoloReport,
  fascicoloReportStatusLabel,
  type FascicoloReportSnapshot,
} from "@/components/procedimenti/FascicoloReport";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report";

function payload(): StructuredFascicoloReportPayload {
  const item = (id: string, normalizedText: string) => ({
    id, kind: "FACT" as const, semanticKey: id, contentFingerprint: id, normalizedText,
    payload: {}, confidence: 90, status: "HUMAN_CONFIRMED" as const, reviewVersion: 1, evidence: [],
  });
  const authority = (resultId: string, title: string, sourceUrl: string) => ({
    resultId, title, sourceUrl, provider: "hidden-provider", assessmentId: `assessment-${resultId}`,
    classificationReviewAuditId: `review-${resultId}`,
    sourceChainFingerprint: `chain-${resultId}`, citationAnchors: [{ page: 1 }], rationale: `Valutazione ${title}`,
  });
  const question = {
    knowledgeItemId: "question-1", semanticKey: "question-key", text: "Quale disciplina si applica?",
    reviewStatus: "HUMAN_CONFIRMED" as const, missionId: "mission-1", missionStatus: "COMPLETED", coverageStatus: "COMPLETE",
    favorableAuthorities: [authority("source-favorable", "Consiglio di Stato, sentenza favorevole", "https://example.test/favorevole")],
    contraryAuthorities: [authority("source-contrary", "TAR, sentenza contraria", "https://example.test/contraria")],
    nonUsableResults: [{
      resultId: "blocked", title: "Fonte non verificata", sourceUrl: "https://example.test/candidate",
      direction: "SUPPORTS" as const, rationale: "Principio provvisorio da verificare", reasons: ["MISSING_FULL_TEXT"],
    }],
    gaps: ["UNCOVERED_ELEMENT"], limitations: ["NO_USABLE_CONTRARY_AUTHORITY"],
  };
  return {
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1", sourceReviewPolicy: "PROFESSIONAL_CLASSIFICATION_REQUIRED_V1", tenantId: "tenant-1", procedimentoId: "procedure-1",
    knowledgeRevisionId: "revision-1", knowledgeContractVersion: "KNOWLEDGE_V1", corpusFingerprint: "corpus",
    knowledgeStateFingerprint: "knowledge", researchStateFingerprint: "research", sourceStateFingerprint: "source",
    documentedFramework: {
      partyRoles: [item("role-1", "Autorità portuale quale ente concedente")],
      facts: [item("fact-1", "Occupazione rilevata oltre la superficie assentita")], timeline: [],
      legalActs: [item("act-1", "Concessione demaniale n. 42")], measures: [],
      contradictions: [{ ...item("contradiction-1", "Superficie indicata in modo non uniforme"), contradictedItemIds: ["fact-1"] }],
    },
    legalIssues: [{ knowledgeItemId: "issue-1", semanticKey: "issue-key", text: "Conformità dell’occupazione", reviewStatus: "HUMAN_CONFIRMED", originatingItemIds: ["fact-1"], questions: [question] }],
    unassignedQuestions: [], gaps: [
      {
        ...item("gap-1", "Manca la planimetria aggiornata"),
        payload: { impact: "Il confronto del perimetro resta incerto." },
        evidence: [{ basisRef: "DOCUMENT_1.PAGE_1", documentoId: "doc-1", documentFileVersionId: null, pageNumber: 1, textSha256: "hash" }],
      },
      item("gap-page-1", "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_5."),
      item("gap-page-2", "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_9."),
      item("gap-compile", "COMPILATION:REBUILT:DOCUMENT_COVERAGE_GAP_ADDED:documentInventory.0"),
      item("gap-inventory", "DOCUMENT_INVENTORY:server-inventory-123:UNCERTAIN:DOCUMENT_1.PAGE_9:Classificazione server-side prudenziale."),
      item("gap-proceeding", "PROCEEDING_IDENTITY:REBUILT:VERIFIED:ISSUE_CANONI"),
    ], deadlineCandidates: [],
    limitations: ["RESEARCH_NOT_COMPLETED", "INTERNAL_WARNING_NOT_FOR_UI"],
  };
}

function snapshot(status: FascicoloReportSnapshot["status"], id: string = status): FascicoloReportSnapshot {
  return { id, status, payload: payload(), staleReasons: status === "SUPERSEDED" ? ["SUPERSEDED_BY_MATERIAL_CHANGE"] : [], generatedAt: new Date("2026-10-01T10:00:00.000Z") };
}

function render(snapshots: readonly FascicoloReportSnapshot[], showDiagnostics = false): string {
  return renderToStaticMarkup(createElement(FascicoloReport, {
    procedimentoId: "procedure-1",
    showDiagnostics,
    snapshots,
    documents: [{ id: "doc-1", nome: "Titolo.pdf" }],
  }));
}

describe("Fascicolo report workspace", () => {
  it("renders the professional current report and only available sections", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Rapporto");
    expect(html).toContain("Bozza istruttoria automatica");
    expect(html).toContain("Corrente");
    expect(html).toContain("01/10/2026");
    expect(html).toContain("Quadro del fascicolo");
    expect(html).toContain("Fatti rilevanti");
    expect(html).toContain("Questioni giuridiche");
    expect(html).toContain("Criticità");
    expect(html).not.toContain("Conclusioni");
    expect(html).not.toContain("Misure</h4>");
  });

  it("translates persisted lifecycle states without changing them", () => {
    expect([fascicoloReportStatusLabel("CURRENT"), fascicoloReportStatusLabel("STALE"), fascicoloReportStatusLabel("SUPERSEDED")])
      .toEqual(["Corrente", "Da aggiornare", "Superato"]);
    const stale = render([snapshot("STALE")]);
    expect(stale).toContain("Il fascicolo contiene modifiche successive alla generazione di questo rapporto.");
  });

  it("keeps unverified candidates out of the professional report and exposes separate admin diagnostics", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Fonti utilizzabili");
    expect(html).toContain("Elementi favorevoli");
    expect(html).toContain("Elementi contrari");
    expect(html).toContain("Consiglio di Stato, sentenza favorevole");
    expect(html).toContain("TAR, sentenza contraria");
    expect(html).not.toContain("Fonte non verificata");
    expect(html).not.toContain("https://example.test/candidate");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    const adminHtml = render([snapshot("CURRENT")], true);
    expect(adminHtml).toContain("Diagnostica amministratore");
    expect(adminHtml).toContain("Fonte non verificata");
    expect(adminHtml).toContain("Principio provvisorio da verificare");
    expect(adminHtml).not.toMatch(/COMPILATION|DOCUMENT_INVENTORY|PROCEEDING_IDENTITY|DOCUMENT_\d+\.PAGE/);
  });

  it("does not present unattested sources or conclusions from a historical snapshot as verified", () => {
    const original = payload();
    const legacy: StructuredFascicoloReportPayload = {
      ...original,
      sourceReviewPolicy: undefined,
      legalApplication: [{
        issueSemanticKey: "issue-key", issueText: "Conformità dell'occupazione", relevantDates: [], facts: [], rules: [],
        favorableAuthorities: [], contraryAuthorities: [],
        favorableArguments: ["Argomento derivato dalla fonte non attestata"], contraryArguments: [],
        conclusionStatus: "GROUNDED_ON_VERIFIED_AUTHORITIES", conclusion: "Conclusione giuridica basata sulla fonte non attestata.",
        consequences: [],
      }],
    };
    const html = render([{ ...snapshot("CURRENT"), payload: legacy }]);
    expect(html).toContain("non è attestata la valutazione professionale della pertinenza");
    expect(html).toContain("La conclusione basata sulle fonti di questa versione è sospesa");
    expect(html).not.toContain("Consiglio di Stato, sentenza favorevole");
    expect(html).not.toContain("Argomento derivato dalla fonte non attestata");
    expect(html).not.toContain("Conclusione giuridica basata sulla fonte non attestata");
    expect(html).not.toContain("Con giurisprudenza verificata");
  });

  it("exports only the current structured report directly from its fascicolo", () => {
    const current = render([snapshot("CURRENT")]);
    expect(current).toContain("/procedimenti/procedure-1/report/export?format=pdf");
    expect(current).toContain("/procedimenti/procedure-1/report/export?format=rtf");
    expect(current).toContain("Scarica PDF");
    expect(current).toContain("Scarica RTF");
    const stale = render([snapshot("STALE")]);
    expect(stale).not.toContain("/report/export");
  });

  it("renders professional limitations and previous versions without internal data", () => {
    const html = render([snapshot("CURRENT"), snapshot("SUPERSEDED", "old-report")]);
    expect(html).toContain("Limiti e punti da approfondire");
    expect(html).toContain("Manca la planimetria aggiornata");
    expect(html).toContain("Riferimenti documentali: documento 1 (Titolo.pdf).");
    expect(html).toContain("Effetto indicato, da verificare: Il confronto del perimetro resta incerto.");
    expect(html).toContain("Per il documento 1 (Titolo.pdf), non è stato possibile verificare il contenuto interpretativo alle pagine 5, 9.");
    expect(html).toContain("Una o più ricerche non risultano completate.");
    expect(html).not.toContain("COMPILATION");
    expect(html).not.toContain("DOCUMENT_INVENTORY");
    expect(html).not.toContain("PROCEEDING_IDENTITY");
    expect(html).not.toContain("DOCUMENT_1.PAGE");
    expect(html).toContain("Versioni precedenti");
    expect(html).toContain("Superato");
    expect(html).not.toContain("INTERNAL_WARNING_NOT_FOR_UI");
    expect(html).not.toContain("hidden-provider");
    expect(html).not.toContain("chain-source");
    expect(html).not.toContain("assessment-source");
    expect(html).not.toContain("STRUCTURED_FASCICOLO_REPORT_V1");
    expect(html).not.toContain("CURRENT</");
    expect(html).not.toContain("SUPERSEDED</");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("{");
  });

  it("humanizes document references throughout the legal analysis and excludes diagnostic facts", () => {
    const report = snapshot("CURRENT");
    const withReferences: FascicoloReportSnapshot = {
      ...report,
      payload: {
        ...report.payload,
        legalIssues: report.payload.legalIssues.map((issue) => ({
          ...issue,
          text: "Questione relativa a DOCUMENT_1.PAGE_9",
          questions: issue.questions.map((question) => ({
            ...question,
            text: "Quale rilievo ha DOCUMENT_1.PAGE_9?",
            favorableAuthorities: question.favorableAuthorities.map((authority) => ({
              ...authority,
              rationale: "Confrontare DOCUMENT_1.PAGE_9.",
            })),
          })),
        })),
        legalApplication: [{
          issueSemanticKey: "issue-key",
          issueText: "Questione relativa a DOCUMENT_1.PAGE_9",
          relevantDates: [{ label: "Fatti", date: "2026-01-02", basis: "Da DOCUMENT_1.PAGE_9" }],
          facts: [
            { text: "Riscontro in DOCUMENT_1.PAGE_9", humanConfirmed: false, pages: [9] },
            { text: "COMPILATION:REBUILT:INTERNAL_DIAGNOSTIC", humanConfirmed: false, pages: [] },
          ],
          rules: [{
            ruleId: "RULE",
            citation: "Norma di prova",
            subject: "Verifica",
            temporalAnchor: "CONDUCT",
            referenceDate: "2026-01-02",
            temporalStatus: "APPLICABLE",
            temporalReasoning: "Data da DOCUMENT_1.PAGE_9",
            applicationToFacts: "Valutare DOCUMENT_1.PAGE_9",
            officialUrl: "https://example.test/official",
          }],
          favorableAuthorities: [],
          contraryAuthorities: [],
          favorableArguments: ["Riscontro in DOCUMENT_1.PAGE_9"],
          contraryArguments: [],
          conclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
          conclusion: "Verificare DOCUMENT_1.PAGE_9",
          consequences: ["Riesaminare DOCUMENT_1.PAGE_9"],
        }],
      },
    };
    const html = render([withReferences]);
    expect(html).toContain("documento 1, pag. 9");
    expect(html).not.toMatch(/DOCUMENT_\d+|PAGE_\d+|COMPILATION|INTERNAL_DIAGNOSTIC/);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>[\s\S]*?Norma di prova/);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[=>\s])/);
  });

  it("links to the guided activities without reproducing the operational workflow", () => {
    const report = snapshot("CURRENT");
    const withPlan: FascicoloReportSnapshot = {
      ...report,
      payload: {
        ...report.payload,
        operationalPlans: [{
          issueSemanticKey: "issue-m4",
          issueText: "Uso di M4 da parte di terzo operatore",
          sourceDocumentRefs: [],
          outstandingEvidence: [],
          legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
          professionalStatus: "PRELIMINARY_NOT_APPROVED",
          recommendedNextStep: "Verificare il titolo.",
          steps: [{
            title: "Contestazione degli addebiti per uso M4",
            action: "Predisporre la contestazione dopo le verifiche.",
            office: "Ufficio competente",
            requiredDocuments: ["Titolo concessorio"],
            completionGate: "Validazione professionale",
            draftTitle: "Contestazione degli addebiti",
            draftTemplate: "Oggetto: contestazione relativa a M4.",
          }],
          alternatives: [],
          deadlineReview: "Verificare il termine applicabile.",
        }],
      },
    };
    const html = render([withPlan]);
    expect(html).toContain('href="/procedimenti/procedure-1?section=proposals"');
    expect(html).toContain("Seguito operativo");
    expect(html).not.toContain("Predisporre la contestazione dopo le verifiche.");
    expect(html).not.toContain("Oggetto: contestazione relativa a M4.");
  });

  it("renders the exact empty state and shares the UX across legacy and intake", () => {
    const html = render([]);
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    expect(html).toContain("Non è ancora disponibile un rapporto strutturato per questo fascicolo.");
    expect(html).toContain("Analisi, Ricerca, Scadenze e Criticità");
    expect(legacy).toContain('activeSection === "reports"');
    expect(intake).toContain('activeSection === "reports"');
  });
});

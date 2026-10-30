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

function payload(label: string = "corrente"): StructuredFascicoloReportPayload {
  const item = (id: string, normalizedText: string) => ({
    id, kind: "FACT" as const, semanticKey: id, contentFingerprint: id, normalizedText,
    payload: {}, confidence: 90, status: "HUMAN_CONFIRMED" as const, reviewVersion: 1, evidence: [],
  });
  const authority = (resultId: string, title: string, sourceUrl: string) => ({
    resultId, title, sourceUrl, provider: "hidden-provider", assessmentId: `assessment-${resultId}`,
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
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1", tenantId: "tenant-1", procedimentoId: "procedure-1",
    knowledgeRevisionId: "revision-1", knowledgeContractVersion: "KNOWLEDGE_V1", corpusFingerprint: "corpus",
    knowledgeStateFingerprint: "knowledge", researchStateFingerprint: "research", sourceStateFingerprint: "source",
    documentedFramework: {
      partyRoles: [item("role-1", "Autorità portuale quale ente concedente")],
      facts: [item("fact-1", `Occupazione rilevata oltre la superficie assentita - ${label}`)], timeline: [],
      legalActs: [item("act-1", "Concessione demaniale n. 42")], measures: [],
      contradictions: [{ ...item("contradiction-1", "Superficie indicata in modo non uniforme"), contradictedItemIds: ["fact-1"] }],
    },
    legalIssues: [{ knowledgeItemId: "issue-1", semanticKey: "issue-key", text: "Conformità dell’occupazione", reviewStatus: "HUMAN_CONFIRMED", originatingItemIds: ["fact-1"], questions: [question] }],
    unassignedQuestions: [], gaps: [item("gap-1", "Manca la planimetria aggiornata")], deadlineCandidates: [],
    legalCompleteness: {
      issueCoverage: "DOCUMENTED_ISSUES_STRUCTURED",
      documentNeed: "ADDITIONAL_DOCUMENTS_REQUIRED",
      researchNeed: "RESEARCH_QUESTIONS_STRUCTURED",
      signalItemIds: ["act-1", "contradiction-1", "gap-1"],
      gapItemIds: ["gap-1"],
      reasonCodes: [
        "ADDITIONAL_DOCUMENTS_REQUIRED",
        "DOCUMENTED_ISSUES_STRUCTURED",
        "RESEARCH_QUESTIONS_STRUCTURED",
      ],
    },
    limitations: ["RESEARCH_NOT_COMPLETED", "INTERNAL_WARNING_NOT_FOR_UI"],
  };
}

function snapshot(status: FascicoloReportSnapshot["status"], id: string = status): FascicoloReportSnapshot {
  return { id, status, payload: payload(id === "CURRENT" ? "corrente" : id), staleReasons: status === "SUPERSEDED" ? ["SUPERSEDED_BY_MATERIAL_CHANGE"] : [], generatedAt: new Date("2026-10-01T10:00:00.000Z") };
}

function render(snapshots: readonly FascicoloReportSnapshot[]): string {
  return renderToStaticMarkup(createElement(FascicoloReport, { snapshots }));
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
    expect(html).toContain("Controllo di completezza giuridica");
    expect(html).not.toContain("Conclusioni");
    expect(html).not.toContain("Misure</h4>");
  });

  it("translates persisted lifecycle states without changing them", () => {
    expect([fascicoloReportStatusLabel("CURRENT"), fascicoloReportStatusLabel("STALE"), fascicoloReportStatusLabel("SUPERSEDED")])
      .toEqual(["Corrente", "Da aggiornare", "Superato"]);
    const stale = render([snapshot("STALE")]);
    expect(stale).toContain("Il fascicolo contiene modifiche successive alla generazione di questo rapporto.");
  });

  it("shows usable authorities separately from unverified linked candidate sources", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Fonti utilizzabili");
    expect(html).toContain("Elementi favorevoli");
    expect(html).toContain("Elementi contrari");
    expect(html).toContain("Consiglio di Stato, sentenza favorevole");
    expect(html).toContain("TAR, sentenza contraria");
    expect(html).toContain("Fonti individuate");
    expect(html).toContain("Fonte non verificata");
    expect(html).toContain("Principio provvisorio da verificare");
    expect(html).toContain("https://example.test/candidate");
    expect(html).toContain("non sono ancora fonti utilizzabili");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("renders verified sources as the basis of issue-specific legal reasoning", () => {
    const current = snapshot("CURRENT");
    const html = render([{
      ...current,
      payload: {
        ...current.payload,
        legalAnalyses: [{
          issueSemanticKey: "issue-key",
          issueText: "Conformità dell’occupazione",
          status: "CONTESTED",
          documentedFacts: [{
            statement: "Occupazione rilevata oltre la superficie assentita",
            documentReferences: ["DOCUMENT_1.PAGE_4"],
          }],
          questions: ["Quale disciplina si applica?"],
          verifiedSources: [{
            resultId: "source-favorable",
            title: "Consiglio di Stato, sentenza favorevole",
            sourceUrl: "https://example.test/favorevole",
            provider: "Moonlit",
            direction: "SUPPORTS",
            relevantPassage: "La misura richiede la verifica concreta dei presupposti.",
            rationale: "Principio pertinente alla fattispecie.",
            citationAnchors: [{ paragraph: 12 }],
          }],
          applications: [{
            applicationId: "application-1",
            outcome: "APPLICABLE",
            checks: [{
              criterion: "Presupposti fattuali",
              outcome: "SATISFIED",
              rationale: "Il verbale documenta l’occupazione oltre il titolo.",
              decisiveFacts: ["Occupazione rilevata oltre la superficie assentita"],
            }],
            conclusion: "La fonte è applicabile al fatto documentato, ferma la verifica professionale.",
          }],
          competingArguments: {
            supporting: ["La misura richiede la verifica concreta dei presupposti."],
            opposing: ["La rimozione spontanea può incidere sulla proporzionalità."],
          },
          assessment: "La tesi è sostenibile, ma deve confrontarsi con la proporzionalità.",
          missingEvidence: ["Planimetria aggiornata"],
          recommendedActions: ["Acquisire la planimetria aggiornata e confrontarla con il titolo."],
          professionalReviewRequired: true,
        }],
      },
    }]);

    expect(html).toContain("Analisi giuridica");
    expect(html).toContain("Fatti documentati rilevanti");
    expect(html).toContain("DOCUMENT_1.PAGE_4");
    expect(html).toContain("Fonti verificate");
    expect(html).toContain("Applicazione ai fatti");
    expect(html).toContain("Presupposti fattuali");
    expect(html).toContain("Valutazione conclusiva");
    expect(html).toContain("Iniziative mirate");
    expect(html).not.toContain("COMPILATION:REBUILT");
  });

  it("renders professional limitations and previous versions without internal data", () => {
    const html = render([snapshot("CURRENT"), snapshot("SUPERSEDED", "old-report")]);
    expect(html).toContain("Limiti e punti da approfondire");
    expect(html).toContain("Manca la planimetria aggiornata");
    expect(html).toContain("Una o più ricerche non risultano completate.");
    expect(html).toContain("Versioni precedenti");
    expect(html).toContain("Superato");
    expect(html).toContain("Rapporto storico del 01/10/2026");
    expect(html).toContain("Occupazione rilevata oltre la superficie assentita - old-report");
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

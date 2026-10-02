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
    sourceChainFingerprint: `chain-${resultId}`, citationAnchors: [{ page: 1 }], rationale: `Valutazione ${title}`,
  });
  const question = {
    knowledgeItemId: "question-1", semanticKey: "question-key", text: "Quale disciplina si applica?",
    reviewStatus: "HUMAN_CONFIRMED" as const, missionId: "mission-1", missionStatus: "COMPLETED", coverageStatus: "COMPLETE",
    favorableAuthorities: [authority("source-favorable", "Consiglio di Stato, sentenza favorevole", "https://example.test/favorevole")],
    contraryAuthorities: [authority("source-contrary", "TAR, sentenza contraria", "https://example.test/contraria")],
    nonUsableResults: [{ resultId: "blocked", title: "Fonte non verificata", direction: "SUPPORTS" as const, reasons: ["MISSING_FULL_TEXT"] }],
    gaps: ["UNCOVERED_ELEMENT"], limitations: ["NO_USABLE_CONTRARY_AUTHORITY"],
  };
  return {
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1", tenantId: "tenant-1", procedimentoId: "procedure-1",
    knowledgeRevisionId: "revision-1", knowledgeContractVersion: "KNOWLEDGE_V1", corpusFingerprint: "corpus",
    knowledgeStateFingerprint: "knowledge", researchStateFingerprint: "research", sourceStateFingerprint: "source",
    documentedFramework: {
      partyRoles: [item("role-1", "Autorità portuale quale ente concedente")],
      facts: [item("fact-1", "Occupazione rilevata oltre la superficie assentita")], timeline: [],
      legalActs: [item("act-1", "Concessione demaniale n. 42")], measures: [],
      contradictions: [{ ...item("contradiction-1", "Superficie indicata in modo non uniforme"), contradictedItemIds: ["fact-1"] }],
    },
    legalIssues: [{ knowledgeItemId: "issue-1", semanticKey: "issue-key", text: "Conformità dell’occupazione", reviewStatus: "HUMAN_CONFIRMED", originatingItemIds: ["fact-1"], questions: [question] }],
    unassignedQuestions: [], gaps: [item("gap-1", "Manca la planimetria aggiornata")], deadlineCandidates: [],
    limitations: ["RESEARCH_NOT_COMPLETED", "INTERNAL_WARNING_NOT_FOR_UI"],
  };
}

function snapshot(status: FascicoloReportSnapshot["status"], id: string = status): FascicoloReportSnapshot {
  return { id, status, payload: payload(), staleReasons: status === "SUPERSEDED" ? ["SUPERSEDED_BY_MATERIAL_CHANGE"] : [], generatedAt: new Date("2026-10-01T10:00:00.000Z") };
}

function render(snapshots: readonly FascicoloReportSnapshot[]): string {
  return renderToStaticMarkup(createElement(FascicoloReport, { snapshots }));
}

describe("Fascicolo report workspace", () => {
  it("renders the professional current report and only available sections", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Rapporto");
    expect(html).toContain("Sintesi professionale strutturata del fascicolo.");
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

  it("shows favorable and contrary usable sources equally and excludes unusable sources", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Fonti utilizzabili");
    expect(html).toContain("Elementi favorevoli");
    expect(html).toContain("Elementi contrari");
    expect(html).toContain("Consiglio di Stato, sentenza favorevole");
    expect(html).toContain("TAR, sentenza contraria");
    expect(html).not.toContain("Fonte non verificata");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("renders professional limitations and previous versions without internal data", () => {
    const html = render([snapshot("CURRENT"), snapshot("SUPERSEDED", "old-report")]);
    expect(html).toContain("Limiti e punti da approfondire");
    expect(html).toContain("Manca la planimetria aggiornata");
    expect(html).toContain("Una o più ricerche non risultano completate.");
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
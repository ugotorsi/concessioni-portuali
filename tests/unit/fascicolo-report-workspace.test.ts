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
    resultId, candidateId: `candidate-${resultId}`, title, sourceUrl, provider: "hidden-provider", assessmentId: `assessment-${resultId}`,
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
      facts: [item("fact-1", `Occupazione rilevata oltre la superficie assentita - ${label}`)], timeline: [],
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

  it("shows unverified candidates separately without promoting them to usable authorities", () => {
    const html = render([snapshot("CURRENT")]);
    expect(html).toContain("Fonti utilizzabili");
    expect(html).toContain("Elementi favorevoli");
    expect(html).toContain("Elementi contrari");
    expect(html).toContain("Consiglio di Stato, sentenza favorevole");
    expect(html).toContain("TAR, sentenza contraria");
    expect(html).toContain("Fonti candidate da verificare");
    expect(html).toContain("Fonte non verificata");
    expect(html).toContain("Principio provvisorio da verificare");
    expect(html).toContain("https://example.test/candidate");
    expect(html).toContain("non sono ancora fonti utilizzabili per conclusioni professionali");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    const adminHtml = render([snapshot("CURRENT")], true);
    expect(adminHtml).not.toContain("Diagnostica amministratore");
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

  it("separates verified pertinent, unverifiable and excluded non-pertinent official sources", () => {
    const current = snapshot("CURRENT");
    const question = current.payload.legalIssues[0].questions[0];
    const withRelevance = {
      ...current,
      payload: {
        ...current.payload,
        legalIssues: [{
          ...current.payload.legalIssues[0],
          questions: [{
            ...question,
            nonUsableResults: [
              { resultId: "pert", title: "Legge 28 gennaio 1994, n. 84", sourceUrl: "https://www.normattiva.it/x", direction: "UNASSESSED", rationale: null, reasons: ["PROFESSIONAL_DIRECTION_REVIEW_REQUIRED"], relevance: "PERTINENTE_VERIFICATA_DA_CLASSIFICARE", relevanceNote: "Testo ufficiale acquisito da Normattiva; articolo pertinente individuato." },
              { resultId: "nv", title: "Legge regionale 5/2020", sourceUrl: null, direction: "UNASSESSED", rationale: null, reasons: ["OFFICIAL_SOURCE_NOT_VERIFIABLE:REGIONAL_OR_SPECIAL_SERIES_ACT_NOT_COVERED"], relevance: "NON_VERIFICABILE" },
              { resultId: "np", title: "D.Lgs. 112/2015 (ferroviario)", sourceUrl: null, direction: "UNASSESSED", rationale: null, reasons: ["NOT_PERTINENT_TO_QUESTION"], relevance: "NON_PERTINENTE" },
            ],
          }],
        }],
      },
    } as unknown as FascicoloReportSnapshot;
    const html = render([withRelevance], true);
    expect(html).toContain("Fonti ufficiali acquisite con corrispondenza testuale");
    expect(html).toContain("pertinenza da confermare");
    expect(html).toContain("Legge 28 gennaio 1994, n. 84");
    expect(html).toContain("non verificabili o da verificare");
    expect(html).toContain("Legge regionale 5/2020");
    expect(html).toContain("Fonti escluse perché non pertinenti al quesito (1)");
    expect(html).toContain("D.Lgs. 112/2015 (ferroviario)");
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
          professionalReasoning: {
            version: "LEGAL_ANALYSIS_CONTRIBUTION_V1",
            contributionId: "contribution-1",
            legalIssueSemanticKey: "a".repeat(64),
            researchQuestionSemanticKey: "b".repeat(64),
            issueStatement: "Occorre valutare la conformità dell’occupazione rispetto al titolo concessorio.",
            ruleApplications: [{
              title: "Presupposti della misura",
              rule: "La misura richiede la verifica concreta dei presupposti previsti dalla disciplina applicabile.",
              sourceCandidateIds: ["candidate-source-favorable"],
              relevantFacts: "Il verbale documenta l’occupazione oltre la superficie assentita dal titolo.",
              factBasisRefs: ["DOCUMENT_1.PAGE_4"],
              application: "Il fatto documentato integra il presupposto materiale, salvo verifica della planimetria vigente.",
              outcome: "Il presupposto appare integrato in via preliminare, con riserva sulla delimitazione assentita.",
            }],
            supportingArguments: [{
              text: "La difformità documentata sostiene l’esercizio del potere previsto dalla disciplina verificata.",
              sourceCandidateIds: ["candidate-source-favorable"],
              factBasisRefs: ["DOCUMENT_1.PAGE_4"],
            }],
            contraryArguments: [{
              text: "La rimozione spontanea può incidere sulla proporzionalità della misura conclusiva.",
              sourceCandidateIds: ["candidate-source-favorable"],
              factBasisRefs: ["DOCUMENT_1.PAGE_4"],
            }],
            evidenceAssessment: {
              strengths: [{
                text: "Il verbale individua la consistenza materiale e la collocazione dell’occupazione.",
                sourceCandidateIds: ["candidate-source-favorable"],
                factBasisRefs: ["DOCUMENT_1.PAGE_4"],
              }],
              weaknesses: [{
                text: "Manca ancora il confronto con la planimetria allegata al titolo vigente.",
                sourceCandidateIds: ["candidate-source-favorable"],
                factBasisRefs: ["DOCUMENT_1.PAGE_4"],
              }],
              missingEvidence: ["Acquisire la planimetria aggiornata allegata al titolo concessorio vigente."],
            },
            reasonedConclusion: {
              text: "La tesi è sostenibile in via preliminare, ma dipende dal confronto con la planimetria vigente.",
              confidence: "MEDIUM",
              decisiveSourceCandidateIds: ["candidate-source-favorable"],
              decisiveFactBasisRefs: ["DOCUMENT_1.PAGE_4"],
              conditions: ["Confermare la delimitazione assentita dal titolo vigente."],
            },
            strategies: [{
              title: "Confronto tecnico-documentale",
              rationale: "Acquisire la planimetria vigente prima di definire la qualificazione giuridica della difformità.",
              sourceCandidateIds: ["candidate-source-favorable"],
              factBasisRefs: ["DOCUMENT_1.PAGE_4"],
              risks: ["Una planimetria diversa potrebbe escludere o ridimensionare la difformità contestata."],
            }],
            uncertainties: ["La delimitazione esatta dell’area assentita richiede verifica documentale."],
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

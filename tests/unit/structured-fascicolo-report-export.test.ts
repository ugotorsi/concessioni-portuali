import { describe, expect, it } from "vitest";

import {
  buildProfessionalReportDocument,
  renderProfessionalReportPdf,
  renderProfessionalReportRtf,
} from "@/server/fascicolo-report/professional-export";
import type { StructuredReportSnapshotRecord } from "@/server/fascicolo-report/repository";

function snapshot(): StructuredReportSnapshotRecord {
  const item = (id: string, normalizedText: string) => ({
    id,
    kind: "FACT" as const,
    semanticKey: id,
    contentFingerprint: id,
    normalizedText,
    payload: {},
    confidence: 90,
    status: "HUMAN_CONFIRMED" as const,
    reviewVersion: 1,
    evidence: [],
  });
  return {
    id: "structured-report-1",
    tenantId: "tenant-1",
    procedimentoId: "procedure-1",
    knowledgeRevisionId: "revision-1",
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1",
    reportFingerprint: "a".repeat(64),
    corpusFingerprint: "b".repeat(64),
    researchStateFingerprint: "c".repeat(64),
    sourceStateFingerprint: "d".repeat(64),
    status: "CURRENT",
    warnings: ["INTERNAL_CODE"],
    staleReasons: [],
    supersededBySnapshotId: null,
    generatedAt: new Date("2026-11-03T10:00:00.000Z"),
    payload: {
      contractVersion: "STRUCTURED_FASCICOLO_REPORT_V1",
      sourceReviewPolicy: "PROFESSIONAL_CLASSIFICATION_REQUIRED_V1",
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledgeRevisionId: "revision-1",
      knowledgeContractVersion: "KNOWLEDGE_V1",
      corpusFingerprint: "b".repeat(64),
      knowledgeStateFingerprint: "e".repeat(64),
      researchStateFingerprint: "c".repeat(64),
      sourceStateFingerprint: "d".repeat(64),
      documentedFramework: {
        partyRoles: [item("role", "Autorità portuale quale ente concedente")],
        facts: [item("fact", "Fatto documentato con {riserva} DOCUMENT_1.PAGE_9")],
        timeline: [item("event", "Provvedimento adottato il 10 ottobre")],
        legalActs: [item("act", "Concessione n. 17/2023")],
        measures: [],
        contradictions: [],
      },
      legalIssues: [{
        knowledgeItemId: "issue",
        semanticKey: "issue-key",
        text: "Tenuta del provvedimento",
        reviewStatus: "HUMAN_CONFIRMED",
        originatingItemIds: ["fact"],
        questions: [{
          knowledgeItemId: "question",
          semanticKey: "question-key",
          text: "Il provvedimento è proporzionato?",
          reviewStatus: "HUMAN_CONFIRMED",
          missionId: "mission",
          missionStatus: "COMPLETED",
          coverageStatus: "COMPLETE",
          favorableAuthorities: [{
            resultId: "usable",
            title: "Consiglio di Stato, decisione verificata",
            sourceUrl: "https://example.test/official",
            provider: "MOONLIT",
            assessmentId: "assessment",
            sourceChainFingerprint: "chain",
            citationAnchors: [{ section: "4" }],
            classificationReviewAuditId: "review-audit",
            rationale: "Principio pertinente ai fatti.",
          }],
          contraryAuthorities: [],
          nonUsableResults: [{
            resultId: "blocked",
            title: "Foreign draft law",
            direction: "SUPPORTS",
            reasons: ["CONTENT_UNVERIFIED"],
          }],
          gaps: [],
          limitations: [],
        }],
      }],
      unassignedQuestions: [],
      gaps: [
        {
          ...item("gap-plan", "Manca la planimetria aggiornata"),
          payload: { impact: "Il confronto del perimetro resta incerto." },
          evidence: [{ basisRef: "DOCUMENT_1.PAGE_3", documentoId: "doc-1", documentFileVersionId: null, pageNumber: 3, textSha256: "hash" }],
        },
        item("gap-page-1", "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_3."),
        item("gap-page-2", "Nessuna informazione interpretativa verificata e stata estratta da DOCUMENT_1.PAGE_8."),
        item("gap-compile", "COMPILATION:REBUILT:DOCUMENT_COVERAGE_GAP_ADDED:documentInventory.0"),
        item("gap-inventory", "DOCUMENT_INVENTORY:server-inventory-123:UNCERTAIN:DOCUMENT_1.PAGE_8:Classificazione server-side prudenziale."),
      ],
      deadlineCandidates: [],
      operationalPlans: [],
      regulatoryApplicability: [],
      legalApplication: [{
        issueSemanticKey: "issue-1",
        issueText: "Tenuta della decadenza",
        relevantDates: [{ label: "Provvedimento finale", date: "2025-04-02", basis: "Data dell'atto conclusivo" }],
        facts: [{ text: "Container non autorizzato", humanConfirmed: false, pages: [3] }],
        rules: [{
          ruleId: "COD_NAV_47", citation: "Art. 47 cod. nav.", subject: "Decadenza", temporalAnchor: "CONDUCT",
          referenceDate: "2024-09-10", temporalStatus: "APPLICABLE", temporalReasoning: "Vigente alla data della condotta.",
          applicationToFacts: "Fattispecie tipiche e contraddittorio.", officialUrl: "https://www.normattiva.it/x!vig=2024-09-10",
        }],
        favorableAuthorities: [], contraryAuthorities: [],
        favorableArguments: ["Inadempimento documentato"], contraryArguments: ["Proporzionalità"],
        conclusionStatus: "NORMATIVE_ONLY_PRELIMINARY",
        conclusion: "Conclusione preliminare motivata.",
        consequences: ["Ricorso al TAR entro 60 giorni"],
      }],
      limitations: ["INTERNAL_CODE", "COMPILATION warning REBUILT"],
    },
  };
}

describe("structured fascicolo professional export", () => {
  it("suspends unattested historical sources and derived conclusions in RTF and PDF without rewriting the snapshot", async () => {
    const original = snapshot();
    const legacy: StructuredReportSnapshotRecord = {
      ...original,
      payload: {
        ...original.payload,
        sourceReviewPolicy: undefined,
        legalApplication: (original.payload.legalApplication ?? []).map((item) => ({
          ...item,
          issueSemanticKey: "issue-key",
          conclusionStatus: "GROUNDED_ON_VERIFIED_AUTHORITIES",
          conclusion: "Conclusione fondata sulla fonte storica non attestata.",
          favorableArguments: ["Argomento derivato dalla fonte storica non attestata."],
        })),
      },
    };
    const before = JSON.stringify(legacy);
    const document = buildProfessionalReportDocument(legacy);
    const text = JSON.stringify(document);
    expect(text).toContain("non è attestata la valutazione professionale della pertinenza");
    expect(text).toContain("La conclusione basata sulle fonti di questa versione è sospesa");
    expect(text).not.toContain("Consiglio di Stato, decisione verificata");
    expect(text).not.toContain("Argomento derivato dalla fonte storica");
    expect(text).not.toContain("Conclusione fondata sulla fonte storica");
    const rtf = renderProfessionalReportRtf(document).toString("utf8");
    expect(rtf).toContain("valutazione professionale della pertinenza");
    expect(rtf).not.toContain("Consiglio di Stato, decisione verificata");
    expect(rtf).not.toMatch(/CLASSIFICATION_|DOCUMENT_INVENTORY|COMPILATION|DOCUMENT_\d+/);
    const pdf = await renderProfessionalReportPdf(document);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const parsed = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    const pdfText: string[] = [];
    for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
      const content = await (await parsed.getPage(pageNumber)).getTextContent();
      pdfText.push(...content.items.flatMap((item) => "str" in item ? [item.str] : []));
    }
    await parsed.destroy();
    expect(pdfText.join(" ")).toContain("valutazione professionale della pertinenza");
    expect(pdfText.join(" ")).not.toContain("Consiglio di Stato, decisione verificata");
    expect(pdfText.join(" ")).not.toContain("Conclusione fondata sulla fonte storica");
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it("projects only professional content from the immutable snapshot", () => {
    const document = buildProfessionalReportDocument(snapshot(), [{ id: "doc-1", nome: "Titolo.pdf" }]);
    const text = JSON.stringify(document);
    expect(text).toContain("Concessione n. 17/2023");
    expect(text).toContain("Consiglio di Stato, decisione verificata");
    expect(text).toContain("Analisi giuridica: applicazione delle norme ai fatti");
    expect(text).toContain("Art. 47 cod. nav. — Decadenza. Vigenza: Vigente alla data della condotta.");
    expect(text).toContain("Conclusione: Conclusione preliminare motivata.");
    expect(text).toContain("(pag. 3)");
    expect(text).not.toContain("Foreign draft law");
    expect(text).not.toContain("MOONLIT");
    expect(text).not.toContain("INTERNAL_CODE");
    expect(text).not.toContain("DOCUMENT_1");
    expect(text).not.toContain("COMPILATION");
    expect(text).not.toContain("DOCUMENT_INVENTORY");
    expect(text).toContain("non è stato possibile verificare il contenuto interpretativo alle pagine 3, 8");
    expect(text).toContain("Riferimenti documentali: documento 1 (Titolo.pdf).");
    expect(text).toContain("Effetto indicato, da verificare: Il confronto del perimetro resta incerto.");
    expect(text).not.toContain("reportFingerprint");
  });

  it("renders deterministic RTF with escaped content", () => {
    const rtf = renderProfessionalReportRtf(buildProfessionalReportDocument(snapshot())).toString("utf8");
    expect(rtf).toMatch(/^\{\\rtf1/);
    expect(rtf).toContain("\\{riserva\\}");
    expect(rtf).toContain("Effetto indicato, da verificare: Il confronto del perimetro resta incerto.");
    expect(rtf).not.toContain("Foreign draft law");
    expect(rtf).not.toMatch(/DOCUMENT_INVENTORY|COMPILATION|DOCUMENT_\d+|INTERNAL_CODE/);
  });

  it("renders a PDF without exposing diagnostic codes in extracted text", async () => {
    const pdf = await renderProfessionalReportPdf(buildProfessionalReportDocument(snapshot()));
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    const text: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      text.push(...content.items.flatMap((item) => "str" in item ? [item.str] : []));
    }
    await document.destroy();
    expect(text.join(" ")).toContain("Consiglio di Stato, decisione verificata");
    expect(text.join(" ").replace(/\s+/g, " ")).toContain("Il confronto del perimetro resta incerto.");
    expect(text.join(" ")).not.toMatch(/DOCUMENT_INVENTORY|COMPILATION|DOCUMENT_\d+|INTERNAL_CODE/);
  });
});

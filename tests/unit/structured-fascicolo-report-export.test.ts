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
        facts: [item("fact", "Fatto documentato con {riserva}")],
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
      gaps: [],
      deadlineCandidates: [],
      operationalPlans: [],
      regulatoryApplicability: [],
      limitations: ["INTERNAL_CODE"],
    },
  };
}

describe("structured fascicolo professional export", () => {
  it("projects only professional content from the immutable snapshot", () => {
    const document = buildProfessionalReportDocument(snapshot());
    const text = JSON.stringify(document);
    expect(text).toContain("Concessione n. 17/2023");
    expect(text).toContain("Consiglio di Stato, decisione verificata");
    expect(text).not.toContain("Foreign draft law");
    expect(text).not.toContain("MOONLIT");
    expect(text).not.toContain("INTERNAL_CODE");
    expect(text).not.toContain("reportFingerprint");
  });

  it("renders deterministic RTF with escaped content", () => {
    const rtf = renderProfessionalReportRtf(buildProfessionalReportDocument(snapshot())).toString("utf8");
    expect(rtf).toMatch(/^\{\\rtf1/);
    expect(rtf).toContain("\\{riserva\\}");
    expect(rtf).not.toContain("Foreign draft law");
  });

  it("renders a non-empty PDF", async () => {
    const pdf = await renderProfessionalReportPdf(buildProfessionalReportDocument(snapshot()));
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });
});

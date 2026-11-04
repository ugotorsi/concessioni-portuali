import { describe, expect, it } from "vitest";

import { renderStructuredReportRtf } from "@/server/pdf/structuredReportExport";
import type { StructuredFascicoloReportPayload } from "@/server/fascicolo-report/structured-report";

function payload(): StructuredFascicoloReportPayload {
  return {
    contractVersion: "STRUCTURED_FASCICOLO_REPORT_V2",
    tenantId: "tenant-1",
    procedimentoId: "procedure-1",
    knowledgeRevisionId: "revision-1",
    knowledgeContractVersion: "V1",
    corpusFingerprint: "c".repeat(64),
    knowledgeStateFingerprint: "k".repeat(64),
    researchStateFingerprint: "r".repeat(64),
    sourceStateFingerprint: "s".repeat(64),
    documentedFramework: {
      partyRoles: [],
      facts: [],
      timeline: [],
      legalActs: [],
      measures: [],
      contradictions: [],
    },
    legalIssues: [],
    unassignedQuestions: [{
      knowledgeItemId: "professional-version-1",
      semanticKey: "q".repeat(64),
      text: "Quale disciplina si applica?",
      reviewStatus: "HUMAN_CONFIRMED",
      missionId: "mission-1",
      missionStatus: "COMPLETED",
      coverageStatus: "COVERED",
      favorableAuthorities: [{
        resultId: "result-1",
        candidateId: "candidate-1",
        title: "Regolamento (UE) 2017/352",
        sourceUrl: "https://eur-lex.europa.eu/",
        provider: "MOONLIT",
        assessmentId: "assessment-1",
        sourceChainFingerprint: "f".repeat(64),
        citationAnchors: [],
        rationale: "Fonte identificata",
      }],
      contraryAuthorities: [],
      nonUsableResults: [{
        resultId: "result-2",
        title: "Decisione da verificare",
        direction: "UNASSESSED",
        reasons: ["MISSING_FULL_TEXT"],
      }],
      gaps: ["MISSING_DOCUMENT"],
      limitations: ["Verifica professionale richiesta"],
    }],
    gaps: [],
    deadlineCandidates: [],
    limitations: ["Rapporto preliminare"],
  };
}

describe("structured report editable export", () => {
  it("includes version, verification state, sources and limitations in RTF", () => {
    const output = renderStructuredReportRtf({
      snapshotId: "snapshot-1",
      status: "CURRENT",
      generatedAt: new Date("2026-11-07T12:00:00.000Z"),
      payload: payload(),
    }).toString("utf8");

    expect(output).toContain("Versione: snapshot-1");
    expect(output).toContain("Regolamento (UE) 2017/352");
    expect(output).toContain("MISSING_FULL_TEXT");
    expect(output).toContain("Verifica professionale richiesta");
    expect(output).toContain("Rapporto preliminare");
  });
});

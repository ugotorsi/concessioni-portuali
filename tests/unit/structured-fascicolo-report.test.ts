import { describe, expect, it } from "vitest";

import {
  buildStructuredFascicoloReport,
  type StructuredReportMissionInput,
} from "@/server/fascicolo-report";
import type {
  StructuredKnowledgeReadItem,
  StructuredKnowledgeReadModel,
} from "@/server/queries/fascicolo-knowledge";

const sha = (value: string) => value.repeat(64).slice(0, 64);

function item(id: string, kind: StructuredKnowledgeReadItem["kind"], status: StructuredKnowledgeReadItem["status"] = "HUMAN_CONFIRMED"): StructuredKnowledgeReadItem {
  return {
    id,
    kind,
    semanticKey: sha(id),
    contentFingerprint: sha(`${id}x`),
    normalizedText: `Testo ${id}`,
    payload: {},
    confidence: 90,
    status,
    reviewVersion: 1,
    evidence: [{ basisRef: "DOCUMENT_1.PAGE_1", documentoId: "document-1", documentFileVersionId: "version-1", pageNumber: 1, textSha256: sha("e") }],
  };
}

function knowledge(): StructuredKnowledgeReadModel {
  const fact = item("fact-1", "FACT");
  const rejectedFact = item("fact-rejected", "FACT", "REJECTED");
  const issue = { ...item("issue-1", "LEGAL_ISSUE"), originatingItemIds: [fact.id] };
  const question = { ...item("question-1", "RESEARCH_QUESTION"), legalIssueId: issue.id };
  return {
    revision: {
      id: "revision-current",
      corpusFingerprint: sha("c"),
      contractVersion: "FASCICOLO_KNOWLEDGE_V1",
      createdAt: new Date("2026-09-29T10:00:00.000Z"),
      completedAt: new Date("2026-09-29T10:01:00.000Z"),
      warnings: ["KNOWLEDGE_WARNING"],
    },
    subjects: [],
    partyRoles: [],
    facts: [rejectedFact, fact],
    events: [],
    legalActs: [],
    measures: [],
    contradictions: [],
    gaps: [item("gap-1", "GAP")],
    deadlineCandidates: [item("deadline-1", "DEADLINE_CANDIDATE")],
    legalIssues: [issue],
    researchQuestions: [question],
    timeline: [],
  };
}

function mission(overrides: Partial<StructuredReportMissionInput> = {}): StructuredReportMissionInput {
  return {
    missionId: "mission-current",
    missionFingerprint: sha("m"),
    knowledgeRevisionId: "revision-current",
    researchQuestionSemanticKey: sha("question-1"),
    lifecycleStatus: "CURRENT",
    status: "COMPLETED",
    question: "Testo question-1",
    coverageStatus: "COMPLETE",
    sourceGaps: ["UNCOVERED_ELEMENT"],
    results: [{
      resultId: "support-result",
      title: "Autorita favorevole",
      sourceUrl: "https://example.test/support",
      provider: "official-provider",
      supportDirection: "SUPPORTS",
      classificationReviewStatus: "HUMAN_CONFIRMED",
      classificationRationale: "Passaggio favorevole",
      sourceAssessment: {
        assessmentId: "assessment-support",
        chainFingerprint: sha("s"),
        isCurrent: true,
        usable: true,
        citationAnchors: [{ page: 4, paragraph: "12" }],
        blockingReasons: [],
        manualReviewRequired: false,
        manualReviewReason: null,
      },
    }, {
      resultId: "oppose-result",
      title: "Autorita contraria",
      sourceUrl: "https://example.test/oppose",
      provider: "official-provider",
      supportDirection: "OPPOSES",
      classificationReviewStatus: "AI_PROPOSED",
      classificationRationale: "Passaggio contrario",
      sourceAssessment: {
        assessmentId: "assessment-oppose",
        chainFingerprint: sha("o"),
        isCurrent: true,
        usable: true,
        citationAnchors: [{ section: "3" }],
        blockingReasons: [],
        manualReviewRequired: false,
        manualReviewReason: null,
      },
    }, {
      resultId: "blocked-result",
      title: "Fonte non utilizzabile",
      sourceUrl: null,
      provider: null,
      supportDirection: "SUPPORTS",
      classificationReviewStatus: "AI_PROPOSED",
      classificationRationale: null,
      sourceAssessment: {
        assessmentId: "assessment-blocked",
        chainFingerprint: sha("b"),
        isCurrent: true,
        usable: false,
        citationAnchors: [],
        blockingReasons: ["MISSING_FULL_TEXT"],
        manualReviewRequired: true,
        manualReviewReason: "FULL_TEXT_REQUIRED",
      },
    }],
    ...overrides,
  };
}

describe("deterministic structured fascicolo report", () => {
  it("projects only CURRENT knowledge and citable USABLE authorities into professional sections", () => {
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [
        mission({ missionId: "mission-historical", lifecycleStatus: "HISTORICAL", results: [] }),
        mission({ results: mission().results.filter((result) => result.resultId !== "oppose-result") }),
        mission({
          missionId: "mission-adverse",
          mode: "ADVERSE_SEARCH",
          results: mission().results.filter((result) => result.resultId === "oppose-result"),
        }),
      ],
    });

    expect(report.payload.documentedFramework.facts.map((fact) => fact.id)).toEqual(["fact-1"]);
    expect(report.payload.legalIssues).toHaveLength(1);
    expect(report.payload.legalIssues[0].questions[0]).toMatchObject({
      missionId: "mission-current",
      favorableAuthorities: [{ resultId: "support-result", citationAnchors: [{ page: 4, paragraph: "12" }] }],
      contraryAuthorities: [{ resultId: "oppose-result", citationAnchors: [{ section: "3" }] }],
      nonUsableResults: [{ resultId: "blocked-result", reasons: ["CITATION_ANCHOR_REQUIRED", "MISSING_FULL_TEXT"] }],
      gaps: ["UNCOVERED_ELEMENT"],
    });
    expect(report.payload.limitations).toContain("DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES");
    expect(JSON.stringify(report.payload)).not.toContain("analysisPayload");
  });

  it("is stable across input order and changes when CURRENT source state changes", () => {
    const firstMission = mission();
    const first = buildStructuredFascicoloReport({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledge: knowledge(), missions: [firstMission],
    });
    const reordered = buildStructuredFascicoloReport({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledge: knowledge(),
      missions: [{ ...firstMission, results: [...firstMission.results].reverse() }],
    });
    const changed = buildStructuredFascicoloReport({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledge: knowledge(),
      missions: [{
        ...firstMission,
        results: firstMission.results.map((result) => result.resultId === "support-result"
          ? { ...result, sourceAssessment: { ...result.sourceAssessment!, chainFingerprint: sha("z") } }
          : result),
      }],
    });

    expect(reordered.reportFingerprint).toBe(first.reportFingerprint);
    expect(changed.reportFingerprint).not.toBe(first.reportFingerprint);
    expect(changed.payload.sourceStateFingerprint).not.toBe(first.payload.sourceStateFingerprint);
  });

  it("projects a reviewed direction only when the existing SourceChain gates are satisfied", () => {
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [mission({
        results: [{
          ...mission().results[0],
          resultId: "reviewed-usable",
          supportDirection: "SUPPORTS",
          classificationReviewStatus: "HUMAN_CONFIRMED",
          classificationRationale: "Classificazione motivata dal revisore.",
        }, {
          ...mission().results[2],
          resultId: "reviewed-not-usable",
          supportDirection: "OPPOSES",
          classificationReviewStatus: "HUMAN_CONFIRMED",
          classificationRationale: "Classificazione contraria motivata dal revisore.",
        }, {
          ...mission().results[0],
          resultId: "reviewed-neutral",
          supportDirection: "NEUTRAL",
          classificationReviewStatus: "HUMAN_CONFIRMED",
          classificationRationale: "La fonte non sostiene nessuna delle due direzioni.",
        }],
      })],
    });

    const question = report.payload.legalIssues[0].questions[0];
    expect(question.favorableAuthorities.map((authority) => authority.resultId)).toEqual(["reviewed-usable"]);
    expect(question.contraryAuthorities).toEqual([]);
    expect(question.nonUsableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ resultId: "reviewed-not-usable", reasons: ["CITATION_ANCHOR_REQUIRED", "MISSING_FULL_TEXT"] }),
      expect.objectContaining({ resultId: "reviewed-neutral", direction: "NEUTRAL" }),
    ]));
  });
});
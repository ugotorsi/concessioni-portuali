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
    evidence: [
      { basisRef: "DOCUMENT_1.PAGE_1", documentoId: "document-1", documentFileVersionId: "version-1", pageNumber: 1, textSha256: sha("e") },
      { basisRef: null, documentoId: "document-1", documentFileVersionId: "version-1", pageNumber: 1, textSha256: sha("e") },
    ],
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
      classificationSource: "HUMAN_REVIEW",
      classificationReviewAuditId: "audit-support",
      classificationReviewStatus: "HUMAN_CONFIRMED",
      classificationRationale: "Il passaggio affronta la medesima questione controversa.",
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
      sourceUrl: "https://example.test/candidate",
      provider: null,
      relevantPassage: "Principio segnalato dal connettore, da riscontrare",
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
    expect(report.payload.operationalPlans).toHaveLength(1);
    expect(report.payload.operationalPlans?.[0]).toMatchObject({
      issueSemanticKey: sha("issue-1"),
      sourceDocumentRefs: ["DOCUMENT_1.PAGE_1"],
      legalSourceStatus: "VERIFIED_SOURCES_ATTACHED",
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
    });
    expect(report.payload.operationalPlans?.[0].steps).toHaveLength(4);
    expect(report.payload.operationalPlans?.[0].steps[1].action).toContain("fonti");
    expect(JSON.stringify(report.payload.operationalPlans)).not.toContain("art. 47");
    expect(report.payload.operationalPlans?.[0].alternatives.some((alternative) => alternative.title.includes("Escludere"))).toBe(true);
    expect(report.payload.operationalPlans?.[0].alternatives.length).toBeGreaterThan(1);
    expect(report.payload.operationalPlans?.[0].steps[0].requiredDocuments.length).toBeGreaterThan(0);

    expect(report.payload.legalIssues).toHaveLength(1);
    expect(report.payload.legalIssues[0].questions[0]).toMatchObject({
      missionId: "mission-current",
      favorableAuthorities: [{ resultId: "support-result", citationAnchors: [{ page: 4, paragraph: "12" }] }],
      contraryAuthorities: [],
      nonUsableResults: [{
        resultId: "blocked-result",
        missionId: "mission-current",
        sourceUrl: "https://example.test/candidate",
        rationale: "Principio segnalato dal connettore, da riscontrare",
        reasons: ["CITATION_ANCHOR_REQUIRED", "CLASSIFICATION_NOT_HUMAN_CONFIRMED", "MANUAL_REVIEW_REQUIRED", "MISSING_FULL_TEXT"],
      }, {
        resultId: "oppose-result",
        missionId: "mission-adverse",
        reasons: ["CLASSIFICATION_NOT_HUMAN_CONFIRMED"],
      }],
      gaps: ["UNCOVERED_ELEMENT"],
    });
    expect(report.payload.limitations).toContain("DEADLINE_CANDIDATES_ARE_NOT_OPERATIONAL_DEADLINES");
    expect(JSON.stringify(report.payload)).not.toContain("analysisPayload");
  });

  it("requires a motivated, audited human classification in addition to the current technical source gates", () => {
      const confirmed = mission().results[0];
      const assessment = confirmed.sourceAssessment!;
      const cases: ReadonlyArray<{
        name: string;
        result: typeof confirmed;
        usable: boolean;
      }> = [
        { name: "audited human review", result: confirmed, usable: true },
        { name: "AI proposal", result: { ...confirmed, classificationReviewStatus: "AI_PROPOSED" }, usable: false },
        { name: "rejected review", result: { ...confirmed, classificationReviewStatus: "REJECTED" }, usable: false },
        { name: "missing provenance", result: { ...confirmed, classificationSource: undefined }, usable: false },
        { name: "missing audit", result: { ...confirmed, classificationReviewAuditId: null }, usable: false },
        { name: "missing rationale", result: { ...confirmed, classificationRationale: null }, usable: false },
        { name: "short rationale", result: { ...confirmed, classificationRationale: "troppo breve" }, usable: false },
        { name: "obsolete source assessment", result: { ...confirmed, sourceAssessment: { ...assessment, isCurrent: false } }, usable: false },
        { name: "blocked source", result: { ...confirmed, sourceAssessment: { ...assessment, usable: false, blockingReasons: ["MISSING_FULL_TEXT"] } }, usable: false },
        { name: "manual review", result: { ...confirmed, sourceAssessment: { ...assessment, manualReviewRequired: true } }, usable: false },
        { name: "missing citation", result: { ...confirmed, sourceAssessment: { ...assessment, citationAnchors: [] } }, usable: false },
        { name: "neutral source", result: { ...confirmed, supportDirection: "NEUTRAL" }, usable: false },
      ];
      for (const testCase of cases) {
        const report = buildStructuredFascicoloReport({
          tenantId: "tenant-1", procedimentoId: "procedure-1", knowledge: knowledge(),
          missions: [mission({ results: [testCase.result] })],
        });
        const question = report.payload.legalIssues[0].questions[0];
        expect(question.favorableAuthorities.length, testCase.name).toBe(testCase.usable ? 1 : 0);
        expect(question.nonUsableResults.length, testCase.name).toBe(testCase.usable ? 0 : 1);
        if (testCase.usable) {
          expect(question.favorableAuthorities[0].classificationReviewAuditId).toBe("audit-support");
          expect(report.payload.sourceReviewPolicy).toBe("PROFESSIONAL_CLASSIFICATION_REQUIRED_V1");
        }
      }
    });

  it("includes an independently reviewed contrary source from its own adverse mission", () => {
      const contrary = {
        ...mission().results[1],
        classificationSource: "HUMAN_REVIEW" as const,
        classificationReviewAuditId: "audit-adverse",
        classificationReviewStatus: "HUMAN_CONFIRMED" as const,
        classificationRationale: "Il caso contrario affronta un limite pertinente alla controversia.",
      };
      const report = buildStructuredFascicoloReport({
        tenantId: "tenant-1", procedimentoId: "procedure-1", knowledge: knowledge(),
        missions: [mission({ results: [mission().results[0]] }), mission({
          missionId: "mission-adverse", mode: "ADVERSE_SEARCH", results: [contrary],
        })],
      });
      expect(report.payload.legalIssues[0].questions[0].contraryAuthorities)
        .toMatchObject([{ resultId: "oppose-result", classificationReviewAuditId: "audit-adverse" }]);
    });
  it("recognizes a concluded Selvara review and never proposes restarting the proceeding", () => {
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-selvara",
      knowledge: {
        ...knowledge(),
        legalActs: [{ ...item("port-title", "LEGAL_ACT"), normalizedText: "Concessione demaniale portuale di Selvara." }],
      },
      missions: [mission()],
      proceduralContext: {
        stato: "CONCLUSO",
        tipologia: "AVVIO_DECADENZA",
        origineProcedimento: "UFFICIO",
        dataAvvio: "2026-01-10T00:00:00.000Z",
        dataProvvedimentoFinale: "2026-09-15T00:00:00.000Z",
        comunicazioneAvvioInviata: true,
        contestazioneFormaleInviata: true,
        memorieRicevute: true,
        audizioneSvolta: true,
        controdeduzioniValutate: true,
        checklistContraddittorioCompleta: true,
        finalAct: {
          numeroAtto: "149/2026",
          dataAtto: "2026-09-15T00:00:00.000Z",
          motivazioneSintetica: "Decadenza",
        },
        concessione: {
          numeroAtto: "SELVARA-2023",
          stato: "DECADUTA",
          dataRilascio: "2023-05-10T00:00:00.000Z",
        },
        documentTitles: [
          "Determinazione 149-2026.pdf",
          "Istanza di riesame Selvara.pdf",
        ],
      },
    });

    const plan = report.payload.operationalPlans?.[0];
    expect(plan?.recommendedNextStep).toContain("procedimento risulta concluso");
    expect(plan?.recommendedNextStep).toContain("Non proporre un nuovo avvio");
    expect(plan?.steps.map((step) => step.title)).toEqual([
      "1. Istruire l'istanza di riesame come procedimento distinto",
      "2. Verificare la tenuta del provvedimento finale",
      "3. Governare esecuzione, contenzioso e obblighi residui",
    ]);
    expect(plan?.steps.every((step) => step.draftTemplate?.includes("approvazione umana"))).toBe(true);
    expect(plan?.steps.map((step) => step.action).join(" ")).not.toContain("predisporre gli atti di avvio");

    expect(report.payload.regulatoryApplicability?.map((row) => row.measure)).toEqual([
      "3.7", "3.13", "3.18", "3.19", "3.20", "4", "5", "15",
    ]);
    expect(report.payload.regulatoryApplicability?.every((row) =>
      row.applicability.includes("non prova che fosse in essere"))).toBe(true);
    expect(report.payload.regulatoryApplicability?.every((row) =>
      row.deadline.includes("Non è una scadenza verificata del fascicolo"))).toBe(true);
    expect(report.payload.regulatoryApplicability?.find((row) => row.measure === "3.18")?.authorityAction)
      .toContain("definite in sede di bando");
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
          classificationSource: "HUMAN_REVIEW",
          classificationReviewAuditId: "audit-blocked",
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
      expect.objectContaining({ resultId: "reviewed-not-usable", reasons: ["CITATION_ANCHOR_REQUIRED", "MANUAL_REVIEW_REQUIRED", "MISSING_FULL_TEXT"] }),
      expect.objectContaining({ resultId: "reviewed-neutral", direction: "NEUTRAL" }),
    ]));
  });
});

describe("profile-specific operational plans", () => {
  it("derives distinct, evidence-driven steps per issue instead of generic art. 47 steps", () => {
    const base = knowledge();
    const use = { ...item("fact-use", "FACT", "AI_PROPOSED"), normalizedText: "Il contratto con Magazzini Levante attribuisce stabilmente a tale società 180 m² di M4, con proprio personale; non è allegato un assenso espresso dell'ente concedente." };
    const invest = { ...item("fact-inv", "FACT", "AI_PROPOSED"), normalizedText: "Il programma di attività prevede l'intervento I4 entro il 30/06/2026." };
    const thirdParty = { ...item("issue-third", "LEGAL_ISSUE"), normalizedText: "Uso di M4 da parte di terzo operatore", originatingItemIds: [use.id] };
    const investment = { ...item("issue-inv", "LEGAL_ISSUE"), normalizedText: "Inadempimento o rimedio concessorio per investimenti", originatingItemIds: [invest.id] };
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-profile",
      knowledge: {
        ...base,
        facts: [use, invest],
        legalActs: [{ ...item("port-title", "LEGAL_ACT"), normalizedText: "Concessione demaniale portuale." }],
        gaps: [],
        legalIssues: [thirdParty, investment],
        researchQuestions: [],
      },
      missions: [],
    });
    const plans = report.payload.operationalPlans ?? [];
    const third = plans.find((plan) => plan.issueText.startsWith("Uso di M4"))!;
    const inv = plans.find((plan) => plan.issueText.startsWith("Inadempimento"))!;
    expect(third.steps[0].title).toBe("1. Uso di M4 da parte di terzo operatore: completare la prova dei requisiti");
    expect(third.steps[1].action).toContain("il solo mancato reperimento del documento non dimostra");
    expect(third.steps[1].requiredDocuments.join(" ")).toMatch(/art\. 18, comma 9/);
    expect(third.steps[2].necessity).toBe("NOT_JUSTIFIED");
    expect(third.steps[2].action).toContain("Non avviare la contestazione");
    expect(third.steps[2].draftTitle).toBeUndefined();
    expect(inv.steps[0].action).toMatch(/Mancata, ritardata o incompleta esecuzione/);
    expect(inv.steps[2].action).toMatch(/Non avviare la contestazione/);
    expect(inv.steps[2].draftTemplate).toBeUndefined();
    expect(new Set(plans.flatMap((plan) => plan.steps.map((step) => step.title))).size).toBe(8);

    const supportedUse = {
      ...use,
      normalizedText: "Il contratto attribuisce stabilmente a Magazzini Levante 180 m² di M4 con proprio personale. La gestione è stata affidata senza autorizzazione dell'ente concedente.",
    };
    const supported = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-profile-supported",
      knowledge: {
        ...base,
        facts: [supportedUse],
        legalActs: [{ ...item("port-title-supported", "LEGAL_ACT"), normalizedText: "Concessione demaniale portuale." }],
        gaps: [],
        legalIssues: [thirdParty],
        researchQuestions: [],
      },
      missions: [],
    }).payload.operationalPlans?.[0];
    expect(supported?.steps[1].action).toMatch(/art\. 47, lett\. e/);
    expect(supported?.steps[1].requiredDocuments.join(" ")).toContain("solo se ricorre sostituzione nel godimento");
    expect(supported?.steps[3].action).toContain("autorizzazione preventiva per l'affidamento futuro");
    expect(supported?.steps[3].action).toContain("Non presumere che l'autorizzazione sani automaticamente la condotta pregressa");
    expect(supported?.steps[3].action).toContain("richiede sostituzione abusiva nel godimento");
    expect(supported?.steps[2].necessity).toBe("CONDITIONAL");
    expect(supported?.steps[2].draftTitle).toBe("Contestazione degli addebiti");
    expect(supported?.steps[2].draftTemplate).toContain("[TERMINE DA VERIFICARE]");
  });
});

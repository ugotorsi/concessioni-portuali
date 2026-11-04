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
  const step = (plan: { steps: readonly { activityCode?: string }[] } | undefined, code: string) =>
    plan?.steps.find((candidate) => candidate.activityCode === code) as NonNullable<NonNullable<ReturnType<typeof buildStructuredFascicoloReport>["payload"]["operationalPlans"]>[number]["steps"][number]> | undefined;
  const build = (procedimentoId: string, facts: ReturnType<typeof item>[], issues: ReturnType<typeof item>[], extra: Partial<ReturnType<typeof knowledge>> = {}) => {
    const base = knowledge();
    return buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId,
      knowledge: {
        ...base,
        facts,
        legalActs: [{ ...item(`${procedimentoId}-title`, "LEGAL_ACT"), normalizedText: "Concessione demaniale portuale." }],
        gaps: [],
        legalIssues: issues.map((issue) => ({ originatingItemIds: [], ...issue })),
        researchQuestions: [],
        ...extra,
      },
      missions: [],
    }).payload;
  };

  it("derives distinct, evidence-driven paths per issue instead of a fixed four-step template", () => {
    const use = { ...item("fact-use", "FACT", "AI_PROPOSED"), normalizedText: "Il contratto con Magazzini Levante attribuisce stabilmente a tale società 180 m² di M4, con proprio personale; non è allegato un assenso espresso dell'ente concedente." };
    const invest = { ...item("fact-inv", "FACT", "AI_PROPOSED"), normalizedText: "Il programma di attività prevede l'intervento I4 entro il 30/06/2026." };
    const thirdParty = { ...item("issue-third", "LEGAL_ISSUE"), normalizedText: "Uso di M4 da parte di terzo operatore", originatingItemIds: [use.id] };
    const investment = { ...item("issue-inv", "LEGAL_ISSUE"), normalizedText: "Inadempimento o rimedio concessorio per investimenti", originatingItemIds: [invest.id] };
    const payload = build("procedure-profile", [use, invest], [thirdParty, investment]);
    const plans = payload.operationalPlans ?? [];
    const third = plans.find((plan) => plan.issueText.startsWith("Uso di M4"))!;
    const inv = plans.find((plan) => plan.issueText.startsWith("Inadempimento"))!;

    expect(third.steps[0].activityCode).toBe("PROFILE:THIRD_PARTY_USE:EVIDENCE");
    expect(third.steps[0].title).toBe("1. Uso di M4 da parte di terzo operatore: accertare la natura del rapporto con il terzo");
    expect(third.steps[0].action).toMatch(/art\. 45-bis cod\. nav\.; art\. 18, comma 9/);
    expect(third.steps[0].action).toMatch(/art\. 46 cod\. nav\./);
    expect(third.steps[0].documentCode).toBe("RICHIESTA_DOCUMENTI_RAPPORTO_TERZO");
    expect(third.steps[0].draftTemplate).toContain("non costituisce contestazione");
    expect(third.steps[0].draftTemplate).toContain("[TERMINE DA VERIFICARE]");
    const qualification = step(third, "PROFILE:THIRD_PARTY_USE:QUALIFICATION")!;
    expect(qualification.action).toContain("il solo mancato reperimento del documento non dimostra");
    expect(qualification.requiredDocuments.join(" ")).toMatch(/art\. 18, comma 9/);
    const contestation = step(third, "PROFILE:THIRD_PARTY_USE:CONTESTATION")!;
    expect(contestation.necessity).toBe("NOT_JUSTIFIED");
    expect(contestation.action).toContain("Non avviare la contestazione");
    expect(contestation.draftTitle).toBeUndefined();
    expect(step(third, "PROFILE:THIRD_PARTY_USE:DECISION")!.necessity).toBe("CONDITIONAL");

    expect(inv.steps[0].activityCode).toBe("PROFILE:INVESTMENT_DEFAULT:EVIDENCE");
    expect(inv.steps[0].title).toMatch(/ricostruire per ciascun intervento \(I4\) termine, esecuzione e verbali/);
    expect(inv.steps[0].documentCode).toBe("RICHIESTA_STATO_INTERVENTI");
    expect(step(inv, "PROFILE:INVESTMENT_DEFAULT:CONTESTATION")!.draftTemplate).toBeUndefined();
    expect(step(inv, "PROFILE:INVESTMENT_DEFAULT:REMEDY")!.necessity).toBe("NOT_JUSTIFIED");
    expect(third.steps[0].title.replace(/^\d+\.\s*/, "")).not.toBe(inv.steps[0].title.replace(/^\d+\.\s*/, ""));
    expect(plans.flatMap((plan) => plan.steps.map((candidate) => candidate.title)).some((title) => /completare la prova dei requisiti/.test(title))).toBe(false);

    // One shared verification of the administrative acts, hosted once and referenced elsewhere.
    const shared = plans.flatMap((plan) => plan.steps.filter((candidate) => candidate.activityCode === "SHARED:ADMIN_ACTS_CHECK"));
    expect(shared).toHaveLength(1);
    expect(shared[0].sharedIssueSemanticKeys).toHaveLength(2);
    expect(shared[0].action).toContain("L'assenza di un atto dal fascicolo non prova che non sia stato rilasciato");
    const referencing = plans.filter((plan) => plan.sharedActivityRefs?.length);
    expect(referencing).toHaveLength(1);
    expect(referencing[0].steps.some((candidate) => candidate.activityCode === "SHARED:ADMIN_ACTS_CHECK")).toBe(false);
    for (const plan of plans) {
      expect(plan.steps.map((candidate) => Number(candidate.title.split(".")[0]))).toEqual(plan.steps.map((_, index) => index + 1));
      expect(plan.recommendedNextStep).toMatch(/^Prossimo passo: 1\./);
    }

    const supportedUse = {
      ...use,
      normalizedText: "Il contratto attribuisce stabilmente a Magazzini Levante 180 m² di M4 con proprio personale. La gestione è stata affidata senza autorizzazione dell'ente concedente.",
    };
    const supported = build("procedure-profile-supported", [supportedUse], [thirdParty]).operationalPlans?.[0];
    const supportedQualification = step(supported, "PROFILE:THIRD_PARTY_USE:QUALIFICATION")!;
    expect(supportedQualification.action).toMatch(/art\. 47, lett\. e/);
    expect(supportedQualification.requiredDocuments.join(" ")).toContain("solo se ricorre sostituzione nel godimento");
    const decision = step(supported, "PROFILE:THIRD_PARTY_USE:DECISION")!;
    expect(decision.necessity).toBe("REQUIRED");
    expect(decision.action).toContain("autorizzazione preventiva per l'affidamento futuro");
    expect(decision.action).toContain("Non presumere che l'autorizzazione sani automaticamente la condotta pregressa");
    expect(decision.action).toContain("richiede sostituzione abusiva nel godimento");
    const supportedContestation = step(supported, "PROFILE:THIRD_PARTY_USE:CONTESTATION")!;
    expect(supportedContestation.necessity).toBe("CONDITIONAL");
    expect(supportedContestation.draftTitle).toBe("Contestazione degli addebiti");
    expect(supportedContestation.draftTemplate).toContain("[TERMINE DA VERIFICARE]");
    expect(supportedContestation.draftTemplate).not.toContain("10-bis");
  });

  it("separates the documented interventions and keeps the remedies alternative", () => {
    const facts = [
      { ...item("inv-1", "FACT", "AI_PROPOSED"), normalizedText: "Il programma di attività obbliga il concessionario a completare gli interventi I1, I4 e M2 entro il 31/03/2026." },
      { ...item("inv-2", "FACT", "AI_PROPOSED"), normalizedText: "Alla verifica del 18/02/2026 l'intervento I1 risulta eseguito con 16 dei 18 punti luce installati. Il separatore dell'intervento I4 non risulta installato e manca il collaudo. Il mezzo M2 è stato ordinato ma non consegnato." },
    ];
    const issue = { ...item("issue-investments", "LEGAL_ISSUE"), normalizedText: "Ritardo negli investimenti del programma", originatingItemIds: facts.map((fact) => fact.id) };
    const plan = build("procedure-investments", facts, [issue]).operationalPlans?.[0];
    const evidence = step(plan, "PROFILE:INVESTMENT_DEFAULT:EVIDENCE");
    const remedy = step(plan, "PROFILE:INVESTMENT_DEFAULT:REMEDY")!;
    expect(plan?.steps[0].activityCode).toMatch(/^PROFILE:INVESTMENT_DEFAULT:(EVIDENCE|JUSTIFICATION)$/);
    expect(`${evidence?.title ?? ""} ${evidence?.action ?? ""} ${remedy.draftTemplate ?? ""}`).toMatch(/I1/);
    expect(`${evidence?.title ?? ""} ${remedy.draftTemplate ?? ""}`).toMatch(/I4/);
    expect(`${evidence?.title ?? ""} ${remedy.draftTemplate ?? ""}`).toMatch(/M2/);
    expect(remedy.action).toMatch(/non sono cumulative|non è ancora individuabile/);
  });

  it("does not propose an injunction for occupations that have ceased", () => {
    const facts = [
      { ...item("occ-1", "FACT", "AI_PROPOSED"), normalizedText: "Nel 2025 il concessionario ha occupato senza titolo un'area di 120 m² esterna alla concessione con container e materiali." },
      { ...item("occ-2", "FACT", "AI_PROPOSED"), normalizedText: "Al sopralluogo del 10/09/2026 i container sono stati rimossi e l'area è stata liberata." },
    ];
    const issue = { ...item("issue-occupation", "LEGAL_ISSUE"), normalizedText: "Occupazione di aree esterne al perimetro concessorio", originatingItemIds: facts.map((fact) => fact.id) };
    const plan = build("procedure-occupation", facts, [issue]).operationalPlans?.[0];
    const restoration = step(plan, "PROFILE:UNAUTHORIZED_OCCUPATION:RESTORATION")!;
    expect(restoration.necessity).toBe("NOT_JUSTIFIED");
    expect(restoration.documentCode).toBeUndefined();
    expect(restoration.action).toMatch(/cessate|non pertinente/i);
  });

  it("reconstructs fee balances before recovery or decadence", () => {
    const facts = [{ ...item("fee-1", "FACT", "AI_PROPOSED"), normalizedText: "Il canone annuo è dovuto in due rate semestrali; risultano versamenti parziali della rata di luglio 2026." }];
    const issue = { ...item("issue-fees", "LEGAL_ISSUE"), normalizedText: "Mancato pagamento dei canoni demaniali", originatingItemIds: facts.map((fact) => fact.id) };
    const plan = build("procedure-fees", facts, [issue]).operationalPlans?.[0];
    expect(plan?.steps[0].activityCode).toBe("PROFILE:FEE_PAYMENT:EVIDENCE");
    expect(plan?.steps[0].title).toMatch(/ricostruire rate, importi, pagamenti, imputazioni e saldo/);
    expect(plan?.steps[0].documentCode).toBe("PROSPETTO_RICONCILIAZIONE_CANONI");
    expect(step(plan, "PROFILE:FEE_PAYMENT:CONTESTATION")!.necessity).toBe("NOT_JUSTIFIED");
    expect(plan?.steps.findIndex((candidate) => candidate.activityCode === "PROFILE:FEE_PAYMENT:RECOVERY"))
      .toBeGreaterThan(plan?.steps.findIndex((candidate) => candidate.activityCode === "PROFILE:FEE_PAYMENT:EVIDENCE") ?? 99);
  });

  it("cites art. 10-bis only for procedures started on a party's request", () => {
    const facts = [{ ...item("party-fact", "FACT", "AI_PROPOSED"), normalizedText: "È stata inviata la contestazione degli addebiti con termine per le deduzioni." }];
    const issue = { ...item("party-issue", "LEGAL_ISSUE"), normalizedText: "Contestazione degli addebiti al concessionario", originatingItemIds: facts.map((fact) => fact.id) };
    const ex = build("procedure-office", facts, [issue]);
    const office = ex.legalApplication?.flatMap((entry) => entry.rules.map((rule) => rule.citation)) ?? [];
    expect(office.some((citation) => /10-bis/.test(citation))).toBe(false);

    const requestFacts = [{ ...item("request-fact", "FACT", "AI_PROPOSED"), normalizedText: "Il concessionario ha presentato istanza di rinnovo della concessione; l'ufficio ritiene di non poterla accogliere." }];
    const requestIssue = { ...item("request-issue", "LEGAL_ISSUE"), normalizedText: "Esito dell'istanza di rinnovo", originatingItemIds: requestFacts.map((fact) => fact.id) };
    const request = build("procedure-request", requestFacts, [requestIssue]);
    expect(request.legalApplication?.flatMap((entry) => entry.rules.map((rule) => rule.ruleId))).toContain("L241_PREAVVISO_RIGETTO");
  });
});

import { describe, expect, it } from "vitest";

import {
  adaptAdministrativeActToInternalTemplate,
  buildStructuredFascicoloReport,
  type StructuredReportMissionInput,
  type StructuredReportTechnicalSourceInput,
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
  const partyPosition = item("position-1", "PARTY_POSITION");
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
    partyPositions: [partyPosition],
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

function legalContribution() {
  const grounded = (text: string) => ({
    text,
    sourceCandidateIds: ["support-result"],
    factBasisRefs: ["DOCUMENT_1.PAGE_1"],
  });
  return {
    version: "LEGAL_ANALYSIS_CONTRIBUTION_V1" as const,
    contributionId: "contribution-issue-1",
    legalIssueSemanticKey: sha("issue-1"),
    researchQuestionSemanticKey: sha("question-1"),
    issueStatement: "Occorre stabilire se il fatto documentato integri i presupposti della disciplina verificata.",
    ruleApplications: [{
      title: "Applicazione della regola verificata",
      rule: "La disposizione richiede la compresenza dei presupposti materiali e procedimentali indicati dalla fonte.",
      sourceCandidateIds: ["support-result"],
      relevantFacts: "Il fatto risulta documentato nel fascicolo e riferito alla questione corrente.",
      factBasisRefs: ["DOCUMENT_1.PAGE_1"],
      application: "Il fatto soddisfa il presupposto materiale, mentre il presupposto procedimentale richiede ancora verifica.",
      outcome: "La tesi è sostenibile limitatamente al presupposto materiale già documentato.",
    }],
    supportingArguments: [grounded("Il fatto documentato coincide con il presupposto materiale descritto dalla fonte favorevole verificata.")],
    contraryArguments: [{
      text: "La fonte contraria impone di verificare separatamente il presupposto procedimentale prima di concludere.",
      sourceCandidateIds: ["oppose-result"],
      factBasisRefs: ["DOCUMENT_1.PAGE_1"],
    }],
    evidenceAssessment: {
      strengths: [grounded("Il fatto decisivo è sostenuto da un riferimento documentale autenticato del fascicolo corrente.")],
      weaknesses: [grounded("Il fascicolo non documenta ancora integralmente il presupposto procedimentale richiesto dalla fonte.")],
      missingEvidence: ["Acquisire l'atto che documenta il completamento del presupposto procedimentale."],
    },
    reasonedConclusion: {
      text: "La tesi favorevole è sostenibile sul piano materiale, ma non è ancora conclusiva sul piano procedimentale.",
      confidence: "MEDIUM" as const,
      decisiveSourceCandidateIds: ["support-result", "oppose-result"],
      decisiveFactBasisRefs: ["DOCUMENT_1.PAGE_1"],
      conditions: ["Verificare documentalmente il presupposto procedimentale mancante."],
    },
    strategies: [{
      title: "Completare l'istruttoria sul presupposto procedimentale",
      rationale: "L'acquisizione dell'atto mancante consente di scegliere tra prosecuzione e archiviazione con motivazione specifica.",
      sourceCandidateIds: ["support-result", "oppose-result"],
      factBasisRefs: ["DOCUMENT_1.PAGE_1"],
      risks: ["Una conclusione anticipata esporrebbe la decisione alla contestazione fondata sulla fonte contraria."],
    }],
    uncertainties: ["Resta incerta la data di perfezionamento del presupposto procedimentale."],
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
    expect((report.payload.documentedFramework.partyPositions ?? []).map((position) => position.id)).toEqual(["position-1"]);
    expect(report.payload.operationalPlans).toHaveLength(1);
    expect(report.payload.operationalPlans?.[0]).toMatchObject({
      issueSemanticKey: sha("issue-1"),
      sourceDocumentRefs: ["DOCUMENT_1.PAGE_1"],
      legalSourceStatus: "VERIFIED_SOURCES_ATTACHED",
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
    });
    expect(report.payload.legalAnalyses).toEqual([
      expect.objectContaining({
        issueSemanticKey: sha("issue-1"),
        status: "MOTIVATION_REQUIRED",
        documentedFacts: [{
          statement: "Testo fact-1",
          documentReferences: ["DOCUMENT_1.PAGE_1"],
        }],
        questions: ["Testo question-1"],
        competingArguments: { supporting: [], opposing: [] },
        professionalReasoning: null,
        professionalReviewRequired: true,
      }),
    ]);
    expect(report.payload.legalAnalyses?.[0].verifiedSources).toEqual([
      expect.objectContaining({ title: "Autorita favorevole", direction: "SUPPORTS" }),
    ]);
    expect(report.payload.legalAnalyses?.[0].assessment).toContain("motivazione argomentata");
    expect(report.payload.operationalPlans?.[0].steps).toHaveLength(4);
    expect(report.payload.operationalPlans?.[0].steps[1].action).toContain("fonti");
    expect(JSON.stringify(report.payload.operationalPlans)).not.toContain("art. 47");
    expect(report.payload.operationalPlans?.[0].alternatives.some((alternative) => alternative.title.includes("Escludere"))).toBe(true);
    expect(report.payload.operationalPlans?.[0].alternatives.length).toBeGreaterThan(1);
    expect(report.payload.operationalPlans?.[0].steps[0].requiredDocuments.length).toBeGreaterThan(0);
    expect(report.payload.operationalPlans?.[0].administrativeActs).toHaveLength(1);
    expect(report.payload.operationalPlans?.[0].administrativeActs).toEqual([
      expect.objectContaining({
        actType: "RELAZIONE_ISTRUTTORIA_CONCLUSIVA",
        necessity: "REQUIRED_IF_PROCEEDING_STARTED",
        sequence: 1,
        templateSource: "INTERNAL_TEMPLATE_REQUIRED_IF_AVAILABLE",
        automaticExecutionProhibited: true,
        sections: expect.objectContaining({
          heading: expect.stringContaining("Bozza istruttoria modificabile"),
          subject: expect.stringContaining("Testo issue-1"),
          premises: expect.any(Array),
          documentedFacts: expect.any(Array),
          investigation: expect.any(Array),
          reasoning: expect.any(Array),
          legalReferences: ["[FONDAMENTO SOSTANZIALE, PROCEDIMENTALE E SULLA COMPETENZA DA VERIFICARE]"],
          operativePart: expect.any(Array),
          communications: expect.any(Array),
          signature: expect.stringContaining("FIRMA"),
        }),
      }),
    ]);
    expect(report.payload.operationalPlans?.[0].administrativeActs![0].adaptationInstructions)
      .toContain("schema interno dell'Ente");

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
    const narrative = report.payload.professionalNarrative!;
    expect(narrative).toMatchObject({
      status: "PRELIMINARY_DOCUMENT_BASED",
      documentaryReferences: ["DOCUMENT_1.PAGE_1"],
    });
    expect(narrative.reconstruction).toContain(
      "Testo fact-1 [DOCUMENT_1.PAGE_1]",
    );
    expect(narrative.complianceAndAllegedBreaches[0])
      .toContain("Allegazione della parte, non assunta come fatto accertato");
    expect(narrative.legalResearchStatus)
      .toContain("Norme e giurisprudenza");
    expect(JSON.stringify(report.payload)).not.toContain("analysisPayload");
  });

  it("represents deferred research with candidates as verification work, not research to restart", () => {
    const blocked = mission().results[2]!;
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [mission({ status: "DEFERRED", results: [blocked] })],
    });

    expect(report.payload.legalIssues[0]!.questions[0]!.coverageStatus).not.toBe("NOT_RESEARCHED");
    expect(report.payload.legalAnalyses).toMatchObject([{
      status: "SOURCE_VERIFICATION_REQUIRED",
      candidateSources: [{ resultId: "blocked-result" }],
    }]);
    expect(report.payload.legalAnalyses![0]!.verifiedSources).toEqual([]);
    expect(report.payload.legalAnalyses![0]!.assessment).toContain("ricerca è stata eseguita");
    expect(report.payload.legalAnalyses![0]!.recommendedActions.join(" ")).not.toContain("Completare la ricerca");
  });

  it("preserves the perimeter and safety issue once when facts remain but the current issue projection dropped it", () => {
    const baseWithoutIssue = knowledge();
    const occupancyFact = {
      ...baseWithoutIssue.facts[1]!,
      normalizedText: "Il 5 dicembre risultano ostruzioni dei varchi antincendio e un container oltre il perimetro, poi rimossi.",
    };
    const withoutIssue = {
      ...baseWithoutIssue,
      facts: baseWithoutIssue.facts.map((fact, index) => index === 1 ? occupancyFact : fact),
    };
    const continuity = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: withoutIssue,
      missions: [],
    });
    expect(continuity.payload.continuityIssues).toHaveLength(1);
    expect(continuity.payload.continuityIssues![0]).toMatchObject({
      profileId: "UNAUTHORIZED_OCCUPATION",
      status: "CONTINUITY_REVIEW_REQUIRED",
    });

    const representedBase = knowledge();
    const represented = {
      ...representedBase,
      facts: representedBase.facts.map((fact, index) => index === 1 ? occupancyFact : fact),
      legalIssues: representedBase.legalIssues.map((issue, index) => index === 0 ? {
        ...issue,
        normalizedText: "Occupazione oltre il perimetro e ostruzione dei varchi di sicurezza",
      } : issue),
    };
    const noDuplicate = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: represented,
      missions: [],
    });
    expect(noDuplicate.payload.continuityIssues).toEqual([]);
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

  it("accepts a specific motivation only when every cited source and fact belongs to the issue", () => {
    const valid = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [mission({
        results: mission().results.map((result) => result.resultId === "oppose-result" ? {
          ...result,
          classificationSource: "HUMAN_REVIEW" as const,
          classificationReviewAuditId: "audit-oppose",
          classificationReviewStatus: "HUMAN_CONFIRMED" as const,
          classificationRationale: "Il passaggio contrario affronta la medesima questione controversa.",
        } : result),
        legalAnalysisContributions: [legalContribution()],
      })],
    });
    expect(valid.payload.legalAnalyses?.[0]).toMatchObject({
      status: "CONTESTED",
      assessment: "La tesi favorevole è sostenibile sul piano materiale, ma non è ancora conclusiva sul piano procedimentale.",
      professionalReasoning: {
        contributionId: "contribution-issue-1",
        ruleApplications: [expect.objectContaining({
          application: expect.stringContaining("presupposto materiale"),
        })],
      },
    });

    const invalid = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [mission({
        legalAnalysisContributions: [{
          ...legalContribution(),
          reasonedConclusion: {
            ...legalContribution().reasonedConclusion,
            decisiveFactBasisRefs: ["DOCUMENT_99.PAGE_1"],
          },
        }],
      })],
    });
    expect(invalid.payload.legalAnalyses?.[0]).toMatchObject({
      status: "MOTIVATION_REQUIRED",
      professionalReasoning: null,
    });
  });

  it("generates differentiated concrete acts and adapts a copy to an internal test template", () => {
    const accountingBase = knowledge();
    const accountingKnowledge: StructuredKnowledgeReadModel = {
      ...accountingBase,
      legalIssues: accountingBase.legalIssues.map((issue, index) => index === 0 ? {
        ...issue,
        normalizedText: "Ricostruire canoni, pagamenti, imputazioni di Tesoreria e proposta di ripiano.",
      } : issue),
      facts: accountingBase.facts.map((fact, index) => index === 1 ? {
        ...fact,
        normalizedText: "Pagamento documentato di euro 20.000 sulla rata di euro 48.000.",
      } : fact),
    };
    const technicalBase = knowledge();
    const technicalKnowledge: StructuredKnowledgeReadModel = {
      ...technicalBase,
      legalIssues: technicalBase.legalIssues.map((issue, index) => index === 0 ? {
        ...issue,
        normalizedText: "Accertare portanza strutturale, carichi delle gru e sicurezza degli impianti.",
      } : issue),
      facts: technicalBase.facts.map((fact, index) => index === 1 ? {
        ...fact,
        normalizedText: "La portanza attuale non e attestata e i carichi puntuali non sono determinati.",
      } : fact),
    };

    const accounting = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: accountingKnowledge,
      missions: [],
    }).payload.operationalPlans![0];
    const technical = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: technicalKnowledge,
      missions: [],
    }).payload.operationalPlans![0];

    expect(accounting.administrativeActs!.map((act) => act.actType)).toEqual([
      "ACQUISIZIONE_PARTITARIO_E_ATTESTAZIONE_TESORERIA",
      "RICHIESTA_DOCUMENTI_CONTABILI_AL_CONCESSIONARIO",
      "PROVVEDIMENTO_SU_RIPIANO_O_REGOLARIZZAZIONE",
    ]);
    expect(technical.administrativeActs!.map((act) => act.actType)).toEqual([
      "RICHIESTA_ACCERTAMENTO_SPECIALISTICO_STRUTTURALE_E_IMPIANTISTICO",
      "DISPOSIZIONE_E_VERBALE_DI_SOPRALLUOGO_TECNICO",
      "PRESCRIZIONE_TECNICA_MOTIVATA",
    ]);
    expect(accounting.administrativeActs![0].sections.documentedFacts.join(" ")).toContain("euro 20.000");
    expect(accounting.administrativeActs![0].sections.investigation.join(" ")).toContain("partitario ufficiale");
    expect(technical.administrativeActs![0].sections.documentedFacts.join(" ")).toContain("portanza attuale");
    expect(technical.administrativeActs![0].sections.investigation.join(" ")).toContain("carichi");

    const internalTemplate = {
      templateId: "test-entity-accounting-act",
      templateVersion: "1",
      heading: "ENTE DI TEST - AREA FINANZIARIA",
      sectionOrder: ["heading", "subject", "premises", "documentedFacts", "investigation", "reasoning", "legalReferences", "operativePart", "communications", "signature"] as const,
      lockedClauses: ["Informativa privacy dell'Ente di test"],
    };
    const adapted = adaptAdministrativeActToInternalTemplate(
      accounting.administrativeActs![0],
      internalTemplate,
    );

    expect(adapted.originalTemplate).toEqual(internalTemplate);
    expect(adapted.originalTemplate).not.toBe(internalTemplate);
    expect(adapted.adaptedSections.heading).toBe("ENTE DI TEST - AREA FINANZIARIA");
    expect(adapted.lockedClausesPreserved).toEqual(internalTemplate.lockedClauses);
    expect(adapted.proposedIntegrations.map((integration) => integration.section))
      .toEqual(internalTemplate.sectionOrder);
    expect(adapted.humanApprovalRequired).toBe(true);
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

  it("builds preliminary operational plans from documented gaps when no explicit legal issue exists", () => {
    const withoutIssues = knowledge();
    withoutIssues.legalIssues = [];
    withoutIssues.researchQuestions = [];

    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: withoutIssues,
      missions: [],
    });

    expect(report.payload.legalIssues).toEqual([]);
    expect(report.payload.operationalPlans).toHaveLength(1);
    expect(report.payload.operationalPlans?.[0]).toMatchObject({
      issueSemanticKey: sha("gap-1"),
      sourceDocumentRefs: ["DOCUMENT_1.PAGE_1"],
      outstandingEvidence: ["Testo gap-1"],
      professionalStatus: "PRELIMINARY_NOT_APPROVED",
    });
    expect(report.payload.limitations).toContain("NO_EXPLICIT_LEGAL_ISSUES_IN_CURRENT_KNOWLEDGE");
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

  it("projects an approved professional question into the V2 report without a Knowledge AI item", () => {
    const professionalMission = mission({
      missionId: "mission-professional",
      missionFingerprint: sha("p"),
      knowledgeRevisionId: null,
      researchQuestionSemanticKey: sha("professional-question"),
      professionalQuestionVersionId: "professional-version-2",
      question: "Quali obblighi di trasparenza si applicano?",
    });
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-1",
      procedimentoId: "procedure-1",
      knowledge: knowledge(),
      missions: [professionalMission],
      contractVersion: "STRUCTURED_FASCICOLO_REPORT_V2",
    });

    const projected = report.payload.unassignedQuestions.find(
      (question) => question.knowledgeItemId === "professional-version-2",
    );
    expect(projected).toMatchObject({
      text: "Quali obblighi di trasparenza si applicano?",
      reviewStatus: "HUMAN_CONFIRMED",
      missionId: "mission-professional",
      missionStatus: "COMPLETED",
    });
  });

  describe("MCP technical sources", () => {
    const technical = (overrides: Partial<StructuredReportTechnicalSourceInput> = {}): StructuredReportTechnicalSourceInput => ({
      recordId: "tech-1",
      missionId: "mission-current",
      toolName: "wms_feature_info",
      questionSnapshot: "Vincoli paesaggistici sull'area demaniale",
      verificationStatus: "RISPOSTA_VUOTA_NON_PROBATORIA",
      serviceVersion: "1.0.0",
      responseDigest: sha("d"),
      retrievedAt: new Date("2026-10-18T08:00:00.000Z"),
      ...overrides,
    });
    const base = { tenantId: "tenant-1", procedimentoId: "procedure-1" };

    it("leaves the report unchanged when no technical source exists", () => {
      const without = buildStructuredFascicoloReport({ ...base, knowledge: knowledge(), missions: [mission()] });
      const empty = buildStructuredFascicoloReport({ ...base, knowledge: knowledge(), missions: [mission()], technicalSources: [] });
      expect(empty.reportFingerprint).toBe(without.reportFingerprint);
      expect(empty.payload.researchStateFingerprint).toBe(without.payload.researchStateFingerprint);
      expect(empty.payload).not.toHaveProperty("technicalSources");
    });

    it("includes only CURRENT-mission acquisitions, as non-probative, without creating authorities", () => {
      const without = buildStructuredFascicoloReport({ ...base, knowledge: knowledge(), missions: [mission()] });
      const report = buildStructuredFascicoloReport({
        ...base,
        knowledge: knowledge(),
        missions: [mission(), mission({ missionId: "mission-historical", lifecycleStatus: "HISTORICAL", results: [] })],
        technicalSources: [
          technical(),
          technical({ recordId: "tech-historical", missionId: "mission-historical" }),
          technical({ recordId: "tech-foreign", missionId: "mission-other-procedure" }),
          technical({ recordId: "tech-unknown", verificationStatus: "VERIFICATO" }),
        ],
      });

      expect(report.payload.technicalSources?.map((source) => source.recordId)).toEqual(["tech-1", "tech-unknown"]);
      expect(report.payload.technicalSources?.every((source) => source.probative === false)).toBe(true);
      expect(report.payload.technicalSources?.[1].verificationStatus).toBe("DA_VERIFICARE_SU_FONTE_ORIGINALE");
      expect(report.payload.technicalSources?.[0]).toMatchObject({
        questionSemanticKey: sha("question-1"),
        retrievedAt: "2026-10-18T08:00:00.000Z",
      });
      expect(report.payload.technicalSources?.[0].requiredVerification).toContain("non prova l'assenza di vincoli");
      expect(report.payload.legalIssues[0].questions[0].favorableAuthorities)
        .toEqual(without.payload.legalIssues[0].questions[0].favorableAuthorities);
      expect(report.payload.operationalPlans?.[0].legalSourceStatus).toBe(without.payload.operationalPlans?.[0].legalSourceStatus);
      expect(report.payload.operationalPlans?.[0].outstandingEvidence.some((line) => line.includes("MCP (2, non probatori)"))).toBe(true);
      expect(report.payload.limitations).toContain("TECHNICAL_SOURCES_NOT_PROBATIVE_VERIFY_ORIGINAL");
      expect(report.payload.researchStateFingerprint).not.toBe(without.payload.researchStateFingerprint);
      expect(report.reportFingerprint).not.toBe(without.reportFingerprint);
    });
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

  it("keeps the issue-specific alternatives behind an explicit instruction gate when sources are unverified", () => {
    const fact = { ...item("occ-manufatto", "FACT", "AI_PROPOSED"), normalizedText: "Un verbale rileva un manufatto sulla banchina portuale all'esterno del perimetro concesso." };
    const issue = { ...item("issue-occ", "LEGAL_ISSUE"), normalizedText: "Occupazione di area demaniale portuale oltre il perimetro della concessione.", originatingItemIds: [fact.id] };
    const plan = build("procedure-alternatives", [fact], [issue]).operationalPlans?.[0];
    const titles = plan?.alternatives.map((alternative) => alternative.title) ?? [];

    expect(plan?.legalSourceStatus).toBe("LEGAL_RESEARCH_REQUIRED");
    expect(titles[0]).toBe("Completare l'istruttoria prima di scegliere il procedimento");
    expect(titles).toContain("Archiviare la contestazione o escludere specifiche misure");
    expect(titles).toContain("Valutare rimozione e ripristino per innovazione abusiva (art. 54 cod. nav.)");
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

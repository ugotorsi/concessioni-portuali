import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  FascicoloResearch,
  researchDirectionLabel,
  researchUsabilityLabel,
  type FascicoloResearchModel,
} from "@/components/procedimenti/FascicoloResearch";
import {
  buildFascicoloResearchModel,
  type FascicoloResearchWorkflowProjection,
} from "@/server/queries/fascicolo-research";

function render(model: FascicoloResearchModel): string {
  return renderToStaticMarkup(createElement(FascicoloResearch, { model }));
}

describe("Fascicolo research workspace", () => {
  function workflowResult(index: number, usable = false) {
    return {
      resultId: `result-${index}`,
      candidateId: `candidate-${index}`,
      missionId: "mission-1",
      bundleId: "bundle-1",
      title: index === 0 ? "Consiglio di Stato n. 10810/2022" : `Fonte normativa ${index}`,
      authority: index === 0 ? "Consiglio di Stato" : null,
      sourceFamily: index === 0 ? "ITALIAN_CASE_LAW" : "ITALIAN_LEGISLATION",
      officialIdentifier: index === 0 ? "10810/2022" : `art-${index}`,
      documentDate: index === 0 ? "2022-12-09" : null,
      sourceUrl: `https://example.test/source-${index}`,
      provider: index === 0 ? "legal-data-hunter" : "simpliciter",
      relevantPassage: `Passaggio pertinente ${index}`,
      supportDirection: "UNASSESSED" as const,
      classificationSource: "PROVIDER_OUTPUT" as const,
      classificationConfidence: null,
      classificationRationale: null,
      classificationReviewStatus: "AI_PROPOSED" as const,
      sourceVerificationState: "DISCOVERED" as const,
      retrievalState: "RESOLVED",
      acquisitionState: usable ? "FULL_TEXT" : "METADATA_ONLY",
      identityVerification: usable ? "VERIFIED" : "NOT_ASSESSED",
      contentVerification: usable ? "VERIFIED" : "NOT_ASSESSED",
      temporalStatus: usable ? "APPLICABLE" : "NOT_ASSESSED",
      adverseStatus: usable ? "COMPLETED" : "NOT_REQUIRED",
      officiality: usable ? "OFFICIAL" : "UNKNOWN",
      usable,
      blockingReasons: usable ? [] : ["IDENTITY_UNVERIFIED"],
      citationAnchors: usable ? [{ page: 4, paragraph: "12" }] : [],
      manualReviewRequired: !usable,
      manualReviewReason: usable ? null : "SOURCE_REVIEW_REQUIRED",
      legacySource: false,
      sourceAssessment: null,
    };
  }

  function workflow(
    status: "COMPLETED" | "DEFERRED",
    results: ReturnType<typeof workflowResult>[],
  ): FascicoloResearchWorkflowProjection {
    return {
      missions: [{
        missionId: "mission-1",
        question: "Quali fonti disciplinano container e manufatti?",
        referenceDate: new Date("2026-10-17T00:00:00.000Z"),
        updatedAt: new Date("2026-10-17T12:00:00.000Z"),
        researchQuestionSemanticKey: "question-container",
        lifecycleStatus: "CURRENT",
        status,
        coverageStatus: results.length > 0 ? "PARTIAL" : "NOT_RESEARCHED",
        coveredElementKeys: results.length > 0 ? ["disciplina"] : [],
        coverageGaps: results.length > 0 ? [{ kind: "UNVERIFIED_SOURCE", key: "verifica" }] : [],
        results,
      }],
    };
  }

  it("projects all eight persisted results for a fascicolo without requiring a linked concession", () => {
    const model = buildFascicoloResearchModel(workflow(
      "COMPLETED",
      Array.from({ length: 8 }, (_, index) => workflowResult(index)),
    ));

    expect(model.questions).toHaveLength(1);
    expect(model.sources).toHaveLength(8);
    expect(model.sources.filter((source) => source.usability === "USABLE")).toHaveLength(0);
    expect(model.sources[0]).toMatchObject({
      title: "Consiglio di Stato n. 10810/2022",
      sourceType: "Giurisprudenza",
      usability: "TO_VERIFY",
      questionId: "mission-1",
      missionId: "mission-1",
      resultId: "result-0",
      lifecycleStatus: "CURRENT",
    });
    expect(model.sources[0].verificationStatus).toContain("Risultato candidato");
    expect(model.questions[0].versions).toEqual([]);
  });

  it("keeps a deferred E2E mission separate and does not invent sources", () => {
    const model = buildFascicoloResearchModel(workflow("DEFERRED", []));

    expect(model.questions[0]).toMatchObject({
      status: "Differita",
      needsFurtherResearch: true,
    });
    expect(model.sources).toEqual([]);
  });

  it("shows verified usability and registered document references without claiming professional validation", () => {
    const model = buildFascicoloResearchModel(workflow("COMPLETED", [workflowResult(0, true)]));

    expect(model.sources[0]).toMatchObject({
      usability: "USABLE",
      verificationStatus: expect.stringContaining("Fonte verificata e utilizzabile"),
      note: expect.stringContaining("pagina 4, paragrafo 12"),
    });
    expect(model.sources[0].verificationStatus).toContain("valutazione professionale");
  });

  it("preserves the same authority as distinct results when it belongs to different missions", () => {
    const first = workflow("COMPLETED", [workflowResult(0)]).missions[0];
    const model = buildFascicoloResearchModel({
      missions: [
        first,
        {
          ...first,
          missionId: "mission-2",
          question: "Quali garanzie di contraddittorio si applicano?",
          researchQuestionSemanticKey: "question-contraddittorio",
          results: [{ ...workflowResult(0), resultId: "result-same-authority-2", missionId: "mission-2" }],
        },
      ],
    });

    expect(model.sources).toHaveLength(2);
    expect(model.sources.map((source) => source.missionId)).toEqual(["mission-1", "mission-2"]);
    expect(model.sources.map((source) => source.resultId)).toEqual(["result-0", "result-same-authority-2"]);
  });

  it("keeps current and historical versions of the same source visible and clearly distinct", () => {
    const current = workflow("COMPLETED", [workflowResult(0, true)]).missions[0];
    const historical = {
      ...current,
      missionId: "mission-historical",
      lifecycleStatus: "HISTORICAL" as const,
      updatedAt: new Date("2026-10-16T12:00:00.000Z"),
      results: [{ ...workflowResult(0, true), resultId: "result-historical", missionId: "mission-historical" }],
    };
    const model = buildFascicoloResearchModel({
      missions: [current],
      historicalMissions: [historical],
    });

    expect(model.sources).toHaveLength(2);
    expect(model.sources[0]).toMatchObject({ lifecycleStatus: "CURRENT", usability: "USABLE" });
    expect(model.sources[1]).toMatchObject({
      lifecycleStatus: "HISTORICAL",
      usability: "TO_VERIFY",
      latestAssessmentUsability: "USABLE",
    });
    expect(model.questions[0].versions?.[0]).toMatchObject({
      id: "mission-historical",
      change: expect.stringContaining("1 risultati"),
    });
    const html = render(model);
    expect(html).toContain("Ricerche correnti");
    expect(html).toContain("Ricerche storiche");
    expect(html).toContain("non costituisce necessariamente una fotografia immutabile alla data della missione");
    expect(html).toContain("Ultima valutazione registrata sul risultato storico");
  });

  it("preserves a supplemental document when a historical result has the same identifier", () => {
    const historical = {
      ...workflow("COMPLETED", [workflowResult(0)]).missions[0],
      missionId: "mission-historical",
      lifecycleStatus: "HISTORICAL" as const,
      results: [{ ...workflowResult(0), resultId: "result-historical", missionId: "mission-historical" }],
    };
    const model = buildFascicoloResearchModel({
      missions: [],
      historicalMissions: [historical],
    }, [{
      id: "documento-fascicolo",
      identifier: "10810/2022",
      title: "Documento acquisito autonomamente",
      origin: "Documento acquisito al fascicolo",
      usability: "TO_VERIFY",
    }]);

    expect(model.sources).toHaveLength(2);
    expect(model.sources.map((source) => source.origin)).toEqual([
      "Ricerca storica archiviata · legal-data-hunter",
      "Documento acquisito al fascicolo",
    ]);
  });

  it("preserves two independently acquired supplemental documents with the same identifier", () => {
    const model = buildFascicoloResearchModel(null, [{
      id: "documento-fascicolo-1",
      identifier: "10810/2022",
      title: "Prima acquisizione",
      origin: "Upload del fascicolo",
      usability: "TO_VERIFY",
    }, {
      id: "documento-fascicolo-2",
      identifier: "10810/2022",
      title: "Seconda acquisizione",
      origin: "Protocollo successivo",
      usability: "TO_VERIFY",
    }]);

    expect(model.sources).toHaveLength(2);
    expect(model.sources.map((source) => source.id)).toEqual([
      "documento-fascicolo-1",
      "documento-fascicolo-2",
    ]);
    expect(model.sources.map((source) => source.origin)).toEqual([
      "Upload del fascicolo",
      "Protocollo successivo",
    ]);
  });

  it("distinguishes a historically non-usable source from its current need for re-verification", () => {
    const notUsableResult = {
      ...workflowResult(0),
      retrievalState: "BLOCKED",
      blockingReasons: ["RETRIEVAL_BLOCKED"],
    };
    const historical = {
      ...workflow("COMPLETED", [notUsableResult]).missions[0],
      missionId: "mission-historical-not-usable",
      lifecycleStatus: "HISTORICAL" as const,
      results: [{ ...notUsableResult, resultId: "result-historical-not-usable" }],
    };
    const model = buildFascicoloResearchModel({ missions: [], historicalMissions: [historical] });

    expect(model.sources[0]).toMatchObject({
      lifecycleStatus: "HISTORICAL",
      usability: "TO_VERIFY",
      latestAssessmentUsability: "NOT_USABLE",
      verificationStatus: expect.stringContaining("ultima valutazione registrata non utilizzabile"),
    });
    const html = render(model);
    expect(html).toContain("Stato attuale: Da verificare");
    expect(html).toContain("Ultima valutazione registrata: Non utilizzabile allo stato");
  });

  it("excludes historical questions from current operational indicators", () => {
    const html = render({
      questions: [{
        id: "question-current",
        text: "Quesito corrente coperto",
        lifecycleStatus: "CURRENT",
        needsFurtherResearch: false,
      }, {
        id: "question-historical",
        text: "Quesito storico incompleto",
        lifecycleStatus: "HISTORICAL",
        needsFurtherResearch: true,
      }],
      sources: [],
    });

    expect(html).toContain("Quesiti correnti");
    expect(html).toContain("Missioni storiche");
    expect(html).toContain("Da approfondire (correnti)");
    expect(html).toMatch(/Da approfondire \(correnti\).*?0/);
  });

  it("shows a historical mission without inventing results", () => {
    const historical = {
      ...workflow("DEFERRED", []).missions[0],
      missionId: "mission-historical-empty",
      lifecycleStatus: "HISTORICAL" as const,
      question: "Quesito conservato senza risultati",
    };
    const model = buildFascicoloResearchModel({
      missions: [],
      historicalMissions: [historical],
      missionReadTruncation: { limitPerLifecycle: 50, current: false, historical: true, adverse: false },
    });

    expect(model.questions).toHaveLength(1);
    expect(model.sources).toEqual([]);
    const html = render(model);
    expect(html).toContain("Quesito conservato senza risultati");
    expect(html).toContain("Il quesito è presente, ma non risultano ancora fonti acquisite.");
    expect(html).toContain("Esistono ulteriori missioni storiche.");
  });

  it("renders questions, coverage, source direction, usability, and version history", () => {
    const html = render({
      questions: [{
        id: "question-1",
        text: "La proroga è applicabile alla concessione?",
        theme: "Durata del titolo",
        status: "Parzialmente coperto",
        referenceDate: "23/09/2026",
        coverage: "La disciplina generale è coperta; resta da verificare il regime transitorio.",
        coveredAspects: ["Disciplina generale"],
        gaps: ["Regime transitorio"],
        needsFurtherResearch: true,
        versions: [{ id: "v1", date: "20/09/2026", status: "Superata", change: "Quesito precisato" }],
      }],
      sources: [{
        id: "source-supports",
        questionId: "question-1",
        authority: "Consiglio di Stato",
        sourceType: "Giurisprudenza",
        identifier: "Sentenza 42/2026",
        date: "15/09/2026",
        title: "Durata delle concessioni demaniali",
        origin: "Fonte ufficiale",
        verificationStatus: "Contenuto e applicabilità temporale verificati.",
        direction: "SUPPORTS",
        usability: "USABLE",
      }, {
        id: "source-opposes",
        questionId: "question-1",
        title: "Orientamento contrario",
        direction: "OPPOSES",
        usability: "TO_VERIFY",
      }],
    });

    expect(html).toContain("La proroga è applicabile alla concessione?");
    expect(html).toContain("Copertura della ricerca");
    expect(html).toContain("Regime transitorio");
    expect(html).toContain("Favorevole");
    expect(html).toContain("Contraria");
    expect(html).toContain("Utilizzabile");
    expect(html).toContain("Da verificare");
    expect(html).toContain("Orientamento contrario");
    expect(html).toContain("Versioni precedenti");
    expect(html).toContain("Quesito precisato");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Non indicato");
  });

  it("maps every required direction and usability label", () => {
    expect([
      researchDirectionLabel("SUPPORTS"),
      researchDirectionLabel("OPPOSES"),
      researchDirectionLabel("NEUTRAL"),
      researchDirectionLabel("INCONCLUSIVE"),
      researchDirectionLabel("UNASSESSED"),
    ]).toEqual(["Favorevole", "Contraria", "Neutrale", "Non conclusiva", "Da valutare"]);
    expect([
      researchUsabilityLabel("USABLE"),
      researchUsabilityLabel("TO_VERIFY"),
      researchUsabilityLabel("NOT_USABLE"),
    ]).toEqual(["Utilizzabile", "Da verificare", "Non utilizzabile allo stato"]);
  });

  it("renders truthful empty states for an empty workspace and a question without sources", () => {
    const empty = render({ questions: [], sources: [] });
    const questionOnly = render({
      questions: [{ id: "question-1", text: "Qual è la disciplina applicabile?" }],
      sources: [],
    });

    expect(empty).toContain("Non risultano ancora approfondimenti giuridici strutturati per questo fascicolo.");
    expect(empty).not.toContain("Quesiti di ricerca");
    expect(questionOnly).toContain("Il quesito è presente, ma non risultano ancora fonti acquisite.");
  });

  it("does not hide sources whose question is unavailable in the current read model", () => {
    const html = render({
      questions: [],
      sources: [{ id: "source-1", questionId: "unavailable-question", title: "Fonte conservata" }],
    });

    expect(html).toContain("Fonte conservata");
  });

  it("is shared by legacy and intake without the interactive candidate panel or dense table", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloResearch.tsx", "utf8");

    expect(legacy).toContain('activeSection === "research"');
    expect(legacy).toContain("<FascicoloResearch");
    expect(intake).toContain('activeSection === "research"');
    expect(intake).toContain("<FascicoloResearch");
    expect(legacy.match(/activeSection === "research"/g)).toHaveLength(2);
    expect(legacy).not.toContain("LegalSourceCandidatesPanel");
    expect(legacy).not.toContain("<CardTitle>Riferimenti normativi collegati</CardTitle>");
    expect(component).not.toContain("JSON.stringify");
    expect(component).not.toContain("<Table");
    expect(component).not.toContain("/api/legal-sources");
  });
});
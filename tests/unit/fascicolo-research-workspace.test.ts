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
        status,
        coverageStatus: results.length > 0 ? "PARTIAL" : "NOT_RESEARCHED",
        coveredElementKeys: results.length > 0 ? ["disciplina"] : [],
        coverageGaps: results.length > 0 ? [{ kind: "UNVERIFIED_SOURCE", key: "verifica" }] : [],
        historicalResultCount: 2,
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
    expect(model.sources[0]).toMatchObject({
      title: "Consiglio di Stato n. 10810/2022",
      sourceType: "Giurisprudenza",
      usability: "TO_VERIFY",
      questionId: "mission-1",
    });
    expect(model.sources[0].verificationStatus).toContain("Risultato candidato");
    expect(model.questions[0].versions?.[0].change).toContain("2 risultati");
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
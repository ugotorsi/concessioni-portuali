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

function render(model: FascicoloResearchModel): string {
  return renderToStaticMarkup(createElement(FascicoloResearch, { model }));
}

describe("Fascicolo research workspace", () => {
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
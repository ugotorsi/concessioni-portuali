import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { FascicoloAnalysis, type FascicoloAnalysisModel } from "@/components/procedimenti/FascicoloAnalysis";

const forbiddenTerms = [
  "provider",
  "prompt",
  "token",
  "job id",
  "fingerprint",
  "hash",
  "queue",
  "runtime",
  "execution logs",
  "trusted review",
  "screening",
  "materiali ai",
];

function render(model: FascicoloAnalysisModel): string {
  return renderToStaticMarkup(createElement(FascicoloAnalysis, { model }));
}

describe("Fascicolo analysis workspace", () => {
  it("renders structured questions, evidence, contradictions, gaps, and relevant items", () => {
    const html = render({
      questions: [{
        id: "issue-1",
        title: "Conformità dell’occupazione",
        description: "La planimetria presenta un limite da verificare.",
        status: "Aperta",
        area: "Titolo concessorio",
        relevance: "Alta",
        evidence: ["Planimetria lotto A"],
      }],
      evidence: [{ id: "doc-1", title: "Planimetria lotto A", detail: "Documento tecnico", href: "/documenti/doc-1/download" }],
      contradictions: [{ id: "contradiction-1", description: "Le superfici indicate non coincidono.", involved: ["Titolo", "Planimetria"], status: "Da chiarire" }],
      gaps: [{ id: "gap-1", title: "Autorizzazione mancante", relevance: "Necessaria per completare la verifica.", status: "Da verificare" }],
      relevantItems: [{ id: "fact-1", title: "Ricezione della planimetria", description: "Documento acquisito nel fascicolo.", detail: "29/06/2026" }],
    });

    expect(html).toContain("Analisi");
    expect(html).toContain("Questioni, evidenze e punti da approfondire nel fascicolo.");
    expect(html).toContain("Questioni principali");
    expect(html).toContain("Conformità dell’occupazione");
    expect(html).toContain("Elementi disponibili");
    expect(html).toContain("Contraddizioni");
    expect(html).toContain("Le superfici indicate non coincidono.");
    expect(html).toContain("Informazioni mancanti");
    expect(html).toContain("Autorizzazione mancante");
    expect(html).toContain("Elementi rilevanti");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<pre");
    for (const term of forbiddenTerms) expect(html.toLocaleLowerCase("it")).not.toContain(term);
  });

  it("omits missing optional fields without rendering placeholders", () => {
    const html = render({
      questions: [{ id: "issue-1", title: "Questione aperta" }],
      evidence: [],
      contradictions: [],
      gaps: [],
      relevantItems: [],
    });

    expect(html).toContain("Questione aperta");
    expect(html).toContain("Nessuna contraddizione rilevata nei dati strutturati.");
    expect(html).not.toContain("Tema:");
    expect(html).not.toContain("Rilevanza:");
    expect(html).not.toContain("Non indicato");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("renders the required empty state when structured analysis is unavailable", () => {
    const html = render({
      questions: [],
      evidence: [],
      contradictions: [],
      gaps: [],
      relevantItems: [],
    });

    expect(html).toContain("L’analisi strutturata del fascicolo non è ancora disponibile.");
    expect(html).toContain("I documenti e i dati presenti nel fascicolo restano consultabili nelle rispettive sezioni.");
    expect(html).not.toContain("Questioni principali");
    expect(html).not.toContain("Contraddizioni");
  });

  it("renders corpus readiness separately from unavailable structured analysis", () => {
    const html = render({
      questions: [],
      evidence: [],
      contradictions: [],
      gaps: [],
      relevantItems: [],
      corpus: {
        availability: "PARTIAL",
        documentCount: 3,
        availableDocumentCount: 1,
        textPageCount: 2,
        documentsToVerify: [
          { id: "doc-2", name: "Scansione.pdf", status: "OCR_REQUIRED" },
          { id: "doc-3", name: "Allegato.pdf", status: "NOT_EXTRACTED" },
          { id: "doc-4", name: "Errore.pdf", status: "EXTRACTION_FAILED" },
        ],
      },
    });

    expect(html).toContain("Corpus documentale");
    expect(html).toContain("3");
    expect(html).toContain("1 documenti · 2 pagine");
    expect(html).toContain("Corpus parziale");
    expect(html).toContain("Disponibilità del corpus");
    expect(html).not.toContain("Analisi strutturata</dt>");
    expect(html).toContain("Scansione.pdf: OCR necessario");
    expect(html).toContain("Allegato.pdf: Testo non ancora estratto");
    expect(html).toContain("Errore.pdf: Estrazione non riuscita");
    expect(html).not.toContain("Errore.pdf: Testo non ancora estratto");
    expect(html).toContain("non rappresenta ancora fatti o valutazioni giuridiche ricostruiti");
    expect(html).toContain("L’analisi strutturata del fascicolo non è ancora disponibile.");
  });

  it("uses the same UX for legacy and intake while preserving the instruction section", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloAnalysis.tsx", "utf8");

    expect(legacy).toContain('activeSection === "analysis"');
    expect(legacy).toContain("<FascicoloAnalysis");
    expect(intake).toContain('activeSection === "analysis"');
    expect(intake).toContain("<FascicoloAnalysis");
    expect(legacy).not.toContain('["analysis", "istruttoria"].includes(activeSection)');
    expect(legacy.match(/activeSection === "analysis"/g)).toHaveLength(2);
    expect(legacy.match(/activeSection === "istruttoria"/g)).toHaveLength(6);
    expect(component).not.toContain("JSON.stringify");
    expect(component).not.toContain("<Table");
    expect(component).not.toContain("<pre");
    expect(component.match(/prefetch=\{false\}/g)).toHaveLength(3);
    for (const term of forbiddenTerms) expect(component.toLocaleLowerCase("it")).not.toContain(term);
  });
});
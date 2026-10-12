import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  FascicoloDeadlines,
  fascicoloDeadlineStatusLabel,
  type FascicoloDeadlinesModel,
} from "@/components/procedimenti/FascicoloDeadlines";

function render(model: FascicoloDeadlinesModel): string {
  return renderToStaticMarkup(createElement(FascicoloDeadlines, { model }));
}

describe("Fascicolo deadlines workspace", () => {
  it("renders a compact professional workspace with prominent dates and real metadata", () => {
    const html = render({
      deadlines: [{
        id: "expired-1",
        date: "20/09/2026",
        description: "Deposito delle osservazioni difensive",
        type: "Termine procedimentale",
        status: "SCADUTA",
        normativeReference: "Art. 10-bis L. 241/1990",
        responsible: "Difensore incaricato",
        notice: "Promemoria registrato",
        origin: "Procedimento",
        links: [{ label: "Apri documento", href: "/documenti/doc-1/download" }],
      }, {
        id: "upcoming-1",
        date: "06/10/2026",
        title: "Verifica garanzia",
        type: "Fideiussione",
        status: "APERTA",
        attention: "UPCOMING",
      }],
    });

    expect(html).toContain("Scadenze");
    expect(html).toContain("Termini e date rilevanti del fascicolo.");
    expect(html).toContain('<time class="block text-2xl');
    expect(html).toContain("20/09/2026");
    expect(html).toContain("Deposito delle osservazioni difensive");
    expect(html).toContain("Termine procedimentale");
    expect(html).toContain("Art. 10-bis L. 241/1990");
    expect(html).toContain("Difensore incaricato");
    expect(html).toContain("Promemoria registrato");
    expect(html).toContain("Origine del termine");
    expect(html).toContain("Scadute");
    expect(html).toContain("Imminenti");
    expect(html.indexOf("Scadute")).toBeLessThan(html.indexOf("Imminenti"));
    expect(html).not.toContain("<table");
  });

  it("translates only the deadline statuses present in the generated enum", () => {
    expect([
      fascicoloDeadlineStatusLabel("APERTA"),
      fascicoloDeadlineStatusLabel("GESTITA"),
      fascicoloDeadlineStatusLabel("SCADUTA"),
      fascicoloDeadlineStatusLabel("ARCHIVIATA"),
    ]).toEqual(["Aperta", "Gestita", "Scaduta", "Archiviata"]);
  });

  it("keeps candidate terms separate from consolidated deadlines", () => {
    const html = render({
      deadlines: [{ id: "deadline-1", date: "15/10/2026", status: "APERTA" }],
      candidates: [{
        id: "candidate-1",
        date: "31/10/2026",
        title: "Termine proposto dal documento",
        origin: "Documento acquisito",
      }],
    });

    expect(html).toContain("Altre");
    expect(html).toContain("Termini da verificare");
    expect(html).toContain("Data o qualificazione ancora da confermare.");
    expect(html).toContain("Termine proposto dal documento");
  });

  it("omits missing fields and renders the required empty state", () => {
    const sparse = render({ deadlines: [{ id: "deadline-1", date: "15/10/2026", status: "APERTA" }] });
    const empty = render({ deadlines: [], candidates: [] });

    expect(sparse).not.toContain("Tipologia</dt>");
    expect(sparse).not.toContain("Responsabile</dt>");
    expect(sparse).not.toContain("Preavviso</dt>");
    expect(sparse).not.toContain("Non indicato");
    expect(sparse).not.toContain("undefined");
    expect(empty).toContain("Non risultano scadenze strutturate per questo fascicolo.");
    expect(empty).not.toContain("Scadute</h3>");
  });

  it("uses the same component for legacy and intake with passive safe links", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloDeadlines.tsx", "utf8");

    expect(legacy).toContain('activeSection === "deadlines"');
    expect(legacy).toContain("<FascicoloDeadlines");
    expect(legacy).toContain("detail.scadenzeRilevanti.map");
    expect(intake).toContain('activeSection === "deadlines"');
    expect(intake).toContain("<FascicoloDeadlines");
    expect(legacy.match(/activeSection === "deadlines"/g)).toHaveLength(1);
    expect(legacy).not.toContain("<CardTitle>8. Scadenze rilevanti</CardTitle>");
    expect(component).toContain("prefetch={false}");
    expect(component).not.toContain("JSON.stringify");
    expect(component).not.toContain("<Table");
    expect(component).not.toContain("Pagamenti");
    expect(component).not.toContain("Documenti completi");
    expect(component.toLocaleLowerCase("it")).not.toContain("fingerprint");
    expect(component.toLocaleLowerCase("it")).not.toContain("payload");
  });
});
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  FascicoloIssues,
  fascicoloIssueSeverityLabel,
  fascicoloIssueStatusLabel,
  type FascicoloIssuesModel,
} from "@/components/procedimenti/FascicoloIssues";

function render(model: FascicoloIssuesModel): string {
  return renderToStaticMarkup(createElement(FascicoloIssues, { model }));
}

describe("Fascicolo issues workspace", () => {
  it("renders real issues as compact cards with full professional descriptions", () => {
    const description = "L’occupazione rilevata non coincide con la superficie assentita e richiede il presidio del profilo concessorio senza alterare la classificazione registrata.";
    const html = render({
      issues: [{
        id: "issue-technical-42",
        type: "Occupazione difforme",
        description,
        severity: "ALTA",
        status: "IN_GESTIONE",
        detectedAt: "02/10/2026",
        normativeReference: "art. 54 Codice della navigazione",
        origin: "Procedimento",
        links: [{ label: "Apri documento", href: "/documenti/doc-1/download" }],
      }],
    });

    expect(html).toContain("Criticità");
    expect(html).toContain("Problemi, anomalie e profili da presidiare nel fascicolo.");
    expect(html).toContain("Occupazione difforme");
    expect(html).toContain(description);
    expect(html).toContain("Rilevata il 02/10/2026");
    expect(html).toContain("Alta");
    expect(html).toContain("In gestione");
    expect(html).toContain("Riferimento:");
    expect(html).toContain("art. 54 Codice della navigazione");
    expect(html).toContain("Procedimento");
    expect(html).not.toContain("issue-technical-42");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("<table");
  });

  it("maps only persisted severity and status enum values", () => {
    expect([
      fascicoloIssueSeverityLabel("BASSA"),
      fascicoloIssueSeverityLabel("MEDIA"),
      fascicoloIssueSeverityLabel("ALTA"),
      fascicoloIssueSeverityLabel("URGENTE"),
    ]).toEqual(["Bassa", "Media", "Alta", "Urgente"]);
    expect([
      fascicoloIssueStatusLabel("APERTA"),
      fascicoloIssueStatusLabel("IN_GESTIONE"),
      fascicoloIssueStatusLabel("RISOLTA"),
      fascicoloIssueStatusLabel("ARCHIVIATA"),
    ]).toEqual(["Aperta", "In gestione", "Risolta", "Archiviata"]);
  });

  it("orders severity groups without calculating a score", () => {
    const html = render({
      issues: [
        { id: "low", type: "Bassa", severity: "BASSA", status: "APERTA" },
        { id: "medium", type: "Media", severity: "MEDIA", status: "RISOLTA" },
        { id: "high", type: "Alta", severity: "ALTA", status: "APERTA" },
        { id: "urgent", type: "Urgente", severity: "URGENTE", status: "IN_GESTIONE" },
      ],
    });

    const urgent = html.indexOf("Urgenti</h3>");
    const high = html.indexOf("Alte</h3>");
    const medium = html.indexOf("Medie</h3>");
    const low = html.indexOf("Basse</h3>");
    expect(urgent).toBeGreaterThan(-1);
    expect(urgent).toBeLessThan(high);
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
    expect(html).toContain("Aperte </dt><dd class=\"inline font-semibold text-slate-950\">3");
    expect(html).toContain("Alte / urgenti </dt><dd class=\"inline font-semibold text-slate-950\">2");
    expect(html).toContain("Chiuse </dt><dd class=\"inline font-semibold text-slate-950\">1");
  });

  it("omits unavailable fields and renders the required empty state", () => {
    const sparse = render({ issues: [{ id: "issue-1", type: "Documentale", severity: "BASSA", status: "APERTA" }] });
    const empty = render({ issues: [] });

    expect(sparse).not.toContain("Rilevata il");
    expect(sparse).not.toContain("Riferimento:");
    expect(sparse).not.toContain("Origine</dt>");
    expect(sparse).not.toContain("Non indicato");
    expect(sparse).not.toContain("undefined");
    expect(empty).toContain("Non risultano criticità strutturate per questo fascicolo.");
    expect(empty).not.toContain("Urgenti</h3>");
  });

  it("uses the same focused component for legacy and intake with safe passive links", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloIssues.tsx", "utf8");

    expect(legacy).toContain('activeSection === "issues"');
    expect(legacy).toContain("<FascicoloIssues");
    expect(legacy).toContain("detail.altreCriticitaAperte.map");
    expect(intake).toContain('activeSection === "issues"');
    expect(intake).toContain("<FascicoloIssues");
    expect(legacy.match(/activeSection === "issues"/g)).toHaveLength(1);
    expect(legacy).not.toContain("<CardTitle>5. Criticità collegata</CardTitle>");
    expect(legacy).not.toContain("<CardTitle>6. Altre criticità aperte della concessione</CardTitle>");
    expect(component).toContain("prefetch={false}");
    expect(component).not.toContain("JSON.stringify");
    expect(component).not.toContain("<Table");
    expect(component).not.toContain("Pagamenti");
    expect(component).not.toContain("Documenti completi");
    expect(component.toLocaleLowerCase("it")).not.toContain("fingerprint");
    expect(component.toLocaleLowerCase("it")).not.toContain("payload");
  });
});
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { FascicoloConcession, type FascicoloConcessionModel } from "@/components/procedimenti/FascicoloConcession";

function render(model: FascicoloConcessionModel): string {
  return renderToStaticMarkup(createElement(FascicoloConcession, { model }));
}

describe("Fascicolo concession workspace", () => {
  it("renders a compact concession summary without tabular detail", () => {
    const html = render({
      number: "CDM-42/2026",
      state: "Attiva",
      concessionaire: "Porto Servizi S.p.A.",
      grantingAuthority: "Comune di Genova",
      expiryDate: "31/12/2028",
      expiryStatus: "Tra 34 mesi",
      openHref: "/concessioni/con-42",
      title: [{ label: "Numero atto", value: "CDM-42/2026" }],
      property: [{ label: "Ubicazione", value: "Calata Levante" }],
      activity: [{ label: "Attività", value: "Turistico ricreativa" }],
      fee: [{ label: "Canone annuo", value: "12.500,00 €" }],
      normativeReferences: ["Codice della navigazione", "Codice della navigazione"],
      indicators: { openIssues: 2, criticalPayments: 1, documents: 8 },
    });

    expect(html).toContain("Concessione");
    expect(html).toContain("CDM-42/2026");
    expect(html).toContain("Scadenza");
    expect(html).toContain("31/12/2028");
    expect(html).toContain("Apri concessione");
    expect(html).toContain('href="/concessioni/con-42"');
    expect(html.match(/Codice della navigazione/g)).toHaveLength(1);
    expect(html).toContain("Pagamenti critici");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Non indicato");
  });

  it("omits unavailable fields and exposes a compact empty state", () => {
    const html = render({
      number: null,
      title: [{ label: "Numero atto", value: null }],
      property: [],
      activity: [],
      fee: [],
    });

    expect(html).toContain("Dati concessori non ancora strutturati.");
    expect(html).not.toContain("Numero atto");
    expect(html).not.toContain("Apri concessione");
    expect(html).not.toContain("<table");
  });

  it("is shared by legacy and intake without the legacy payments table", () => {
    const legacy = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intake = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const component = readFileSync("src/components/procedimenti/FascicoloConcession.tsx", "utf8");

    expect(legacy).toContain("<FascicoloConcession");
    expect(intake).toContain("<FascicoloConcession");
    expect(legacy).not.toContain("<CardTitle>7. Pagamenti critici</CardTitle>");
    expect(component).not.toContain("<Table");
    expect(component).not.toContain("Non indicato");
  });
});
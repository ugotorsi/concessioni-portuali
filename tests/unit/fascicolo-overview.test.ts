import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FascicoloOverview,
  type FascicoloOverviewModel,
} from "@/components/procedimenti/FascicoloShell";

const model: FascicoloOverviewModel = {
  title: "Fascicolo Avvio revoca",
  status: "In corso",
  type: "Avvio revoca",
  reference: "CP-073/2023",
  administration: "Autorità portuale",
  subject: "Concessionario Alfa",
  lastUpdated: "04/10/2026",
  phase: "Procedimento di revoca",
  checklist: { completed: 1, total: 8 },
  attention: [
    { label: "Termine del contraddittorio da verificare", section: "deadlines" },
    { label: "Morosità aperta", section: "issues" },
  ],
  documents: [{
    id: "3c0cf100-2992-4af0-b355-846190e1d718",
    name: "Istanza.pdf",
    type: "Istanza",
    date: "01/10/2026",
    isFileAvailable: true,
    href: "/documenti/3c0cf100-2992-4af0-b355-846190e1d718/download",
  }],
  documentCount: 1,
  openIssueCount: 2,
  criticalPaymentCount: 1,
  deadlines: [{
    id: "7866ccbd-e876-4a6c-952d-98ac32f910cf",
    date: "15/10/2026",
    label: "Termine interno",
    status: "Aperta",
  }],
  concession: {
    number: "CP-073/2023",
    authority: "Autorità portuale",
    object: "Area demaniale",
    startDate: "01/01/2023",
    expiryDate: "31/12/2026",
    location: "Molo sud",
    incomplete: false,
  },
  subjects: [
    { name: "Concessionario Alfa", role: "Concessionario" },
    { name: "Autorità portuale", role: "Ente concedente" },
  ],
  nextStep: {
    label: "Completare la verifica del contraddittorio",
    section: "analysis",
  },
};

function render(input: FascicoloOverviewModel): string {
  return renderToStaticMarkup(createElement(FascicoloOverview, {
    model: input,
    basePath: "/procedimenti/fascicolo-1",
  }));
}

describe("Fascicolo overview", () => {
  it("renders the operational summary with real section links", () => {
    const html = render(model);

    for (const label of [
      "Stato del fascicolo",
      "Richiede attenzione",
      "Prossime scadenze",
      "Concessione / titolo",
      "Soggetti principali",
      "Documenti",
      "Prossimo passo",
      "1 di 8 attività completate",
    ]) {
      expect(html).toContain(label);
    }
    for (const section of ["deadlines", "issues", "concession", "subjects", "documents", "analysis"]) {
      expect(html).toContain(`/procedimenti/fascicolo-1?section=${section}`);
    }
    expect(html).not.toContain("3c0cf100-2992-4af0-b355-846190e1d718");
    expect(html).not.toContain("7866ccbd-e876-4a6c-952d-98ac32f910cf");
  });

  it("renders clear empty states without technical placeholders", () => {
    const html = render({
      ...model,
      reference: null,
      administration: null,
      subject: null,
      attention: [],
      documents: [],
      documentCount: 0,
      openIssueCount: 0,
      criticalPaymentCount: 0,
      deadlines: [],
      concession: { incomplete: true },
      subjects: [],
      nextStep: undefined,
    });

    expect(html).toContain("Nessuna priorità immediata rilevata.");
    expect(html).toContain("Nessuna scadenza imminente.");
    expect(html).toContain("Dati concessione da completare.");
    expect(html).toContain("Nessun soggetto disponibile.");
    expect(html).toContain("Nessun documento disponibile.");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

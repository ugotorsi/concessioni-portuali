import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FascicoloTimeline,
  type FascicoloTimelineEvent,
} from "@/components/procedimenti/FascicoloTimeline";

const events: FascicoloTimelineEvent[] = [
  {
    id: "old-event",
    date: "15/02/2021",
    dateTime: "2021-02-15T00:00:00.000Z",
    timestamp: 1613347200000,
    title: "Concessione rilasciata",
    type: "Concessione",
    description: "Rilascio della concessione CP-001/2021.",
    subjects: "Logistica Molo Sud S.r.l.",
    href: "/procedimenti/case-1?section=concession",
    actionLabel: "Vai alla concessione",
  },
  {
    id: "new-event",
    dedupeKey: "document-doc-1",
    date: "24/07/2026",
    dateTime: "2026-07-24T00:00:00.000Z",
    timestamp: 1784851200000,
    title: "Titolo concessorio CP-001/2021",
    type: "Documento",
    description: "Documento acquisito nel fascicolo.",
    source: "Titolo concessorio CP-001/2021",
    alert: "Da verificare",
    href: "/documenti/doc-1/download",
    actionLabel: "Apri documento",
  },
];

function renderTimeline(items = events): string {
  return renderToStaticMarkup(createElement(FascicoloTimeline, {
    events: items,
    nextDeadline: "07/09/2026",
  }));
}

describe("Fascicolo timeline workspace", () => {
  it("renders a professional timeline with truthful summary indicators", () => {
    const html = renderTimeline();

    expect(html).toContain("Eventi, atti e passaggi rilevanti del fascicolo ordinati nel tempo.");
    expect(html).toContain("Eventi: ");
    expect(html).toContain("Ultimo evento: ");
    expect(html).toContain("24/07/2026");
    expect(html).toContain("Prossima scadenza: ");
    expect(html).toContain("07/09/2026");
  });

  it("shows event type, source, subjects, alert, and descriptive links", () => {
    const html = renderTimeline();

    expect(html).toContain("Documento");
    expect(html).toContain("Concessione");
    expect(html).toContain("Fonte:");
    expect(html).toContain("Soggetti:");
    expect(html).toContain("Attenzione: Da verificare");
    expect(html).toContain("Apri documento");
    expect(html).toContain("Vai alla concessione");
    expect(html).not.toContain("Fonte: -");
    expect(html).not.toContain("Soggetti: -");
  });

  it("orders recent events first and exposes local type and order controls", () => {
    const html = renderTimeline();

    expect(html.indexOf("Titolo concessorio CP-001/2021")).toBeLessThan(html.indexOf("Concessione rilasciata"));
    expect(html).toContain("Tipo evento");
    expect(html).toContain("Tutti gli eventi");
    expect(html).toContain("Più recenti");
    expect(html).toContain("Più vecchi");
  });

  it("deduplicates events by their stable presentation key", () => {
    const duplicate = { ...events[1], id: "duplicate-event", title: "Duplicato da non mostrare" };
    const html = renderTimeline([...events, duplicate]);

    expect(html).not.toContain("Duplicato da non mostrare");
    expect(html).toContain("Eventi: ");
  });

  it("renders the compact empty state", () => {
    const html = renderTimeline([]);

    expect(html).toContain("Nessun evento cronologico ancora disponibile.");
    expect(html).not.toContain("Tipo evento");
  });

  it("is shared by legacy and intake without timeline tables", () => {
    const timelineSource = readFileSync("src/components/procedimenti/FascicoloTimeline.tsx", "utf8");
    const detailSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intakeSource = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");
    const shellSource = readFileSync("src/components/procedimenti/FascicoloShell.tsx", "utf8");

    expect(timelineSource).toContain("sm:grid-cols-[7rem_minmax(0,1fr)_auto]");
    expect(timelineSource).toContain('aria-label="Eventi cronologici"');
    expect(timelineSource).not.toContain("<Table");
    expect(detailSource).toContain("events={timelineEvents}");
    expect(intakeSource).toContain("events={timelineEvents}");
    expect(shellSource).toContain("model.timeline.slice(0, 3)");
  });
});

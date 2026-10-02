import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FascicoloSubjects,
  type FascicoloSubject,
} from "@/components/procedimenti/FascicoloSubjects";

const subjects: FascicoloSubject[] = [
  { name: "Logistica Molo Sud S.r.l.", roles: ["Assistito"], category: "principal" },
  { name: "  logistica molo sud s.r.l. ", roles: ["Concessionario"], category: "principal", contact: "ufficio@logisticamolosud.it", note: "Concessione CP-001/2021" },
  { name: "Autorità di Sistema Portuale", roles: ["Ente concedente"], category: "principal", type: "Amministrazione pubblica" },
  { name: "Studio Tecnico Porto", roles: ["Tecnico"], category: "other" },
];

function renderSubjects(items = subjects): string {
  return renderToStaticMarkup(createElement(FascicoloSubjects, {
    subjects: items,
    responsible: {
      name: "Mario Rossi",
      email: "mario.rossi@adsp.it",
      organization: "Unità Demanio",
      assignedAt: "12/07/2026",
    },
    responsibilityHistory: [{
      id: "assignment-1",
      name: "Lucia Bianchi",
      organization: "Unità Demanio",
      assignedAt: "03/02/2025",
      endedAt: "11/07/2026",
      note: "Riorganizzazione interna",
    }],
  }));
}

describe("Fascicolo subjects workspace", () => {
  it("renders principal subjects as a compact case map with truthful indicators", () => {
    const html = renderSubjects();

    expect(html).toContain("Persone, società e amministrazioni coinvolte nel fascicolo.");
    expect(html).toContain("Soggetti principali");
    expect(html).toContain("Amministrazione principale");
    expect(html).toContain("Autorità di Sistema Portuale");
    expect(html).toContain("Studio Tecnico Porto");
  });

  it("deduplicates assisted subject and concessionaire while preserving both roles", () => {
    const html = renderSubjects();

    expect(html.match(/>Logistica Molo Sud S\.r\.l\.<\/h4>/g)).toHaveLength(1);
    expect(html).toContain("Assistito · Concessionario");
    expect(html).toContain("Soggetti </dt><dd class=\"inline font-semibold text-slate-950\">4</dd>");
  });

  it("keeps the current responsible and compact assignment history separate", () => {
    const html = renderSubjects();

    expect(html).toContain("Responsabile del procedimento");
    expect(html).toContain("Mario Rossi");
    expect(html).toContain("Assegnato il 12/07/2026");
    expect(html).toContain("Storico responsabilità");
    expect(html).toContain("Lucia Bianchi");
    expect(html).toContain("Riorganizzazione interna");
  });

  it("omits missing contacts and technical placeholders", () => {
    const html = renderToStaticMarkup(createElement(FascicoloSubjects, {
      subjects: [{ name: "Soggetto essenziale", roles: ["Assistito"], category: "principal" }],
    }));

    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("Non indicato");
    expect(html).not.toContain("N/D");
    expect(html).not.toContain(">-<");
    expect(html).toContain("Nessun altro soggetto registrato.");
  });

  it("is shared by legacy and intake with responsive cards and no subject table", () => {
    const subjectsSource = readFileSync("src/components/procedimenti/FascicoloSubjects.tsx", "utf8");
    const detailSource = readFileSync("src/app/procedimenti/[id]/page.tsx", "utf8");
    const intakeSource = readFileSync("src/components/procedimenti/FascicoloIntakeDetail.tsx", "utf8");

    expect(detailSource).toContain("<FascicoloSubjects");
    expect(detailSource).toContain("responsibilityHistory=");
    expect(detailSource).toContain("Riassegna responsabile");
    expect(intakeSource).toContain("<FascicoloSubjects subjects={subjects}");
    expect(intakeSource).toContain("fascicolo.soggettoAssistito");
    expect(intakeSource).toContain("fascicolo.controparteAmministrazione");
    expect(subjectsSource).toContain("md:grid-cols-2 xl:grid-cols-4");
    expect(subjectsSource).toContain("[overflow-wrap:anywhere]");
    expect(subjectsSource).not.toContain("<Table");
  });
});
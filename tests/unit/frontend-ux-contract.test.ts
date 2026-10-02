import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("frontend UX contract", () => {
  it("provides simple, responsive and role-aware navigation", () => {
    const source = readSource("src/components/layout/Sidebar.tsx");

    for (const item of ["Dashboard", "Fascicoli", "Verticali", "Mappa", "Concessionari"]) {
      expect(source).toContain(`label: "${item}"`);
    }
    for (const removed of ["Concessioni", "Scadenze", "Criticità", "Pagamenti", "Sopralluoghi", "Documenti", "Normativa", "Ricerca giuridica", "Report", "Assistente AI", "Audit", "Runtime", "Orchestrazione", "Scenari demo", "Demo guidata"]) {
      expect(source).not.toContain(`label: "${removed}"`);
    }
    for (const group of ["Operatività", "Conoscenza", "Territorio", "Amministrazione", "Supporto"]) {
      expect(source).not.toContain(`label: "${group}"`);
    }
    expect(source).toContain('<details className="group sticky top-0');
    expect(source).toContain('role === "VIEWER_ADSP" ? adspNavItems : backofficeNavItems');
    expect(source).toContain('label: "Portale AdSP"');
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source).not.toContain("Cambia profilo");
  });

  it("puts daily attention before contextual dashboard indicators", () => {
    const source = readSource("src/app/dashboard/page.tsx");
    const attentionIndex = source.indexOf("Richiede attenzione oggi");
    const contextIndex = source.indexOf("Indicatori di contesto");

    expect(attentionIndex).toBeGreaterThan(-1);
    expect(contextIndex).toBeGreaterThan(attentionIndex);
    expect(source).toContain('title="Criticità urgenti"');
    expect(source).toContain('title="Morosità aperte"');
    expect(source).toContain('href="/scadenze?periodo=ENTRO_90_GIORNI"');
    expect(source).toContain('href="/criticita?gravita=URGENTE"');
    expect(source).toContain('href="/pagamenti?criticita=MOROSITA"');
    expect(source).toContain('href="/procedimenti?stato=IN_CORSO"');
    for (const removed of ["Criticità prioritarie", "Scadenze imminenti", "Morosità e pagamenti critici", "Azioni consigliate", "Fonti normative", "Norme in consultazione"]) {
      expect(source).not.toContain(removed);
    }
    expect(source).not.toContain("Scenari demo istituzionali");
    expect(source).not.toContain("Apri mappa demo");
    expect(source).not.toContain("Verticali");
  });

  it("makes dashboard metric cards accessible as one large click target", () => {
    const source = readSource("src/components/dashboard/MetricCard.tsx");

    expect(source).toContain("href?: string");
    expect(source).toContain("<Link");
    expect(source).toContain("aria-label={`${title}: ${value}. ${description}`}");
    expect(source).toContain("focus-visible:ring-2");
  });

  it("keeps advanced proceedings filters available without dominating the initial view", () => {
    const source = readSource("src/components/procedimenti/ProcedimentiFiltersBar.tsx");

    expect(source).toContain("Cerca fascicolo");
    expect(source).toContain("Filtri avanzati");
    expect(source).toContain('<details className="mt-4');
    expect(source).toContain('name="preavvisoRigettoApplicabile"');
    expect(source).toContain('name="criticitaId"');
  });

  it("provides in-page detail navigation and progressive technical disclosure", () => {
    const detail = readSource("src/app/procedimenti/[id]/page.tsx");
    const shell = readSource("src/components/procedimenti/FascicoloShell.tsx");
    const workflow = readSource("src/components/procedimenti/FascicoloAutomaticWorkflowPanel.tsx");

    for (const anchor of ["panoramica", "documenti", "cronologia", "soggetti", "concessione", "analisi", "ricerca", "scadenze", "criticita", "rapporti", "proposte"]) {
      expect(`${detail}\n${shell}`).toContain(`#${anchor}`);
    }
    expect(detail).toContain('{ label: "Istruttoria", href: "#istruttoria" }');
    expect(detail).toContain('{ label: "Decisione", href: "#decisione" }');
    expect(shell).not.toContain("Copertina");
    expect(shell).not.toContain("Collegamenti");
    expect(detail).not.toContain('<h1 className="text-2xl font-semibold text-slate-900">Fascicolo</h1>');
    expect(workflow).toContain("Verifiche professionali");
    expect(workflow).toContain("Dettaglio tecnico");
    expect(workflow).toContain("Dettagli tecnici del rapporto");
    expect(workflow).toContain("Genera proposte operative");
    expect(workflow).toContain("Archivia rapporto");
    expect(workflow).toContain("Altro");
  });

  it("uses accessible clickable rows without separate action columns", () => {
    const clickableRow = readSource("src/components/ui/ClickableTableRow.tsx");

    expect(clickableRow).toContain('role="link"');
    expect(clickableRow).toContain("event.key === \"Enter\"");
    expect(clickableRow).toContain("event.key === \" \"");

    for (const page of [
      "src/app/procedimenti/page.tsx",
      "src/app/report/page.tsx",
      "src/app/normativa/page.tsx",
    ]) {
      const source = readSource(page);
      expect(source).toContain("<ClickableTableRow");
      expect(source).not.toContain("<TableHead>Azioni</TableHead>");
    }
  });

  it("keeps document operations available behind one primary action", () => {
    for (const page of [
      "src/app/documenti/page.tsx",
      "src/components/documents/EntityDocumentsPanel.tsx",
    ]) {
      const source = readSource(page);
      expect(source).toContain("Apri documento");
      expect(source).toContain("Altro");
      expect(source).toContain("Dettagli tecnici");
      expect(source).not.toContain("<TableHead>Aggiorna</TableHead>");
      expect(source).not.toContain("<TableHead>Storage</TableHead>");
    }
  });
});
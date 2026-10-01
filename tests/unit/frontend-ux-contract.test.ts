import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("frontend UX contract", () => {
  it("provides grouped, responsive and role-aware navigation", () => {
    const source = readSource("src/components/layout/Sidebar.tsx");

    for (const group of ["Operatività", "Conoscenza", "Territorio", "Amministrazione", "Supporto"]) {
      expect(source).toContain(`label: "${group}"`);
    }
    expect(source).toContain('<details className="group sticky top-0');
    expect(source).toContain('item.href === "/admin/runtime"');
    expect(source).toContain('role === "ADMIN"');
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source).toContain("Altro");
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
    expect(source).not.toContain("Scenari demo istituzionali");
    expect(source).not.toContain("Apri mappa demo");
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
    const workflow = readSource("src/components/procedimenti/FascicoloAutomaticWorkflowPanel.tsx");

    for (const anchor of ["copertina", "documenti", "automazione", "istruttoria", "decisione", "collegamenti"]) {
      expect(detail).toContain(`#${anchor}`);
    }
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
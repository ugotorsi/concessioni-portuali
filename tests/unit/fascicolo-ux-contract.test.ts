import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Fascicolo UX contract", () => {
  it("keeps the Procedimento routes while exposing Fascicoli navigation and creation", () => {
    const sidebar = readSource("src/components/layout/Sidebar.tsx");
    const listPage = readSource("src/app/procedimenti/page.tsx");
    const createPage = readSource("src/app/procedimenti/nuovo/page.tsx");

    expect(sidebar).toContain('{ href: "/procedimenti", label: "Fascicoli"');
    expect(listPage).toContain('title="Fascicoli"');
    expect(listPage).toContain('href="/procedimenti/nuovo"');
    expect(listPage).toContain("Nuovo Fascicolo");
    expect(listPage).toContain("Nessun fascicolo presente.");
    expect(listPage).toContain("Crea il primo fascicolo");
    expect(createPage).toContain("<form action={createProcedimentoAction}");
    expect(createPage).toContain("Crea e apri Fascicolo");
  });

  it("opens with cover data and the fixed-context attachment panel", () => {
    const detailPage = readSource("src/app/procedimenti/[id]/page.tsx");
    const documentsPanel = readSource("src/components/documents/EntityDocumentsPanel.tsx");
    const documentsIndex = detailPage.indexOf('title="Documenti del Fascicolo"');
    const coverDataIndex = detailPage.indexOf("1. Dati del Fascicolo");

    expect(detailPage).toContain("Copertina del Fascicolo");
    expect(detailPage).toContain("Torna ai fascicoli");
    expect(documentsIndex).toBeGreaterThan(-1);
    expect(documentsIndex).toBeLessThan(coverDataIndex);
    expect(detailPage).toContain('entityType="procedimento"');
    expect(detailPage).toContain("entityId={detail.procedimento.id}");
    expect(documentsPanel).toContain('<input type="hidden" name={hiddenFieldName} value={entityId} />');
    expect(documentsPanel).toContain("Allega documento");
    expect(documentsPanel).toContain("Nessun documento presente nel fascicolo.");
  });
});
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Fascicolo UX contract", () => {
  it("never routes the Fascicoli flow directly to the standalone concession page", () => {
    const sidebar = readSource("src/components/layout/Sidebar.tsx");
    const listPage = readSource("src/app/procedimenti/page.tsx");
    const detailPage = readSource("src/app/procedimenti/[id]/page.tsx");
    const registerRow = listPage.match(/<ClickableTableRow[\s\S]*?<\/ClickableTableRow>/)?.[0];

    expect(sidebar, "Fascicoli sidebar entry must open /procedimenti").toContain(
      '{ href: "/procedimenti", label: "Fascicoli"',
    );
    expect(registerRow, "Fascicoli register must render a primary clickable row").toBeDefined();
    expect(registerRow, "primary Fascicoli action must open /procedimenti/[id]").toContain(
      'href={`/procedimenti/${item.id}`}',
    );
    expect(registerRow, "concession number must stay inside the case workspace").toContain(
      'href={`/procedimenti/${item.id}?section=concession`}',
    );
    expect(listPage, "Fascicoli register must not link directly to /concessioni/[id]").not.toMatch(
      /href=\{`\/concessioni\/\$\{/,
    );
    expect(detailPage, "case workspace must retain an explicit standalone concession action").toContain(
      'href={`/concessioni/${detail.concessione.id}`}',
    );
    expect(detailPage).toContain("Apri concessione");
  });

  it("keeps the Procedimento routes while exposing Fascicoli navigation and creation", () => {
    const sidebar = readSource("src/components/layout/Sidebar.tsx");
    const listPage = readSource("src/app/procedimenti/page.tsx");
    const createPage = readSource("src/app/procedimenti/nuovo/page.tsx");

    expect(sidebar).toContain('{ href: "/procedimenti", label: "Fascicoli"');
    expect(listPage).toContain('title="Fascicoli"');
    expect(listPage).toContain('href="/procedimenti/nuovo"');
    expect(listPage).toContain('href={`/procedimenti/${item.id}?section=concession`}');
    expect(listPage).not.toContain('href={`/concessioni/${item.concessione.id}`}');
    expect(listPage).toContain("Nuovo fascicolo");
    expect(listPage).toContain("Nessun fascicolo trovato");
    expect(listPage).toContain("Modifica i filtri applicati oppure crea un nuovo fascicolo.");
    expect(createPage).toContain("<form action={createFascicoloIntakeAction}");
    expect(createPage).toContain("Inquadramento");
    expect(createPage).toContain("Dati della concessione");
    expect(createPage).toContain("Soggetti iniziali");
    expect(createPage).toContain("Documenti iniziali");
    expect(createPage).toContain("Contesto iniziale");
    expect(createPage).toContain("Collega a concessione già presente");
    expect(createPage).toContain("Crea Fascicolo");
    expect(createPage).toContain("Nome fascicolo");
    expect(createPage).not.toContain("Denominazione breve del fascicolo");
    expect(createPage).toContain("Altri dati della concessione");
    expect(createPage.indexOf("Inquadramento")).toBeLessThan(createPage.indexOf("Documenti iniziali"));
    expect(createPage.indexOf("Documenti iniziali")).toBeLessThan(createPage.indexOf("Dati della concessione"));
    expect(createPage.indexOf("Dati della concessione")).toBeLessThan(createPage.indexOf("Soggetti iniziali"));
    expect(createPage.indexOf("Soggetti iniziali")).toBeLessThan(createPage.indexOf("Contesto iniziale"));
    expect(createPage).toContain('name="documentiIniziali"');
    expect(createPage).toContain("multiple");
    expect(createPage).not.toContain('name="criticitaId"');
    expect(createPage).not.toContain('name="riferimentoNormativo"');
    expect(createPage).not.toContain('name="dataScadenzaContraddittorio"');
    expect(createPage).not.toContain("checklistContraddittorio");
    for (const secondaryField of [
      "autoritaCompetenteIniziale",
      "dataRilascioIniziale",
      "decorrenzaIniziale",
      "beneAreaServizioIniziale",
    ]) {
      expect(createPage.indexOf(`name="${secondaryField}"`)).toBeGreaterThan(
        createPage.indexOf("Altri dati della concessione"),
      );
    }
  });

  it("opens with cover data and the fixed-context attachment panel", () => {
    const detailPage = readSource("src/app/procedimenti/[id]/page.tsx");
    const documentsPanel = readSource("src/components/documents/EntityDocumentsPanel.tsx");
    const intakeDetail = readSource("src/components/procedimenti/FascicoloIntakeDetail.tsx");
    const fascicoloShell = readSource("src/components/procedimenti/FascicoloShell.tsx");
    const documentsIndex = detailPage.indexOf('title="Documenti del Fascicolo"');
    const subjectsIndex = detailPage.indexOf("<FascicoloSubjects");

    expect(detailPage).toContain("<FascicoloShell");
    expect(fascicoloShell).toContain("Torna ai fascicoli");
    expect(detailPage).not.toContain("<InPageNav");
    expect(detailPage).not.toContain("Copertina del Fascicolo");
    for (const section of ["documents", "timeline", "subjects", "concession", "analysis", "research", "deadlines", "issues", "reports", "proposals", "decisione"]) {
      expect(detailPage).toContain(`activeSection === "${section}"`);
    }
    expect(detailPage).toContain('["analysis", "istruttoria"].includes(activeSection)');
    expect(documentsIndex).toBeGreaterThan(-1);
    expect(subjectsIndex).toBeGreaterThan(documentsIndex);
    expect(detailPage).toContain('entityType="procedimento"');
    expect(detailPage).toContain("entityId={detail.procedimento.id}");
    expect(documentsPanel).toContain('<input type="hidden" name={hiddenFieldName} value={entityId} />');
    expect(documentsPanel).toContain("Allega documento");
    expect(documentsPanel).toContain("Nessun documento presente nel fascicolo.");
    expect(detailPage).toContain("getFascicoloIntakeDetail(id)");
    expect(detailPage).toContain("<FascicoloIntakeDetail");
    expect(intakeDetail).toContain("<FascicoloShell");
    expect(intakeDetail).toContain('activeSection === "documents"');
    expect(intakeDetail).toContain('activeSection === "timeline"');
    expect(intakeDetail).toContain('activeSection === "subjects"');
    expect(intakeDetail).toContain('activeSection === "concession"');
    expect(intakeDetail).toContain("uploadFascicoloIntakeDocumentAction");
    expect(fascicoloShell).toContain("Panoramica");
    expect(fascicoloShell).toContain("Navigazione del fascicolo");
    expect(fascicoloShell).toContain("Richiede attenzione");
    expect(fascicoloShell).toContain("Nessuna priorità immediata rilevata.");
    expect(fascicoloShell).toContain("documents.slice(0, 3)");
    expect(fascicoloShell).toContain('?section=${section}');
    expect(fascicoloShell).toContain('activeSection === "overview" ? null : children');
    expect(fascicoloShell).toContain('aria-current={activeSection === section ? "page" : undefined}');
    expect(fascicoloShell).toContain('overflow-x-auto');
    expect(fascicoloShell).toContain('lg:grid-cols-2');
    expect(fascicoloShell).not.toContain("Trusted Review");
    expect(fascicoloShell).not.toContain("materialId");
    expect(fascicoloShell).not.toContain("automatic workflow");
    expect(fascicoloShell).not.toContain("read model");
    expect(fascicoloShell).toContain('sectionHref(basePath, "istruttoria")');
    expect(fascicoloShell).toContain('sectionHref(basePath, "decisione")');
    expect(detailPage).toContain("resolveFascicoloSection(section)");
    expect(detailPage).toContain("activeSection={activeSection}");
  });
});
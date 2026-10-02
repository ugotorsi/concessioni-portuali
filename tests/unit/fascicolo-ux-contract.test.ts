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
    const documentsIndex = detailPage.indexOf('title="Documenti del Fascicolo"');
    const coverDataIndex = detailPage.indexOf("1. Dati del Fascicolo");

    expect(detailPage).toContain("Copertina del Fascicolo");
    expect(detailPage).toContain("Torna ai fascicoli");
    expect(detailPage).toContain("<InPageNav");
    expect(detailPage).toContain('id="documenti"');
    expect(detailPage).toContain('id="istruttoria"');
    expect(documentsIndex).toBeGreaterThan(-1);
    expect(documentsIndex).toBeLessThan(coverDataIndex);
    expect(detailPage).toContain('entityType="procedimento"');
    expect(detailPage).toContain("entityId={detail.procedimento.id}");
    expect(documentsPanel).toContain('<input type="hidden" name={hiddenFieldName} value={entityId} />');
    expect(documentsPanel).toContain("Allega documento");
    expect(documentsPanel).toContain("Nessun documento presente nel fascicolo.");
    expect(detailPage).toContain("getFascicoloIntakeDetail(id)");
    expect(detailPage).toContain("<FascicoloIntakeDetail");
    expect(intakeDetail).toContain('id="documenti"');
    expect(intakeDetail).toContain("uploadFascicoloIntakeDocumentAction");
  });
});
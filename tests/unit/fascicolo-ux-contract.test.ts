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
    const dashboardPage = readSource("src/app/dashboard/page.tsx");
    const intakeQuery = readSource("src/server/queries/fascicolo-intake.ts");

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
    expect(createPage).toContain("Riferimenti");
    expect(createPage).toContain("Dati concessione");
    expect(createPage).toContain("Soggetti");
    expect(createPage).not.toContain("Documenti iniziali");
    expect(createPage).toContain("Crea fascicolo senza collegare una concessione esistente");
    expect(createPage).toContain("Crea fascicolo");
    expect(createPage).toContain("Titolo fascicolo");
    expect(createPage).toContain('name="titoloFascicolo" required');
    expect(createPage).toContain('name="tipologiaConcessioneIniziale" required');
    expect(createPage.indexOf("Inquadramento")).toBeLessThan(createPage.indexOf("Riferimenti"));
    expect(createPage.indexOf("Riferimenti")).toBeLessThan(createPage.indexOf("Dati concessione"));
    expect(createPage.indexOf("Dati concessione")).toBeLessThan(createPage.indexOf("Soggetti"));
    expect(createPage).not.toContain('name="documentiIniziali"');
    expect(createPage).not.toContain('name="criticitaId"');
    expect(createPage).not.toContain('name="riferimentoNormativo"');
    expect(createPage).not.toContain('name="dataScadenzaContraddittorio"');
    expect(createPage).not.toContain("checklistContraddittorio");
    expect(createPage).not.toContain("Fascicolo Intake");
    expect(createPage).not.toContain("Salva bozza");
    expect(createPage).not.toContain("Crea concessione");
    expect(dashboardPage).toContain("getFascicoliIntakeList()");
    expect(dashboardPage).toContain("...fascicoliIntake.map");
    expect(dashboardPage).toContain("fascicoliRecenti.map");
    expect(intakeQuery).toContain("procedimentoId: null");
  });

  it("labels tenant and fascicolo AI policy actions consistently", () => {
    const policyPanel = readSource(
      "src/components/procedimenti/FascicoloAiResearchControlPanel.tsx",
    );

    expect(policyPanel).toContain(
      '{tenantScope ? "Salva policy dell\'ente" : "Salva policy del fascicolo"}',
    );
  });

  it("exposes the three professional AI actions inside the fascicolo", () => {
    const aiWorkspace = readSource(
      "src/components/procedimenti/FascicoloAiWorkspace.tsx",
    );
    const questionPanel = readSource(
      "src/components/procedimenti/ProfessionalLegalQuestionsPanel.tsx",
    );
    const detailPage = readSource("src/app/procedimenti/[id]/page.tsx");
    const runtimePage = readSource("src/app/admin/runtime/page.tsx");
    const runtimeActions = readSource("src/app/admin/runtime/actions.ts");
    const legalWorkbench = readSource("src/app/admin/runtime/LegalWorkbenchSection.tsx");

    expect(aiWorkspace).toContain("Aggiorna fascicolo");
    expect(aiWorkspace).toContain("Interroga AI");
    expect(aiWorkspace).toContain("Ricerca e aggiornamento giuridico");
    expect(aiWorkspace).toContain("Il comando resta disabilitato");
    expect(aiWorkspace).toContain("La policy del fascicolo può soltanto restringere");
    expect(aiWorkspace).toContain("Analisi AI bloccata");
    expect(aiWorkspace).toContain("Ricerca manuale autorizzata");
    expect(aiWorkspace).toContain("La ricerca manuale autorizzata è distinta dall&apos;analisi del corpus");
    expect(aiWorkspace).toContain("startLegalAnalysisPipeline");
    expect(runtimePage).toContain("activateQueuedLegalAnalysisJob");
    expect(runtimePage).toContain("activateQueuedAnalysisAction");
    expect(runtimeActions).toContain("FASCICOLO_QUEUED_ANALYSIS_WORKER_ACTIVATION");
    expect(legalWorkbench).toContain("Avvia worker per analisi accodata");
    expect(questionPanel).toContain('id="interroga-ai"');
    expect(questionPanel).toContain("Salva quesito");
    expect(detailPage.match(/<FascicoloAiWorkspace/g)).toHaveLength(2);
    expect(runtimePage).toContain("Quadro operativo immediato");
    expect(runtimePage).toContain("Percorso guidato di attivazione");
    expect(runtimePage).toContain("eseguibili ora");
    expect(runtimePage).toContain("Verificati sulla configurazione corrente");
    expect(runtimePage).not.toContain("di {aiEngines.length} disponibili");
    expect(runtimePage).toContain("Globali: deployment, kill-switch, provider, worker e budget globale.");
  });

  it("opens with cover data and the fixed-context attachment panel", () => {
    const detailPage = readSource("src/app/procedimenti/[id]/page.tsx");
    const documentsPanel = readSource("src/components/documents/EntityDocumentsPanel.tsx");
    const intakeDetail = readSource("src/components/procedimenti/FascicoloIntakeDetail.tsx");
    const fascicoloShell = readSource("src/components/procedimenti/FascicoloShell.tsx");
    const checklistEvidence = readSource("src/components/procedimenti/ChecklistItemEvidence.tsx");
    const observationsPanel = readSource("src/components/procedimenti/FascicoloObservationsPanel.tsx");
    const documentsIndex = detailPage.indexOf('title="Documenti del Fascicolo"');
    const subjectsIndex = detailPage.indexOf("<FascicoloSubjects");

    expect(detailPage).toContain("<FascicoloShell");
    expect(fascicoloShell).toContain("Torna ai fascicoli");
    expect(detailPage).not.toContain("<InPageNav");
    expect(detailPage).not.toContain("Copertina del Fascicolo");
    for (const section of ["documents", "timeline", "subjects", "concession", "analysis", "research", "deadlines", "issues", "reports", "proposals", "decisione"]) {
      expect(detailPage).toContain(`activeSection === "${section}"`);
    }
    expect(detailPage).toContain('activeSection === "analysis"');
    expect(detailPage).toContain('activeSection === "istruttoria"');
    expect(detailPage).toContain('id="istruttoria-title"');
    expect(detailPage).toContain('id="decisione-title"');
    expect(detailPage).toContain("Verifiche, osservazioni e valutazioni a supporto del procedimento.");
    expect(detailPage).toContain("Provvedimento finale e relativo stato di registrazione.");
    expect(detailPage).toContain('href={`/documenti/${decisioneConclusiva.documentoId}/download`} prefetch={false}');
    expect(detailPage).not.toContain(">Warning<");
    expect(detailPage).not.toContain("in questo incremento");
    expect(detailPage).not.toContain('motivazioneValutazione ?? "-"');
    expect(detailPage).not.toContain('termineMemorieScadenza) : "-"');
    expect(detailPage).not.toContain('registeredByUserEmail ?? decisioneConclusiva.registeredByUserId');
    expect(detailPage).not.toContain('protocolloAtto ?? "-"');
    expect(detailPage).toContain("Provvedimento registrato (sola lettura)");
    expect(detailPage).toContain("Apri registro attività");
    expect(documentsIndex).toBeGreaterThan(-1);
    expect(subjectsIndex).toBeGreaterThan(documentsIndex);
    expect(detailPage).toContain('entityType="procedimento"');
    expect(detailPage).toContain("entityId={detail.procedimento.id}");
    expect(documentsPanel).toContain('<input type="hidden" name={hiddenFieldName} value={entityId} />');
    expect(documentsPanel).toContain("Allega documento");
    expect(documentsPanel).toContain("Nessun documento presente nel fascicolo.");
    expect(detailPage).toContain("getFascicoloIntakeDetail(id)");
    expect(detailPage).toContain("redirect(`/procedimenti/${fascicoloIntake.procedimento.id}`)");
    expect(detailPage).toContain("<FascicoloIntakeDetail");
    expect(intakeDetail).toContain("<FascicoloShell");
    expect(intakeDetail).toContain('activeSection === "documents"');
    expect(intakeDetail).toContain('activeSection === "timeline"');
    expect(intakeDetail).toContain('activeSection === "subjects"');
    expect(intakeDetail).toContain('activeSection === "concession"');
    expect(intakeDetail).toContain("activateFascicoloIntakeAction");
    expect(fascicoloShell).toContain("Panoramica");
    expect(fascicoloShell).toContain("Navigazione del fascicolo");
    expect(fascicoloShell).toContain("Richiede attenzione");
    expect(fascicoloShell).toContain("Nessuna priorità immediata rilevata.");
    expect(fascicoloShell).toContain("documents.slice(0, 3)");
    expect(fascicoloShell).toContain("Stato del fascicolo");
    expect(fascicoloShell).toContain("Prossime scadenze");
    expect(fascicoloShell).toContain("Concessione / titolo");
    expect(fascicoloShell).toContain("Soggetti principali");
    expect(fascicoloShell).toContain("Prossimo passo");
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
    expect(checklistEvidence).not.toContain("reviewedByActorId");
    expect(observationsPanel).not.toContain("observation.ruleCode");
    expect(observationsPanel).not.toContain("observation.ruleVersion");
    expect(observationsPanel).not.toContain("pecRicevutaAccettazioneId ??");
    expect(observationsPanel).not.toContain("pecRicevutaConsegnaId ??");
    expect(observationsPanel).toContain("Ricevuta di accettazione:");
  });
});
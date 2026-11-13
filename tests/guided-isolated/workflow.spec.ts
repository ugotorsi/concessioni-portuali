import { expect, test, type Locator, type Page } from "playwright/test";

import { loginAndExpectLanding } from "../e2e/helpers/auth";

const runId = process.env.NOETRA_GUIDED_E2E_RUN_ID;
if (!runId || !/^[a-z0-9-]{1,24}$/.test(runId)) throw new Error("A unique isolated workflow run ID is required.");
const caseId = (name: string) => `e2e-guided-${runId}-${name}`;
const porto = caseId("porto-aurora");
const nonPort = caseId("non-port");
const shared = caseId("shared");
const review = caseId("selvara-synthetic");
const reconciliation = caseId("reconciliation");

async function login(page: Page) {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
}

/** Optional evidence of the real screens, written only when an absolute directory is configured. */
async function capture(page: Page, name: string) {
  const directory = process.env.NOETRA_GUIDED_E2E_SCREENSHOT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${runId}-${name}.png`, fullPage: true });
}

async function openIssue(page: Page, title: string): Promise<Locator> {
  const summary = page.locator("summary").filter({ hasText: title }).first();
  await expect(summary).toBeVisible();
  const issue = summary.locator("..");
  if (!(await issue.evaluate((element) => element instanceof HTMLDetailsElement && element.open))) {
    await summary.click();
  }
  return issue;
}

async function openDetails(summary: Locator) {
  if (!(await summary.locator("..").evaluate((element) => element instanceof HTMLDetailsElement && element.open))) {
    await summary.click();
  }
}

function activity(issue: Locator, title: RegExp): Locator {
  return issue.getByRole("heading", { name: title }).locator("xpath=ancestor::article");
}

async function submit(button: Locator) {
  const response = button.page().waitForResponse((result) =>
    result.request().method() === "POST" && new URL(result.url()).pathname.startsWith("/procedimenti/"));
  await button.click();
  expect((await response).status()).toBeLessThan(400);
}

async function archiveIfNeeded(page: Page) {
  await expect(page.getByRole("region", { name: "Procedimento guidato" })).toBeVisible();
  const archive = page.getByRole("button", { name: "Archivia il quadro corrente" });
  if (await archive.isVisible()) {
    await submit(archive);
    await expect(archive).toHaveCount(0);
  }
}

async function command(card: Locator, label: string, note: string) {
  const button = card.getByRole("button", { name: label, exact: true });
  const form = button.locator("xpath=ancestor::form");
  await form.locator('textarea[name="note"]').fill(note);
  const confirmation = form.locator('input[name="confirmed"]');
  if (await confirmation.count()) await confirmation.check();
  await submit(button);
}

async function approveAndTake(card: Locator, requireProposal = false) {
  const proposal = card.getByRole("button", { name: "Approva proposta", exact: true });
  if (requireProposal) await expect(proposal).toBeVisible();
  if (await proposal.isVisible()) {
    const form = proposal.locator("xpath=ancestor::form");
    await form.locator('textarea[name="reviewNote"]').fill("Proposta valutata nel collaudo sintetico.");
    await submit(proposal);
    await command(card, "Collega approvazione all'attività", "Approvazione collegata dopo verifica.");
  } else {
    await command(card, "Approva questa iniziativa", "Iniziativa valutata nel collaudo sintetico.");
  }
  await command(card, "Prendi in carico", "Attività presa in carico nel collaudo.");
  await expect(card).toContainText("In lavorazione");
}

async function recordEvidence(card: Locator, kind: "execution" | "outcome", documentId: string, alternativeTitle?: string) {
  const label = kind === "execution" ? "Registra esecuzione o comunicazione" : "Registra riscontro ed esito";
  const summary = card.locator("summary").filter({ hasText: label });
  await summary.click();
  const form = summary.locator("..").locator("form");
  await form.getByLabel("Data effettiva").fill(kind === "execution" ? "2026-10-25" : "2026-10-26");
  await form.getByLabel("Documenti che comprovano il passaggio").selectOption([documentId]);
  if (alternativeTitle) {
    const alternative = form.getByLabel("Alternativa valutata, se pertinente");
    await expect(alternative).not.toHaveAttribute("multiple", "");
    await alternative.selectOption({ label: alternativeTitle });
    await expect(alternative).toHaveValue(alternativeTitle);
  }
  await form.locator('textarea[name="note"]').fill(kind === "execution"
    ? "Esecuzione simulata e documentata." : "Riscontro simulato esaminato e motivato.");
  await submit(form.getByRole("button", { name: label, exact: true }));
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("Porto Aurora: dalla proposta approvata al completamento documentato e persistente", async ({ page }) => {
  await page.goto(`/procedimenti/${porto}?section=istruttoria`);
  await page.getByRole("link", { name: /Genera proposte operative: esamina prima la simulazione/ }).click();
  await archiveIfNeeded(page);
  const preview = page.locator("#proposal-reconciliation");
  await openDetails(preview.locator("summary").first());
  await expect(preview).toContainText("Anteprima in sola lettura");
  await preview.getByLabel("Ho esaminato la simulazione e autorizzo la riconciliazione della coda, senza eliminare lo storico.").check();
  await submit(preview.getByRole("button", { name: "Genera proposte operative" }));
  await expect(preview.getByRole("status")).toContainText("Riconciliazione registrata");
  const issue = await openIssue(page, "Occupazione oltre il perimetro di Porto Aurora");
  const first = activity(issue, /^1\..*accertare con sopralluogo quali occupazioni/);
  const decision = activity(issue, /^6\..*decisione motivata/);
  for (const unjustified of [/^4\..*sgombero e rimessa in pristino/, /^5\..*contestazione degli addebiti/]) {
    await expect(activity(issue, unjustified).getByRole("button", { name: "Approva proposta", exact: true })).toHaveCount(0);
  }
  await expect(issue.locator("summary").first()).toContainText("Prossimo passo: 1. Occupazione oltre il perimetro di Porto Aurora: accertare con sopralluogo");
  await capture(page, "porto-aurora-proposte");
  await approveAndTake(first, true);
  await approveAndTake(decision, true);

  const firstKey = (await first.getAttribute("id"))?.replace(/^activity-/, "");
  const decisionKey = (await decision.getAttribute("id"))?.replace(/^activity-/, "");
  expect(firstKey).toBeTruthy();
  expect(decisionKey).toBeTruthy();

  const settings = decision.locator("summary").filter({ hasText: "Responsabile, termini, documenti e collegamenti" }).locator("..");
  await settings.locator("summary").click();
  const settingsForm = settings.locator("form");
  await settingsForm.getByLabel("Responsabile o ufficio").fill("Ufficio sintetico");
  await settingsForm.getByLabel("Termine verificato, se esistente").fill("2026-12-01");
  await settingsForm.getByLabel("Motivo e fondamento del termine").fill("Termine indicato nel documento sintetico.");
  await settingsForm.getByRole("checkbox", { name: /Ho verificato il termine/ }).check();
  await settingsForm.getByLabel("Documenti che fondano il termine").selectOption([`${porto}-a-base`]);
  await settingsForm.getByLabel("Altri documenti collegati all'attività").selectOption([`${porto}-a-base`]);
  await settingsForm.getByLabel("Attività presupposte").selectOption([firstKey!]);
  await settingsForm.locator('textarea[name="note"]').fill("Collegamento e termine verificati nel fascicolo sintetico.");
  await submit(settingsForm.getByRole("button", { name: "Salva collegamenti" }));
  await expect(decision).toContainText("Presupposti non completati");
  await expect(decision).toContainText("Responsabile: Ufficio sintetico");
  await expect(decision).toContainText("Termine verificato: 2026-12-01");

  await expect(first.getByRole("button", { name: "Registra esecuzione o comunicazione" })).toHaveCount(0);
  await expect(first.locator("summary").filter({ hasText: "Registra esecuzione o comunicazione" })).toHaveCount(0);
  await submit(first.getByRole("button", { name: "Apri o crea bozza" }));
  await expect(page).toHaveURL(/section=acts/);
  const verbale = page.locator("article").filter({ has: page.getByRole("heading", { name: "Verbale di sopralluogo e accertamento" }) });
  await expect(verbale).toHaveCount(1);
  await verbale.locator("summary").filter({ hasText: "Modifica e versiona" }).click();
  await expect(verbale.getByLabel("Testo dell'atto")).toHaveValue(/\[DATA\]/);
  await verbale.getByRole("combobox", { name: "Stato", exact: true }).selectOption("APPROVATA_INTERNAMENTE");
  await verbale.getByLabel("Nota di modifica").fill("Verbale completato con i rilievi del sopralluogo simulato.");
  await submit(verbale.getByRole("button", { name: "Salva nuova versione" }));
  await expect(verbale.locator("header")).toContainText("versione 2");
  await verbale.getByRole("link", { name: "Torna all'attività" }).click();
  await first.getByPlaceholder("Nota sul collegamento").fill("Verbale collegato all'accertamento.");
  await submit(first.getByRole("button", { name: "Collega versione" }));
  await first.getByPlaceholder("Motivo della validazione").fill("Verbale verificato.");
  await submit(first.getByRole("button", { name: "Valida versione corrente" }));
  await recordEvidence(first, "execution", `${porto}-b-execution`);
  await recordEvidence(first, "outcome", `${porto}-c-outcome`);
  await command(first, "Verifica e completa", "Esecuzione e riscontro verificati nel collaudo.");
  await expect(first).toContainText("Completamento verificato dal professionista");
  await expect(decision).not.toContainText("Presupposti non completati");
  await expect(issue.locator("summary").first()).toContainText("25% verificato");

  const otherPage = await page.context().newPage();
  await otherPage.goto(`/procedimenti/${porto}?section=proposals&activity=${decisionKey}`);
  const otherDecision = activity(await openIssue(otherPage, "Occupazione oltre il perimetro di Porto Aurora"), /^6\..*decisione motivata/);
  await Promise.all([
    submit(decision.getByRole("button", { name: "Apri o crea bozza" })),
    submit(otherDecision.getByRole("button", { name: "Apri o crea bozza" })),
  ]);
  await expect(page).toHaveURL(/section=acts/);
  await expect(otherPage).toHaveURL(/section=acts/);
  expect(new URL(page.url()).hash).toBe(new URL(otherPage.url()).hash);
  await otherPage.close();

  const draft = page.locator("article").filter({ has: page.getByRole("heading", { name: "Schema di decisione motivata" }) });
  await expect(draft).toHaveCount(1);
  await expect(draft.locator("header")).toContainText("versione 1");
  const pdfHref = await draft.getByRole("link", { name: "PDF", exact: true }).getAttribute("href");
  expect(pdfHref).toBeTruthy();
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await draft.locator("summary").filter({ hasText: "Modifica e versiona" }).click();
  await draft.getByLabel("Testo dell'atto").fill("Bozza sintetica modificata. Autorità, motivazione e termini sono da verificare.");
  await draft.getByLabel("Nota di modifica").fill("Modifica professionale simulata.");
  await submit(draft.getByRole("button", { name: "Salva nuova versione" }));
  await expect(draft.locator("header")).toContainText("versione 2");
  const editor = draft.locator("summary").filter({ hasText: "Modifica e versiona" });
  if (!(await editor.locator("..").evaluate((element) => element instanceof HTMLDetailsElement && element.open))) {
    await editor.click();
  }
  await draft.getByRole("combobox", { name: "Stato", exact: true }).selectOption("APPROVATA_INTERNAMENTE");
  await draft.getByLabel("Nota di modifica").fill("Approvazione interna simulata.");
  await submit(draft.getByRole("button", { name: "Salva nuova versione" }));
  await expect(draft.locator("header")).toContainText("versione 3");
  await capture(page, "porto-aurora-atti");
  await draft.getByRole("link", { name: "Torna all'attività" }).click();
  await expect(decision).not.toContainText("Completamento verificato dal professionista");

  await decision.getByPlaceholder("Nota sul collegamento").fill("Versione corrente collegata.");
  await submit(decision.getByRole("button", { name: "Collega versione" }));
  await decision.getByPlaceholder("Motivo della validazione").fill("Versione verificata e validata.");
  await submit(decision.getByRole("button", { name: "Valida versione corrente" }));
  await recordEvidence(decision, "execution", `${porto}-b-execution`);
  const selectedAlternative = "Archiviare la contestazione o escludere specifiche misure";
  await recordEvidence(decision, "outcome", `${porto}-c-outcome`, selectedAlternative);
  await command(decision, "Verifica e completa", "Condizioni di completamento verificate.");
  await expect(decision).toContainText("Completamento verificato dal professionista");
  await expect(issue.locator("summary").first()).toContainText("50% verificato");

  await page.reload();
  await expect(decision).toContainText("Completamento verificato dal professionista");
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await page.waitForURL(/\/login/);
  await login(page);
  await page.goto(`/procedimenti/${porto}?section=proposals&activity=${decisionKey}`);
  const restored = activity(await openIssue(page, "Occupazione oltre il perimetro di Porto Aurora"), /^6\..*decisione motivata/);
  await expect(restored).toContainText("Completamento verificato dal professionista");
  await expect(restored).toContainText("Riscontro simulato esaminato e motivato");
  await restored.locator("summary").filter({ hasText: "Cronologia completa" }).click();
  await expect(restored).toContainText("Versione corrente collegata");
  await expect(restored).toContainText("Termine indicato nel documento sintetico");
  await expect(restored).toContainText(`alternativa: ${selectedAlternative}`);
  await capture(page, "porto-aurora-attivita-completata");

  await page.goto(`/procedimenti/${porto}?section=reports`);
  const report = page.getByTestId("fascicolo-report");
  await expect(report).toContainText("Coordinamento del regime concessorio portuale nel tempo");
  await expect(report.getByLabel("Esposizione giuridica").first()).toContainText("Dai documenti del fascicolo risulta");
  await capture(page, "porto-aurora-rapporto");
  await expect(report).toContainText("Manca la planimetria aggiornata del perimetro.");
  await expect(report).toContainText("Effetto indicato, da verificare: Il confronto del perimetro resta incerto.");
  const law = report.locator("summary").filter({ hasText: "Art. 18 L." }).first();
  await expect(law.locator("..")).not.toHaveAttribute("open", "");
  await law.click();
  await expect(law.locator("..")).toHaveAttribute("open", "");
  expect(await report.textContent()).not.toMatch(/COMPILATION|DOCUMENT_INVENTORY|PROCEEDING_IDENTITY|DOCUMENT_\d+\.PAGE_\d+/);

  const rtfHref = await report.getByRole("link", { name: "Scarica RTF" }).getAttribute("href");
  const pdfReportHref = await report.getByRole("link", { name: "Scarica PDF" }).getAttribute("href");
  expect(rtfHref).toBeTruthy();
  expect(pdfReportHref).toBeTruthy();
  const rtfReport = await page.request.get(rtfHref!);
  expect(rtfReport.status()).toBe(200);
  expect(await rtfReport.text()).toContain("Il confronto del perimetro resta incerto.");
  expect(await rtfReport.text()).not.toMatch(/COMPILATION|DOCUMENT_INVENTORY|PROCEEDING_IDENTITY|DOCUMENT_\d+\.PAGE_\d+/);
  const pdfReport = await page.request.get(pdfReportHref!);
  expect(pdfReport.status()).toBe(200);
  const bytes = await pdfReport.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfDocument = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pdfText: string[] = [];
  for (let index = 1; index <= pdfDocument.numPages; index += 1) {
    const content = await (await pdfDocument.getPage(index)).getTextContent();
    pdfText.push(...content.items.flatMap((item) => "str" in item ? [item.str] : []));
  }
  await pdfDocument.destroy();
  expect(pdfText.join(" ")).toContain("Coordinamento del regime concessorio portuale");
  expect(pdfText.join(" ").replace(/\s+/g, " ")).toContain("Il confronto del perimetro resta incerto.");
  expect(pdfText.join(" ")).not.toMatch(/COMPILATION|DOCUMENT_INVENTORY|PROCEEDING_IDENTITY|DOCUMENT_\d+\.PAGE_\d+/);
});

test("Caso non portuale: documenti distinti e riesame dopo un nuovo allegato", async ({ page }) => {
  await page.goto(`/procedimenti/${nonPort}?section=proposals`);
  await archiveIfNeeded(page);
  let issue = await openIssue(page, "Segnalazione commerciale comunale");
  for (const title of [/^3\. Valutare partecipazione/, /^4\. Motivare la decisione/]) {
    const card = activity(issue, title);
    await approveAndTake(card);
    await submit(card.getByRole("button", { name: "Apri o crea bozza" }));
    await expect(page).toHaveURL(/section=acts/);
    await page.goto(`/procedimenti/${nonPort}?section=proposals`);
    issue = await openIssue(page, "Segnalazione commerciale comunale");
  }
  await page.goto(`/procedimenti/${nonPort}?section=acts`);
  await expect(page.getByRole("heading", { name: "Schema di comunicazione istruttoria" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Schema di decisione motivata" })).toHaveCount(1);
  await expect(page.locator("main")).not.toContainText(/cod\. nav\.|L\. 84\/1994|demanio marittimo/);
  await capture(page, "non-portuale-atti");
  await page.goto(`/procedimenti/${nonPort}?section=documents`);
  await page.getByRole("button", { name: "Allega documento" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "riscontro-sintetico.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Riscontro sintetico di collaudo; nessuna comunicazione reale."),
  });
  await page.getByLabel("Nome documento (opzionale)").fill("Riscontro caricato nel collaudo");
  await submit(page.getByRole("button", { name: "Conferma allegato" }));
  await expect(page.getByText("Riscontro caricato nel collaudo")).toBeVisible();
  await page.goto(`/procedimenti/${nonPort}?section=proposals`);
  issue = await openIssue(page, "Segnalazione commerciale comunale");
  await expect(activity(issue, /^3\. Valutare partecipazione/)).toContainText("Il quadro è cambiato");
  await expect(activity(issue, /^4\. Motivare la decisione/)).toContainText("Il quadro è cambiato");
});

test("Due problematiche condividono una sola cronologia senza duplicare il lavoro", async ({ page }) => {
  await page.goto(`/procedimenti/${shared}?section=proposals`);
  await archiveIfNeeded(page);
  const primaryIssue = await openIssue(page, "Verifica del titolo commerciale");
  const primary = activity(primaryIssue, /^1\. Accertare fatti e documenti/);
  await command(primary, "Approva questa iniziativa", "La stessa ricostruzione serve a entrambe le verifiche.");
  const settings = primary.locator("summary").filter({ hasText: "Responsabile, termini, documenti e collegamenti" }).locator("..");
  await settings.locator("summary").click();
  const form = settings.locator("form");
  await form.getByLabel("Stesso lavoro condiviso con altre problematiche")
    .selectOption({ label: "Verifica delle osservazioni commerciali — 1. Accertare fatti e documenti" });
  await form.locator('textarea[name="note"]').fill("Coincidenza del lavoro verificata dal professionista.");
  await submit(form.getByRole("button", { name: "Salva collegamenti" }));
  await expect(primary.locator("summary").filter({ hasText: "Cronologia completa (2)" })).toBeVisible();

  const otherIssue = await openIssue(page, "Verifica delle osservazioni commerciali");
  const other = activity(otherIssue, /^1\. Accertare fatti e documenti/);
  await expect(other).toContainText("Attività condivisa");
  await expect(other.getByRole("button", { name: "Approva questa iniziativa" })).toHaveCount(0);
  await command(primary, "Prendi in carico", "Presa in carico unica per entrambe le problematiche.");
  await expect(other).toContainText("In lavorazione");
  await page.reload();
  await openIssue(page, "Verifica delle osservazioni commerciali");
  await expect(other).toContainText("Attività condivisa");
  await expect(other).toContainText("In lavorazione");
});

test("Riesame sintetico: le attività non riavviano il procedimento già concluso", async ({ page }) => {
  await page.goto(`/procedimenti/${review}?section=proposals`);
  const issue = await openIssue(page, "Riesame di una decadenza simulata");
  await expect(issue).toContainText("Istruire l'istanza di riesame");
  await expect(issue).not.toContainText("Garantire contestazione e contraddittorio");
  await page.goto(`/procedimenti/${review}?section=acts`);
  await expect(page.getByText("Fase rilevata:").first()).toContainText("Fase successiva al provvedimento finale");
  await expect(page.getByRole("button", { name: /Crea bozza/ })).toHaveCount(0);
});

test("La simulazione precede una riconciliazione reversibile senza cancellare la storia", async ({ page }) => {
  await page.goto(`/procedimenti/${reconciliation}?section=proposals`);
  await archiveIfNeeded(page);
  const preview = page.locator("#proposal-reconciliation");
  await openDetails(preview.locator("summary").first());
  await expect(preview).toContainText("Anteprima in sola lettura");
  await expect(preview.locator("summary").filter({ hasText: "Nuove proposte generate" })).not.toHaveText(/\(0\)/);
  await preview.getByLabel("Ho esaminato la simulazione e autorizzo la riconciliazione della coda, senza eliminare lo storico.").check();
  await submit(preview.getByRole("button", { name: "Genera proposte operative" }));
  await expect(preview.getByRole("status")).toContainText("Riconciliazione registrata");
  const summaries = preview.locator("summary").filter({ hasText: "Ultime riconciliazioni verificabili" });
  await openDetails(summaries);
  const reversal = preview.getByRole("button", { name: "Ripristina la coda precedente" });
  const form = reversal.locator("xpath=ancestor::form");
  await form.getByLabel("Motivo del ripristino").fill("Ripristino del collaudo sintetico.");
  await form.getByLabel("Confermo il ripristino della coda e la conservazione dello storico.").check();
  await submit(reversal);
  await expect(preview.getByRole("status")).toContainText("Ripristino registrato");
  await expect(preview.locator("summary").filter({ hasText: "Proposte da riattivare" })).not.toHaveText(/\(0\)/);

  await preview.getByLabel("Ho esaminato la simulazione e autorizzo la riconciliazione della coda, senza eliminare lo storico.").check();
  await submit(preview.getByRole("button", { name: "Genera proposte operative" }));
  await expect(preview.getByRole("status")).toContainText("Riconciliazione registrata");
  const issue = await openIssue(page, "Verifica dell'istanza sintetica");
  const first = activity(issue, /^1\. Accertare fatti e documenti/);
  const approval = first.getByRole("button", { name: "Approva proposta" });
  const approvalForm = approval.locator("xpath=ancestor::form");
  await approvalForm.locator('textarea[name="reviewNote"]').fill("Approvazione successiva al ripristino.");
  await submit(approval);
  await expect(first.getByRole("button", { name: "Collega approvazione all'attività" })).toBeVisible();

  await openDetails(page.locator("summary").filter({ hasText: "Altre proposte e storico delle revisioni" }));
  const concession = page.getByRole("heading", {
    name: "Riconciliare il titolo amministrativo 17/2023",
  }).locator("xpath=ancestor::article");
  await expect(concession).toContainText("Concessione da collegare o creare");
  await concession.locator("summary").filter({ hasText: "Crea e collega una nuova concessione" }).click();
  const createButton = concession.getByRole("button", { name: "Verifica, modifica e approva la creazione" });
  const createForm = createButton.locator("xpath=ancestor::form");
  await expect(createForm.locator('input[name="numeroAtto"]')).toHaveValue("17/2023");
  await expect(createForm.locator('input[name="dataRilascio"]')).toHaveValue("2023-04-03");
  await createForm.locator('select[name="concessionarioId"]').selectOption({ index: 1 });
  await createForm.locator('input[name="dataScadenza"]').fill("2033-04-03");
  await createForm.locator('textarea[name="reviewNote"]').fill(
    "Titolo, data, concessionario e durata verificati sui documenti sintetici.",
  );
  await submit(createButton);
  const materialize = concession.getByRole("button", { name: "Materializza" });
  await expect(materialize).toBeVisible();
  await submit(materialize);
  await page.goto(`/procedimenti/${reconciliation}?section=concession`);
  await expect(page.getByText("17/2023", { exact: true }).first()).toBeVisible();
  await page.goto(`/procedimenti/${reconciliation}?section=proposals`);
  await openDetails(preview.locator("summary").first());
  await openDetails(summaries);
  await expect(preview).toContainText("Coda cambiata: ripristino bloccato");
  await openDetails(page.locator("summary").filter({ hasText: "Altre proposte e storico delle revisioni" }));
  await expect(page.getByRole("heading", {
    name: "Riconciliare il titolo amministrativo 17/2023",
  }).locator("xpath=ancestor::article")).toContainText("Materializzata");
});

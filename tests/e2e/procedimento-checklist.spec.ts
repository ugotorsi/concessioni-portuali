import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("procedimento checklist section and update form visibility by role", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/procedimenti");
  const detailLink = page.locator('a[href^="/procedimenti/"]', { hasText: "Apri scheda" }).first();
  await expect(detailLink).toBeVisible();
  const detailHref = await detailLink.getAttribute("href");
  expect(detailHref).toBeTruthy();

  await page.goto(detailHref!);
  await expect(page).toHaveURL(/\/procedimenti\/.+/);
  const procedimentoDetailUrl = page.url();

  const fascicoloNav = page.getByRole("navigation", { name: "Navigazione del fascicolo" });
  await expect(fascicoloNav).toBeVisible();
  await expect(fascicoloNav.locator(":scope > div > *")).toHaveText([
    "Panoramica",
    "Documenti",
    "Cronologia",
    "Soggetti",
    "Concessione",
    "Analisi",
    "Ricerca",
    "Scadenze",
    "Criticità",
    "Rapporto",
    "Proposte",
  ]);
  const overview = page.locator("#panoramica");
  await expect(overview.getByText("Richiede attenzione", { exact: true })).toBeVisible();
  await expect(overview.getByText("Sintesi del fascicolo", { exact: true })).toBeVisible();
  expect(await overview.locator('[aria-labelledby="documenti-sintesi-title"] li').count()).toBeLessThanOrEqual(3);
  await expect(overview.getByText("Trusted Review", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Altre funzioni", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checklist istruttoria" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Documenti del Fascicolo" })).toHaveCount(0);

  await page.getByRole("link", { name: "Documenti", exact: true }).click();
  await expect(page).toHaveURL(/\?section=documents$/);
  await expect(page.getByRole("heading", { name: "Documenti del Fascicolo" })).toBeVisible();
  await expect(page.locator("#panoramica")).toHaveCount(0);

  await page.getByRole("link", { name: "Concessione", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4. Contesto concessorio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "7. Pagamenti critici" })).toBeVisible();

  await page.getByRole("link", { name: "Ricerca", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Riferimenti normativi collegati" })).toBeVisible();

  await page.goto(`${new URL(procedimentoDetailUrl).pathname}?section=analysis`);
  await page.reload();
  await expect(page).toHaveURL(/\?section=analysis$/);

  await expect(page.getByRole("heading", { name: "Checklist istruttoria" })).toBeVisible();
  await expect(page.getByText(/Checklist (completa|incompleta)/i)).toBeVisible();
  await expect(page.getByText(/Origine procedimento/i)).toBeVisible();
  await expect(page.getByText(/Stato preavviso rigetto/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna checklist" })).toBeVisible();

  await page.locator('select[name="origineProcedimento"]').selectOption("ISTANZA_PARTE");
  await page.locator('select[name="procedimentoUfficio"]').selectOption("false");
  await page.locator('select[name="preavvisoRigettoApplicabile"]').selectOption("true");
  await page.locator('select[name="statoPreavvisoRigetto"]').selectOption("INVIATO");
  await page.getByRole("button", { name: "Aggiorna checklist" }).click();

  await expect(page).toHaveURL(/\/procedimenti\/.+/);
  await page.goto(`${new URL(procedimentoDetailUrl).pathname}?section=analysis`);
  await expect(page.getByText(/Istanza di parte/i).first()).toBeVisible();
  await expect(page.getByText(/Preavviso in gestione/i)).toBeVisible();

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto(`${new URL(procedimentoDetailUrl).pathname}?section=analysis`);
  await expect(page).toHaveURL(/\/procedimenti\/.+/);
  await expect(page.getByRole("heading", { name: "Checklist istruttoria" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna checklist" })).toHaveCount(0);
});

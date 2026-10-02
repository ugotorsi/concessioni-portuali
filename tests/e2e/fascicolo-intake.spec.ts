import { expect, test } from "playwright/test";

import { loginAndExpectLanding } from "./helpers/auth";

test("nuovo fascicolo mostra solo l'intake iniziale e il collegamento concessione resta opzionale", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
  await page.goto("/procedimenti/nuovo", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Nuovo Fascicolo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inquadramento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dati della concessione" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Soggetti iniziali" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documenti iniziali" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contesto iniziale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crea Fascicolo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Annulla" })).toBeVisible();

  const sectionTitles = await page.locator("main section h2").allTextContents();
  expect(sectionTitles).toEqual([
    "Inquadramento",
    "Documenti iniziali",
    "Dati della concessione",
    "Soggetti iniziali",
    "Contesto iniziale",
  ]);
  await expect(page.getByLabel("Nome fascicolo")).toBeVisible();
  await expect(page.locator('[name="documentiIniziali"]')).toBeVisible();

  const secondaryDisclosure = page.getByText("Altri dati della concessione", { exact: true });
  await expect(secondaryDisclosure).toBeVisible();
  await expect(page.locator('[name="autoritaCompetenteIniziale"]')).not.toBeVisible();
  await secondaryDisclosure.click();
  await expect(page.locator('[name="autoritaCompetenteIniziale"]')).toBeVisible();

  await expect(page.locator('[name="criticitaId"]')).toHaveCount(0);
  await expect(page.locator('[name="riferimentoNormativo"]')).toHaveCount(0);
  await expect(page.locator('[name="dataScadenzaContraddittorio"]')).toHaveCount(0);
  await expect(page.locator('[name="responsabileProcedimentoNome"]')).toHaveCount(0);

  const disclosure = page.getByText("Collega a concessione già presente", { exact: false });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.locator('[name="concessioneId"]')).toBeVisible();
  await expect(page.locator('[name="concessioneId"]')).not.toHaveAttribute("required", "");
});

test("fascicolo in preparazione usa la panoramica e la navigazione condivise", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
  await page.goto("/procedimenti", { waitUntil: "domcontentloaded" });

  const intakeList = page.getByRole("heading", { name: "Fascicoli in preparazione" }).locator("..");
  const intakeLink = intakeList.locator('a[href^="/procedimenti/"]').first();
  test.skip(await intakeLink.count() === 0, "Nessun FascicoloIntake disponibile nel dataset E2E");
  await intakeLink.click();

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
  await expect(page.locator("#panoramica").getByText("Sintesi del fascicolo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documenti" })).toHaveCount(0);
  await page.getByRole("link", { name: "Documenti", exact: true }).click();
  await expect(page).toHaveURL(/\?section=documents$/);
  await expect(page.getByRole("heading", { name: "Documenti", exact: true })).toBeVisible();
  await expect(page.getByText("Atti e documenti acquisiti nel fascicolo.")).toBeVisible();
  await expect(page.getByText("Direzione non indicata")).toHaveCount(0);
  const intakeAttachDocument = page.getByRole("button", { name: "Allega documento" });
  await expect(intakeAttachDocument).toBeVisible();
  if (await page.getByRole("link", { name: "Apri documento" }).count()) {
    await expect(page.getByRole("link", { name: "Apri documento" }).first()).toBeVisible();
  }
  await page.reload();
  await expect(page).toHaveURL(/\?section=documents$/);
  await expect(page.getByText("Checklist istruttoria", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Cronologia", exact: true }).click();
  await expect(page).toHaveURL(/\?section=timeline$/);
  await expect(page.getByRole("heading", { name: "Cronologia", exact: true })).toBeVisible();
  await expect(page.locator('ol[aria-label="Eventi cronologici"] > li').first()).toBeVisible();
  await expect(page.locator("main table")).toHaveCount(0);
});

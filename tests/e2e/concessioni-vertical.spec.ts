import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("admin vede la verticale concessione in lista e dettaglio", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/concessioni");
  await expect(page).toHaveURL(/\/concessioni$/);
  await expect(page.getByTestId(/concessione-vertical-/).first()).toBeVisible();
  const concessioniTable = page.locator("tbody");
  await expect(concessioniTable.getByText("Portuale / AdSP").first()).toBeVisible();
  await expect(concessioniTable.getByText("Turistico-ricreativa / Comune costiero").first()).toBeVisible();

  const dettaglioLink = page.getByRole("link", { name: "Apri scheda" }).first();
  await expect(dettaglioLink).toBeVisible();
  await Promise.all([page.waitForURL(/\/concessioni\/.+/), dettaglioLink.click()]);

  await expect(page.getByTestId("concessione-vertical-detail")).toBeVisible();
  await expect(page.getByTestId("concessione-legal-frameworks-detail")).toBeVisible();
});

test("concessioni filters expose explicit accessible labels", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/concessioni");
  await expect(page).toHaveURL(/\/concessioni$/);

  await expect(page.getByLabel("Ricerca")).toBeVisible();
  await expect(page.getByLabel("Stato")).toBeVisible();
  await expect(page.getByLabel("Tipologia bene")).toBeVisible();
  await expect(page.getByLabel("Attivita")).toBeVisible();
  await expect(page.getByLabel("Verticale")).toBeVisible();
  await expect(page.getByLabel("Concessionario")).toBeVisible();
  await expect(page.getByLabel("Scadenza")).toBeVisible();

  await expect(page.locator('label[for="concessioni-filter-verticale"]')).toBeVisible();
  await expect(page.locator("#concessioni-filter-verticale")).toBeVisible();
});

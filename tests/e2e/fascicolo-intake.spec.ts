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

  await expect(page.locator('[name="criticitaId"]')).toHaveCount(0);
  await expect(page.locator('[name="riferimentoNormativo"]')).toHaveCount(0);
  await expect(page.locator('[name="dataScadenzaContraddittorio"]')).toHaveCount(0);
  await expect(page.locator('[name="responsabileProcedimentoNome"]')).toHaveCount(0);

  const disclosure = page.getByText("Collega a concessione già presente", { exact: true });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(page.locator('[name="concessioneId"]')).toBeVisible();
  await expect(page.locator('[name="concessioneId"]')).not.toHaveAttribute("required", "");
});

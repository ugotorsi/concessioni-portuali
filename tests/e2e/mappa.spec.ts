import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("admin consulta il modulo mappa operativo", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa", exact: true })).toBeVisible();
  await expect(page.getByTestId("mappa-leaflet")).toBeVisible();
  await expect(page.getByLabel(/Apri dettagli concessione/).first()).toBeVisible();

  await page.getByLabel(/Apri dettagli concessione/).first().click();
  const primaryLink = page.getByRole("link", { name: "Apri fascicolo" }).first();
  const secondaryLink = page.getByRole("link", { name: "Apri concessione" }).first();
  await expect(primaryLink).toBeVisible();
  await expect(secondaryLink).toBeVisible();
  await expect(primaryLink).toHaveAttribute("href", /\/procedimenti\/.+/);
  await expect(secondaryLink).toHaveAttribute("href", /\/concessioni\/.+/);

  await primaryLink.click();
  await expect(page).toHaveURL(/\/procedimenti\/.+/);
});

test("viewer adsp può consultare la mappa in sola lettura", async ({ page }) => {
  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa", exact: true })).toBeVisible();
  await expect(page.getByTestId("mappa-leaflet")).toBeVisible();
});

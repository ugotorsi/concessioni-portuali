import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin consulta il modulo mappa operativo", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

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
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa", exact: true })).toBeVisible();
  await expect(page.getByTestId("mappa-leaflet")).toBeVisible();
});

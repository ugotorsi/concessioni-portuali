import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin consulta il modulo mappa demo", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa demo concessioni e criticita" })).toBeVisible();
  await expect(page.getByTestId("mappa-placeholder")).toBeVisible();
  await expect(page.getByTestId("mappa-marker-list")).toBeVisible();
  await expect(page.getByText(/Morosita|DEMO-01/i).first()).toBeVisible();
  await expect(page.getByTestId("mappa-point").first()).toBeVisible();

  await page.getByRole("link", { name: "Apri scheda" }).first().click();
  await expect(page).toHaveURL(/\/(concessioni|criticita|sopralluoghi)\/.+/);
});

test("viewer adsp puo consultare la mappa in sola lettura", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa demo concessioni e criticita" })).toBeVisible();
  await expect(page.getByTestId("mappa-placeholder")).toBeVisible();
});

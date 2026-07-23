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
  await expect(page.getByRole("heading", { name: "Mappa demo concessioni e criticità" })).toBeVisible();
  await expect(page.getByTestId("mappa-placeholder")).toBeVisible();
  await expect(page.getByTestId("mappa-marker-list")).toBeVisible();
  await expect(page.getByText(/Morosità|Morosita|DEMO-01/i).first()).toBeVisible();
  await expect(page.getByTestId("mappa-point").first()).toBeVisible();

  const firstDetailLink = page.getByTestId("mappa-marker-list").getByRole("link", { name: "Apri scheda" }).first();
  await expect(firstDetailLink).toBeVisible();
  const detailHref = await firstDetailLink.getAttribute("href");
  expect(detailHref).toBeTruthy();

  await page.goto(detailHref!);
  await expect(page).toHaveURL(/\/(concessioni|criticita|sopralluoghi)\/.+/);
});

test("viewer adsp può consultare la mappa in sola lettura", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/mappa");
  await expect(page).toHaveURL(/\/mappa$/);
  await expect(page.getByRole("heading", { name: "Mappa demo concessioni e criticità" })).toBeVisible();
  await expect(page.getByTestId("mappa-placeholder")).toBeVisible();
});

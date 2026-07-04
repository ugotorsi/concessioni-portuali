import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin visualizza i 5 scenari demo istituzionali", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/demo-scenari");
  await expect(page).toHaveURL(/\/demo-scenari$/);

  await expect(page.getByRole("heading", { name: "Scenari demo istituzionali" }).first()).toBeVisible();

  await expect(page.getByTestId("demo-scenario-card-morosita-art47")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-occupazione-difforme")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-regolarizzazione-pre-provvedimento")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-contraddittorio-incompleto")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-istanza-parte-art10bis")).toBeVisible();

  await page.getByTestId("demo-scenario-card-morosita-art47").getByRole("link", { name: "Apri report" }).click();
  await expect(page).toHaveURL(/\/report\/.+/);
  await expect(page.getByText(/Documento istruttorio|art\. 47/i).first()).toBeVisible();
});

test("viewer adsp puo consultare scenari demo in sola lettura", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/demo-scenari");
  await expect(page).toHaveURL(/\/demo-scenari$/);
  await expect(page.getByRole("heading", { name: "Scenari demo istituzionali" }).first()).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-istanza-parte-art10bis")).toBeVisible();
});

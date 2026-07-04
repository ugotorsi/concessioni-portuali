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
  await page.getByRole("link", { name: "Apri scheda" }).first().click();
  await expect(page).toHaveURL(/\/procedimenti\/.+/);
  const procedimentoDetailUrl = page.url();

  await expect(page.getByRole("heading", { name: "2. Checklist contraddittorio" })).toBeVisible();
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
  await expect(page.getByText(/Istanza di parte/i).first()).toBeVisible();
  await expect(page.getByText(/Preavviso in gestione/i)).toBeVisible();

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto(procedimentoDetailUrl);
  await expect(page).toHaveURL(/\/procedimenti\/.+/);
  await expect(page.getByRole("heading", { name: "2. Checklist contraddittorio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna checklist" })).toHaveCount(0);
});

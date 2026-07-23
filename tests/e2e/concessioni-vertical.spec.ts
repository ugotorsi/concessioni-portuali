import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin vede la verticale concessione in lista e dettaglio", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/concessioni");
  await expect(page).toHaveURL(/\/concessioni$/);
  await expect(page.getByText("Portuale / AdSP").first()).toBeVisible();
  await expect(page.getByText("Turistico-ricreativa / Comune costiero").first()).toBeVisible();

  const dettaglioLink = page.getByRole("link", { name: "Apri scheda" }).first();
  await expect(dettaglioLink).toBeVisible();
  await Promise.all([page.waitForURL(/\/concessioni\/.+/), dettaglioLink.click()]);

  await expect(page.getByTestId("concessione-vertical-detail")).toBeVisible();
  await expect(page.getByTestId("concessione-legal-frameworks-detail")).toBeVisible();
});
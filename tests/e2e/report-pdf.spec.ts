import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("pdf report access policy by role and validation", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/report");
  await page.getByRole("link", { name: "Apri report" }).first().click();

  const pdfLink = page.getByRole("link", { name: "Scarica PDF istituzionale" });
  await expect(pdfLink).toBeVisible();

  const pdfPath = await pdfLink.getAttribute("href");
  expect(pdfPath).toBeTruthy();

  const unvalidateButton = page.getByRole("button", { name: "Rimuovi validazione" });
  if (await unvalidateButton.isVisible()) {
    await unvalidateButton.click();
    await expect(page.getByRole("button", { name: "Valida report" })).toBeVisible();
  }

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  const response = await page.goto(pdfPath as string);
  expect(response?.status()).toBe(403);
  await expect(page.getByText("Forbidden")).toBeVisible();
});

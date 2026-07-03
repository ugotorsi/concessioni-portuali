import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("audit page access and report validation audit events", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/report");
  await page.getByRole("link", { name: "Apri report" }).first().click();

  const validateButton = page.getByRole("button", { name: "Valida report" });
  const unvalidateButton = page.getByRole("button", { name: "Rimuovi validazione" });

  await page.waitForSelector('button:has-text("Valida report"), button:has-text("Rimuovi validazione")');

  if (await validateButton.isVisible()) {
    await validateButton.click();
    await expect(unvalidateButton).toBeVisible();
  } else {
    await expect(unvalidateButton).toBeVisible();
    await unvalidateButton.click();
    await expect(validateButton).toBeVisible();
  }

  await page.goto("/audit");
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("heading", { name: "Ultimi eventi audit" })).toBeVisible();
  await expect(page.getByText(/REPORT_VALIDATE|REPORT_UNVALIDATE/).first()).toBeVisible();

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/audit");
  await expect(page).toHaveURL(/\/adsp$/);
});

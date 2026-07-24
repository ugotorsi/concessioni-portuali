import { expect } from "playwright/test";

export async function loginAndExpectLanding(
  page: import("playwright/test").Page,
  email: string,
  password: string,
  expectedLanding: RegExp,
) {
  const authErrorMessage = "Credenziali non valide o account temporaneamente bloccato.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 20000 });

    const emailInput = page.getByTestId("login-email");
    const passwordInput = page.getByTestId("login-password");
    const submitButton = page.getByTestId("login-submit");

    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(passwordInput).toBeVisible({ timeout: 10000 });
    await expect(submitButton).toBeVisible({ timeout: 10000 });

    await emailInput.fill(email);
    await passwordInput.fill(password);

    await Promise.all([
      page
        .waitForResponse(
          (response) =>
            response.request().method() === "POST" && response.url().includes("/api/auth/callback/credentials"),
          { timeout: 10000 },
        )
        .catch(() => null),
      submitButton.click(),
    ]);

    const landed = await page
      .waitForURL(expectedLanding, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (landed) {
      return;
    }

    const hasAuthError = await page.getByText(authErrorMessage).isVisible().catch(() => false);
    if (hasAuthError) {
      throw new Error(`Login rejected for user ${email}.`);
    }
  }

  throw new Error(`Login did not reach expected landing ${expectedLanding} for user ${email}. Last URL: ${page.url()}`);
}
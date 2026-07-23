import { expect } from "playwright/test";

export async function loginAndExpectLanding(
  page: import("playwright/test").Page,
  email: string,
  password: string,
  expectedLanding: RegExp,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reachedLogin = await page
      .goto("/login", { waitUntil: "domcontentloaded", timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!reachedLogin) {
      await page.waitForTimeout(300);
      continue;
    }

    const emailInput = page.getByTestId("login-email");
    const passwordInput = page.getByTestId("login-password");
    const submitButton = page.getByTestId("login-submit");
    const loginFormReady = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (!loginFormReady) {
      if (expectedLanding.test(page.url())) {
        return;
      }

      await page.goto("/logout").catch(() => null);
      await page.waitForTimeout(250);
      continue;
    }

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

    try {
      await expect(page).toHaveURL(expectedLanding, { timeout: 10000 });
      return;
    } catch {
      // Retry transient login/redirect failures seen under parallel E2E load.
      await page.waitForTimeout(500);
    }
  }

  throw new Error(`Login did not reach expected landing ${expectedLanding} for user ${email}. Last URL: ${page.url()}`);
}
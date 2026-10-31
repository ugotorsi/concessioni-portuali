import { expect } from "playwright/test";
import * as OTPAuth from "otpauth";

const authenticatedCookies = new Map<string, Awaited<ReturnType<import("playwright/test").BrowserContext["cookies"]>>>();

function currentE2eMfaCode(): string {
  const secret = process.env.E2E_MFA_SECRET?.trim();
  if (!secret) {
    throw new Error("E2E_MFA_SECRET is required for MFA-protected demo users.");
  }

  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
}

export async function loginAndExpectLanding(
  page: import("playwright/test").Page,
  email: string,
  password: string,
  expectedLanding: RegExp,
) {
  const authErrorMessage = "Credenziali non valide o account temporaneamente bloccato.";
  const cachedCookies = authenticatedCookies.get(email);
  if (cachedCookies) {
    await page.context().clearCookies();
    await page.context().addCookies(cachedCookies);
    await page.goto(expectedLanding.source.includes("adsp") ? "/adsp" : "/dashboard");
    if (expectedLanding.test(new URL(page.url()).pathname)) {
      return;
    }
    authenticatedCookies.delete(email);
  }

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

    const mfaInput = page.getByTestId("login-mfa-code");
    const outcome = await Promise.race([
      page.waitForURL(expectedLanding, { timeout: 15000 }).then(() => "landed" as const),
      mfaInput.waitFor({ state: "visible", timeout: 15000 }).then(() => "mfa" as const),
    ]).catch(() => "pending" as const);

    if (outcome === "mfa") {
      await mfaInput.fill(currentE2eMfaCode());
      await submitButton.click();
    }

    const landed = outcome === "landed" || await page
      .waitForURL(expectedLanding, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (landed) {
      authenticatedCookies.set(email, await page.context().cookies());
      return;
    }

    const hasAuthError = await page.getByText(authErrorMessage).isVisible().catch(() => false);
    if (hasAuthError) {
      throw new Error(`Login rejected for user ${email}.`);
    }
  }

  throw new Error(`Login did not reach expected landing ${expectedLanding} for user ${email}. Last URL: ${page.url()}`);
}
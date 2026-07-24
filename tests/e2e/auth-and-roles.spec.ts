import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("auth + role redirects baseline", async ({ page, context }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);

  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/concessioni", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/concessioni$/);
  await page.goto("/report", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/report$/);
  await page.goto("/ai", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/ai$/);

  await page.goto("/logout", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);

  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/adsp$/);
  await page.goto("/ai", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/adsp$/);
  await page.goto("/procedimenti/nuovo", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/adsp$/);

  await context.clearCookies();
  const guestPage = await context.newPage();

  await guestPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(guestPage).toHaveURL(/\/login/);

  await guestPage.goto("/verticali", { waitUntil: "domcontentloaded" });
  await expect(guestPage).toHaveURL(/\/login/);

  await guestPage.goto("/verticali/portuale-adsp", { waitUntil: "domcontentloaded" });
  await expect(guestPage).toHaveURL(/\/login/);

  await guestPage.close();
});

test("generic auth error and lockout baseline", async ({ page }) => {
  await page.goto("/login");

  await page.getByTestId("login-email").fill("lockout@demo.local");
  await page.getByTestId("login-password").fill("bad-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByText("Credenziali non valide o account temporaneamente bloccato.")).toBeVisible();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByTestId("login-email").fill("lockout@demo.local");
    await page.getByTestId("login-password").fill("wrong-password");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/login$/);
  }

  await page.getByTestId("login-email").fill("lockout@demo.local");
  await page.getByTestId("login-password").fill("lockout123");
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Credenziali non valide o account temporaneamente bloccato.")).toBeVisible();
});

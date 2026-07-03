import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("auth + role redirects baseline", async ({ page, context }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/concessioni");
  await expect(page).toHaveURL(/\/concessioni$/);
  await page.goto("/report");
  await expect(page).toHaveURL(/\/report$/);
  await page.goto("/ai");
  await expect(page).toHaveURL(/\/ai$/);

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/adsp$/);
  await page.goto("/ai");
  await expect(page).toHaveURL(/\/adsp$/);
    await page.goto("/procedimenti/nuovo");
  await expect(page).toHaveURL(/\/adsp$/);

  await context.clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

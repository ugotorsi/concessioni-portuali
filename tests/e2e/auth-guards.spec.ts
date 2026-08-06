import { expect, test } from "playwright/test";

test("anonymous user is redirected to /login from /dashboard", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/login/);

  expect(new URL(page.url()).pathname).toBe("/login");
});

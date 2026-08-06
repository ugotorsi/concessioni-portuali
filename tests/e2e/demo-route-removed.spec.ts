import { expect, test } from "playwright/test";

test("/demo returns 404 for anonymous users", async ({ page }) => {
  const response = await page.goto("/demo", { waitUntil: "domcontentloaded" });

  expect(response).not.toBeNull();
  expect(response?.status()).toBe(404);
});

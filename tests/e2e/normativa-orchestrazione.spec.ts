import { expect, test } from "playwright/test";

import { loginAndExpectLanding } from "./helpers/auth";

test("normativa orchestration workspace is reachable and shows deterministic disclaimer", async ({ page }) => {
  await loginAndExpectLanding(page, "giuridico@demo.local", "giuridico123", /\/dashboard$/);

  await page.goto("/normativa");
  await expect(page.getByRole("link", { name: "Orchestrazione regole" })).toBeVisible();

  await page.getByRole("link", { name: "Orchestrazione regole" }).click();
  await expect(page).toHaveURL(/\/normativa\/orchestrazione$/);
  await expect(page.getByRole("heading", { name: "Orchestrazione Regole" })).toBeVisible();
  await expect(page.getByText("human review obbligatoria", { exact: false })).toBeVisible();
});

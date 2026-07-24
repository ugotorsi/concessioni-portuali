import { expect, test } from "playwright/test";

import { loginAndExpectLanding } from "./helpers/auth";

test("normativa orchestration workspace is reachable and shows deterministic disclaimer", async ({ page }) => {
  await loginAndExpectLanding(page, "giuridico@demo.local", "giuridico123", /\/dashboard$/);

  await page.goto("/normativa");
  await expect(page.getByRole("link", { name: "Orchestrazione regole" })).toBeVisible();

  await page.getByRole("link", { name: "Orchestrazione regole" }).click();
  await expect(page).toHaveURL(/\/normativa\/orchestrazione$/);
  await expect(page.getByRole("heading", { name: "Orchestrazione Regole" })).toBeVisible();

  await expect(page.locator("label", { hasText: "Autorita" })).toBeVisible();
  await expect(page.locator("label", { hasText: "Porto" })).toBeVisible();
  await expect(page.locator("label", { hasText: "Reference date" })).toBeVisible();

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/legal-rules/resolve") && response.ok()),
    page.getByRole("button", { name: "Esegui orchestrazione" }).click(),
  ]);

  await expect(page.getByTestId("rule-orchestrator-result")).toBeVisible();
  await expect(page.getByText("Fonti applicabili", { exact: false })).toBeVisible();
  await expect(page.getByText("Fonti escluse per territorio", { exact: false })).toBeVisible();
  await expect(page.getByText("Known gaps", { exact: false })).toBeVisible();
  await expect(page.getByText("Conflitti potenziali", { exact: false })).toBeVisible();
  await expect(page.getByText("humanReviewRequired: true", { exact: false })).toBeVisible();
  await expect(page.getByTestId("professional-review-badge")).toContainText("Verifica professionale richiesta");
  await expect(page.getByTestId("overall-confidence")).not.toBeEmpty();
  await expect(page.getByTestId("reasoning-trace-title")).toContainText("Reasoning trace");
  await expect(page.getByTestId("reasoning-trace").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("rule-orchestrator-result").locator("p").first()).toContainText("Output di supporto istruttorio");
});

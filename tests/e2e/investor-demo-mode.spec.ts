import { expect, test } from "playwright/test";

test.describe("investor demo mode", () => {
  test.skip(process.env.INVESTOR_DEMO_MODE !== "true", "Run this suite only with INVESTOR_DEMO_MODE=true");

  test("opens dashboard directly and navigates enabled demo sections", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();
    await expect(page.getByTestId("investor-demo-dashboard")).toBeVisible();

    await page.getByRole("main").getByRole("link", { name: "Concessioni" }).click();
    await expect(page).toHaveURL(/\/concessioni$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    await page.goto("/procedimenti", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/procedimenti$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    await page.goto("/documenti", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/documenti$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    await page.goto("/scadenze", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/scadenze$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    await page.goto("/normativa", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/normativa$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();

    await page.goto("/normativa/orchestrazione", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/normativa\/orchestrazione$/);
    await expect(page.getByTestId("investor-demo-banner")).toBeVisible();
    await expect(page.getByTestId("investor-demo-orchestrazione")).toBeVisible();
    await expect(page.getByText("Confidence:", { exact: false })).toBeVisible();
    await expect(page.getByText("Reasoning trace", { exact: false })).toBeVisible();
    await expect(page.getByText("Verifica professionale richiesta", { exact: false })).toBeVisible();
  });
});
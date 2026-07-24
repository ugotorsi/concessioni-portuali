import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("desktop navigation exposes Verticali and landing page renders cards", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await expect(page.getByRole("link", { name: "Verticali" }).first()).toBeVisible();

  await page.goto("/verticali");
  await expect(page).toHaveURL(/\/verticali$/);
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
  await expect(page.getByTestId("verticali-cards-grid")).toBeVisible();
  await expect(page.getByTestId(/vertical-card-/).first()).toBeVisible();

  const firstWorkspaceCta = page.getByRole("link", { name: "Apri workspace verticale" }).first();
  await expect(firstWorkspaceCta).toBeVisible();
  await Promise.all([page.waitForURL(/\/verticali\/.+/), firstWorkspaceCta.click()]);

  await expect(page.getByTestId("vertical-workspace-kpi")).toBeVisible();
});

test("mobile navigation shows Verticali and workspace links remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  const verticaliLink = page.getByRole("link", { name: "Verticali" }).first();
  await expect(verticaliLink).toBeVisible();
  await verticaliLink.click();

  await expect(page).toHaveURL(/\/verticali$/);
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
});

test("verticale workspace links to concessioni filtered by concessionVertical", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/verticali");
  const filteredLink = page.getByRole("link", { name: "Vedi concessioni correlate" }).first();
  const href = await filteredLink.getAttribute("href");
  expect(href).toContain("/concessioni?concessionVertical=");

  await filteredLink.click();
  await expect(page).toHaveURL(/\/concessioni\?concessionVertical=/);
  await expect(page.getByTestId(/concessione-vertical-/).first()).toBeVisible();
});

test("viewer adsp can access /verticali in read-only with scoped data", async ({ page }) => {
  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/verticali");
  await expect(page).toHaveURL(/\/verticali$/);
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
  await expect(page.getByTestId(/vertical-count-/).first()).toBeVisible();
});

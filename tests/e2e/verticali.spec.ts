import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("desktop navigation exposes Verticali and its landing page remains available", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  const verticaliLink = page.getByRole("navigation", { name: "Navigazione principale" }).getByRole("link", { name: "Verticali" });
  await expect(verticaliLink).toBeVisible();

  await verticaliLink.click();
  await expect(page).toHaveURL(/\/verticali$/);
  await expect(verticaliLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
  await expect(page.getByTestId("verticali-cards-grid")).toBeVisible();
  await expect(page.getByTestId(/vertical-card-/).first()).toBeVisible();

  const firstWorkspaceCta = page.getByRole("link", { name: "Apri verticale" }).first();
  await expect(firstWorkspaceCta).toBeVisible();
  await Promise.all([page.waitForURL(/\/verticali\/.+/), firstWorkspaceCta.click()]);

  await expect(page.getByTestId("vertical-workspace-kpi")).toBeVisible();
});

test("mobile navigation exposes Verticali and its route remains reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await page.getByText("Concessioni Portuali").first().click();
  const verticaliLink = page.getByRole("navigation", { name: "Navigazione principale" }).getByRole("link", { name: "Verticali" });
  await expect(verticaliLink).toBeVisible();

  await verticaliLink.click();
  await expect(page).toHaveURL(/\/verticali$/);
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
});

test("verticale workspace links to concessioni filtered by concessionVertical", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await page.goto("/verticali");
  const filteredLink = page.getByRole("link", { name: "Vedi concessioni" }).first();
  const href = await filteredLink.getAttribute("href");
  expect(href).toContain("/concessioni?concessionVertical=");

  await filteredLink.click();
  await expect(page).toHaveURL(/\/concessioni\?concessionVertical=/);
  await expect(page.getByTestId(/concessione-vertical-/).first()).toBeVisible();
});

test("workspace links keep vertical filter only for concessioni and use generic links elsewhere", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await page.goto("/verticali");
  await page.getByRole("link", { name: "Apri verticale" }).first().click();
  await expect(page).toHaveURL(/\/verticali\/.+/);

  await expect(page.getByTestId("workspace-links-scope-note")).toContainText(
    "Gli elenchi sono generali per il tuo perimetro di accesso e non sono filtrati per questa verticale.",
  );

  await expect(page.getByTestId("workspace-link-concessioni")).toHaveAttribute(
    "href",
    /\/concessioni\?concessionVertical=/,
  );
  await expect(page.getByTestId("workspace-link-documenti")).toHaveAttribute("href", "/documenti");
  await expect(page.getByTestId("workspace-link-report")).toHaveAttribute("href", "/report");
  await expect(page.getByTestId("workspace-link-criticita")).toHaveAttribute("href", "/criticita");
  await expect(page.getByTestId("workspace-link-scadenze")).toHaveAttribute("href", "/scadenze");
  await expect(page.getByTestId("workspace-link-procedimenti")).toHaveAttribute("href", "/procedimenti");
});

test("workspace exposes fascicolo-first actions without hiding the concession", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await page.goto("/verticali/portuale-adsp");
  const item = page.getByTestId("vertical-concessione-item").filter({ has: page.getByText("1 fascicolo", { exact: true }) }).first();
  await expect(item.getByRole("link", { name: "Apri fascicolo" })).toHaveAttribute("href", /\/procedimenti\/.+/);
  await expect(item.getByRole("link", { name: "Apri concessione" })).toHaveAttribute("href", /\/concessioni\/.+/);
  await expect(page.getByTestId("vertical-multiple-fascicoli").first().getByRole("link", { name: "Apri fascicolo" }).first()).toHaveAttribute("href", /\/procedimenti\/.+/);
});

test("viewer adsp can access /verticali in read-only with scoped data", async ({ page }) => {
  await loginAndExpectLanding(page, "viewer.adsp.demo@concessioni.local", "adsp123", /\/adsp$/);

  await page.goto("/verticali");
  await expect(page).toHaveURL(/\/verticali$/);
  await expect(page.getByRole("heading", { name: "Verticali", exact: true })).toBeVisible();
  await expect(page.getByTestId(/vertical-count-/).first()).toBeVisible();
});

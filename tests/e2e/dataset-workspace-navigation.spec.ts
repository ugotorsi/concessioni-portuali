import { expect, test } from "playwright/test";

import { loginAndExpectLanding } from "./helpers/auth";

const WORKSPACE_COOKIE = "noetra.dataset-workspace";

async function ensureProfessionalWorkspace(page: import("playwright/test").Page) {
  const synthetic = page.getByRole("button", { name: "Collaudo sintetico" });
  if (await synthetic.isVisible()) {
    await synthetic.click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  await expect(page.getByRole("button", { name: "Dati professionali" })).toBeVisible();
}

test("keeps the synthetic dataset workspace across prefetched navigation", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
  await ensureProfessionalWorkspace(page);

  const fascicoliLink = page.getByRole("link", { name: "Fascicoli", exact: true });
  await expect(page.getByRole("button", { name: "Dati professionali" })).toBeVisible();
  await fascicoliLink.hover();
  await page.waitForTimeout(1_000);

  await page.getByRole("button", { name: "Dati professionali" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Collaudo sintetico" })).toBeVisible();

  const selectedCookie = (await page.context().cookies())
    .find((cookie) => cookie.name === WORKSPACE_COOKIE);
  expect(selectedCookie).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Strict",
  });

  await fascicoliLink.click();
  await expect(page).toHaveURL(/\/procedimenti$/);
  await expect(page.getByRole("button", { name: "Collaudo sintetico" })).toBeVisible();
  await expect(page.getByText("Totale fascicoli").locator("..")).toContainText("9");
  await expect(page.getByText("Fascicolo intake E2E", { exact: true })).toBeVisible();

  const detailHref = await page.getByRole("table").locator('a[href^="/procedimenti/"]')
    .first()
    .getAttribute("href");
  expect(detailHref).toMatch(/^\/procedimenti\/[^?]+$/);

  for (const path of [
    detailHref as string,
    "/documenti",
    "/ai",
    "/legal-research/assisted-verification",
    "/report",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Collaudo sintetico" })).toBeVisible();
  }

  const persistedCookie = (await page.context().cookies())
    .find((cookie) => cookie.name === WORKSPACE_COOKIE);
  expect(persistedCookie?.value).toBe(selectedCookie?.value);
});

test("refreshes an existing tab after the workspace changes in another tab", async ({
  page,
}) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
  await ensureProfessionalWorkspace(page);
  await page.goto("/procedimenti");
  await expect(page.getByRole("button", { name: "Dati professionali" })).toBeVisible();

  const selectorPage = await page.context().newPage();
  await selectorPage.goto("/dashboard");
  await selectorPage.getByRole("button", { name: "Dati professionali" }).click();
  await expect(selectorPage.getByRole("button", { name: "Collaudo sintetico" })).toBeVisible();

  await page.bringToFront();
  await expect(page.getByRole("button", { name: "Collaudo sintetico" })).toBeVisible();
  await expect(page.getByText("Totale fascicoli").locator("..")).toContainText("9");
});

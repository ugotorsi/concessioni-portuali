import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("backoffice navigation exposes only the four primary destinations", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  const navigation = page.getByRole("navigation", { name: "Navigazione principale" });
  await expect(navigation.getByRole("link")).toHaveCount(4);

  for (const label of ["Dashboard", "Fascicoli", "Mappa", "Concessionari"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  for (const label of ["Concessioni", "Scadenze", "Criticità", "Pagamenti", "Sopralluoghi", "Verticali", "Documenti", "Normativa", "Report", "Audit", "Runtime", "Orchestrazione", "Scenari demo", "Demo guidata"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
});

test("dashboard attention cards are accessible links to filtered operational views", async ({ page }) => {
  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await expect(page.getByRole("link", { name: /^Scadenza entro 90 giorni:/ })).toHaveAttribute("href", "/scadenze?periodo=ENTRO_90_GIORNI");
  await expect(page.getByRole("link", { name: /^Criticità urgenti:/ })).toHaveAttribute("href", "/criticita?gravita=URGENTE");
  await expect(page.getByRole("link", { name: /^Morosità aperte:/ })).toHaveAttribute("href", "/pagamenti?criticita=MOROSITA");
  await expect(page.getByRole("link", { name: /^Procedimenti in corso:/ })).toHaveAttribute("href", "/procedimenti?stato=IN_CORSO");

  for (const removedSection of ["Criticità prioritarie", "Scadenze imminenti", "Morosità e pagamenti critici", "Azioni consigliate"]) {
    await expect(page.getByText(removedSection, { exact: true })).toHaveCount(0);
  }
});

test("viewer navigation remains role-aware and minimal", async ({ page }) => {
  await loginAndExpectLanding(page, "viewer.adsp.demo@concessioni.local", "adsp123", /\/adsp$/);

  const navigation = page.getByRole("navigation", { name: "Navigazione principale" });
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await expect(navigation.getByRole("link", { name: "Portale AdSP", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Mappa", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Fascicoli", exact: true })).toHaveCount(0);
});
import { expect, test } from "playwright/test";

import { loginAndExpectLanding } from "../e2e/helpers/auth";

const runId = process.env.NOETRA_GUIDED_E2E_RUN_ID;
if (!runId || !/^[a-z0-9-]{1,24}$/.test(runId)) {
  throw new Error("A unique isolated workflow run ID is required.");
}

const procedimentoId = `e2e-guided-${runId}-porto-aurora`;

test.beforeEach(async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
});

test("fascicolo AI and service status stay clear and fail-closed", async ({ page }) => {
  await page.goto(`/procedimenti/${procedimentoId}?section=analysis`);

  await expect(page.getByRole("heading", { name: "AI del fascicolo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aggiorna fascicolo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interroga AI" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ricerca e aggiornamento giuridico" })).toBeVisible();
  await expect(page.getByText("AI non operativa", { exact: true })).toBeVisible();
  await expect(page.getByText("Il comando generale AI è disattivato.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Aggiorna fascicolo", exact: true })).toHaveCount(0);

  const prepareQuestion = page.getByRole("link", { name: "Prepara il quesito" });
  await expect(prepareQuestion).toHaveAttribute(
    "href",
    `/procedimenti/${procedimentoId}?section=research#interroga-ai`,
  );
  await prepareQuestion.click();
  await expect(page.getByRole("heading", { name: "Interroga AI sul fascicolo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salva quesito" })).toBeVisible();

  await page.goto("/admin/runtime");
  await expect(page.getByRole("heading", { name: "Quadro operativo immediato" })).toBeVisible();
  await expect(page.getByText("AI", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Provider", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Worker e coda", { exact: true })).toBeVisible();
  await expect(page.getByText("Ricerca", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Percorso guidato di attivazione" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Budget, consumi e blocchi" })).toBeVisible();
});

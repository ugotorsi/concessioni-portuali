import { expect, test } from "playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin uploads and downloads a fascicolo document", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/documenti");
  await expect(page.getByRole("heading", { name: "Fascicolo documentale" }).first()).toBeVisible();

  const tmpDir = await mkdtemp(path.join(tmpdir(), "cp-doc-e2e-"));
  const filePath = path.join(tmpDir, "verbale-upload-e2e.txt");
  const uniqueTitle = `Verbale upload E2E ${Date.now()}`;
  await writeFile(filePath, "Documento E2E baseline fascicolo");

  const uploadForm = page.locator("form", {
    has: page.getByRole("button", { name: "Carica documento" }),
  }).first();

  await uploadForm.locator('input[name="file"]').setInputFiles(filePath);
  await uploadForm.locator('input[name="nome"]').fill(uniqueTitle);
  await uploadForm.locator('select[name="tipologia"]').selectOption("VERBALE");
  await uploadForm.locator('select[name="direzione"]').selectOption("ENTRATA");
  await uploadForm.locator('select[name="canale"]').selectOption("PEC");
  await uploadForm.locator('input[name="numeroProtocollo"]').fill(`PG/2026/${Date.now()}`);
  await uploadForm.locator('input[name="dataProtocollo"]').fill("2026-03-10");
  await uploadForm.locator('input[name="pecMessageId"]').fill(`<e2e-${Date.now()}@pec.demo>`);
  await uploadForm.locator('input[name="pecRicevutaAccettazioneId"]').fill("ACC-E2E-001");
  await uploadForm.locator('select[name="concessioneId"]').selectOption({ index: 1 });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    uploadForm.getByRole("button", { name: "Carica documento" }).click(),
  ]);

  await expect(page).toHaveURL(/\/documenti$/);
  await page.locator('input[name="search"]').fill(uniqueTitle);
  await page.getByRole("button", { name: "Applica" }).click();
  const uploadedRow = page.locator("tr", { hasText: uniqueTitle }).first();
  await expect(uploadedRow).toBeVisible({ timeout: 20000 });
  await expect(uploadedRow).toContainText("Warning PEC");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    uploadedRow.getByRole("link", { name: "Scarica" }).click(),
  ]);

  expect(download.suggestedFilename().toLowerCase()).toContain("verbale");
});

test("viewer adsp can consult document register without upload controls", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/documenti");
  await expect(page).toHaveURL(/\/documenti$/);
  await expect(page.getByRole("heading", { name: "Fascicolo documentale" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Carica documento" })).toHaveCount(0);
});

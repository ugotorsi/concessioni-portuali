import { expect, test } from "playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loginAndExpectLanding } from "./helpers/auth";

test("admin uploads and downloads a fascicolo document", async ({ page }, testInfo) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/documenti");
  await expect(page.getByRole("heading", { name: "Fascicolo documentale" }).first()).toBeVisible();

  const uniqueToken = `${Date.now()}-w${testInfo.workerIndex}-r${testInfo.retry}`;
  const tmpDir = await mkdtemp(path.join(tmpdir(), "cp-doc-e2e-"));
  const filePath = path.join(tmpDir, `verbale-upload-e2e-${uniqueToken}.txt`);
  const uniqueTitle = `Verbale upload E2E ${uniqueToken}`;
  await writeFile(filePath, "Documento E2E baseline fascicolo");

  const uploadForm = page.locator("form", {
    has: page.getByRole("button", { name: "Carica documento" }),
  }).first();

  await uploadForm.locator('input[name="file"]').setInputFiles(filePath);
  await uploadForm.locator('input[name="nome"]').fill(uniqueTitle);
  await uploadForm.locator('select[name="tipologia"]').selectOption("VERBALE");
  await uploadForm.locator('select[name="source"]').selectOption("UPLOAD_UTENTE");
  await uploadForm.locator('select[name="status"]').selectOption("ATTIVO");
  await uploadForm.locator('select[name="direzione"]').selectOption("ENTRATA");
  await uploadForm.locator('select[name="canale"]').selectOption("PEC");
  await uploadForm.locator('input[name="numeroProtocollo"]').fill(`PG/2026/${Date.now()}`);
  await uploadForm.locator('input[name="dataProtocollo"]').fill("2026-03-10");
  await uploadForm.locator('input[name="pecMessageId"]').fill(`<e2e-${Date.now()}@pec.demo>`);
  await uploadForm.locator('input[name="pecRicevutaAccettazioneId"]').fill("ACC-E2E-001");

  const concessioneSelect = uploadForm.locator('select[name="concessioneId"]');
  const concessioneId = await concessioneSelect.evaluate((selectElement) => {
    const options = Array.from((selectElement as HTMLSelectElement).options);
    const firstUsable = options.find((option) => option.value.trim().length > 0);
    return firstUsable?.value ?? "";
  });
  expect(concessioneId).not.toBe("");
  await concessioneSelect.selectOption(concessioneId);

  await Promise.all([
    page.waitForResponse(
      (response) => {
        if (response.request().method() !== "POST") {
          return false;
        }
        const url = new URL(response.url());
        return url.pathname === "/documenti";
      },
      { timeout: 20000 },
    ),
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
  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/documenti");
  await expect(page).toHaveURL(/\/documenti$/);
  await expect(page.getByRole("heading", { name: "Fascicolo documentale" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Carica documento" })).toHaveCount(0);
});

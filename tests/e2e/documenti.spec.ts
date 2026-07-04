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
  await writeFile(filePath, "Documento E2E baseline fascicolo");

  await page.locator('input[name="file"]').first().setInputFiles(filePath);
  await page.locator('input[name="nome"]').first().fill("Verbale upload E2E");
  await page.locator('select[name="tipologia"]').first().selectOption("VERBALE");
  await page.locator('select[name="concessioneId"]').first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Carica documento" }).first().click();

  await expect(page).toHaveURL(/\/documenti$/);
  await expect(page.getByText("Verbale upload E2E").first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Scarica" }).first().click(),
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

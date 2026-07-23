import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("audit page access and report validation audit events", async ({ page }) => {
  test.setTimeout(90000);

  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/report");
  await page.getByRole("link", { name: "Apri report" }).first().click();

  const validateButton = page.getByRole("button", { name: "Valida report" });
  const unvalidateButton = page.getByRole("button", { name: "Rimuovi validazione" });

  await page.waitForSelector('button:has-text("Valida report"), button:has-text("Rimuovi validazione")');

  if (await validateButton.isVisible()) {
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      validateButton.click(),
    ]);
  } else {
    await expect(unvalidateButton).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      unvalidateButton.click(),
    ]);
  }

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Scarica PDF istituzionale" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^report-istituzionale-.*\.pdf$/);

  await page.goto("/audit", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByRole("heading", { name: "Ultimi eventi audit" })).toBeVisible();
  await expect(page.getByText(/REPORT_VALIDATE|REPORT_UNVALIDATE/).first()).toBeVisible();
  await expect(page.getByText("REPORT_PDF_DOWNLOAD").first()).toBeVisible();

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/audit", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/adsp$/);
});

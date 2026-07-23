import { expect, test } from "playwright/test";
import { Pool } from "pg";
import { loginAndExpectLanding } from "./helpers/auth";

async function createUnvalidatedReport() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://concessioni:concessioni@localhost:5433/concessioni_portuali?schema=public";

  const pool = new Pool({ connectionString: databaseUrl });
  const reportId = `e2e-report-${Date.now()}`;
  const legacyDate = new Date("2000-01-01T00:00:00.000Z");

  try {
    await pool.query(
      `
        INSERT INTO "Report" ("id", "tipologia", "titolo", "contenuto", "formato", "validato", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        reportId,
        "REPORT_CRITICITA",
        `Report E2E PDF non validato ${Date.now()}`,
        "Report di test e2e per verifica policy download PDF.",
        "PDF",
        false,
        legacyDate,
        legacyDate,
      ],
    );

    return reportId;
  } finally {
    await pool.end();
  }
}

async function setReportValidation(reportId: string, validato: boolean) {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://concessioni:concessioni@localhost:5433/concessioni_portuali?schema=public";

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(
      `
        UPDATE "Report"
        SET "validato" = $2, "updatedAt" = NOW()
        WHERE "id" = $1
      `,
      [reportId, validato],
    );
  } finally {
    await pool.end();
  }
}

test("pdf report access policy by role and validation", async ({ page }) => {
  const reportId = await createUnvalidatedReport();
  await setReportValidation(reportId, false);

  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto(`/report/${reportId}`);

  const pdfLink = page.getByRole("link", { name: "Scarica PDF istituzionale" });
  await expect(pdfLink).toBeVisible();

  const pdfPath = await pdfLink.getAttribute("href");
  expect(pdfPath).toBeTruthy();

  const adminPdfResponse = await page.request.get(pdfPath as string);
  expect(adminPdfResponse.status()).toBe(200);
  expect(adminPdfResponse.headers()["content-type"]).toContain("application/pdf");
  const adminPdfBody = await adminPdfResponse.body();
  expect(adminPdfBody.byteLength).toBeGreaterThan(3500);

  const validateButton = page.getByRole("button", { name: "Valida report" });
  const unvalidateButton = page.getByRole("button", { name: "Rimuovi validazione" });
  const hasValidateControl =
    (await validateButton.isVisible().catch(() => false)) || (await unvalidateButton.isVisible().catch(() => false));
  expect(hasValidateControl).toBe(true);

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await setReportValidation(reportId, false);

  const adspPdfResponse = await page.request.get(pdfPath as string);
  expect(adspPdfResponse.status()).toBe(403);
  expect(await adspPdfResponse.text()).toContain("Forbidden");
});

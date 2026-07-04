import { expect, test } from "playwright/test";
import { Pool } from "pg";

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

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("pdf report access policy by role and validation", async ({ page }) => {
  const reportId = await createUnvalidatedReport();

  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(`/report/${reportId}`);

  const pdfLink = page.getByRole("link", { name: "Scarica PDF istituzionale" });
  await expect(pdfLink).toBeVisible();

  const pdfPath = await pdfLink.getAttribute("href");
  expect(pdfPath).toBeTruthy();

  await expect(page.getByRole("button", { name: "Valida report" })).toBeVisible();

  await page.goto("/logout");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  const response = await page.goto(pdfPath as string);
  expect(response?.status()).toBe(403);
  await expect(page.getByText("Forbidden")).toBeVisible();
});

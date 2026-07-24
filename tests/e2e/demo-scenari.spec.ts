import { expect, test } from "playwright/test";
import { loginAndExpectLanding } from "./helpers/auth";

test("admin visualizza i 6 scenari demo istituzionali", async ({ page }) => {
  await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);

  await page.goto("/demo-scenari");
  await expect(page).toHaveURL(/\/demo-scenari$/);

  await expect(page.getByRole("heading", { name: "Scenari demo istituzionali" }).first()).toBeVisible();

  await expect(page.getByTestId("demo-scenario-card-morosita-art47")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-occupazione-difforme")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-regolarizzazione-pre-provvedimento")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-contraddittorio-incompleto")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-istanza-parte-art10bis")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-comune-costiero-stagionale")).toBeVisible();

  await expect(page.getByTestId("demo-scenario-vertical-comune-costiero-stagionale")).toContainText(
    "Turistico-ricreativa / Comune costiero",
  );

  const reportLink = page
    .getByTestId("demo-scenario-card-morosita-art47")
    .getByRole("link", { name: "Apri report" });

  await expect(reportLink).toBeVisible();
  await expect(reportLink).toHaveAttribute("href", /\/report\/.+/);
  await Promise.all([
    page.waitForURL(/\/report\/.+/),
    reportLink.click(),
  ]);
  await expect(page.getByText(/Documento istruttorio|art\. 47/i).first()).toBeVisible();
});

test("viewer adsp può consultare scenari demo in sola lettura", async ({ page }) => {
  await loginAndExpectLanding(page, "adsp@demo.local", "adsp123", /\/adsp$/);

  await page.goto("/demo-scenari");
  await expect(page).toHaveURL(/\/demo-scenari$/);
  await expect(page.getByRole("heading", { name: "Scenari demo istituzionali" }).first()).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-istanza-parte-art10bis")).toBeVisible();
  await expect(page.getByTestId("demo-scenario-card-comune-costiero-stagionale")).toBeVisible();
});

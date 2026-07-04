import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("admin consulta la demo guidata AI e naviga le slide", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/demo-guidata");
  await expect(page).toHaveURL(/\/demo-guidata$/);
  await expect(page.getByRole("heading", { name: "Demo guidata AI" }).first()).toBeVisible();
  await expect(page.getByText("Non è un gestionale. È una piattaforma intelligente di governo istruttorio delle concessioni portuali.")).toBeVisible();
  await expect(page.getByTestId("guided-demo-speaker-notes")).toBeVisible();
  await expect(page.getByTestId("guided-demo-voice-section")).toBeVisible();
  await expect(page.getByTestId("guided-demo-voice-read")).toBeVisible();
  await expect(page.getByTestId("guided-demo-narrator-mode")).toContainText("Modalità relatore AI");
  await expect(page.getByTestId("guided-demo-voice-section")).toContainText("non una semplice lettura della slide");

  await page.getByTestId("guided-demo-voice-read").click();
  await expect(page.getByTestId("guided-demo-voice-stop")).toBeVisible();

  const autoToggle = page.getByTestId("guided-demo-voice-auto-toggle");
  await autoToggle.check();
  await expect(autoToggle).toBeChecked();
  await autoToggle.uncheck();
  await expect(autoToggle).not.toBeChecked();

  await page.getByTestId("guided-demo-next").click();
  await expect(page.getByTestId("guided-demo-slide-indicator")).toContainText("2/");
  await page.getByTestId("guided-demo-prev").click();
  await expect(page.getByTestId("guided-demo-slide-indicator")).toContainText("1/");

  for (let index = 0; index < 9; index += 1) {
    await page.getByTestId("guided-demo-next").click();
  }

  const actionLink = page.getByTestId("guided-demo-action-link");
  await expect(actionLink).toBeVisible();
  await actionLink.click();
  await expect(page).toHaveURL(/\/(documenti|demo-scenari)/);
});

test("viewer AdSP può consultare la demo guidata in sola lettura", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/demo-guidata");
  await expect(page).toHaveURL(/\/demo-guidata$/);
  await expect(page.getByRole("heading", { name: "Demo guidata AI" }).first()).toBeVisible();
  await expect(page.getByTestId("guided-demo-slide-card")).toBeVisible();
});

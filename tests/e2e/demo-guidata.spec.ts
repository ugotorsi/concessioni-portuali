import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function goToSlideWithTitle(page: import("playwright/test").Page, title: string) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const currentTitle = (await page.getByTestId("guided-demo-current-title").textContent()) ?? "";
    if (currentTitle.includes(title)) {
      return;
    }

    const nextButton = page.getByTestId("guided-demo-next");
    if (await nextButton.isDisabled()) {
      break;
    }

    await nextButton.click();
  }

  throw new Error(`Slide non trovata: ${title}`);
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
  await expect(page.getByTestId("guided-demo-pause-info")).toContainText("la demo viene sospesa");

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

  await goToSlideWithTitle(page, "Il fascicolo intelligente");

  const actionLink = page.getByTestId("guided-demo-action-link");
  await expect(actionLink).toBeVisible();
  await expect(page.getByTestId("guided-demo-action-pause-open")).toContainText("sospendi demo");

  await page.goto("/demo-guidata");
  await expect(page).toHaveURL(/\/demo-guidata$/);

  await goToSlideWithTitle(page, "Supporto legale-amministrativo");
  await expect(page.getByTestId("guided-demo-current-body")).toContainText("predisposizione di atti");
  await expect(page.getByTestId("guided-demo-legal-outputs")).toContainText("Output legali assistiti");

  await goToSlideWithTitle(page, "Dalla criticità all’atto");
  await expect(page.getByTestId("guided-demo-current-body")).toContainText("percorso assistito");

  await goToSlideWithTitle(page, "Libreria atti e modelli");
  await expect(page.getByTestId("guided-demo-current-body")).toContainText("libreria di modelli amministrativi");

  await goToSlideWithTitle(page, "Controllo di coerenza dell’atto");
  await expect(page.getByTestId("guided-demo-current-body")).toContainText("Prima della firma");

  await goToSlideWithTitle(page, "Business plan: perimetro nazionale");
  await expect(page.getByTestId("guided-demo-current-body")).toContainText("mercato iniziale");
  await expect(page.getByTestId("guided-demo-business-metrics")).toContainText("16 AdSP / 62 porti");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("16 Autorità di Sistema Portuale");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("62 porti di rilievo nazionale");

  await goToSlideWithTitle(page, "Costi, tempi e ricavi");
  await expect(page.getByTestId("guided-demo-financial-rows")).toContainText("Breve periodo");
  await expect(page.getByTestId("guided-demo-financial-rows")).toContainText("Medio periodo");
  await expect(page.getByTestId("guided-demo-financial-rows")).toContainText("Lungo periodo");

  await goToSlideWithTitle(page, "Scenario ricavi");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("Scenario prudente");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("Scenario intermedio");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("Scenario esteso");

  await goToSlideWithTitle(page, "Leve di ricavo");
  await expect(page.getByTestId("guided-demo-slide-card")).toContainText("modulo legal assistant");
});

test("admin sospende su modulo e riprende la demo dalla stessa slide", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/demo-guidata");
  await expect(page).toHaveURL(/\/demo-guidata$/);

  await goToSlideWithTitle(page, "Il fascicolo intelligente");
  await expect(page.getByTestId("guided-demo-current-title")).toContainText("Il fascicolo intelligente");

  await page.getByTestId("guided-demo-action-pause-open").click();
  await expect(page).toHaveURL(/\/documenti$/);
  await expect(page.getByTestId("resume-demo-banner")).toBeVisible();

  await page.getByRole("link", { name: "Torna alla demo guidata" }).click();
  await expect(page).toHaveURL(/\/demo-guidata\?resume=1/);
  await expect(page.getByTestId("guided-demo-resume-box")).toBeVisible();
  await expect(page.getByTestId("guided-demo-resume-badge")).toContainText("Ripresa disponibile");

  await page.getByTestId("guided-demo-resume-silent").click();
  await expect(page.getByTestId("guided-demo-current-title")).toContainText("Il fascicolo intelligente");

  await page.getByTestId("guided-demo-action-pause-open").click();
  await expect(page).toHaveURL(/\/documenti$/);
  await page.getByRole("link", { name: "Torna alla demo guidata" }).click();
  await expect(page).toHaveURL(/\/demo-guidata\?resume=1/);
  await expect(page.getByTestId("guided-demo-resume-box")).toBeVisible();

  await page.getByTestId("guided-demo-restart").click();
  await expect(page.getByTestId("guided-demo-slide-indicator")).toContainText("1/");
});

test("viewer AdSP può consultare la demo guidata in sola lettura", async ({ page }) => {
  await login(page, "adsp@demo.local", "adsp123");
  await expect(page).toHaveURL(/\/adsp$/);

  await page.goto("/demo-guidata");
  await expect(page).toHaveURL(/\/demo-guidata$/);
  await expect(page.getByRole("heading", { name: "Demo guidata AI" }).first()).toBeVisible();
  await expect(page.getByTestId("guided-demo-slide-card")).toBeVisible();

  await goToSlideWithTitle(page, "Il fascicolo intelligente");
  await expect(page.getByTestId("guided-demo-current-title")).toContainText("Il fascicolo intelligente");
  await page.getByTestId("guided-demo-action-pause-open").click();
  await expect(page).toHaveURL(/\/documenti$/);
  await expect(page.getByTestId("resume-demo-banner")).toBeVisible();

  await page.getByRole("link", { name: "Torna alla demo guidata" }).click();
  await expect(page).toHaveURL(/\/demo-guidata\?resume=1/);
  await expect(page.getByTestId("guided-demo-resume-box")).toBeVisible();

  await page.getByTestId("guided-demo-resume-silent").click();
  await expect(page.getByTestId("guided-demo-current-title")).toContainText("Il fascicolo intelligente");
});

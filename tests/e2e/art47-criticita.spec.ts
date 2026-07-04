import { expect, test } from "playwright/test";

async function login(page: import("playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

test("create criticita with Art.47 mapping", async ({ page }) => {
  await login(page, "admin@demo.local", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/criticita/nuova");
  await expect(page).toHaveURL(/\/criticita\/nuova$/);

  await page.locator("#concessioneId").selectOption({ index: 1 });
  await page.locator("#tipologia").selectOption("MOROSITA");
  await page.locator("#gravita").selectOption("ALTA");
  await page.locator("#fonte").selectOption("VERIFICA_DOCUMENTALE");

  await page.locator("#descrizione").fill(`Morosita persistente con profilo istruttorio ex art. 47. ${Date.now()}`);
  await page.locator("#noteIstruttorie").fill("Avviare approfondimento con diffida.");

  await page.locator("#rilevanzaArt47").selectOption("true");
  await page.locator("#letteraArt47").selectOption("D_OMESSO_PAGAMENTO_CANONE");
  await page.locator("#rischioDecadenza").selectOption("ALTO");
  await page.locator("#motivazioneArt47").fill("Persistenza morosita su canoni dovuti in assenza di piano rispettato.");
  await page.locator("#azioneIstruttoriaArt47").fill("Predisporre contraddittorio e verifica presupposti.");

  await page.locator("#regolarizzata").selectOption("true");
  await page.locator("#dataRegolarizzazione").fill("2026-06-20");
  await page.locator("#esitoRegolarizzazione").selectOption("COMPLETA");
  await page.locator("#verificataRegolarizzazione").selectOption("true");
  await page.locator("#descrizioneRegolarizzazione").fill("Versato il residuo con quietanza protocollata e piano rientro chiuso.");
  await page.locator("#dataVerificaRegolarizzazione").fill("2026-06-25");
  await page.locator("#noteVerificaRegolarizzazione").fill("Verifica amministrativa completata con esito favorevole.");

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.getByRole("button", { name: "Salva criticita" }).click(),
  ]);

  await expect(page).toHaveURL(/\/criticita\/(?!nuova$)[^/]+$/, { timeout: 30000 });
  await expect(page.getByRole("heading", { name: "Dettaglio criticità" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mapping art. 47 Cod. Nav." })).toBeVisible();
  await expect(page.getByText("Rilevante")).toBeVisible();
  await expect(page.getByText(/Lettera d/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Regolarizzazione / sanatoria" })).toBeVisible();
  await expect(page.getByText("Regolarizzata")).toBeVisible();
});

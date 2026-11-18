import { expect, test } from "playwright/test";
import { Pool } from "pg";

import { loginAndExpectLanding } from "./helpers/auth";

interface ScenarioSeed {
  procedimentoId: string;
  concessioneId: string;
  documentoId: string;
}

function getPool() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://concessioni:concessioni@localhost:5433/concessioni_portuali?schema=public";

  return new Pool({ connectionString: databaseUrl });
}

async function seedScenario(input: {
  tipologiaProcedimento: "AVVIO_DECADENZA" | "AVVIO_REVOCA";
  propostaEsito: "DECADENZA_DA_VALUTARE" | "REVOCA_DA_VALUTARE";
}): Promise<ScenarioSeed> {
  const pool = getPool();

  const procedimentoId = `e2e-proc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const documentoId = `e2e-doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  try {
    const concessioneResult = await pool.query<{ id: string; enteId: string }>(
      `SELECT "id", "enteId" FROM "Concessione" WHERE "enteId" IS NOT NULL AND "stato" NOT IN ('DECADUTA', 'REVOCATA', 'ARCHIVIATA') ORDER BY "createdAt" ASC LIMIT 1`,
    );

    const concessione = concessioneResult.rows[0];
    if (!concessione) {
      throw new Error("No concessione found in seed data.");
    }
    const concessioneId = concessione.id;

    await pool.query(
      `
        INSERT INTO "Procedimento" (
          "id", "enteId", "concessioneId", "tipologia", "stato", "checklistContraddittorioCompleta", "propostaEsitoIstruttorio",
          "responsabileProcedimentoNome", "unitaOrganizzativaResponsabile", "responsabileAssegnatoAt", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), NOW())
      `,
      [
        procedimentoId,
        concessione.enteId,
        concessioneId,
        input.tipologiaProcedimento,
        "IN_CORSO",
        true,
        input.propostaEsito,
        "Responsabile E2E",
        "Ufficio procedimenti E2E",
      ],
    );

    await pool.query(
      `
        INSERT INTO "Documento" (
          "id", "nome", "tipologia", "statoDocumento", "enteId", "concessioneId", "procedimentoId", "url", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `,
      [
        documentoId,
        `Atto conclusivo ${procedimentoId}`,
        "DETERMINA",
        "ATTIVO",
        concessione.enteId,
        concessioneId,
        procedimentoId,
        `/documenti/${documentoId}/download`,
      ],
    );

    return {
      procedimentoId,
      concessioneId,
      documentoId,
    };
  } finally {
    await pool.end();
  }
}

async function executeDecisionFlow(input: {
  page: import("playwright/test").Page;
  scenario: ScenarioSeed;
  decisionType: "DECADENZA_DICHIARATA" | "REVOCA_DISPOSTA";
  expectedConcessioneStateLabel: "Decaduta" | "Revocata";
}) {
  const errors: string[] = [];
  input.page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  input.page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await input.page.goto(`/procedimenti/${input.scenario.procedimentoId}?section=decisione`);
  await expect(input.page.getByRole("heading", { name: "Provvedimento finale registrato" })).toBeVisible();
  await expect(input.page.getByText(/proposta istruttoria/i).first()).toBeVisible();
  await expect(input.page.getByText(/non costituisce adozione/i).first()).toBeVisible();

  await expect(input.page.getByText(/Documenti demo/i)).toHaveCount(0);

  await input.page.locator('select[name="decisionType"]').selectOption(input.decisionType);
  await input.page.locator('select[name="documentoId"]').selectOption(input.scenario.documentoId);
  await input.page.locator('input[name="numeroAtto"]').fill(`ATTO-${Date.now()}`);
  await input.page.locator('input[name="protocolloAtto"]').fill(`PROT-${Date.now()}`);
  await input.page.locator('input[name="dataAtto"]').fill("2026-07-10");
  await input.page.locator('input[name="dataEfficacia"]').fill("2026-07-11");
  await input.page.locator('input[name="organoCompetente"]').fill("Comitato di Gestione");
  await input.page.locator('textarea[name="motivazioneSintetica"]').fill("Decisione conclusiva formalizzata su istruttoria completa.");

  await Promise.all([
    input.page.waitForResponse((response) => response.request().method() === "POST"),
    input.page.getByRole("button", { name: "Conferma registrazione provvedimento" }).click(),
  ]);

  await expect(input.page).toHaveURL(new RegExp(`/procedimenti/${input.scenario.procedimentoId}$`));
  await input.page.goto(`/procedimenti/${input.scenario.procedimentoId}?section=decisione`);
  await expect(input.page.getByText("Provvedimento registrato (sola lettura)")).toBeVisible();
  await expect(input.page.getByText("Comitato di Gestione")).toBeVisible();
  await expect(input.page.getByText(/stato concessione/i).first()).toBeVisible();

  await input.page.goto(`/concessioni/${input.scenario.concessioneId}`);
  await expect(input.page.getByRole("heading", { name: "Ultimo evento decisionale conclusivo" })).toBeVisible();
  await expect(input.page.getByText(input.expectedConcessioneStateLabel).first()).toBeVisible();

  await input.page.goto("/audit");
  await expect(input.page.getByText("DECISIONE_REGISTRATA").first()).toBeVisible();

  const severeErrors = errors.filter((item) => !/favicon|ResizeObserver loop limit exceeded/i.test(item));
  expect(severeErrors).toEqual([]);
}

test("decisione conclusiva decadenza desktop", async ({ page }) => {
  const scenario = await seedScenario({
    tipologiaProcedimento: "AVVIO_DECADENZA",
    propostaEsito: "DECADENZA_DA_VALUTARE",
  });

  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await executeDecisionFlow({
    page,
    scenario,
    decisionType: "DECADENZA_DICHIARATA",
    expectedConcessioneStateLabel: "Decaduta",
  });
});

test("decisione conclusiva revoca mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const scenario = await seedScenario({
    tipologiaProcedimento: "AVVIO_REVOCA",
    propostaEsito: "REVOCA_DA_VALUTARE",
  });

  await loginAndExpectLanding(page, "admin.demo@concessioni.local", "admin123", /\/dashboard$/);

  await executeDecisionFlow({
    page,
    scenario,
    decisionType: "REVOCA_DISPOSTA",
    expectedConcessioneStateLabel: "Revocata",
  });
});

import { expect, test } from "playwright/test";
import { Pool } from "pg";

import { loginAndExpectLanding } from "./helpers/auth";

test("admin refreshes and reviews a PEC receipt observation without changing core records", async ({ page }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgresql://concessioni:concessioni@localhost:5433/concessioni_portuali?schema=public" });
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const procedimentoId = `e2e-p1a-proc-${suffix}`;
  const documentoId = `e2e-p1a-doc-${suffix}`;

  try {
    const concessione = await pool.query<{ id: string; enteId: string | null }>(
      'SELECT "id", "enteId" FROM "Concessione" WHERE "enteId" IS NOT NULL LIMIT 1',
    );
    const row = concessione.rows[0];
    if (!row?.enteId) throw new Error("Missing tenant-scoped concessione fixture.");

    await pool.query(
      'INSERT INTO "Procedimento" ("id", "concessioneId", "tipologia", "stato", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, NOW(), NOW())',
      [procedimentoId, row.id, "DIFFIDA", "IN_CORSO"],
    );
    await pool.query(
      'INSERT INTO "Documento" ("id", "nome", "tipologia", "statoDocumento", "canale", "pecWarningMancataRicevuta", "enteId", "concessioneId", "procedimentoId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())',
      [documentoId, "PEC P1-A", "NOTA", "ATTIVO", "PEC", true, row.enteId, row.id, procedimentoId],
    );

    await loginAndExpectLanding(page, "admin@demo.local", "admin123", /\/dashboard$/);
    await page.goto(`/procedimenti/${procedimentoId}`);
    await page.getByRole("button", { name: "Aggiorna osservazioni" }).click();
    await expect(page.getByText("Ricevuta PEC non registrata nel fascicolo")).toBeVisible();
    await page.getByRole("button", { name: "Valida" }).click();
    await expect(page.getByText("VALIDATO")).toBeVisible();

    const core = await pool.query(
      'SELECT "stato" FROM "Procedimento" WHERE "id" = $1',
      [procedimentoId],
    );
    expect(core.rows[0]?.stato).toBe("IN_CORSO");
  } finally {
    await pool.query('DELETE FROM "FascicoloObservation" WHERE "procedimentoId" = $1', [procedimentoId]).catch(() => undefined);
    await pool.query('DELETE FROM "Documento" WHERE "id" = $1', [documentoId]).catch(() => undefined);
    await pool.query('DELETE FROM "Procedimento" WHERE "id" = $1', [procedimentoId]).catch(() => undefined);
    await pool.end();
  }
});
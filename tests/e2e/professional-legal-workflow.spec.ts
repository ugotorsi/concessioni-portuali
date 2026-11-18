import { expect, test } from "playwright/test";
import { Pool } from "pg";

import { loginAndExpectLanding } from "./helpers/auth";

test("GIURIDICO creates, versions and approves a question without starting paid research", async ({ page }) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "******localhost:5433/concessioni_portuali?schema=public" });
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const procedimentoId = `e2e-professional-question-${suffix}`;
  let questionId: string | null = null;

  try {
    const concessione = await pool.query<{ id: string; enteId: string | null }>(
      `SELECT c."id", c."enteId"
       FROM "Concessione" c
       WHERE c."enteId" IS NOT NULL
         AND c."enteId" IN (
           SELECT tm."enteId" FROM "TenantMembership" tm
           JOIN "User" u ON u."id" = tm."userId"
           WHERE u."email" = 'giuridico@demo.local'
         )
       LIMIT 1`,
    );
    const owner = concessione.rows[0];
    if (!owner?.enteId) throw new Error("Missing tenant-scoped concessione fixture.");
    await pool.query(
      'INSERT INTO "Procedimento" ("id", "enteId", "concessioneId", "tipologia", "stato", "dataAvvio", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())',
      [procedimentoId, owner.enteId, owner.id, "DIFFIDA", "IN_CORSO", "2026-11-07"],
    );

    await loginAndExpectLanding(page, "giuridico@demo.local", "giuridico123", /\/dashboard$/);
    await page.goto(`/procedimenti/${procedimentoId}?section=research`);
    await expect(page.getByText("Percorso professionale del fascicolo")).toBeVisible();
    await page.getByLabel("Tema").first().fill("Concorrenza e trasparenza");
    await page.getByLabel("Quesito giuridico").first().fill("Quali obblighi di trasparenza si applicano al procedimento?");
    await page.getByLabel("Contesto e ragione del quesito").first().fill("Valutazione professionale sul fascicolo disponibile.");
    await page.getByRole("button", { name: "Salva la bozza" }).click();
    await expect(page.getByText("Versione 1 · Bozza")).toBeVisible();

    const question = await pool.query<{ id: string }>(
      'SELECT "id" FROM "ProfessionalLegalQuestion" WHERE "procedimentoId" = $1',
      [procedimentoId],
    );
    questionId = question.rows[0]?.id ?? null;
    expect(questionId).not.toBeNull();

    await page.getByText("Crea una nuova versione").click();
    await page.getByLabel("Quesito giuridico").last().fill("Quali obblighi di trasparenza e pubblicità si applicano al procedimento?");
    await page.getByRole("button", { name: "Salva nuova versione" }).click();
    await expect(page.getByText("Versione 2 · Bozza")).toBeVisible();
    await page.getByRole("button", { name: "Approva versione 2" }).click();
    await expect(page.getByText("Versione 2 · Approvato")).toBeVisible();
    await expect(page.getByText("Autorizzazione puntuale della ricerca")).toBeVisible();
    await expect(page.getByRole("button", { name: "Autorizza e avvia questa ricerca" })).toBeVisible();

    const persisted = await pool.query<{ version: number; status: string; missions: string }>(`
      SELECT v."version", v."status",
        (SELECT COUNT(*)::text FROM "ResearchMissionRecord" m WHERE m."professionalQuestionVersionId" = v."id") AS missions
      FROM "ProfessionalLegalQuestionVersion" v
      WHERE v."questionId" = $1
      ORDER BY v."version" DESC
      LIMIT 1
    `, [questionId]);
    expect(persisted.rows[0]).toEqual({ version: 2, status: "APPROVED", missions: "0" });
  } finally {
    if (questionId) {
      await pool.query('DELETE FROM "ProfessionalLegalQuestionVersion" WHERE "questionId" = $1', [questionId]).catch(() => undefined);
      await pool.query('DELETE FROM "ProfessionalLegalQuestion" WHERE "id" = $1', [questionId]).catch(() => undefined);
    }
    await pool.query('DELETE FROM "Procedimento" WHERE "id" = $1', [procedimentoId]).catch(() => undefined);
    await pool.end();
  }
});

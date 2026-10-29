import { Pool } from "pg";

const PROCEDURE_ID = "procedimento-intake-9e04f4d4cdbf092845b57c66";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.DATABASE_URL) {
    throw new Error("SELVARA_INVENTORY_SCOPE_MISMATCH");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rootResult = await pool.query<{
      enteId: string;
      concessioneId: string | null;
    }>(
      `SELECT "enteId", "concessioneId" FROM "Procedimento" WHERE "id" = $1`,
      [PROCEDURE_ID],
    );
    const root = rootResult.rows[0];
    if (!root) throw new Error("SELVARA_PROCEDURE_NOT_FOUND");

    const columnResult = await pool.query<{
      table_name: string;
      columns: string[];
    }>(`
      SELECT table_name, array_agg(column_name ORDER BY column_name) AS columns
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('procedimentoId', 'tenantId', 'enteId', 'concessioneId')
      GROUP BY table_name
      ORDER BY table_name
    `);
    const tableCounts: Array<{
      table: string;
      count: number;
      scopeColumns: string[];
    }> = [];

    for (const entry of columnResult.rows) {
      const predicates: string[] = [];
      const values: string[] = [];
      const addPredicate = (column: string, value: string | null): void => {
        if (!entry.columns.includes(column) || !value) return;
        values.push(value);
        predicates.push(`${quoteIdentifier(column)} = $${values.length}`);
      };
      addPredicate("procedimentoId", PROCEDURE_ID);
      addPredicate("tenantId", root.enteId);
      if (!entry.columns.includes("tenantId")) addPredicate("enteId", root.enteId);
      addPredicate("concessioneId", root.concessioneId);
      if (predicates.length === 0) continue;

      const countResult = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(entry.table_name)}
         WHERE ${predicates.join(" OR ")}`,
        values,
      );
      if (countResult.rows[0].count > 0) {
        tableCounts.push({
          table: entry.table_name,
          count: countResult.rows[0].count,
          scopeColumns: entry.columns,
        });
      }
    }

    console.info(`NOETRA_SELVARA_PROMOTION_INVENTORY=${JSON.stringify({
      procedureId: PROCEDURE_ID,
      scopedTableCounts: tableCounts,
    })}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "SELVARA_INVENTORY_FAILED");
  process.exitCode = 1;
});

import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const startedAt = Date.now();

try {
  await client.connect();
  const migrationResult = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `);
  const tableResult = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const queryResult = await client.query('SELECT COUNT(*)::int AS count FROM "User"');

  console.log(JSON.stringify({
    migrations: migrationResult.rows[0].count,
    publicTables: tableResult.rows[0].count,
    userRowsReadable: Number.isInteger(queryResult.rows[0].count),
    elapsedMs: Date.now() - startedAt,
  }));
} finally {
  await client.end();
}
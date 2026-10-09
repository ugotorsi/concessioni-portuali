import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_VERCEL_ENV = "preview";
const EXPECTED_GIT_BRANCH = "e2e-unified-fascicolo-20261009";
const EXPECTED_DATABASE_HOSTNAME = "ep-wispy-breeze-ate2kt5o.c-9.us-east-1.aws.neon.tech";
const NO_STORE = { "Cache-Control": "no-store" };

interface DatabaseDiagnosticRow {
  migrationCompleted: boolean;
  columnExists: boolean;
}

function response(status: 204 | 404 | 503): Response {
  return new Response(null, { status, headers: NO_STORE });
}

export async function GET(): Promise<Response> {
  if (
    process.env.VERCEL_ENV !== EXPECTED_VERCEL_ENV
    || process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_GIT_BRANCH
  ) {
    return response(404);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return response(503);
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    return response(503);
  }

  if (hostname !== EXPECTED_DATABASE_HOSTNAME) {
    return response(503);
  }

  try {
    const rows = await prisma.$queryRaw<DatabaseDiagnosticRow[]>`
      SELECT
        EXISTS (
          SELECT 1
          FROM "_prisma_migrations"
          WHERE "migration_name" = '20261009_unified_fascicolo'
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        ) AS "migrationCompleted",
        EXISTS (
          SELECT 1
          FROM "information_schema"."columns"
          WHERE "table_schema" = 'public'
            AND "table_name" = 'Procedimento'
            AND "column_name" = 'enteId'
        ) AS "columnExists"
    `;

    if (rows.length !== 1 || !rows[0].migrationCompleted || !rows[0].columnExists) {
      return response(503);
    }

    return response(204);
  } catch {
    console.error({ event: "preview_database_diagnostic_failed" });
    return response(503);
  }
}

import "dotenv/config";

import { Pool } from "pg";

import {
  LEGACY_LEGAL_SOURCE_STATUS_MAP,
  normalizeLegacyLegalSourceStatus,
  sanitizeNormalizationErrorMessage,
  type LegacyLegalSourceStatus,
  type LegalSourceStatusNormalizationRepository,
} from "../../src/server/legal-rules/normalize-legal-source-status";

type ExistsRow = { exists: boolean };

class PostgresLegalSourceStatusRepository implements LegalSourceStatusNormalizationRepository {
  constructor(private readonly pool: Pool) {}

  async ensureLegalSourceTableExists(): Promise<boolean> {
    const result = await this.pool.query<ExistsRow>(
      `SELECT to_regclass('public."LegalSource"') IS NOT NULL AS exists`,
    );
    return result.rows[0]?.exists ?? false;
  }

  async ensureLegalSourceStatusEnumExists(): Promise<boolean> {
    const result = await this.pool.query<ExistsRow>(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LegalSourceStatus') AS exists`,
    );
    return result.rows[0]?.exists ?? false;
  }

  async hasEnumValue(value: string): Promise<boolean> {
    const result = await this.pool.query<ExistsRow>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = 'LegalSourceStatus'
          AND e.enumlabel = $1
      ) AS exists
      `,
      [value],
    );
    return result.rows[0]?.exists ?? false;
  }

  async addEnumValue(value: string): Promise<void> {
    if (!Object.values(LEGACY_LEGAL_SOURCE_STATUS_MAP).includes(value as (typeof LEGACY_LEGAL_SOURCE_STATUS_MAP)[LegacyLegalSourceStatus])) {
      throw new Error(`Unsupported enum value ${value}`);
    }

    await this.pool.query(`ALTER TYPE "LegalSourceStatus" ADD VALUE IF NOT EXISTS '${value}'`);
  }

  async countLegacyStatuses(): Promise<Record<LegacyLegalSourceStatus, number>> {
    const result = await this.pool.query<{
      vigente: string;
      superata: string;
      bozza: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE "status"::text = 'VIGENTE') AS vigente,
        COUNT(*) FILTER (WHERE "status"::text = 'SUPERATA') AS superata,
        COUNT(*) FILTER (WHERE "status"::text = 'BOZZA') AS bozza
      FROM "LegalSource"
      `,
    );

    return {
      VIGENTE: Number(result.rows[0]?.vigente ?? 0),
      SUPERATA: Number(result.rows[0]?.superata ?? 0),
      BOZZA: Number(result.rows[0]?.bozza ?? 0),
    };
  }

  async updateLegacyStatuses(mapping: Readonly<Record<LegacyLegalSourceStatus, string>>): Promise<number> {
    const updateResult = await this.pool.query(
      `
      UPDATE "LegalSource"
      SET "status" = CASE "status"::text
        WHEN 'VIGENTE' THEN $1::"LegalSourceStatus"
        WHEN 'SUPERATA' THEN $2::"LegalSourceStatus"
        WHEN 'BOZZA' THEN $3::"LegalSourceStatus"
        ELSE "status"
      END
      WHERE "status"::text IN ('VIGENTE', 'SUPERATA', 'BOZZA')
      `,
      [mapping.VIGENTE, mapping.SUPERATA, mapping.BOZZA],
    );

    return updateResult.rowCount ?? 0;
  }

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    await this.pool.query("BEGIN");
    try {
      const result = await callback();
      await this.pool.query("COMMIT");
      return result;
    } catch (error) {
      await this.pool.query("ROLLBACK");
      throw error;
    }
  }
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresLegalSourceStatusRepository(pool);

  try {
    const report = await normalizeLegacyLegalSourceStatus(repository, { dryRun: args.dryRun });
    console.log("[db-normalize] legal-source-status");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? sanitizeNormalizationErrorMessage(error.message) : "Unknown error";
  console.error("[db-normalize] failed:", message);
  process.exitCode = 1;
});
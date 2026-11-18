import { prisma } from "@/lib/prisma";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const defaultExecutor: RuntimeSqlExecutor = {
  async query<T>(sql: string, params: readonly unknown[] = []) {
    return { rows: await prisma.$queryRawUnsafe<T[]>(sql, ...params) };
  },
};

interface DatabaseIdentityRow {
  databaseName: string;
  neonProjectId: string | null;
  neonBranchId: string | null;
  neonEndpointId: string | null;
}

export type DatabaseIdentityOutcome = "MATCH" | "MISMATCH" | "NON_VERIFICABILE";

export interface DatabaseIdentityDiagnostic {
  available: boolean;
  outcome: DatabaseIdentityOutcome;
  databaseConnected: boolean;
  endpointId: string | null;
  neonProjectId: string | null;
  neonBranchId: string | null;
  databaseName: string | null;
  expectedIdentityConfigured: boolean;
}

function endpointIdFromDatabaseUrl(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const hostname = new URL(databaseUrl).hostname;
    if (!/\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(hostname)) return null;
    const endpointId = hostname.split(".", 1)[0]?.replace(/-pooler$/, "") ?? null;
    return endpointId && /^ep-[a-z0-9-]+$/.test(endpointId) ? endpointId : null;
  } catch {
    return null;
  }
}

export async function getDatabaseIdentityDiagnostic(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  executor: RuntimeSqlExecutor = defaultExecutor,
): Promise<DatabaseIdentityDiagnostic> {
  try {
    const result = await executor.query<DatabaseIdentityRow>(`
      SELECT
        current_database() AS "databaseName",
        current_setting('neon.project_id', true) AS "neonProjectId",
        current_setting('neon.branch_id', true) AS "neonBranchId",
        current_setting('neon.endpoint_id', true) AS "neonEndpointId"
    `);
    const row = result.rows[0];
    if (!row) throw new Error("DATABASE_IDENTITY_QUERY_EMPTY");

    const endpointId = row.neonEndpointId ?? endpointIdFromDatabaseUrl(environment.DATABASE_URL);
    const comparisons = [
      {
        observed: endpointId,
        expected: environment.RUNTIME_EXPECTED_NEON_ENDPOINT_ID?.trim() || null,
      },
      {
        observed: row.neonProjectId,
        expected: environment.RUNTIME_EXPECTED_NEON_PROJECT_ID?.trim()
          || environment.POSTGRES_NEON_PROJECT_ID?.trim()
          || null,
      },
      {
        observed: row.neonBranchId,
        expected: environment.RUNTIME_EXPECTED_NEON_BRANCH_ID?.trim() || null,
      },
      {
        observed: row.databaseName,
        expected: environment.RUNTIME_EXPECTED_DATABASE_NAME?.trim() || null,
      },
    ];
    const configuredComparisons = comparisons.filter(({ expected }) => expected !== null);
    const hasMismatch = configuredComparisons.some(
      ({ observed, expected }) => observed !== null && observed !== expected,
    );
    const outcome = hasMismatch
      ? "MISMATCH" as const
      : configuredComparisons.length > 0
        && configuredComparisons.every(({ observed, expected }) => observed === expected)
        ? "MATCH" as const
        : "NON_VERIFICABILE" as const;

    return {
      available: true,
      outcome,
      databaseConnected: true,
      endpointId,
      neonProjectId: row.neonProjectId,
      neonBranchId: row.neonBranchId,
      databaseName: row.databaseName,
      expectedIdentityConfigured: configuredComparisons.length > 0,
    };
  } catch {
    return {
      available: true,
      outcome: "NON_VERIFICABILE",
      databaseConnected: false,
      endpointId: null,
      neonProjectId: null,
      neonBranchId: null,
      databaseName: null,
      expectedIdentityConfigured: false,
    };
  }
}

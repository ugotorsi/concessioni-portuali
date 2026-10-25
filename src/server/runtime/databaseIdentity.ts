import { prisma } from "@/lib/prisma";
import {
  CANONICAL_IDENTITY_V3_PREVIEW_BRANCH,
  CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID,
  CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID,
} from "@/server/fascicolo-knowledge/canonicalIntegrationGate";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

const EXPECTED_NEON_PROJECT_ID = "aged-smoke-22484639";
const EXPECTED_NEON_BRANCH_ID = "br-aged-truth-atfpqdbo";
const EXPECTED_DATABASE_NAME = "neondb";

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
}

function isAuthorizedPreview(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment.NODE_ENV === "production"
    && environment.VERCEL_ENV === "preview"
    && environment.VERCEL_PROJECT_ID === CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID
    && environment.VERCEL_GIT_COMMIT_REF === CANONICAL_IDENTITY_V3_PREVIEW_BRANCH;
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
  if (!isAuthorizedPreview(environment)) {
    return {
      available: false,
      outcome: "NON_VERIFICABILE",
      databaseConnected: false,
      endpointId: null,
      neonProjectId: null,
      neonBranchId: null,
      databaseName: null,
    };
  }

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
    const observed = [
      endpointId,
      row.neonProjectId,
      row.neonBranchId,
      row.databaseName,
    ];
    const expected = [
      CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID,
      EXPECTED_NEON_PROJECT_ID,
      EXPECTED_NEON_BRANCH_ID,
      EXPECTED_DATABASE_NAME,
    ];
    const hasMismatch = observed.some((value, index) => value !== null && value !== expected[index]);
    const outcome = hasMismatch
      ? "MISMATCH" as const
      : observed.every((value, index) => value === expected[index])
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
    };
  }
}

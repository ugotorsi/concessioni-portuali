import { Client } from "pg";

export const EXPECTED_PREVIEW_ENV = "preview";
export const EXPECTED_BRANCH = "staging-operativo";
export const DEFAULT_TIMEOUT_MS = 3000;

export const READ_ONLY_SQL = {
  identity: "SELECT current_database() AS current_database, current_schema() AS current_schema",
  version: "SHOW server_version",
  prismaMigrationsPresent:
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations') AS present",
  prismaMigrationsCount: "SELECT COUNT(*)::int AS count FROM public._prisma_migrations",
  publicTablesCount:
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  targetTables:
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
  enums:
    "SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e' AND t.typname IN ('TipoDecisioneProcedimento','EffettoTitoloProcedimento','StatoEffettoProcedimento')",
  decisionColumns:
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='DecisioneProcedimento' AND column_name IN ('statoEffetto','effettoApplicatoAt','effectVersion')",
  decisionIndexesCount:
    "SELECT COUNT(*)::int AS count FROM pg_indexes WHERE schemaname='public' AND tablename='DecisioneProcedimento'",
  decisionConstraintsCount:
    "SELECT COUNT(*)::int AS count FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public' AND cl.relname='DecisioneProcedimento'",
  recordCounts: `SELECT
    CASE WHEN to_regclass('public."Ente"') IS NULL THEN NULL ELSE (SELECT COUNT(*)::int FROM public."Ente") END AS ente_count,
    CASE WHEN to_regclass('public."User"') IS NULL THEN NULL ELSE (SELECT COUNT(*)::int FROM public."User") END AS user_count,
    CASE WHEN to_regclass('public."Concessione"') IS NULL THEN NULL ELSE (SELECT COUNT(*)::int FROM public."Concessione") END AS concessione_count,
    CASE WHEN to_regclass('public."Procedimento"') IS NULL THEN NULL ELSE (SELECT COUNT(*)::int FROM public."Procedimento") END AS procedimento_count,
    CASE WHEN to_regclass('public."DecisioneProcedimento"') IS NULL THEN NULL ELSE (SELECT COUNT(*)::int FROM public."DecisioneProcedimento") END AS decisioneprocedimento_count`,
} as const;

export interface DbReconPreviewTempResult {
  connected: true;
  currentDatabase: string;
  currentSchema: string;
  postgresVersion: string;
  prismaMigrationsPresent: boolean;
  prismaMigrationsCount: number | null;
  publicTablesCount: number;
  tablesPresence: {
    Ente: boolean;
    User: boolean;
    Concessione: boolean;
    Procedimento: boolean;
    DecisioneProcedimento: boolean;
  };
  enumsPresence: {
    TipoDecisioneProcedimento: boolean;
    EffettoTitoloProcedimento: boolean;
    StatoEffettoProcedimento: boolean;
  };
  columnsPresence: {
    statoEffetto: boolean;
    effettoApplicatoAt: boolean;
    effectVersion: boolean;
  };
  decisioneProcedimentoIndexesCount: number;
  decisioneProcedimentoConstraintsCount: number;
  recordCounts: {
    Ente: number | null;
    User: number | null;
    Concessione: number | null;
    Procedimento: number | null;
    DecisioneProcedimento: number | null;
  };
}

export class ReconConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconConfigError";
  }
}

export class ReconTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconTimeoutError";
  }
}

interface PgClientLike {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  connection?: {
    stream?: {
      destroy?: () => void;
    };
  };
}

interface ReconDeps {
  clientFactory?: (config: {
    connectionString: string;
    ssl: { rejectUnauthorized: false };
    connectionTimeoutMillis: number;
    query_timeout: number;
    statement_timeout: number;
  }) => PgClientLike;
}

export function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith("SELECT") || normalized.startsWith("SHOW");
}

export function assertReadOnlyQueries(): void {
  for (const sql of Object.values(READ_ONLY_SQL)) {
    if (!isReadOnlySql(sql)) {
      throw new Error("Detected non read-only SQL in db recon queries.");
    }
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new ReconTimeoutError(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  }) as Promise<T>;
}

export function synthesizePostgresVersion(raw: string): string {
  const match = raw.match(/^PostgreSQL\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) {
    return "PostgreSQL";
  }

  return `PostgreSQL ${match[1]}`;
}

function validateDirectUrl(raw: string | undefined): string {
  if (raw === undefined) {
    throw new ReconConfigError("DIRECT_URL is missing.");
  }

  if (raw.trim().length === 0) {
    throw new ReconConfigError("DIRECT_URL is empty.");
  }

  if (raw === "[SENSITIVE]") {
    throw new ReconConfigError("DIRECT_URL placeholder is invalid.");
  }

  if (!(raw.startsWith("postgres://") || raw.startsWith("postgresql://"))) {
    throw new ReconConfigError("DIRECT_URL must use a PostgreSQL scheme.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ReconConfigError("DIRECT_URL is malformed.");
  }

  if (!parsed.hostname) {
    throw new ReconConfigError("DIRECT_URL host is missing.");
  }

  const databaseName = (parsed.pathname || "").replace(/^\//, "");
  if (!databaseName) {
    throw new ReconConfigError("DIRECT_URL database is missing.");
  }

  if (!parsed.searchParams.has("sslmode")) {
    throw new ReconConfigError("DIRECT_URL sslmode is missing.");
  }

  return raw;
}

async function safeCloseClient(client: PgClientLike): Promise<void> {
  try {
    await client.end();
  } catch {
    client.connection?.stream?.destroy?.();
  }
}

assertReadOnlyQueries();

export async function runDbReconPreviewTemp(timeoutMs = DEFAULT_TIMEOUT_MS, deps: ReconDeps = {}): Promise<DbReconPreviewTempResult> {
  const directUrl = validateDirectUrl(process.env.DIRECT_URL);
  const clientFactory = deps.clientFactory ?? ((config) => new Client(config));

  const client = clientFactory({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    client.connection?.stream?.destroy?.();
  }, timeoutMs);

  const queryReadOnly = async (sql: string) => {
    if (timedOut) {
      throw new ReconTimeoutError("DB recon timeout.");
    }

    try {
      return await client.query(sql);
    } catch (error) {
      if (timedOut) {
        throw new ReconTimeoutError("DB recon timeout.");
      }
      throw error;
    }
  };

  try {
    await client.connect();

    const identity = await queryReadOnly(READ_ONLY_SQL.identity);
    const version = await queryReadOnly(READ_ONLY_SQL.version);
    const migrationsPresent = await queryReadOnly(READ_ONLY_SQL.prismaMigrationsPresent);

    let prismaMigrationsCount: number | null = null;
    if (migrationsPresent.rows[0]?.present) {
      const migrationCount = await queryReadOnly(READ_ONLY_SQL.prismaMigrationsCount);
      prismaMigrationsCount = (migrationCount.rows[0]?.count as number) ?? null;
    }

    const publicTablesCount = await queryReadOnly(READ_ONLY_SQL.publicTablesCount);
    const targetTables = await queryReadOnly(READ_ONLY_SQL.targetTables);
    const enums = await queryReadOnly(READ_ONLY_SQL.enums);
    const columns = await queryReadOnly(READ_ONLY_SQL.decisionColumns);
    const indexesCount = await queryReadOnly(READ_ONLY_SQL.decisionIndexesCount);
    const constraintsCount = await queryReadOnly(READ_ONLY_SQL.decisionConstraintsCount);
    const recordCounts = await queryReadOnly(READ_ONLY_SQL.recordCounts);

    const tableSet = new Set<string>(targetTables.rows.map((row) => row.table_name as string));
    const enumSet = new Set<string>(enums.rows.map((row) => row.typname as string));
    const columnSet = new Set<string>(columns.rows.map((row) => row.column_name as string));

    return {
      connected: true as const,
      currentDatabase: (identity.rows[0]?.current_database as string) ?? "unknown",
      currentSchema: (identity.rows[0]?.current_schema as string) ?? "unknown",
      postgresVersion: synthesizePostgresVersion((version.rows[0]?.server_version as string) ?? ""),
      prismaMigrationsPresent: Boolean(migrationsPresent.rows[0]?.present),
      prismaMigrationsCount,
      publicTablesCount: (publicTablesCount.rows[0]?.count as number) ?? 0,
      tablesPresence: {
        Ente: tableSet.has("Ente"),
        User: tableSet.has("User"),
        Concessione: tableSet.has("Concessione"),
        Procedimento: tableSet.has("Procedimento"),
        DecisioneProcedimento: tableSet.has("DecisioneProcedimento"),
      },
      enumsPresence: {
        TipoDecisioneProcedimento: enumSet.has("TipoDecisioneProcedimento"),
        EffettoTitoloProcedimento: enumSet.has("EffettoTitoloProcedimento"),
        StatoEffettoProcedimento: enumSet.has("StatoEffettoProcedimento"),
      },
      columnsPresence: {
        statoEffetto: columnSet.has("statoEffetto"),
        effettoApplicatoAt: columnSet.has("effettoApplicatoAt"),
        effectVersion: columnSet.has("effectVersion"),
      },
      decisioneProcedimentoIndexesCount: (indexesCount.rows[0]?.count as number) ?? 0,
      decisioneProcedimentoConstraintsCount: (constraintsCount.rows[0]?.count as number) ?? 0,
      recordCounts: {
        Ente: (recordCounts.rows[0]?.ente_count as number | null) ?? null,
        User: (recordCounts.rows[0]?.user_count as number | null) ?? null,
        Concessione: (recordCounts.rows[0]?.concessione_count as number | null) ?? null,
        Procedimento: (recordCounts.rows[0]?.procedimento_count as number | null) ?? null,
        DecisioneProcedimento: (recordCounts.rows[0]?.decisioneprocedimento_count as number | null) ?? null,
      },
    };
  } catch (error) {
    if (timedOut || error instanceof ReconTimeoutError) {
      throw new ReconTimeoutError("DB recon timeout.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await safeCloseClient(client);
  }
}
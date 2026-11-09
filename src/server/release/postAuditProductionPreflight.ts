import {
  verifyAuditHashRecords,
  type AuditHashChainVerification,
  type AuditHashRecord,
} from "@/server/audit/hash";

export interface ReadOnlyQueryExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

type ReadOnlyAttestation = {
  databaseName: string;
  databaseUser: string;
  transactionReadOnly: boolean;
  roleDefaultReadOnly: boolean;
  databaseCreatePrivilege: boolean;
  schemaCreatePrivilege: boolean;
  tableWritePrivilege: boolean;
  sequenceWritePrivilege: boolean;
  roleSuperuser: boolean;
  roleBypassRls: boolean;
};

type AggregateSummary = {
  concessionCount: number;
  procedureCount: number;
  activityLogCount: number;
  normalizedDuplicateGroups: number;
  normalizedDuplicateRows: number;
  concessionsWithoutTenant: number;
};

export type PostAuditProductionPreflightResult = {
  safeToMigrate: boolean;
  concessionCount: number;
  procedureCount: number;
  activityLogCount: number;
  normalizedDuplicateGroups: number;
  normalizedDuplicateRows: number;
  concessionsWithoutTenant: number;
  auditChain: {
    valid: boolean;
    verifiedCount: number;
    issueCode: NonNullable<AuditHashChainVerification["issue"]>["code"] | null;
    issueOrdinal: number | null;
    scope: "PREEXISTING_PRODUCTION_HISTORY";
  };
};

function assertReadOnlyAttestation(attestation: ReadOnlyAttestation): void {
  if (
    !attestation.transactionReadOnly
    || !attestation.roleDefaultReadOnly
    || attestation.databaseCreatePrivilege
    || attestation.schemaCreatePrivilege
    || attestation.tableWritePrivilege
    || attestation.sequenceWritePrivilege
    || attestation.roleSuperuser
    || attestation.roleBypassRls
  ) {
    throw new Error("PRODUCTION_PREFLIGHT_ROLE_NOT_STRICTLY_READ_ONLY");
  }
}

async function verifyAuditChain(
  executor: ReadOnlyQueryExecutor,
  expectedCount: number,
  batchSize: number,
): Promise<AuditHashChainVerification> {
  let last: { createdAt: Date; id: string } | null = null;
  let previousHash: string | null = null;
  let verifiedCount = 0;
  for (;;) {
    const result: { rows: AuditHashRecord[] } = await executor.query<AuditHashRecord>(`
      SELECT
        "id", ("createdAt" AT TIME ZONE 'UTC') AS "createdAt",
        "userId", "userEmail", "userRole", "azione", "entita",
        "entitaId", "enteId", "concessioneId", "esito", "metadata", "previousHash", "currentHash"
      FROM "ActivityLog"
      WHERE (
        $1::timestamptz IS NULL
        OR "createdAt" > ($1::timestamptz AT TIME ZONE 'UTC')
        OR ("createdAt" = ($1::timestamptz AT TIME ZONE 'UTC') AND "id" > $2)
      )
      ORDER BY "createdAt" ASC, "id" ASC
      LIMIT $3
    `, [last?.createdAt ?? null, last?.id ?? "", batchSize]);
    if (result.rows.length === 0) {
      if (verifiedCount !== expectedCount) throw new Error("PRODUCTION_PREFLIGHT_AUDIT_COUNT_CHANGED");
      return { valid: true, verifiedCount, finalHash: previousHash, issue: null };
    }
    const verification = verifyAuditHashRecords(result.rows, previousHash);
    verifiedCount += verification.verifiedCount;
    if (!verification.valid) return { ...verification, verifiedCount };
    previousHash = verification.finalHash;
    const tail = result.rows.at(-1)!;
    last = { createdAt: tail.createdAt, id: tail.id };
    if (result.rows.length < batchSize) {
      if (verifiedCount !== expectedCount) throw new Error("PRODUCTION_PREFLIGHT_AUDIT_COUNT_CHANGED");
      return { valid: true, verifiedCount, finalHash: previousHash, issue: null };
    }
  }
}

export async function runPostAuditProductionPreflight(
  executor: ReadOnlyQueryExecutor,
  batchSize = 1_000,
): Promise<PostAuditProductionPreflightResult> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("PRODUCTION_PREFLIGHT_BATCH_SIZE_INVALID");
  }
  const attestationResult = await executor.query<ReadOnlyAttestation>(`
    SELECT
      current_database() AS "databaseName",
      current_user AS "databaseUser",
      current_setting('transaction_read_only') = 'on' AS "transactionReadOnly",
      COALESCE('default_transaction_read_only=on' = ANY(r.rolconfig), false)
        AS "roleDefaultReadOnly",
      has_database_privilege(current_user, current_database(), 'CREATE')
        AS "databaseCreatePrivilege",
      EXISTS (
        SELECT 1
        FROM pg_namespace n
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_toast'
          AND has_schema_privilege(current_user, n.oid, 'CREATE')
      ) AS "schemaCreatePrivilege",
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_toast'
          AND c.relkind IN ('r', 'p')
          AND has_table_privilege(
            current_user,
            c.oid,
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
      ) AS "tableWritePrivilege",
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname !~ '^pg_toast'
          AND c.relkind = 'S'
          AND has_sequence_privilege(current_user, c.oid, 'USAGE,UPDATE')
      ) AS "sequenceWritePrivilege",
      r.rolsuper AS "roleSuperuser",
      r.rolbypassrls AS "roleBypassRls"
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const attestation = attestationResult.rows[0];
  if (!attestation) throw new Error("PRODUCTION_PREFLIGHT_ROLE_ATTESTATION_MISSING");
  assertReadOnlyAttestation(attestation);

  const aggregateResult = await executor.query<AggregateSummary>(`
    WITH duplicate_groups AS (
      SELECT count(*)::integer AS row_count
      FROM "Concessione"
      WHERE "enteId" IS NOT NULL
      GROUP BY "enteId", lower(regexp_replace("numeroAtto", '\\s+', '', 'g'))
      HAVING count(*) > 1
    )
    SELECT
      (SELECT count(*)::integer FROM "Concessione") AS "concessionCount",
      (SELECT count(*)::integer FROM "Procedimento") AS "procedureCount",
      (SELECT count(*)::integer FROM "ActivityLog") AS "activityLogCount",
      (SELECT count(*)::integer FROM duplicate_groups) AS "normalizedDuplicateGroups",
      COALESCE((SELECT sum(row_count)::integer FROM duplicate_groups), 0) AS "normalizedDuplicateRows",
      (SELECT count(*)::integer FROM "Concessione" WHERE "enteId" IS NULL) AS "concessionsWithoutTenant"
  `);
  const aggregate = aggregateResult.rows[0];
  if (!aggregate) throw new Error("PRODUCTION_PREFLIGHT_AGGREGATE_MISSING");
  const auditChain = await verifyAuditChain(executor, aggregate.activityLogCount, batchSize);
  return {
    safeToMigrate:
      aggregate.normalizedDuplicateGroups === 0
      && aggregate.concessionsWithoutTenant === 0
      && auditChain.valid,
    ...aggregate,
    auditChain: {
      valid: auditChain.valid,
      verifiedCount: auditChain.verifiedCount,
      issueCode: auditChain.issue?.code ?? null,
      issueOrdinal: auditChain.issue ? auditChain.verifiedCount + 1 : null,
      scope: "PREEXISTING_PRODUCTION_HISTORY",
    },
  };
}

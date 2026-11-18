import { describe, expect, it } from "vitest";

import { computeAuditHash, type AuditHashRecord } from "@/server/audit/hash";
import {
  runPostAuditProductionPreflight,
  type ReadOnlyQueryExecutor,
  type ProductionAuditChainBaseline,
} from "@/server/release/postAuditProductionPreflight";

const baseRecord = {
  createdAt: new Date("2026-11-09T12:00:00.000Z"),
  azione: "TEST",
  entita: "Entity",
  entitaId: "entity-1",
  enteId: "tenant-1",
  concessioneId: null,
  esito: "SUCCESS" as const,
  userId: "user-1",
  userEmail: "operator@example.test",
  userRole: "ADMIN",
  metadata: { verified: true },
};

function auditRecord(previousHash: string | null): AuditHashRecord {
  const currentHash = computeAuditHash({
    ...baseRecord,
    previousHash,
    actor: {
      userId: baseRecord.userId,
      userEmail: baseRecord.userEmail,
      userRole: baseRecord.userRole,
    },
  });
  return { id: "audit-1", ...baseRecord, previousHash, currentHash };
}

function baselineFor(records: AuditHashRecord[]): ProductionAuditChainBaseline {
  const finalRecord = records.at(-1)!;
  return {
    recordCount: records.length,
    finalRecordId: finalRecord.id,
    finalHash: finalRecord.currentHash,
    algorithmCounts: {
      LEGACY_SEED_STRING_METADATA: 0,
      CANONICAL_WITHOUT_ENTE_ID: 0,
      CANONICAL_WITH_ENTE_ID: records.length,
    },
  };
}

function run(executorValue: ReadOnlyQueryExecutor, records = [auditRecord(null)]) {
  return runPostAuditProductionPreflight(executorValue, 1_000, baselineFor(records));
}

function executor(options: {
  writePrivilege?: boolean;
  duplicateGroups?: number;
  concessionsWithoutTenant?: number;
  records?: AuditHashRecord[];
  onSql?: (sql: string) => void;
} = {}): ReadOnlyQueryExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[] }> {
      options.onSql?.(sql);
      if (sql.includes("FROM pg_roles")) {
        return { rows: [{
          databaseName: "noetra_production",
          databaseUser: "noetra_readonly",
          transactionReadOnly: true,
          roleDefaultReadOnly: true,
          databaseCreatePrivilege: false,
          schemaCreatePrivilege: false,
          tableWritePrivilege: options.writePrivilege ?? false,
          sequenceWritePrivilege: false,
          roleSuperuser: false,
          roleBypassRls: false,
        } as T] };
      }
      if (sql.includes("WITH duplicate_groups")) {
        return { rows: [{
          concessionCount: 12,
          procedureCount: 8,
          activityLogCount: options.records?.length ?? 1,
          normalizedDuplicateGroups: options.duplicateGroups ?? 0,
          normalizedDuplicateRows: options.duplicateGroups ? 2 : 0,
          concessionsWithoutTenant: options.concessionsWithoutTenant ?? 0,
        } as T] };
      }
      if (sql.includes('FROM "ActivityLog"')) {
        const records = options.records ?? [auditRecord(null)];
        const lastId = String(params[1] ?? "");
        const start = lastId
          ? records.findIndex((record) => record.id === lastId) + 1
          : 0;
        const limit = Number(params[2] ?? records.length);
        return { rows: records.slice(start, start + limit) as T[] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

describe("post-audit Production preflight", () => {
  it("returns aggregate-only readiness for a valid chain and unique titles", async () => {
    const statements: string[] = [];
    await expect(run(executor({ onSql: (sql) => statements.push(sql) })))
      .resolves.toMatchObject({
      safeToMigrate: true,
      concessionCount: 12,
      procedureCount: 8,
      activityLogCount: 1,
      normalizedDuplicateGroups: 0,
      auditChain: {
        valid: true,
        verifiedCount: 1,
        algorithmCounts: {
          LEGACY_SEED_STRING_METADATA: 0,
          CANONICAL_WITHOUT_ENTE_ID: 0,
          CANONICAL_WITH_ENTE_ID: 1,
        },
        baselineAnchorVerified: true,
        issueCode: null,
        scope: "PREEXISTING_PRODUCTION_HISTORY",
      },
    });
    expect(statements.find((sql) => sql.includes('ORDER BY "createdAt" ASC')))
      .toContain('"createdAt" > ($1::timestamptz AT TIME ZONE \'UTC\')');
  });

  it("fails before reading data when the role can write", async () => {
    await expect(run(executor({ writePrivilege: true })))
      .rejects.toThrow("PRODUCTION_PREFLIGHT_ROLE_NOT_STRICTLY_READ_ONLY");
  });

  it("blocks migration on duplicates or a historical hash mismatch", async () => {
    await expect(run(executor({ duplicateGroups: 1 })))
      .resolves.toMatchObject({ safeToMigrate: false, normalizedDuplicateGroups: 1 });
    const tampered = { ...auditRecord(null), metadata: { verified: false } };
    await expect(run(
      executor({ records: [tampered] }),
      [tampered],
    ))
      .resolves.toMatchObject({
        safeToMigrate: false,
        auditChain: {
          valid: false,
          issueCode: "CURRENT_HASH_MISMATCH",
          issueOrdinal: 1,
          scope: "PREEXISTING_PRODUCTION_HISTORY",
        },
      });
  });

  it("blocks migration when historical concessions have no tenant", async () => {
    await expect(run(executor({ concessionsWithoutTenant: 1 })))
      .resolves.toMatchObject({ safeToMigrate: false, concessionsWithoutTenant: 1 });
  });

  it("blocks migration when a valid chain does not contain the approved baseline anchor", async () => {
    await expect(runPostAuditProductionPreflight(executor(), 1_000, {
      ...baselineFor([auditRecord(null)]),
      finalHash: "unapproved-hash",
    })).resolves.toMatchObject({
      safeToMigrate: false,
      auditChain: {
        valid: true,
        baselineAnchorVerified: false,
      },
    });
  });

  it("preserves cumulative algorithm counts when a later page fails", async () => {
    const first = auditRecord(null);
    const secondBase = {
      ...baseRecord,
      createdAt: new Date("2026-11-09T12:00:00.001Z"),
      entitaId: "entity-2",
      metadata: { verified: true, ordinal: 2 },
      previousHash: first.currentHash,
    };
    const second: AuditHashRecord = {
      id: "audit-2",
      ...secondBase,
      currentHash: computeAuditHash({
        ...secondBase,
        actor: {
          userId: secondBase.userId,
          userEmail: secondBase.userEmail,
          userRole: secondBase.userRole,
        },
      }),
    };
    const tamperedSecond = { ...second, metadata: { verified: false, ordinal: 2 } };

    await expect(runPostAuditProductionPreflight(
      executor({ records: [first, tamperedSecond] }),
      1,
      baselineFor([first, second]),
    )).resolves.toMatchObject({
      safeToMigrate: false,
      auditChain: {
        valid: false,
        verifiedCount: 1,
        algorithmCounts: {
          LEGACY_SEED_STRING_METADATA: 0,
          CANONICAL_WITHOUT_ENTE_ID: 0,
          CANONICAL_WITH_ENTE_ID: 1,
        },
        issueOrdinal: 2,
      },
    });
  });
});

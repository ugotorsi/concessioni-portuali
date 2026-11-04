import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";
import { stableActDraftKey } from "@/server/fascicolo-acts/model";
import { listActDrafts, saveActDraftVersion } from "@/server/fascicolo-acts/repository";
import {
  ACTIVITY_AUDIT_ACTION,
  ACTIVITY_ENTITY,
  stableActivityKey,
  type ActivitySpec,
} from "@/server/fascicolo-operational-activities/model";
import {
  appendActivityCommand,
  listOperationalActivities,
  type ActivityRepositoryContext,
  type ActivityRepositoryExecutor,
} from "@/server/fascicolo-operational-activities/repository";

const isolatedUrl = process.env.NOETRA_ISOLATED_PG_URL;
const scope = { tenantId: "tenant-test", procedimentoId: "procedure-test", concessioneId: "concession-test" };
const actor = { actorId: "operator-test", actorEmail: "operator@example.test", actorRole: "ADMIN" };
const corpusFingerprint = "c".repeat(64);

function assertIsolatedUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55432"
    || url.username !== "noetra_test" || url.pathname !== "/noetra_test_concurrency") {
    throw new Error("PostgreSQL concurrency tests require the dedicated local noetra_test_concurrency database.");
  }
}

function executor(client: Prisma.TransactionClient): ActivityRepositoryExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return { rows: await client.$queryRawUnsafe<T[]>(sql, ...params) };
    },
    listDrafts: (input) => listActDrafts(input, client),
    readCorpusFingerprint: async () => corpusFingerprint,
    audit: ({ scope: inputScope, actor: inputActor, metadata }) => createAuditLogInTransaction(client, {
      azione: ACTIVITY_AUDIT_ACTION,
      entita: ACTIVITY_ENTITY,
      entitaId: `${inputScope.procedimentoId}::${metadata.activityKey}`,
      enteId: inputScope.tenantId,
      concessioneId: inputScope.concessioneId,
      esito: "SUCCESS",
      metadata: { ...metadata },
      actor: { userId: inputActor.actorId, userEmail: inputActor.actorEmail, userRole: inputActor.actorRole },
      requestContext: { ipAddress: null, userAgent: null },
    }),
  };
}

function concurrentContext(): { context: ActivityRepositoryContext; backendIds: Set<number> } {
  const backendIds = new Set<number>();
  let arrived = 0;
  let release: () => void = () => { throw new Error("Concurrent test barrier not initialized."); };
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  return {
    backendIds,
    context: {
      read: executor(prisma),
      transaction: (operation) => runSerializableTransactionWithRetry(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        backendIds.add(rows[0].pid);
        if (arrived < 2) {
          arrived += 1;
          if (arrived === 2) release();
          await barrier;
        }
        return operation(executor(tx));
      }),
      now: () => new Date("2026-11-03T12:00:00Z"),
    },
  };
}

function spec(code: string): ActivitySpec {
  return {
    activityKey: stableActivityKey(scope.procedimentoId, "issue-test", code),
    issueSemanticKey: "issue-test",
    issueText: "Problematica di prova",
    activityCode: code,
    title: `Verifica ${code}`,
    action: "Esaminare la documentazione.",
    office: "Ufficio competente da verificare",
    requiredDocuments: [],
    completionGate: "Riscontro verificato",
    necessity: "REQUIRED",
    legalSummary: "Conclusione preliminare.",
    legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
    alternatives: [],
    documents: [],
    fingerprint: "a".repeat(64),
  };
}

function approval(code: string, requestId: string) {
  const activity = spec(code);
  return {
    scope,
    actor,
    knowledgeRevisionId: "revision-test",
    reportFingerprint: "b".repeat(64),
    specs: [activity],
    activityKey: activity.activityKey,
    expectedSpecFingerprint: activity.fingerprint,
    expectedCorpusFingerprint: corpusFingerprint,
    expectedVersion: 0,
    requestId,
    command: { kind: "APPROVE" as const, note: "Approvazione motivata.", confirmed: true as const },
    verifiedDocuments: [],
  };
}

describe.skipIf(!isolatedUrl)("concurrency on a disposable PostgreSQL cluster", () => {
  let pool: Pool;
  let prismaConfigured = false;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!isolatedUrl) throw new Error("NOETRA_ISOLATED_PG_URL is required.");
    assertIsolatedUrl(isolatedUrl);
    pool = new Pool({ connectionString: isolatedUrl });
    const identity = await pool.query<{
      database: string;
      username: string;
      port: number;
      address: string;
      tables: string;
    }>(`
      SELECT current_database() AS database, current_user AS username, inet_server_port() AS port,
        host(inet_server_addr()) AS address,
        (SELECT count(*)::text FROM information_schema.tables WHERE table_schema = 'public') AS tables
    `);
    expect(identity.rows[0]).toEqual({
      database: "noetra_test_concurrency", username: "noetra_test", port: 55432, address: "127.0.0.1", tables: "0",
    });
    await pool.query(`
      CREATE TYPE "AuditEsito" AS ENUM ('SUCCESS', 'FAILURE');
      CREATE TABLE "Concessione" ("id" text PRIMARY KEY, "enteId" text NOT NULL);
      CREATE TABLE "Procedimento" ("id" text PRIMARY KEY, "enteId" text NOT NULL, "concessioneId" text);
      CREATE TABLE "Documento" ("id" text PRIMARY KEY, "procedimentoId" text, "enteId" text, "currentFileVersionId" text);
      CREATE TABLE "DocumentFileVersion" ("id" text PRIMARY KEY, "documentId" text, "canonicalEnteId" text, "sha256" text);
      CREATE TABLE "FascicoloKnowledgeRevision" (
        "id" text PRIMARY KEY, "tenantId" text NOT NULL, "procedimentoId" text NOT NULL,
        "status" text NOT NULL, "corpusFingerprint" text NOT NULL
      );
      CREATE TABLE "StructuredFascicoloReportSnapshot" (
        "id" text PRIMARY KEY, "tenantId" text NOT NULL, "procedimentoId" text NOT NULL,
        "knowledgeRevisionId" text NOT NULL, "reportFingerprint" text NOT NULL, "status" text NOT NULL
      );
      CREATE TABLE "FascicoloOperationalProposal" (
        "id" text PRIMARY KEY, "tenantId" text, "procedimentoId" text, "status" text,
        "proposalType" text, "title" text, "knowledgeRevisionId" text, "structuredReportFingerprint" text,
        "originatingIssueSemanticKeys" text[], "proposedPayload" jsonb, "approvedPayload" jsonb,
        "reviewVersion" integer, "supersededAt" timestamp
      );
      CREATE TABLE "ActivityLog" (
        "id" text PRIMARY KEY, "userId" text, "userEmail" text, "userRole" text,
        "enteId" text, "concessioneId" text, "ipAddress" text, "userAgent" text,
        "azione" text NOT NULL, "entita" text NOT NULL, "entitaId" text, "esito" "AuditEsito" NOT NULL,
        "metadata" jsonb, "previousHash" text, "currentHash" text NOT NULL, "createdAt" timestamp(3) NOT NULL
      );
      INSERT INTO "Concessione" VALUES ('concession-test','tenant-test');
      INSERT INTO "Procedimento" VALUES ('procedure-test','tenant-test','concession-test');
      INSERT INTO "FascicoloKnowledgeRevision"
        VALUES ('revision-test','tenant-test','procedure-test','CURRENT',repeat('c',64));
      INSERT INTO "StructuredFascicoloReportSnapshot"
        VALUES ('report-test','tenant-test','procedure-test','revision-test',repeat('b',64),'CURRENT');
    `);
    process.env.DATABASE_URL = isolatedUrl;
    prismaConfigured = true;
  }, 30_000);

  afterAll(async () => {
    if (prismaConfigured) await prisma.$disconnect();
    await pool?.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("serializes the same idempotent command across independent sessions", async () => {
    const { context, backendIds } = concurrentContext();
    const input = approval("RETRY", "00000000-0000-4000-8000-000000000001");
    const [first, retry] = await Promise.all([
      appendActivityCommand(input, context),
      appendActivityCommand(input, context),
    ]);
    expect(backendIds.size).toBeGreaterThanOrEqual(2);
    expect(retry).toEqual(first);
    const record = (await listOperationalActivities(scope, context))
      .find((item) => item.activityKey === input.activityKey);
    expect(record?.history).toHaveLength(1);
  }, 30_000);

  it("rejects one of two different concurrent approvals at the same expected version", async () => {
    const { context, backendIds } = concurrentContext();
    const first = approval("CONFLICT", "00000000-0000-4000-8000-000000000002");
    const second = approval("CONFLICT", "00000000-0000-4000-8000-000000000003");
    const results = await Promise.allSettled([
      appendActivityCommand(first, context),
      appendActivityCommand(second, context),
    ]);
    expect(backendIds.size).toBeGreaterThanOrEqual(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "STALE_VERSION" } });
    const record = (await listOperationalActivities(scope, context))
      .find((item) => item.activityKey === first.activityKey);
    expect(record?.history).toHaveLength(1);
  }, 30_000);

  it("opens one persistent draft for concurrent identical creations", async () => {
    const templateKey = "REPORT_PLAN:TEST:ACTIVITY:DOCUMENT";
    const draftInput = {
      scope,
      actor,
      draftKey: stableActDraftKey(templateKey, "issue-test"),
      expectedVersion: 0,
      idempotentCreate: true,
      creationIdentity: { legacyTemplateKeys: [], ambiguousLegacyKeys: [] },
      content: {
        templateKey,
        issueSemanticKey: "issue-test",
        title: "Bozza di prova",
        body: "Contenuto da verificare.",
        status: "BOZZA" as const,
        assignee: null,
        dueDate: null,
        progress: 0,
        dependencies: [],
        attachments: [],
        changeNote: "Creazione di prova.",
      },
    };
    const [first, retry] = await Promise.all([saveActDraftVersion(draftInput), saveActDraftVersion(draftInput)]);
    expect(retry).toEqual(first);
    const drafts = await listActDrafts(scope);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].history).toHaveLength(1);
  }, 30_000);

  it("rejects a command if another session replaces its report while it waits on the revision lock", async () => {
    const writer = await pool.connect();
    let committed = false;
    try {
      await writer.query("BEGIN");
      await writer.query(`SELECT "id" FROM "FascicoloKnowledgeRevision" WHERE "id"='revision-test' FOR UPDATE`);
      await writer.query(`UPDATE "StructuredFascicoloReportSnapshot" SET "status"='SUPERSEDED' WHERE "id"='report-test'`);
      await writer.query(`
        INSERT INTO "StructuredFascicoloReportSnapshot"
        VALUES ('report-new','tenant-test','procedure-test','revision-test',repeat('d',64),'CURRENT')
      `);

      let reachedRevision: () => void = () => { throw new Error("Report race barrier not initialized."); };
      const revisionAttempt = new Promise<void>((resolve) => { reachedRevision = resolve; });
      const context: ActivityRepositoryContext = {
        read: executor(prisma),
        transaction: (operation) => runSerializableTransactionWithRetry((tx) => {
          const base = executor(tx);
          return operation({
            ...base,
            async query<T>(sql: string, params: readonly unknown[] = []) {
              if (sql.includes('FROM "FascicoloKnowledgeRevision"')) reachedRevision();
              return base.query<T>(sql, params);
            },
          });
        }),
        now: () => new Date("2026-11-03T12:00:00Z"),
      };
      const input = approval("REPORT_RACE", "00000000-0000-4000-8000-000000000004");
      const pending = appendActivityCommand(input, context).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      await revisionAttempt;
      await writer.query("COMMIT");
      committed = true;
      const result = await pending;
      expect(result).toMatchObject({ status: "rejected", reason: { code: "STALE_SPEC" } });
      const records = await listOperationalActivities(scope, context);
      expect(records.some((record) => record.activityKey === input.activityKey)).toBe(false);
    } finally {
      if (!committed) await writer.query("ROLLBACK");
      writer.release();
    }
  }, 30_000);
});

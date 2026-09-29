import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildStructuredFascicoloReport,
  listStructuredFascicoloReportSnapshots,
  markCurrentStructuredReportStale,
  persistStructuredFascicoloReport,
  type StructuredReportRepositoryContext,
  type StructuredReportSqlExecutor,
} from "@/server/fascicolo-report";
import type { StructuredKnowledgeReadModel } from "@/server/queries/fascicolo-knowledge";

const migration = readFileSync(path.join(
  process.cwd(), "prisma", "migrations", "20260929_structured_fascicolo_report", "migration.sql",
), "utf8");
const databases: PGlite[] = [];
const sha = (value: string) => value.repeat(64).slice(0, 64);

function executor(database: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }): StructuredReportSqlExecutor {
  return { query: (sql, params = []) => database.query(sql, [...params]) };
}

function context(database: PGlite): StructuredReportRepositoryContext {
  return {
    read: executor(database),
    transaction: (operation) => database.transaction((transaction) => operation(executor(transaction))),
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  };
}

async function database(): Promise<PGlite> {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TYPE "FascicoloKnowledgeRevisionStatus" AS ENUM ('BUILDING', 'CURRENT', 'SUPERSEDED');
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Concessione" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL);
    CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY, "concessioneId" TEXT NOT NULL);
    CREATE TABLE "FascicoloKnowledgeRevision" (
      "id" TEXT NOT NULL,
      "tenantId" TEXT NOT NULL,
      "procedimentoId" TEXT NOT NULL,
      "corpusFingerprint" CHAR(64) NOT NULL,
      "contractVersion" VARCHAR(64) NOT NULL,
      "status" "FascicoloKnowledgeRevisionStatus" NOT NULL,
      PRIMARY KEY ("id"),
      UNIQUE ("id", "tenantId", "procedimentoId")
    );
    INSERT INTO "Ente" VALUES ('tenant-a'), ('tenant-b');
    INSERT INTO "Concessione" VALUES ('concession-a', 'tenant-a'), ('concession-b', 'tenant-b');
    INSERT INTO "Procedimento" VALUES ('procedure-a', 'concession-a'), ('procedure-b', 'concession-b');
    INSERT INTO "FascicoloKnowledgeRevision" VALUES
      ('revision-a', 'tenant-a', 'procedure-a', '${sha("a")}', 'FASCICOLO_KNOWLEDGE_V1', 'CURRENT'),
      ('revision-b', 'tenant-b', 'procedure-b', '${sha("b")}', 'FASCICOLO_KNOWLEDGE_V1', 'CURRENT');
  `);
  await db.exec(migration);
  return db;
}

function report(tenantId = "tenant-a", procedimentoId = "procedure-a", revisionId = "revision-a", warning = "BASELINE") {
  const corpusFingerprint = tenantId === "tenant-a" ? sha("a") : sha("b");
  const knowledge: StructuredKnowledgeReadModel = {
    revision: {
      id: revisionId,
      corpusFingerprint,
      contractVersion: "FASCICOLO_KNOWLEDGE_V1",
      createdAt: new Date("2026-09-29T10:00:00.000Z"),
      completedAt: new Date("2026-09-29T10:01:00.000Z"),
      warnings: [warning],
    },
    subjects: [], partyRoles: [], facts: [], events: [], legalActs: [], measures: [], contradictions: [],
    gaps: [], deadlineCandidates: [], legalIssues: [], researchQuestions: [], timeline: [],
  };
  return buildStructuredFascicoloReport({ tenantId, procedimentoId, knowledge, missions: [] });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("structured fascicolo report repository on disposable PGlite", () => {
  it("reuses an identical report and preserves a supersession chain on material change", async () => {
    const db = await database();
    const repository = context(db);
    const first = await persistStructuredFascicoloReport(report(), repository);
    const reused = await persistStructuredFascicoloReport(report(), repository);
    const second = await persistStructuredFascicoloReport(report("tenant-a", "procedure-a", "revision-a", "CHANGED"), repository);
    const history = await listStructuredFascicoloReportSnapshots({ tenantId: "tenant-a", procedimentoId: "procedure-a" }, repository);

    expect(first.outcome).toBe("CREATED");
    expect(reused).toMatchObject({ outcome: "REUSED", snapshot: { id: first.snapshot.id } });
    expect(second.outcome).toBe("CREATED");
    expect(history).toHaveLength(2);
    expect(history.find((snapshot) => snapshot.id === first.snapshot.id)).toMatchObject({
      status: "SUPERSEDED", supersededBySnapshotId: second.snapshot.id,
    });
    expect(history.find((snapshot) => snapshot.id === second.snapshot.id)?.status).toBe("CURRENT");
  });

  it("marks drift stale and never leaks snapshots across tenant/procedure scope", async () => {
    const db = await database();
    const repository = context(db);
    const current = await persistStructuredFascicoloReport(report(), repository);
    await persistStructuredFascicoloReport(report("tenant-b", "procedure-b", "revision-b"), repository);
    const reasons = await markCurrentStructuredReportStale({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      knowledgeRevisionId: "revision-a",
      researchStateFingerprint: sha("x"),
      sourceStateFingerprint: sha("y"),
    }, repository);
    const tenantA = await listStructuredFascicoloReportSnapshots({ tenantId: "tenant-a", procedimentoId: "procedure-a" }, repository);

    expect(reasons).toEqual(["RESEARCH_STATE_CHANGED", "SOURCE_STATE_CHANGED"]);
    expect(tenantA).toHaveLength(1);
    expect(tenantA[0]).toMatchObject({ id: current.snapshot.id, tenantId: "tenant-a", status: "STALE" });
  });
});
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FascicoloAnalysisEvaluationRepositoryError,
  persistFascicoloAnalysisEvaluationArtifact,
  type EvaluationSqlExecutor,
  type FascicoloAnalysisEvaluationArtifactInput,
  type FascicoloAnalysisEvaluationRepositoryContext,
} from "@/server/ai/fascicoloAnalysisEvaluationRepository";

const databases: PGlite[] = [];
const migration = readFileSync(path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261020_fascicolo_analysis_evaluation",
  "migration.sql",
), "utf8");

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): EvaluationSqlExecutor {
  return { query: (query, params = []) => sql.query(query, [...params]) };
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL);
    CREATE TABLE "AsyncJob" (
      "id" TEXT PRIMARY KEY,
      "tenantId" TEXT NOT NULL,
      "procedimentoId" TEXT NOT NULL
    );
    CREATE TABLE "FascicoloKnowledgeRevision" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL);
    CREATE TABLE "StructuredFascicoloReportSnapshot" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL);
    INSERT INTO "Ente" VALUES ('tenant-a'), ('tenant-b');
    INSERT INTO "Procedimento" VALUES ('procedure-a', 'tenant-a'), ('procedure-b', 'tenant-b');
    INSERT INTO "AsyncJob" VALUES
      ('job-a', 'tenant-a', 'procedure-a'),
      ('job-b', 'tenant-b', 'procedure-b');
    INSERT INTO "FascicoloKnowledgeRevision" VALUES ('revision-current', 'CURRENT');
    INSERT INTO "StructuredFascicoloReportSnapshot" VALUES ('report-current', 'CURRENT');
  `);
  await db.exec(migration);
  return db;
}

function artifact(overrides: Partial<FascicoloAnalysisEvaluationArtifactInput> = {}): FascicoloAnalysisEvaluationArtifactInput {
  return {
    evaluationId: "evaluation-test-legal-001-01",
    tenantId: "tenant-a",
    procedimentoId: "procedure-a",
    jobId: "job-a",
    actorId: "evaluation-runner",
    actorEmail: null,
    actorRole: "SYSTEM",
    authorizationRef: "approval:test-legal-001",
    testCaseId: "TEST-LEGAL-001",
    corpusFingerprint: "a".repeat(64),
    contractVersion: "FASCICOLO_DOCUMENT_ANALYSIS_V5",
    inputFingerprint: "b".repeat(64),
    outputFingerprint: "c".repeat(64),
    providerOutput: { structuredKnowledge: { items: [] } },
    provenance: [{ reference: "DOCUMENT_3.PAGE_1" }],
    comparison: { passed: true },
    maxCostAmount: 0.5,
    ...overrides,
  };
}

describe("fascicolo analysis evaluation artifact repository", () => {
  afterEach(async () => {
    await Promise.all(databases.splice(0).map((db) => db.close()));
  });

  it("persists once, reuses exact output, and rejects conflicting or cross-tenant reuse", async () => {
    const db = await database();
    const audit = vi.fn(async () => undefined);
    const context: FascicoloAnalysisEvaluationRepositoryContext = {
      transaction: (operation) => db.transaction((tx) => operation(executor(tx))),
      audit,
    };

    await expect(persistFascicoloAnalysisEvaluationArtifact(artifact(), context))
      .resolves.toEqual({ outcome: "CREATED", evaluationId: "evaluation-test-legal-001-01" });
    await expect(persistFascicoloAnalysisEvaluationArtifact(artifact(), context))
      .resolves.toEqual({ outcome: "REUSED", evaluationId: "evaluation-test-legal-001-01" });
    await expect(persistFascicoloAnalysisEvaluationArtifact(
      artifact({ outputFingerprint: "d".repeat(64) }),
      context,
    )).rejects.toEqual(new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_CONFLICT"));
    await expect(persistFascicoloAnalysisEvaluationArtifact(
      artifact({ tenantId: "tenant-b", procedimentoId: "procedure-b", jobId: "job-b" }),
      context,
    )).rejects.toEqual(new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_SCOPE_MISMATCH"));
    await expect(persistFascicoloAnalysisEvaluationArtifact(
      artifact({
        evaluationId: "evaluation-cross-tenant",
        tenantId: "tenant-a",
        procedimentoId: "procedure-b",
        jobId: "job-b",
      }),
      context,
    )).rejects.toEqual(new FascicoloAnalysisEvaluationRepositoryError("EVALUATION_SCOPE_MISMATCH"));

    const rows = await db.query<{
      evaluationId: string;
      tenantId: string;
      procedimentoId: string;
      outputFingerprint: string;
      maxCostAmount: string;
    }>(`SELECT "evaluationId","tenantId","procedimentoId","outputFingerprint","maxCostAmount"::text
       FROM "FascicoloAnalysisEvaluationArtifact"`);
    expect(rows.rows).toEqual([{
      evaluationId: "evaluation-test-legal-001-01",
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      outputFingerprint: "c".repeat(64),
      maxCostAmount: "0.500000",
    }]);
    expect(audit).toHaveBeenCalledOnce();
    expect((await db.query(`SELECT * FROM "FascicoloKnowledgeRevision"`)).rows)
      .toEqual([{ id: "revision-current", status: "CURRENT" }]);
    expect((await db.query(`SELECT * FROM "StructuredFascicoloReportSnapshot"`)).rows)
      .toEqual([{ id: "report-current", status: "CURRENT" }]);
  });
});

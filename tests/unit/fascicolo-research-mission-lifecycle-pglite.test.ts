import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  admitDeferredKnowledgeResearchMissionWave,
  reconcileKnowledgeResearchMissions,
  type KnowledgeResearchMissionPlan,
  type ResearchMissionLifecycleContext,
  type ResearchMissionLifecycleSqlExecutor,
} from "@/server/fascicolo-knowledge";
import { createResearchMission, RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";

const migration = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260929_fascicolo_research_mission_lifecycle", "migration.sql"), "utf8");
const databases: PGlite[] = [];

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): ResearchMissionLifecycleSqlExecutor {
  return { query: (query, params = []) => sql.query(query, [...params]) };
}

function context(db: PGlite): ResearchMissionLifecycleContext {
  return {
    read: executor(db),
    transaction: <T>(operation: (tx: ResearchMissionLifecycleSqlExecutor) => Promise<T>) => db.transaction((tx) => operation(executor(tx))),
  };
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TYPE "ResearchMissionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BUDGET_EXHAUSTED', 'DEFERRED', 'REJECTED');
    CREATE TABLE "FascicoloKnowledgeRevision" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "procedimentoId" TEXT NOT NULL, "status" TEXT NOT NULL
    );
    CREATE TABLE "ResearchMissionRecord" (
      "id" VARCHAR(96) PRIMARY KEY,
      "tenantId" TEXT,
      "contractVersion" VARCHAR(64) NOT NULL,
      "caseId" VARCHAR(256) NOT NULL,
      "fascicoloReference" VARCHAR(256),
      "referenceDate" TIMESTAMPTZ NOT NULL,
      "mode" VARCHAR(64) NOT NULL,
      "payload" JSONB NOT NULL,
      "payloadFingerprint" CHAR(64) NOT NULL UNIQUE,
      "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PENDING',
      "stateVersion" INTEGER NOT NULL DEFAULT 0,
      "claimantId" VARCHAR(256),
      "claimToken" CHAR(64),
      "claimExpiresAt" TIMESTAMPTZ,
      "activeExecutionId" VARCHAR(256),
      "completedAt" TIMESTAMPTZ,
      "deferredAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "ResearchEvidenceBundleRecord" (
      "id" TEXT PRIMARY KEY, "missionId" VARCHAR(96) NOT NULL, "payload" JSONB NOT NULL
    );
  `);
  await db.exec(migration);
  return db;
}

function plan(fingerprint: string, questionSemanticKey = "q".repeat(64), caseId = "procedure-1"): KnowledgeResearchMissionPlan {
  const mission = createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId, fascicoloReference: caseId },
    legalIssueIds: ["i".repeat(64)],
    legalPropositionIds: [],
    referenceDate: "2026-09-01T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "Quale disciplina si applica?",
    assumptionsFingerprint: fingerprint,
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["ITALIAN_LEGISLATION"],
    missingSourceFamilies: [],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: { authorityCandidates: true, citationObservations: false, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: false },
    budget: { maxTotalResearchCalls: 2, maxMoonlitCalls: 1, maxSimpliciterCalls: 1, maxLegalDataHunterCalls: 0 },
    status: "PENDING",
    executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"] },
  });
  return {
    questionItemId: "question-item",
    questionSemanticKey,
    legalIssueItemId: "issue-item",
    legalIssueSemanticKey: "i".repeat(64),
    originatingItemIds: ["fact-item"],
    priority: "HIGH",
    referenceDate: "2026-09-01",
    referenceDateBasis: { type: "EVENT_DATE", itemSemanticKey: "e".repeat(64), rationale: "Data documentata", userConfirmedDateSource: null },
    missionFingerprint: fingerprint,
    execution: "ADMITTED",
    blockReason: null,
    mission,
  };
}

async function setCurrent(db: PGlite, id: string, tenantId = "tenant-1", procedimentoId = "procedure-1") {
  await db.query('UPDATE "FascicoloKnowledgeRevision" SET "status" = \'SUPERSEDED\' WHERE "tenantId" = $1 AND "procedimentoId" = $2', [tenantId, procedimentoId]);
  await db.query('INSERT INTO "FascicoloKnowledgeRevision" ("id", "tenantId", "procedimentoId", "status") VALUES ($1, $2, $3, \'CURRENT\')', [id, tenantId, procedimentoId]);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("Lotto 3 research mission lifecycle on PGlite", () => {
  it("reuses an invariant fingerprint and creates a new CURRENT mission while preserving the historical bundle when assumptions change", async () => {
    const db = await database();
    const ctx = context(db);
    await setCurrent(db, "revision-1");
    const first = await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-1", plans: [plan("a".repeat(64))],
    }, ctx);
    expect(first[0].outcome).toBe("CREATED");
    await db.query('INSERT INTO "ResearchEvidenceBundleRecord" VALUES ($1, $2, $3::jsonb)', ["bundle-1", first[0].missionId, JSON.stringify({ immutable: true })]);

    await setCurrent(db, "revision-2");
    const reused = await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-2", plans: [plan("a".repeat(64))],
    }, ctx);
    expect(reused[0]).toMatchObject({ outcome: "REUSED", missionId: first[0].missionId });

    await setCurrent(db, "revision-3");
    const changed = await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-3", plans: [plan("b".repeat(64))],
    }, ctx);
    expect(changed[0].outcome).toBe("CREATED");
    expect(changed[0].missionId).not.toBe(first[0].missionId);
    const missions = await db.query<{ id: string; lifecycleStatus: string }>('SELECT "id", "lifecycleStatus" FROM "ResearchMissionRecord" ORDER BY "createdAt", "id"');
    expect(missions.rows).toEqual(expect.arrayContaining([
      { id: first[0].missionId, lifecycleStatus: "HISTORICAL" },
      { id: changed[0].missionId, lifecycleStatus: "CURRENT" },
    ]));
    const bundles = await db.query<{ missionId: string; payload: { immutable: boolean } }>('SELECT "missionId", "payload" FROM "ResearchEvidenceBundleRecord"');
    expect(bundles.rows).toEqual([{ missionId: first[0].missionId, payload: { immutable: true } }]);
    const currentBundles = await db.query<{ count: number }>(`
      SELECT count(*)::int AS "count" FROM "ResearchEvidenceBundleRecord" b
      INNER JOIN "ResearchMissionRecord" m ON m."id" = b."missionId"
      WHERE m."lifecycleStatus" = 'CURRENT'
    `);
    expect(currentBundles.rows[0].count).toBe(0);
  });

  it("creates no mission when promotion has not reached CURRENT", async () => {
    const db = await database();
    const ctx = context(db);
    await db.query('INSERT INTO "FascicoloKnowledgeRevision" VALUES ($1, $2, $3, $4)', ["revision-building", "tenant-1", "procedure-1", "BUILDING"]);
    await expect(reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-building", plans: [plan("c".repeat(64))],
    }, ctx)).rejects.toThrow("KNOWLEDGE_REVISION_NOT_CURRENT");
    const count = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "ResearchMissionRecord"');
    expect(count.rows[0].count).toBe(0);
  });

  it("keeps tenant and procedure mission lifecycles isolated", async () => {
    const db = await database();
    const ctx = context(db);
    await setCurrent(db, "revision-a", "tenant-1", "procedure-1");
    await setCurrent(db, "revision-b", "tenant-2", "procedure-2");
    await reconcileKnowledgeResearchMissions({ tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-a", plans: [plan("d".repeat(64))] }, ctx);
    await reconcileKnowledgeResearchMissions({ tenantId: "tenant-2", procedimentoId: "procedure-2", knowledgeRevisionId: "revision-b", plans: [plan("d".repeat(64), "q".repeat(64), "procedure-2")] }, ctx);
    const rows = await db.query<{ tenantId: string; caseId: string }>('SELECT "tenantId", "caseId" FROM "ResearchMissionRecord" ORDER BY "tenantId"');
    expect(rows.rows).toEqual([{ tenantId: "tenant-1", caseId: "procedure-1" }, { tenantId: "tenant-2", caseId: "procedure-2" }]);
  });

  it("persists seven missions, defers two, and admits the residual wave without duplicates", async () => {
    const db = await database();
    const ctx = context(db);
    await setCurrent(db, "revision-wave");
    const plans = Array.from({ length: 7 }, (_, index) => ({
      ...plan(String(index + 1).repeat(64), String(index + 1).repeat(64)),
      execution: index < 5 ? "ADMITTED" as const : "DEFERRED_BY_POLICY" as const,
      blockReason: index < 5 ? null : "EXECUTION_WAVE_LIMIT",
    }));
    await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-wave", plans,
    }, ctx);
    const firstWave = await db.query<{ status: string; count: number }>('SELECT "status", count(*)::int AS "count" FROM "ResearchMissionRecord" GROUP BY "status" ORDER BY "status"');
    expect(firstWave.rows).toEqual(expect.arrayContaining([{ status: "DEFERRED", count: 2 }, { status: "PENDING", count: 5 }]));
    const secondWave = await admitDeferredKnowledgeResearchMissionWave({ tenantId: "tenant-1", procedimentoId: "procedure-1", limit: 5 }, ctx);
    expect(secondWave).toHaveLength(2);
    expect(await admitDeferredKnowledgeResearchMissionWave({ tenantId: "tenant-1", procedimentoId: "procedure-1", limit: 5 }, ctx)).toHaveLength(0);
    const final = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "ResearchMissionRecord" WHERE "status" = \'PENDING\'');
    expect(final.rows[0].count).toBe(7);
  });

  it("moves all structured missions to history when the CURRENT revision has zero questions and preserves bundles", async () => {
    const db = await database();
    const ctx = context(db);
    await setCurrent(db, "revision-with-question");
    const created = await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-with-question", plans: [plan("e".repeat(64))],
    }, ctx);
    await db.query('INSERT INTO "ResearchEvidenceBundleRecord" VALUES ($1, $2, $3::jsonb)', ["bundle-zero", created[0].missionId, JSON.stringify({ immutable: true })]);
    await setCurrent(db, "revision-zero");
    expect(await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-zero", plans: [],
    }, ctx)).toEqual([]);
    const mission = await db.query<{ lifecycleStatus: string }>('SELECT "lifecycleStatus" FROM "ResearchMissionRecord" WHERE "id" = $1', [created[0].missionId]);
    expect(mission.rows[0].lifecycleStatus).toBe("HISTORICAL");
    const bundle = await db.query<{ payload: { immutable: boolean } }>('SELECT "payload" FROM "ResearchEvidenceBundleRecord" WHERE "id" = $1', ["bundle-zero"]);
    expect(bundle.rows[0].payload).toEqual({ immutable: true });
  });

  it("moves a previously valid mission to history when its question is rejected and preserves its bundle", async () => {
    const db = await database();
    const ctx = context(db);
    await setCurrent(db, "revision-valid");
    const valid = plan("f".repeat(64));
    const created = await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-valid", plans: [valid],
    }, ctx);
    await db.query('INSERT INTO "ResearchEvidenceBundleRecord" VALUES ($1, $2, $3::jsonb)', ["bundle-rejected", created[0].missionId, JSON.stringify({ immutable: true })]);
    await setCurrent(db, "revision-rejected");
    await reconcileKnowledgeResearchMissions({
      tenantId: "tenant-1", procedimentoId: "procedure-1", knowledgeRevisionId: "revision-rejected",
      plans: [{ ...valid, execution: "REJECTED", blockReason: "QUESTION_REJECTED", mission: null }],
    }, ctx);
    const mission = await db.query<{ lifecycleStatus: string }>('SELECT "lifecycleStatus" FROM "ResearchMissionRecord" WHERE "id" = $1', [created[0].missionId]);
    expect(mission.rows[0].lifecycleStatus).toBe("HISTORICAL");
    const bundle = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "ResearchEvidenceBundleRecord" WHERE "id" = $1', ["bundle-rejected"]);
    expect(bundle.rows[0].count).toBe(1);
  });
});

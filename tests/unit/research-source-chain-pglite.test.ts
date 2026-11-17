import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureAdverseResearchMission,
  completeAdverseResearchRequirement,
  initializeDiscoveredSourceAssessment,
  persistSourceChainAssessment,
  type SourceChainPersistenceContext,
  type SourceChainSqlExecutor,
} from "@/server/legal-research/source-chain-persistence";
import { SOURCE_CHAIN_VERIFICATION_VERSION, type SourceChainSnapshot } from "@/server/legal-research/source-chain";
import type { AuthorityCandidate } from "@/server/legal-research/bridge";

const resultMigration = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260929_research_question_results", "migration.sql"), "utf8");
const sourceMigration = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260929_research_source_chain", "migration.sql"), "utf8");
const databases: PGlite[] = [];

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): SourceChainSqlExecutor {
  return { query: (query, params = []) => sql.query(query, [...params]) };
}

function context(db: PGlite): SourceChainPersistenceContext {
  return { read: executor(db), transaction: (operation) => db.transaction((tx) => operation(executor(tx))) };
}

async function database(): Promise<PGlite> {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TYPE "ResearchMissionStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','BUDGET_EXHAUSTED','DEFERRED','REJECTED');
    CREATE TABLE "ResearchMissionRecord" (
      "id" VARCHAR(96) PRIMARY KEY, "tenantId" TEXT, "contractVersion" VARCHAR(64) NOT NULL,
      "caseId" VARCHAR(256) NOT NULL, "fascicoloReference" VARCHAR(256), "referenceDate" TIMESTAMPTZ NOT NULL,
      "mode" VARCHAR(64) NOT NULL, "payload" JSONB NOT NULL, "payloadFingerprint" CHAR(64) UNIQUE NOT NULL,
      "missionFingerprint" CHAR(64), "knowledgeRevisionId" TEXT, "firstKnowledgeRevisionId" TEXT,
      "legalIssueSemanticKey" CHAR(64), "researchQuestionSemanticKey" CHAR(64), "referenceDateBasis" JSONB,
      "lifecycleStatus" TEXT NOT NULL DEFAULT 'CURRENT', "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PENDING',
      UNIQUE ("id", "tenantId"), UNIQUE ("tenantId", "caseId", "missionFingerprint")
    );
    CREATE TABLE "ResearchEvidenceBundleRecord" (
      "id" VARCHAR(96) PRIMARY KEY, "missionId" VARCHAR(96) NOT NULL, "payload" JSONB NOT NULL
    );
    CREATE TABLE "LegalSource" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "LegalSourceVersion" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "LegalSourceAcquisition" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "LegalSourceTemporalAssessment" ("id" TEXT PRIMARY KEY);
  `);
  await db.exec(resultMigration);
  await db.exec(sourceMigration);
  return db;
}

async function seed(db: PGlite, input: { missionId?: string; tenantId?: string; caseId?: string; fingerprint?: string; direction?: "SUPPORTS" | "OPPOSES" } = {}) {
  const missionId = input.missionId ?? "mission-1";
  const tenantId = input.tenantId ?? "tenant-1";
  const caseId = input.caseId ?? "case-1";
  const fingerprint = input.fingerprint ?? "m".repeat(64);
  const question = "q".repeat(64);
  const payload = { kind: "RESEARCH_MISSION", missionId, mode: "DISCOVER_AUTHORITIES", researchQuestion: "Question" };
  await db.query(`INSERT INTO "ResearchMissionRecord" VALUES ($1,$2,'V1',$3,NULL,'2025-01-01T00:00:00.000Z','DISCOVER_AUTHORITIES',$4,$5,$6,'revision-1','revision-1',$7,$8,$9,'CURRENT','COMPLETED')`,
    [missionId, tenantId, caseId, JSON.stringify(payload), fingerprint.replace(/m/g, "p"), fingerprint, "i".repeat(64), question, JSON.stringify({ type: "MEASURE_DATE" })]);
  await db.query(`INSERT INTO "ResearchEvidenceBundleRecord" VALUES ($1,$2,'{}')`, [`bundle-${missionId}`, missionId]);
  const resultId = `result-${missionId}`;
  await db.query(`INSERT INTO "ResearchQuestionResultRecord" (
    "id","tenantId","caseId","missionId","bundleId","candidateId","legalIssueSemanticKey","researchQuestionSemanticKey",
    "missionFingerprint","toolId","candidateSnapshot","supportDirection"
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'tool','{}',$10::"ResearchResultSupportDirection")`,
    [resultId, tenantId, caseId, missionId, `bundle-${missionId}`, `candidate-${missionId}`, "i".repeat(64), question, fingerprint, input.direction ?? "SUPPORTS"]);
  return { missionId, tenantId, caseId, fingerprint, question, resultId };
}

function candidate(): AuthorityCandidate {
  return {
    kind: "AUTHORITY_CANDIDATE", candidateId: "candidate", executionRecordId: "execution", toolId: "tool",
    supportDirection: "SUPPORT", sourceFamily: "ITALIAN_LEGISLATION", retrievalMethod: "SEMANTIC_SEARCH",
    fullTextAvailable: false, verificationState: "OFFICIAL_VERIFICATION_REQUIRED", officialIdentifier: "123/2024",
  };
}

function usable(owner: Awaited<ReturnType<typeof seed>>, overrides: Partial<SourceChainSnapshot> = {}): SourceChainSnapshot {
  return {
    resultId: owner.resultId, tenantId: owner.tenantId, caseId: owner.caseId, missionId: owner.missionId,
    researchQuestionSemanticKey: owner.question, missionFingerprint: owner.fingerprint, referenceDate: "2025-01-01",
    referenceDateBasis: { type: "MEASURE_DATE" }, verificationVersion: SOURCE_CHAIN_VERIFICATION_VERSION,
    sourceIdentityKey: "official:123/2024", contentSha256: "a".repeat(64), retrievalState: "RESOLVED",
    textState: "FULL_TEXT", identityState: "VERIFIED", contentState: "VERIFIED", temporalState: "APPLICABLE",
    adverseState: "COMPLETED", officiality: "OFFICIAL", citationAnchors: [{ page: 1 }],
    manualReviewRequired: false, manualReviewReason: null, currentMission: true, ...overrides,
  };
}

afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

describe("Lotto 5 source chain persistence", () => {
  it("initializes discovery as retrieval required and deduplicates retry", async () => {
    const db = await database();
    const owner = await seed(db);
    const first = await initializeDiscoveredSourceAssessment({ resultId: owner.resultId, candidate: candidate() }, context(db));
    const retry = await initializeDiscoveredSourceAssessment({ resultId: owner.resultId, candidate: candidate() }, context(db));
    expect(first).toMatchObject({ outcome: "CREATED", retrievalState: "RETRIEVAL_REQUIRED", usable: false });
    expect(retry).toMatchObject({ outcome: "REUSED", chainFingerprint: first.chainFingerprint });
    expect((await db.query('SELECT * FROM "ResearchSourceAssessmentRecord"')).rows).toHaveLength(1);
  });

  it("preserves verification history and reuses only the identical hash/date/version snapshot", async () => {
    const db = await database();
    const owner = await seed(db);
    const first = await persistSourceChainAssessment(usable(owner), context(db));
    expect((await persistSourceChainAssessment(usable(owner), context(db))).outcome).toBe("REUSED");
    const changed = await persistSourceChainAssessment(usable(owner, { contentSha256: "b".repeat(64) }), context(db));
    expect(changed.chainFingerprint).not.toBe(first.chainFingerprint);
    const rows = await db.query<{ isCurrent: boolean }>('SELECT "isCurrent" FROM "ResearchSourceAssessmentRecord" ORDER BY "createdAt"');
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.filter((row) => row.isCurrent)).toHaveLength(1);
  });

  it("rejects cross-tenant and cross-case assessment attribution", async () => {
    const db = await database();
    const owner = await seed(db);
    await expect(persistSourceChainAssessment(usable(owner, { tenantId: "tenant-2" }), context(db))).rejects.toThrow("RESEARCH_RESULT_NOT_FOUND");
    await expect(persistSourceChainAssessment(usable(owner, { caseId: "case-2" }), context(db))).rejects.toThrow("RESEARCH_RESULT_NOT_FOUND");
  });

  it("persists blocking and manual-review reasons without promoting the source", async () => {
    const db = await database();
    const owner = await seed(db);
    await persistSourceChainAssessment(usable(owner, {
      identityState: "INCOMPLETE",
      manualReviewRequired: true,
      manualReviewReason: "SOURCE_IDENTITY_INCOMPLETE",
    }), context(db));
    const row = await db.query<{ usable: boolean; blockingReasons: string[]; manualReviewReason: string }>(`SELECT "usable","blockingReasons","manualReviewReason" FROM "ResearchSourceAssessmentRecord"`);
    expect(row.rows[0]).toMatchObject({ usable: false, blockingReasons: expect.arrayContaining(["IDENTITY_UNVERIFIED", "MANUAL_REVIEW_REQUIRED"]), manualReviewReason: "SOURCE_IDENTITY_INCOMPLETE" });
  });

  it("excludes a historical mission from usable CURRENT state", async () => {
    const db = await database();
    const owner = await seed(db);
    await db.query(`UPDATE "ResearchMissionRecord" SET "lifecycleStatus"='HISTORICAL' WHERE "id"=$1`, [owner.missionId]);
    const assessment = await persistSourceChainAssessment(usable(owner), context(db));
    expect(assessment).toMatchObject({ usable: false, currentMission: false, blockingReasons: expect.arrayContaining(["MISSION_NOT_CURRENT"]) });
  });

  it("creates one separate ADVERSE mission and requirement without retry duplicates or loops", async () => {
    const db = await database();
    const owner = await seed(db);
    const preAdverse = await persistSourceChainAssessment(usable(owner, { adverseState: "REQUIRED" }), context(db));
    expect(preAdverse).toMatchObject({ usable: false, blockingReasons: ["ADVERSE_NOT_COMPLETED"] });
    const first = await ensureAdverseResearchMission({ tenantId: owner.tenantId, caseId: owner.caseId, primaryMissionId: owner.missionId }, context(db));
    const retry = await ensureAdverseResearchMission({ tenantId: owner.tenantId, caseId: owner.caseId, primaryMissionId: owner.missionId }, context(db));
    expect(first).toMatchObject({ outcome: "CREATED", adverseMissionId: expect.any(String) });
    expect(retry).toMatchObject({ outcome: "REUSED", adverseMissionId: first.adverseMissionId });
    const adverse = await db.query<{ mode: string; researchQuestionSemanticKey: string }>(`SELECT "mode","researchQuestionSemanticKey" FROM "ResearchMissionRecord" WHERE "id"=$1`, [first.adverseMissionId]);
    expect(adverse.rows[0]).toMatchObject({ mode: "ADVERSE_SEARCH", researchQuestionSemanticKey: owner.question });
    expect((await db.query('SELECT * FROM "ResearchAdverseRequirement"')).rows).toHaveLength(1);
    await expect(ensureAdverseResearchMission({ tenantId: owner.tenantId, caseId: owner.caseId, primaryMissionId: first.adverseMissionId! }, context(db))).resolves.toMatchObject({ outcome: "NOT_REQUIRED" });
    await expect(persistSourceChainAssessment(usable(owner, { adverseState: "COMPLETED" }), context(db))).resolves.toMatchObject({ usable: true });
  });

  it("does not require adverse research when usable opposition already exists", async () => {
    const db = await database();
    const owner = await seed(db, { direction: "OPPOSES" });
    await persistSourceChainAssessment(usable(owner), context(db));
    await expect(ensureAdverseResearchMission({ tenantId: owner.tenantId, caseId: owner.caseId, primaryMissionId: owner.missionId }, context(db))).resolves.toMatchObject({ outcome: "NOT_REQUIRED" });
  });

  it("histories the prior adverse requirement when the primary fingerprint changes", async () => {
    const db = await database();
    const first = await seed(db, { missionId: "mission-1", fingerprint: "a".repeat(64) });
    await persistSourceChainAssessment(usable(first), context(db));
    await ensureAdverseResearchMission({ tenantId: first.tenantId, caseId: first.caseId, primaryMissionId: first.missionId }, context(db));
    await db.query(`UPDATE "ResearchMissionRecord" SET "lifecycleStatus"='HISTORICAL' WHERE "id"=$1`, [first.missionId]);
    const second = await seed(db, { missionId: "mission-2", fingerprint: "b".repeat(64) });
    await persistSourceChainAssessment(usable(second), context(db));
    await ensureAdverseResearchMission({ tenantId: second.tenantId, caseId: second.caseId, primaryMissionId: second.missionId }, context(db));
    const statuses = await db.query<{ status: string }>('SELECT "status" FROM "ResearchAdverseRequirement" ORDER BY "createdAt"');
    expect(statuses.rows.map((row) => row.status)).toEqual(["HISTORICAL", "REQUIRED"]);
    const oldAdverse = await db.query<{ lifecycleStatus: string }>(`SELECT m."lifecycleStatus" FROM "ResearchMissionRecord" m JOIN "ResearchAdverseRequirement" r ON r."adverseMissionId"=m."id" WHERE r."primaryMissionId"=$1`, [first.missionId]);
    expect(oldAdverse.rows[0].lifecycleStatus).toBe("HISTORICAL");
  });

  it("completes the adverse requirement and creates a new usable source snapshot", async () => {
    const db = await database();
    const owner = await seed(db);
    await persistSourceChainAssessment(usable(owner, { adverseState: "REQUIRED" }), context(db));
    const adverse = await ensureAdverseResearchMission({ tenantId: owner.tenantId, caseId: owner.caseId, primaryMissionId: owner.missionId }, context(db));
    await db.query(`UPDATE "ResearchMissionRecord" SET "status"='COMPLETED' WHERE "id"=$1`, [adverse.adverseMissionId]);
    await expect(completeAdverseResearchRequirement({ tenantId: owner.tenantId, caseId: owner.caseId, adverseMissionId: adverse.adverseMissionId! }, context(db))).resolves.toBe(1);
    const current = await db.query<{ usable: boolean; adverseState: string }>('SELECT "usable","adverseState" FROM "ResearchSourceAssessmentRecord" WHERE "isCurrent"=true');
    expect(current.rows).toEqual([{ usable: true, adverseState: "COMPLETED" }]);
  });
});
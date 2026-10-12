import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthorityCandidate } from "@/server/legal-research/bridge";
import {
  deriveResearchQuestionCoverage,
  deriveResearchResultSourceState,
  normalizeSupportDirection,
  persistResearchQuestionResults,
  reviewResearchQuestionResult,
  type ResearchQuestionResultContext,
  type ResearchQuestionResultSqlExecutor,
} from "@/server/legal-research/question-results";

const migration = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20260929_research_question_results", "migration.sql"), "utf8");
const databases: PGlite[] = [];

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): ResearchQuestionResultSqlExecutor {
  return { query: (query, params = []) => sql.query(query, [...params]) };
}

function context(db: PGlite): ResearchQuestionResultContext {
  return {
    read: executor(db),
    transaction: (operation) => db.transaction((tx) => operation(executor(tx))),
    initializeSourceAssessment: async () => undefined,
  };
}

function candidate(id: string, direction: AuthorityCandidate["supportDirection"] = "SUPPORT", overrides: Partial<AuthorityCandidate> = {}): AuthorityCandidate {
  return {
    kind: "AUTHORITY_CANDIDATE", candidateId: id, executionRecordId: "execution-1", toolId: "provider-tool",
    providerId: "provider-1", title: `Result ${id}`, supportDirection: direction,
    sourceFamily: "ITALIAN_LEGISLATION", retrievalMethod: "SEMANTIC_SEARCH", fullTextAvailable: false,
    verificationState: "OFFICIAL_VERIFICATION_REQUIRED", ...overrides,
  };
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TYPE "ResearchMissionStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','BUDGET_EXHAUSTED','DEFERRED','REJECTED');
    CREATE TABLE "ResearchMissionRecord" (
      "id" VARCHAR(96) PRIMARY KEY, "tenantId" TEXT, "caseId" VARCHAR(256) NOT NULL,
      "legalIssueSemanticKey" CHAR(64), "researchQuestionSemanticKey" CHAR(64), "missionFingerprint" CHAR(64),
      "status" "ResearchMissionStatus" NOT NULL DEFAULT 'PENDING', "lifecycleStatus" TEXT NOT NULL DEFAULT 'CURRENT',
      UNIQUE ("id", "tenantId")
    );
    CREATE TABLE "ResearchEvidenceBundleRecord" (
      "id" VARCHAR(96) PRIMARY KEY, "missionId" VARCHAR(96) NOT NULL, "payload" JSONB NOT NULL
    );
    CREATE TABLE "StructuredFascicoloReportSnapshot" (
      "id" TEXT PRIMARY KEY
    );
  `);
  await db.exec(migration);
  return db;
}

async function seed(db: PGlite, missionId = "mission-1", tenantId = "tenant-1", caseId = "case-1") {
  await db.query(`INSERT INTO "ResearchMissionRecord" VALUES ($1,$2,$3,$4,$5,$6,'COMPLETED','CURRENT')`,
    [missionId, tenantId, caseId, "i".repeat(64), "q".repeat(64), "f".repeat(64)]);
  await db.query(`INSERT INTO "ResearchEvidenceBundleRecord" VALUES ($1,$2,'{}'::jsonb)`, [`bundle-${missionId}`, missionId]);
}

afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

describe("Lotto 4 research question results", () => {
  it("links a result to the exact tenant, case, question, mission, fingerprint, and bundle without retry duplicates", async () => {
    const db = await database();
    await seed(db);
    const input = { missionId: "mission-1", bundleId: "bundle-mission-1", candidates: [candidate("candidate-1")] };
    expect(await persistResearchQuestionResults(input, context(db))).toMatchObject([{ outcome: "CREATED" }]);
    expect(await persistResearchQuestionResults(input, context(db))).toMatchObject([{ outcome: "REUSED" }]);
    const rows = await db.query<any>('SELECT * FROM "ResearchQuestionResultRecord"');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ tenantId: "tenant-1", caseId: "case-1", missionId: "mission-1", bundleId: "bundle-mission-1", candidateId: "candidate-1", researchQuestionSemanticKey: "q".repeat(64), missionFingerprint: "f".repeat(64) });
  });

  it("keeps results of different tenants, cases, questions, and historical missions isolated", async () => {
    const db = await database();
    await seed(db, "mission-1", "tenant-1", "case-1");
    await seed(db, "mission-2", "tenant-2", "case-2");
    await persistResearchQuestionResults({ missionId: "mission-1", bundleId: "bundle-mission-1", candidates: [candidate("same")] }, context(db));
    await persistResearchQuestionResults({ missionId: "mission-2", bundleId: "bundle-mission-2", candidates: [candidate("same")] }, context(db));
    await db.query(`UPDATE "ResearchMissionRecord" SET "lifecycleStatus"='HISTORICAL' WHERE "id"='mission-1'`);
    const current = await db.query<any>(`SELECT r.* FROM "ResearchQuestionResultRecord" r JOIN "ResearchMissionRecord" m ON m."id"=r."missionId" WHERE m."tenantId"=$1 AND m."caseId"=$2 AND m."lifecycleStatus"='CURRENT'`, ["tenant-2", "case-2"]);
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0].missionId).toBe("mission-2");
    const historical = await db.query<any>(`SELECT r.* FROM "ResearchQuestionResultRecord" r JOIN "ResearchMissionRecord" m ON m."id"=r."missionId" WHERE m."lifecycleStatus"='HISTORICAL'`);
    expect(historical.rows).toHaveLength(1);
  });

  it("preserves human confirmation and rejection without deleting the result", async () => {
    const db = await database();
    await seed(db);
    const [created] = await persistResearchQuestionResults({ missionId: "mission-1", bundleId: "bundle-mission-1", candidates: [candidate("candidate-1", "UNKNOWN")] }, context(db));
    const confirmed = await reviewResearchQuestionResult({ resultId: created.id, tenantId: "tenant-1", missionId: "mission-1", direction: "SUPPORTS", reviewStatus: "HUMAN_CONFIRMED", confidence: 0.9, rationale: "Passaggio pertinente verificato." }, context(db));
    expect(confirmed).toMatchObject({ supportDirection: "SUPPORTS", classificationSource: "HUMAN_REVIEW", classificationReviewStatus: "HUMAN_CONFIRMED" });
    await reviewResearchQuestionResult({ resultId: created.id, tenantId: "tenant-1", missionId: "mission-1", direction: "SUPPORTS", reviewStatus: "REJECTED", confidence: 0.2, rationale: "Classificazione non affidabile." }, context(db));
    const count = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "ResearchQuestionResultRecord"');
    expect(count.rows[0].count).toBe(1);
    const reports = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "StructuredFascicoloReportSnapshot"');
    expect(reports.rows[0].count).toBe(0);
  });

  it("rejects a review outside the exact mission scope or without a rationale", async () => {
    const db = await database();
    await seed(db);
    const [created] = await persistResearchQuestionResults({ missionId: "mission-1", bundleId: "bundle-mission-1", candidates: [candidate("candidate-1")] }, context(db));
    await expect(reviewResearchQuestionResult({
      resultId: created.id,
      tenantId: "tenant-1",
      missionId: "another-mission",
      direction: "SUPPORTS",
      reviewStatus: "HUMAN_CONFIRMED",
      confidence: null,
      rationale: "Passaggio pertinente verificato dal revisore.",
    }, context(db))).rejects.toThrow("RESEARCH_QUESTION_RESULT_NOT_FOUND");
    await expect(reviewResearchQuestionResult({
      resultId: created.id,
      tenantId: "tenant-1",
      missionId: "mission-1",
      direction: "SUPPORTS",
      reviewStatus: "HUMAN_CONFIRMED",
      confidence: null,
      rationale: "Breve",
    }, context(db))).rejects.toThrow("INVALID_CLASSIFICATION_RATIONALE");
  });

  it("keeps support direction separate from source verification state", () => {
    const discovered = candidate("candidate-1", "SUPPORT");
    expect(deriveResearchResultSourceState(discovered)).toBe("DISCOVERED");
    expect(discovered.supportDirection).toBe("SUPPORT");
    expect(deriveResearchResultSourceState(candidate("candidate-2", "AGAINST", { fullTextAvailable: true }))).toBe("ACQUIRED");
    expect(deriveResearchResultSourceState(candidate("candidate-3", "SUPPORT", { verificationState: "OFFICIALLY_VERIFIED" }))).toBe("IDENTITY_VERIFIED");
  });

  it("maps provider output and represents every support direction explicitly", () => {
    expect(normalizeSupportDirection("SUPPORT")).toBe("SUPPORTS");
    expect(normalizeSupportDirection("AGAINST")).toBe("OPPOSES");
    expect(normalizeSupportDirection("QUALIFIES")).toBe("NEUTRAL");
    expect(normalizeSupportDirection("UNKNOWN")).toBe("UNASSESSED");
    const coverage = (supportDirection: "SUPPORTS" | "OPPOSES" | "NEUTRAL" | "INCONCLUSIVE" | "UNASSESSED") => deriveResearchQuestionCoverage({
      missionStatus: "COMPLETED",
      results: [{
        candidateId: supportDirection,
        candidateSnapshot: candidate(supportDirection, "UNKNOWN", { fullTextAvailable: true }),
        supportDirection,
        classificationReviewStatus: "HUMAN_CONFIRMED",
        coverageElementKeys: ["element"],
        unresolvedAspectKeys: [],
      }],
    }).status;
    expect(coverage("SUPPORTS")).toBe("COVERED");
    expect(coverage("OPPOSES")).toBe("COVERED");
    expect(coverage("NEUTRAL")).toBe("COVERED");
    expect(coverage("INCONCLUSIVE")).toBe("PARTIAL");
    expect(coverage("UNASSESSED")).toBe("RESULTS_UNASSESSED");
  });

  it("derives conservative no-results, unassessed, partial, covered, conflicting, deferred, and pending states", () => {
    const base = (direction: any, overrides: any = {}) => ({ candidateId: direction, candidateSnapshot: candidate(direction, "UNKNOWN", overrides.candidate ?? {}), supportDirection: direction, classificationReviewStatus: "AI_PROPOSED" as const, coverageElementKeys: overrides.elements ?? [], unresolvedAspectKeys: overrides.unresolved ?? [] });
    expect(deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [] }).status).toBe("NO_RESULTS");
    expect(deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [base("UNASSESSED")] }).status).toBe("RESULTS_UNASSESSED");
    expect(deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [base("SUPPORTS")] }).status).toBe("PARTIAL");
    expect(deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [base("SUPPORTS", { candidate: { fullTextAvailable: true }, elements: ["competenza"] })] }).status).toBe("COVERED");
    expect(deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [base("SUPPORTS", { candidate: { fullTextAvailable: true } }), base("OPPOSES", { candidate: { fullTextAvailable: true } })] }).status).toBe("CONFLICTING");
    expect(deriveResearchQuestionCoverage({ missionStatus: "DEFERRED", results: [] }).status).toBe("NOT_RESEARCHED");
    expect(deriveResearchQuestionCoverage({ missionStatus: "PENDING", results: [] }).executionState).toBe("PENDING");
  });

  it("represents unresolved aspects, missing full text, unverified sources, and rejected classifications conservatively", () => {
    const rejected = { candidateId: "rejected", candidateSnapshot: candidate("rejected"), supportDirection: "SUPPORTS" as const, classificationReviewStatus: "REJECTED" as const, coverageElementKeys: ["competenza"], unresolvedAspectKeys: [] };
    const partial = { candidateId: "active", candidateSnapshot: candidate("active"), supportDirection: "INCONCLUSIVE" as const, classificationReviewStatus: "AI_PROPOSED" as const, coverageElementKeys: ["competenza"], unresolvedAspectKeys: ["decadenza"] };
    const coverage = deriveResearchQuestionCoverage({ missionStatus: "COMPLETED", results: [rejected, partial], evidenceGapKeys: ["NO_CASSATION_CHECK"] });
    expect(coverage.status).toBe("PARTIAL");
    expect(coverage.coveredElementKeys).toEqual(["competenza"]);
    expect(coverage.gaps.map((gap) => gap.kind)).toEqual(expect.arrayContaining(["MISSING_ASPECT", "MISSING_FULL_TEXT", "UNVERIFIED_SOURCE", "INSUFFICIENT_RESULT"]));
  });
});
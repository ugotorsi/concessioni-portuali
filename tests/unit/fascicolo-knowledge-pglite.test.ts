import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  FascicoloKnowledgeRepositoryError,
  createBuildingKnowledgeRevision,
  createKnowledgeRelation,
  getCurrentKnowledgeRevision,
  listKnowledgeRevisionHistory,
  reconcileAndPromoteKnowledgeRevision,
  reviewCurrentKnowledgeItem,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeItemCandidate,
  type KnowledgeSqlExecutor,
} from "@/server/fascicolo-knowledge";

const migration = readFileSync(path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260928_fascicolo_knowledge_foundation",
  "migration.sql",
), "utf8");
const structuredKnowledgeMigration = readFileSync(path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260929_fascicolo_structured_knowledge",
  "migration.sql",
), "utf8");
const textHash = "a".repeat(64);
const corpusA = "1".repeat(64);
const corpusB = "2".repeat(64);
const corpusC = "3".repeat(64);
const databases: PGlite[] = [];

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): KnowledgeSqlExecutor {
  return {
    query: (query, params = []) => sql.query(query, [...params]),
  };
}

function repositoryContext(database: PGlite, overrides: Partial<FascicoloKnowledgeRepositoryContext> = {}) {
  return {
    read: executor(database),
    transaction: <T>(operation: (tx: KnowledgeSqlExecutor) => Promise<T>) => (
      database.transaction((transaction) => operation(executor(transaction)))
    ),
    now: () => new Date("2026-09-28T12:00:00.000Z"),
    ...overrides,
  } satisfies FascicoloKnowledgeRepositoryContext;
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Concessione" ("id" TEXT PRIMARY KEY, "enteId" TEXT);
    CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL, "concessioneId" TEXT);
    CREATE TABLE "Documento" ("id" TEXT PRIMARY KEY, "enteId" TEXT, "procedimentoId" TEXT);
    CREATE TABLE "DocumentFileVersion" ("id" TEXT PRIMARY KEY, "documentId" TEXT NOT NULL, "canonicalEnteId" TEXT NOT NULL, "sha256" TEXT NOT NULL);
    CREATE TABLE "NeutralIntake" ("id" TEXT PRIMARY KEY, "enteId" TEXT);
    CREATE TABLE "NeutralIntakeDestination" ("neutralIntakeId" TEXT PRIMARY KEY, "procedimentoId" TEXT NOT NULL);
    CREATE TABLE "NeutralIntakeExtractionAttempt" ("id" TEXT PRIMARY KEY, "neutralIntakeId" TEXT NOT NULL, "artifactSha256" TEXT NOT NULL);
    CREATE TABLE "NeutralIntakeExtractionPage" ("id" TEXT PRIMARY KEY, "extractionAttemptId" TEXT NOT NULL, "pageNumber" INTEGER NOT NULL, "textSha256" TEXT NOT NULL);
    INSERT INTO "Ente" VALUES ('tenant-a'), ('tenant-b');
    INSERT INTO "Concessione" VALUES ('concession-a1', 'tenant-a'), ('concession-a2', 'tenant-a'), ('concession-b1', 'tenant-b');
    INSERT INTO "Procedimento" VALUES
      ('procedure-a1', 'tenant-a', 'concession-a1'),
      ('procedure-a2', 'tenant-a', 'concession-a2'),
      ('procedure-b1', 'tenant-b', 'concession-b1');
    INSERT INTO "Documento" VALUES ('document-a1', 'tenant-a', 'procedure-a1'), ('document-a2', 'tenant-a', 'procedure-a2'), ('document-b1', 'tenant-b', 'procedure-b1');
    INSERT INTO "DocumentFileVersion" VALUES ('version-a1', 'document-a1', 'tenant-a', '${textHash}'), ('version-a2', 'document-a2', 'tenant-a', '${textHash}'), ('version-b1', 'document-b1', 'tenant-b', '${textHash}');
    INSERT INTO "NeutralIntake" VALUES ('intake-a1', 'tenant-a'), ('intake-a2', 'tenant-a'), ('intake-b1', 'tenant-b');
    INSERT INTO "NeutralIntakeDestination" VALUES ('intake-a1', 'procedure-a1'), ('intake-a2', 'procedure-a2'), ('intake-b1', 'procedure-b1');
    INSERT INTO "NeutralIntakeExtractionAttempt" VALUES ('attempt-a1', 'intake-a1', '${textHash}'), ('attempt-a2', 'intake-a2', '${textHash}'), ('attempt-b1', 'intake-b1', '${textHash}');
    INSERT INTO "NeutralIntakeExtractionPage" VALUES ('page-a1-1', 'attempt-a1', 1, '${textHash}'), ('page-a2-1', 'attempt-a2', 1, '${textHash}'), ('page-b1-1', 'attempt-b1', 1, '${textHash}');
  `);
  await db.exec(migration);
  await db.exec(structuredKnowledgeMigration);
  return db;
}

function scope(procedimentoId = "procedure-a1", tenantId = "tenant-a") {
  return { tenantId, procedimentoId };
}

function candidate(identity: string, overrides: Partial<KnowledgeItemCandidate> = {}): KnowledgeItemCandidate {
  return {
    kind: "GENERIC",
    normalizedIdentity: identity,
    normalizedText: `Testo ${identity}`,
    structuredPayload: { identity },
    confidence: 80,
    evidence: [{
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-a1",
      documentFileVersionId: "version-a1",
      extractionAttemptId: "attempt-a1",
      pageNumber: 1,
      textSha256: textHash,
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    }],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("fascicolo knowledge repository on disposable PGlite", () => {
  it("creates BUILDING, promotes the first CURRENT, and reconciles a second revision with preserved review", async () => {
    const db = await database();
    const ctx = repositoryContext(db);
    const first = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusA }, ctx);
    expect(first.status).toBe("BUILDING");
    const firstResult = await reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: first.id, expectedCurrentRevisionId: null,
      candidates: [candidate("confirmed"), candidate("rejected"), candidate("modified"), candidate("removed")],
    }, ctx);
    expect(firstResult.revision.status).toBe("CURRENT");
    expect(firstResult.classifications.every((item) => item.classification === "ADDED")).toBe(true);
    const confirmed = firstResult.revision.items.find((item) => item.normalizedText === "Testo confirmed")!;
    const rejected = firstResult.revision.items.find((item) => item.normalizedText === "Testo rejected")!;
    await reviewCurrentKnowledgeItem({ ...scope(), itemId: confirmed.id, status: "HUMAN_CONFIRMED" }, ctx);
    await reviewCurrentKnowledgeItem({ ...scope(), itemId: rejected.id, status: "REJECTED" }, ctx);

    const second = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusB }, ctx);
    const secondResult = await reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: second.id, expectedCurrentRevisionId: first.id,
      candidates: [
        candidate("confirmed"),
        candidate("rejected"),
        candidate("modified", { normalizedText: "Testo modificato materialmente" }),
        candidate("added"),
      ],
    }, ctx);
    expect(Object.fromEntries(secondResult.classifications.map((item) => [item.classification,
      (secondResult.classifications.filter((candidateResult) => candidateResult.classification === item.classification).length)])))
      .toMatchObject({ ADDED: 1, UNCHANGED: 2, MODIFIED: 1, NO_LONGER_SUPPORTED: 1 });
    expect(secondResult.revision.items.find((item) => item.semanticKey === confirmed.semanticKey)?.status)
      .toBe("HUMAN_CONFIRMED");
    expect(secondResult.revision.items.find((item) => item.semanticKey === rejected.semanticKey)?.status)
      .toBe("REJECTED");
    expect(secondResult.revision.items.find((item) => item.normalizedText === "Testo modificato materialmente")?.status)
      .toBe("AI_PROPOSED");
    expect(secondResult.revision.items.every((item) => item.evidence.length === 1)).toBe(true);
    expect(secondResult.revision.relations).toContainEqual(expect.objectContaining({ relationType: "SUPERSEDES" }));

    const current = await getCurrentKnowledgeRevision(scope(), ctx);
    const history = await listKnowledgeRevisionHistory(scope(), ctx);
    expect(current?.id).toBe(second.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: first.id, status: "SUPERSEDED" });
    expect(history[0].items.every((item) => item.supersededAt !== null)).toBe(true);
    await expect(createKnowledgeRelation({
      ...scope(), revisionId: first.id,
      sourceItemId: history[0].items[0].id,
      targetItemId: history[0].items[1].id,
      relationType: "RELATED_TO",
    }, ctx)).rejects.toMatchObject({ code: "REVISION_NOT_CURRENT" });
  });

  it("isolates tenants and procedures even when semantic keys are equal", async () => {
    const db = await database();
    const ctx = repositoryContext(db);
    const revisions = await Promise.all([
      createBuildingKnowledgeRevision({ ...scope("procedure-a1", "tenant-a"), corpusFingerprint: corpusA }, ctx),
      createBuildingKnowledgeRevision({ ...scope("procedure-a2", "tenant-a"), corpusFingerprint: corpusA }, ctx),
      createBuildingKnowledgeRevision({ ...scope("procedure-b1", "tenant-b"), corpusFingerprint: corpusA }, ctx),
    ]);
    const candidates = [
      candidate("shared"),
      candidate("shared", { evidence: [{ ...candidate("shared").evidence[0], documentoId: "document-a2", documentFileVersionId: "version-a2", extractionAttemptId: "attempt-a2" }] }),
      candidate("shared", { evidence: [{ ...candidate("shared").evidence[0], documentoId: "document-b1", documentFileVersionId: "version-b1", extractionAttemptId: "attempt-b1" }] }),
    ];
    const results = [];
    for (let index = 0; index < revisions.length; index += 1) {
      const selectedScope = index === 0 ? scope("procedure-a1", "tenant-a")
        : index === 1 ? scope("procedure-a2", "tenant-a") : scope("procedure-b1", "tenant-b");
      results.push(await reconcileAndPromoteKnowledgeRevision({
        ...selectedScope, revisionId: revisions[index].id, expectedCurrentRevisionId: null, candidates: [candidates[index]],
      }, ctx));
    }
    expect(new Set(results.map((result) => result.revision.items[0].semanticKey)).size).toBe(1);
    await expect(reviewCurrentKnowledgeItem({
      ...scope("procedure-a2", "tenant-a"), itemId: results[0].revision.items[0].id, status: "REJECTED",
    }, ctx)).rejects.toMatchObject({ code: "ITEM_NOT_CURRENT" });
    const foreignRevision = await createBuildingKnowledgeRevision({
      ...scope("procedure-b1", "tenant-b"), corpusFingerprint: corpusB,
    }, ctx);
    await expect(reconcileAndPromoteKnowledgeRevision({
      ...scope("procedure-a1", "tenant-a"), revisionId: foreignRevision.id,
      expectedCurrentRevisionId: results[0].revision.id, candidates: [],
    }, ctx)).rejects.toMatchObject({ code: "REVISION_NOT_FOUND" });
    await expect(createKnowledgeRelation({
      ...scope("procedure-a1", "tenant-a"), revisionId: results[0].revision.id,
      sourceItemId: results[0].revision.items[0].id,
      targetItemId: results[1].revision.items[0].id,
      relationType: "RELATED_TO",
    }, ctx)).rejects.toMatchObject({ code: "RELATION_SCOPE_MISMATCH" });
  });

  it("rejects relations between items belonging to different tenants without changing either CURRENT revision", async () => {
    const db = await database();
    const ctx = repositoryContext(db);
    const tenantARevision = await createBuildingKnowledgeRevision({
      ...scope("procedure-a1", "tenant-a"), corpusFingerprint: corpusA,
    }, ctx);
    const tenantBRevision = await createBuildingKnowledgeRevision({
      ...scope("procedure-b1", "tenant-b"), corpusFingerprint: corpusB,
    }, ctx);
    const tenantAResult = await reconcileAndPromoteKnowledgeRevision({
      ...scope("procedure-a1", "tenant-a"), revisionId: tenantARevision.id,
      expectedCurrentRevisionId: null, candidates: [candidate("tenant-a")],
    }, ctx);
    const tenantBResult = await reconcileAndPromoteKnowledgeRevision({
      ...scope("procedure-b1", "tenant-b"), revisionId: tenantBRevision.id,
      expectedCurrentRevisionId: null,
      candidates: [candidate("tenant-b", { evidence: [{
        ...candidate("tenant-b").evidence[0],
        documentoId: "document-b1", documentFileVersionId: "version-b1", extractionAttemptId: "attempt-b1",
      }] })],
    }, ctx);

    await expect(createKnowledgeRelation({
      ...scope("procedure-a1", "tenant-a"), revisionId: tenantARevision.id,
      sourceItemId: tenantAResult.revision.items[0].id,
      targetItemId: tenantBResult.revision.items[0].id,
      relationType: "RELATED_TO",
    }, ctx)).rejects.toMatchObject({ code: "RELATION_SCOPE_MISMATCH" });

    const relationCount = await db.query<{ count: number }>(`
      SELECT count(*)::int AS "count" FROM "FascicoloKnowledgeRelation"
    `);
    expect(relationCount.rows[0].count).toBe(0);
    expect((await getCurrentKnowledgeRevision(scope("procedure-a1", "tenant-a"), ctx))?.id)
      .toBe(tenantARevision.id);
    expect((await getCurrentKnowledgeRevision(scope("procedure-b1", "tenant-b"), ctx))?.id)
      .toBe(tenantBRevision.id);
  });

  it("rejects cross-procedure evidence without changing the current revision", async () => {
    const db = await database();
    const ctx = repositoryContext(db);
    const first = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusA }, ctx);
    await reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: first.id, expectedCurrentRevisionId: null, candidates: [candidate("current")],
    }, ctx);
    const second = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusB }, ctx);
    await expect(reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: second.id, expectedCurrentRevisionId: first.id,
      candidates: [candidate("foreign", { evidence: [{
        ...candidate("foreign").evidence[0],
        documentoId: "document-a2", documentFileVersionId: "version-a2", extractionAttemptId: "attempt-a2",
      }] })],
    }, ctx)).rejects.toMatchObject({ code: "EVIDENCE_SCOPE_MISMATCH" });
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(first.id);
  });

  it("rolls back supersession when promotion fails", async () => {
    const db = await database();
    const base = repositoryContext(db);
    const first = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusA }, base);
    await reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: first.id, expectedCurrentRevisionId: null, candidates: [candidate("current")],
    }, base);
    const second = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusB }, base);
    const failing = repositoryContext(db, { beforeCurrentPromotion: async () => { throw new Error("SYNTHETIC_FAILURE"); } });
    await expect(reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: second.id, expectedCurrentRevisionId: first.id, candidates: [candidate("replacement")],
    }, failing)).rejects.toThrow("SYNTHETIC_FAILURE");
    expect((await getCurrentKnowledgeRevision(scope(), base))?.id).toBe(first.id);
    const state = await db.query<{ id: string; status: string }>(`
      SELECT "id", "status" FROM "FascicoloKnowledgeRevision" ORDER BY "id"
    `);
    expect(state.rows.find((row) => row.id === second.id)?.status).toBe("BUILDING");
  });

  it("allows only one winner when two BUILDING revisions were based on the same CURRENT revision", async () => {
    const db = await database();
    const ctx = repositoryContext(db);
    const first = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusA }, ctx);
    await reconcileAndPromoteKnowledgeRevision({
      ...scope(), revisionId: first.id, expectedCurrentRevisionId: null, candidates: [candidate("base")],
    }, ctx);
    const second = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusB }, ctx);
    const third = await createBuildingKnowledgeRevision({ ...scope(), corpusFingerprint: corpusC }, ctx);
    const outcomes = await Promise.allSettled([
      reconcileAndPromoteKnowledgeRevision({
        ...scope(), revisionId: second.id, expectedCurrentRevisionId: first.id, candidates: [candidate("second")],
      }, ctx),
      reconcileAndPromoteKnowledgeRevision({
        ...scope(), revisionId: third.id, expectedCurrentRevisionId: first.id, candidates: [candidate("third")],
      }, ctx),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toEqual(new FascicoloKnowledgeRepositoryError("STALE_CURRENT_REVISION"));
    const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof reconcileAndPromoteKnowledgeRevision>>>).value;
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(winner.revision.id);
    const currentCount = await db.query<{ count: number }>(`
      SELECT count(*)::int AS "count" FROM "FascicoloKnowledgeRevision" WHERE "status" = 'CURRENT'
    `);
    expect(currentCount.rows[0].count).toBe(1);
  });
});
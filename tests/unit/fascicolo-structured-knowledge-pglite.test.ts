import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  getCurrentKnowledgeRevision,
  listKnowledgeRevisionHistory,
  persistStructuredKnowledgeRevision,
  resolveKnowledgeSubjects,
  reviewCurrentKnowledgeItem,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeEvidenceCandidate,
  type KnowledgeSqlExecutor,
} from "@/server/fascicolo-knowledge";
import {
  loadCurrentStructuredKnowledge,
  type StructuredKnowledgeQueryExecutor,
} from "@/server/queries/fascicolo-knowledge";

const migrations = [
  "20260928_fascicolo_knowledge_foundation",
  "20260929_fascicolo_structured_knowledge",
].map((name) => readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8"));
const documentEvidenceMigrations = [
  "20261010_fascicolo_document_evidence_provenance",
  "20261010_fascicolo_document_knowledge_evidence",
].map((name) => readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8"));
const databases: PGlite[] = [];
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): KnowledgeSqlExecutor {
  return { query: (query, params = []) => sql.query(query, [...params]) };
}

function queryExecutor(db: PGlite): StructuredKnowledgeQueryExecutor {
  return executor(db);
}

function context(db: PGlite): FascicoloKnowledgeRepositoryContext {
  return {
    read: executor(db),
    transaction: <T>(operation: (tx: KnowledgeSqlExecutor) => Promise<T>) => db.transaction((tx) => operation(executor(tx))),
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  };
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Concessione" ("id" TEXT PRIMARY KEY, "enteId" TEXT);
    CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL, "concessioneId" TEXT);
    CREATE TABLE "Documento" ("id" TEXT PRIMARY KEY, "enteId" TEXT, "procedimentoId" TEXT, "currentFileVersionId" TEXT);
    CREATE TABLE "DocumentFileVersion" ("id" TEXT PRIMARY KEY, "documentId" TEXT NOT NULL, "canonicalEnteId" TEXT NOT NULL, "sha256" TEXT NOT NULL);
    CREATE TABLE "NeutralIntake" ("id" TEXT PRIMARY KEY, "enteId" TEXT);
    CREATE TABLE "NeutralIntakeDestination" ("neutralIntakeId" TEXT PRIMARY KEY, "procedimentoId" TEXT NOT NULL);
    CREATE TABLE "NeutralIntakeExtractionAttempt" ("id" TEXT PRIMARY KEY, "neutralIntakeId" TEXT NOT NULL, "artifactSha256" TEXT NOT NULL, "outcome" TEXT NOT NULL);
    CREATE TABLE "NeutralIntakeExtractionPage" ("id" TEXT PRIMARY KEY, "extractionAttemptId" TEXT NOT NULL, "pageNumber" INTEGER NOT NULL, "textSha256" TEXT NOT NULL);
    CREATE TABLE "DocumentExtractionAttempt" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Scadenza" ("id" TEXT PRIMARY KEY);
    INSERT INTO "Ente" VALUES ('tenant-a'), ('tenant-b');
    INSERT INTO "Concessione" VALUES ('concession-a1', 'tenant-a'), ('concession-a2', 'tenant-a'), ('concession-b1', 'tenant-b');
    INSERT INTO "Procedimento" VALUES
      ('procedure-a1', 'tenant-a', 'concession-a1'),
      ('procedure-a2', 'tenant-a', 'concession-a2'),
      ('procedure-b1', 'tenant-b', 'concession-b1');
    INSERT INTO "Documento" VALUES
      ('document-a1', 'tenant-a', 'procedure-a1', 'version-a1'),
      ('document-a2', 'tenant-a', 'procedure-a2', 'version-a2'),
      ('document-b1', 'tenant-b', 'procedure-b1', 'version-b1');
    INSERT INTO "DocumentFileVersion" VALUES
      ('version-a1', 'document-a1', 'tenant-a', '${hashA}'),
      ('version-a1-mismatch', 'document-a1', 'tenant-a', '${hashB}'),
      ('version-a2', 'document-a2', 'tenant-a', '${hashA}'),
      ('version-b1', 'document-b1', 'tenant-b', '${hashA}');
    INSERT INTO "NeutralIntake" VALUES ('intake-a1', 'tenant-a'), ('intake-a2', 'tenant-a'), ('intake-b1', 'tenant-b');
    INSERT INTO "NeutralIntakeDestination" VALUES ('intake-a1', 'procedure-a1'), ('intake-a2', 'procedure-a2'), ('intake-b1', 'procedure-b1');
    INSERT INTO "NeutralIntakeExtractionAttempt" VALUES
      ('attempt-a1', 'intake-a1', '${hashA}', 'SUCCEEDED'),
      ('attempt-a1-v2', 'intake-a1', '${hashA}', 'SUCCEEDED'),
      ('attempt-a1-mismatch', 'intake-a1', '${hashB}', 'SUCCEEDED'),
      ('attempt-a2', 'intake-a2', '${hashA}', 'SUCCEEDED'),
      ('attempt-b1', 'intake-b1', '${hashA}', 'SUCCEEDED');
    INSERT INTO "NeutralIntakeExtractionPage" VALUES
      ('page-a1-1', 'attempt-a1', 1, '${hashA}'),
      ('page-a1-v2-1', 'attempt-a1-v2', 1, '${hashB}'),
      ('page-a1-mismatch-1', 'attempt-a1-mismatch', 1, '${hashA}'),
      ('page-a2-1', 'attempt-a2', 1, '${hashA}'),
      ('page-b1-1', 'attempt-b1', 1, '${hashA}');
  `);
  for (const migration of migrations) await db.exec(migration);
  for (const documentEvidenceMigration of documentEvidenceMigrations) {
    await db.exec(documentEvidenceMigration);
  }
  return db;
}

function scope(procedimentoId = "procedure-a1", tenantId = "tenant-a") {
  return { tenantId, procedimentoId };
}

function evidence(overrides: Partial<KnowledgeEvidenceCandidate> = {}): KnowledgeEvidenceCandidate {
  return {
    provenanceType: "DOCUMENT_EXTRACTION",
    documentoId: "document-a1",
    documentFileVersionId: "version-a1",
    extractionAttemptId: "attempt-a1",
    pageNumber: 1,
    textSha256: hashA,
    quoteSha256: null,
    basisRef: "DOCUMENT_1.PAGE_1",
    ...overrides,
  };
}

function structuredKnowledge(overrides: { factText?: string; includeGap?: boolean; eventEvidence?: string } = {}) {
  return {
    version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1" as const,
    subjects: [{
      localId: "subject-authority",
      canonicalName: "Autorita Portuale",
      subjectType: "AUTHORITY" as const,
      strongIdentifiers: [{ type: "PEC" as const, value: "protocollo@pec.example" }],
      aliases: ["AdSP"],
    }],
    items: [
      {
        localId: "role-authority", kind: "PARTY_ROLE" as const, confidence: 95,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { subjectLocalId: "subject-authority", role: "autorita procedente", context: "procedimento" },
      },
      {
        localId: "fact-a", kind: "FACT" as const, confidence: 90,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { normalizedStatement: overrides.factText ?? "La partenza e avvenuta alle 12:50", subjectLocalIds: ["subject-authority"], object: null, qualifier: null },
      },
      {
        localId: "fact-b", kind: "FACT" as const, confidence: 70,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { normalizedStatement: "La partenza e avvenuta alle 12:55", subjectLocalIds: [], object: null, qualifier: null },
      },
      {
        localId: "event-exact", kind: "EVENT" as const, confidence: 88,
        basisRefs: [overrides.eventEvidence ?? "DOCUMENT_1.PAGE_1"],
        payload: { title: "Partenza", normalizedStatement: "Partenza registrata", date: { precision: "EXACT" as const, from: "2026-09-01", to: null, originalText: "1 settembre 2026", confidence: 90 }, subjectLocalIds: ["subject-authority"], relatedItemLocalIds: ["fact-a"] },
      },
      {
        localId: "event-uncertain", kind: "EVENT" as const, confidence: 50,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { title: "Comunicazione", normalizedStatement: "Comunicazione avvenuta probabilmente a settembre", date: { precision: "UNCERTAIN" as const, from: null, to: null, originalText: "forse a settembre", confidence: 40 }, subjectLocalIds: [], relatedItemLocalIds: [] },
      },
      {
        localId: "event-unknown", kind: "EVENT" as const, confidence: 40,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { title: "Notifica", normalizedStatement: "Notifica priva di data", date: { precision: "UNKNOWN" as const, from: null, to: null, originalText: null, confidence: null }, subjectLocalIds: [], relatedItemLocalIds: [] },
      },
      {
        localId: "legal-act", kind: "LEGAL_ACT" as const, confidence: 85,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { documentBasisRef: "DOCUMENT_1.PAGE_1", actType: "istanza", authoritySubjectLocalId: "subject-authority", number: "42", date: { precision: "EXACT" as const, from: "2026-08-20", to: null, originalText: null, confidence: 100 }, title: "Istanza n. 42", declaredEffects: [] },
      },
      {
        localId: "measure", kind: "MEASURE" as const, confidence: 92,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { documentBasisRef: "DOCUMENT_1.PAGE_1", actType: "decreto", authoritySubjectLocalId: "subject-authority", number: "7", date: { precision: "EXACT" as const, from: "2026-08-25", to: null, originalText: null, confidence: 100 }, title: "Decreto n. 7", declaredEffects: ["Avvio del procedimento"] },
      },
      {
        localId: "contradiction", kind: "CONTRADICTION" as const, confidence: 80,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { description: "Gli orari di partenza sono incompatibili", conflictingItemLocalIds: ["fact-a", "fact-b"] },
      },
      ...(overrides.includeGap === false ? [] : [{
        localId: "gap", kind: "GAP" as const, confidence: 75,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { gapType: "MISSING_DOCUMENT", description: "Manca la ricevuta di notifica", impact: "Non e verificabile la decorrenza", relatedItemLocalIds: ["event-unknown"] },
      }]),
      {
        localId: "deadline-explicit", kind: "DEADLINE_CANDIDATE" as const, confidence: 90,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { deadlineType: "EXPLICIT_DATE" as const, baseDate: null, resultingDate: { precision: "EXACT" as const, from: "2026-12-31", to: null, originalText: "31 dicembre 2026", confidence: 100 }, ruleText: "Entro il 31 dicembre", calculationExplanation: null },
      },
      {
        localId: "deadline-calculated", kind: "DEADLINE_CANDIDATE" as const, confidence: 70,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: { deadlineType: "CALCULATED_TERM" as const, baseDate: { precision: "EXACT" as const, from: "2026-09-01", to: null, originalText: null, confidence: 100 }, resultingDate: { precision: "EXACT" as const, from: "2026-10-01", to: null, originalText: null, confidence: 80 }, ruleText: "Trenta giorni dalla partenza", calculationExplanation: "Aggiunta di 30 giorni" },
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("fascicolo structured knowledge on disposable PGlite", () => {
  it("deduplicates subjects by strong identifier without merging similar weak names or crossing tenants", async () => {
    const db = await database();
    const ctx = context(db);
    const first = await resolveKnowledgeSubjects({ ...scope(), candidates: [{
      localId: "first", canonicalName: "Mario Rossi", subjectType: "PERSON",
      strongIdentifiers: [{ type: "CODICE_FISCALE", value: "RSSMRA80A01H501U" }], aliases: [],
    }] }, ctx);
    const same = await resolveKnowledgeSubjects({ ...scope(), candidates: [{
      localId: "same", canonicalName: "M. Rossi", subjectType: "PERSON",
      strongIdentifiers: [{ type: "CODICE_FISCALE", value: " rssmra80a01h501u " }], aliases: [],
    }] }, ctx);
    const similar = await resolveKnowledgeSubjects({ ...scope(), candidates: [{
      localId: "similar", canonicalName: "Mario Ross", subjectType: "PERSON", strongIdentifiers: [], aliases: [],
    }] }, ctx);
    const otherTenant = await resolveKnowledgeSubjects({ ...scope("procedure-b1", "tenant-b"), candidates: [{
      localId: "other", canonicalName: "Mario Rossi", subjectType: "PERSON",
      strongIdentifiers: [{ type: "CODICE_FISCALE", value: "RSSMRA80A01H501U" }], aliases: [],
    }] }, ctx);
    expect(same.get("same")?.id).toBe(first.get("first")?.id);
    expect(similar.get("similar")?.id).not.toBe(first.get("first")?.id);
    expect(otherTenant.get("other")?.id).not.toBe(first.get("first")?.id);
  });

  it("does not weak-merge equal names with incompatible subject types", async () => {
    const db = await database();
    const ctx = context(db);
    const person = await resolveKnowledgeSubjects({ ...scope(), candidates: [{
      localId: "person", canonicalName: "Porto Nuovo", subjectType: "PERSON", strongIdentifiers: [], aliases: [],
    }] }, ctx);
    const authority = await resolveKnowledgeSubjects({ ...scope(), candidates: [{
      localId: "authority", canonicalName: "Porto Nuovo", subjectType: "AUTHORITY", strongIdentifiers: [], aliases: [],
    }] }, ctx);
    expect(authority.get("authority")?.id).not.toBe(person.get("person")?.id);
  });

  it("keeps one tenant-scoped canonical subject under concurrent strong-identifier resolution", async () => {
    const db = await database();
    const ctx = context(db);
    const candidate = (localId: string) => ({
      localId, canonicalName: "Mario Rossi", subjectType: "PERSON" as const,
      strongIdentifiers: [{ type: "CODICE_FISCALE" as const, value: "RSSMRA80A01H501U" }], aliases: [],
    });
    const [left, right] = await Promise.all([
      resolveKnowledgeSubjects({ ...scope(), candidates: [candidate("left")] }, ctx),
      resolveKnowledgeSubjects({ ...scope(), candidates: [candidate("right")] }, ctx),
    ]);
    expect(left.get("left")?.id).toBe(right.get("right")?.id);
    const subjects = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "FascicoloSubject" WHERE "tenantId" = $1', ["tenant-a"]);
    expect(subjects.rows[0].count).toBe(1);
  });

  it("persists all Lotto 2 categories, contradiction edges, provenance, and a deterministic EVENT timeline without creating Scadenza", async () => {
    const db = await database();
    const result = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "1".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, context(db));
    expect(new Set(result.revision.items.map((item) => item.kind))).toEqual(new Set([
      "PARTY_ROLE", "FACT", "EVENT", "LEGAL_ACT", "MEASURE", "CONTRADICTION", "GAP", "DEADLINE_CANDIDATE",
    ]));
    expect(result.revision.items.every((item) => item.evidence.length === 1)).toBe(true);
    const role = result.revision.items.find((item) => item.kind === "PARTY_ROLE")!;
    expect((role.structuredPayload as { subjectIds: string[] }).subjectIds).toEqual([result.subjectIdsByLocalId.get("subject-authority")]);
    expect(result.revision.relations.filter((relation) => relation.relationType === "CONTRADICTS")).toHaveLength(2);
    expect(result.revision.items.filter((item) => item.kind === "FACT")).toHaveLength(2);

    const readModel = await loadCurrentStructuredKnowledge("tenant-a", "procedure-a1", queryExecutor(db));
    expect(readModel?.timeline.map((item) => (item.payload as { date: { precision: string } }).date.precision))
      .toEqual(["EXACT", "UNCERTAIN", "UNKNOWN"]);
    expect(readModel?.legalActs[0].evidence[0]).toMatchObject({ documentoId: "document-a1", documentFileVersionId: "version-a1" });
    expect(readModel?.measures[0].payload).toMatchObject({
      number: "7",
      date: { precision: "EXACT", from: "2026-08-25" },
    });
    expect((readModel?.measures[0].payload as { subjectIds: string[] }).subjectIds)
      .toEqual([result.subjectIdsByLocalId.get("subject-authority")]);
    expect(readModel?.contradictions[0].contradictedItemIds).toHaveLength(2);
    expect(readModel?.gaps).toHaveLength(1);
    expect(readModel?.deadlineCandidates.map((item) => item.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deadlineType: "EXPLICIT_DATE",
        resultingDate: expect.objectContaining({ precision: "EXACT", from: "2026-12-31" }),
      }),
      expect.objectContaining({
        deadlineType: "CALCULATED_TERM",
        baseDate: expect.objectContaining({ precision: "EXACT", from: "2026-09-01" }),
        resultingDate: expect.objectContaining({ precision: "EXACT", from: "2026-10-01" }),
        ruleText: "Trenta giorni dalla partenza",
        calculationExplanation: "Aggiunta di 30 giorni",
      }),
    ]));
    expect(readModel?.facts.every((item) => item.status === "AI_PROPOSED")).toBe(true);
    const scadenze = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "Scadenza"');
    expect(scadenze.rows[0].count).toBe(0);
  });

  it("excludes an item with unresolved evidence but persists auditable warnings when the revision remains coherent", async () => {
    const db = await database();
    const result = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "2".repeat(64),
      knowledge: structuredKnowledge({ eventEvidence: "DOCUMENT_99.PAGE_1" }),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, context(db));
    expect(result.warnings).toContain("INVALID_EVIDENCE:event-exact");
    expect(result.revision.items.some((item) => item.normalizedText === "Partenza registrata")).toBe(false);
    const stored = await db.query<{ warnings: string[] }>('SELECT "warnings" FROM "FascicoloKnowledgeRevision" WHERE "id" = $1', [result.revision.id]);
    expect(stored.rows[0].warnings).toContain("INVALID_EVIDENCE:event-exact");
  });

  it("fails closed on wholly invalid evidence and preserves the previous CURRENT revision", async () => {
    const db = await database();
    const ctx = context(db);
    const first = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "3".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const invalid = {
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [],
      items: [{
        localId: "invalid-fact", kind: "FACT", confidence: 50, basisRefs: ["DOCUMENT_9.PAGE_9"],
        payload: { normalizedStatement: "Fatto non provato", subjectLocalIds: [], object: null, qualifier: null },
      }],
    };
    await expect(persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "4".repeat(64), knowledge: invalid,
      evidenceByBasisRef: new Map(),
    }, ctx)).rejects.toThrow("STRUCTURED_KNOWLEDGE_NO_VALID_ITEMS");
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(first.revision.id);
  });

  it.each([
    ["missing page", { pageNumber: 99 }],
    ["missing file version", { documentFileVersionId: "version-missing" }],
    ["missing extraction", { extractionAttemptId: "attempt-missing" }],
    ["mismatched file version and extraction", { documentFileVersionId: "version-a1-mismatch" }],
  ])("rejects documentary evidence with %s", async (_label, evidenceOverrides) => {
    const db = await database();
    const ctx = context(db);
    await expect(persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "c".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence(evidenceOverrides)]]),
    }, ctx)).rejects.toMatchObject({ code: "EVIDENCE_SCOPE_MISMATCH" });
    expect(await getCurrentKnowledgeRevision(scope(), ctx)).toBeNull();
  });

  it("rolls back a newly resolved subject when the revision later fails", async () => {
    const db = await database();
    const ctx = context(db);
    const current = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "a".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const failedKnowledge = structuredKnowledge();
    failedKnowledge.subjects = [{
      localId: "subject-authority", canonicalName: "Nuova Autorita", subjectType: "AUTHORITY",
      strongIdentifiers: [{ type: "PEC", value: "nuova@pec.example" }], aliases: [],
    }];
    await expect(persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "b".repeat(64), knowledge: failedKnowledge,
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence({ pageNumber: 99 })]]),
    }, ctx)).rejects.toMatchObject({ code: "EVIDENCE_SCOPE_MISMATCH" });
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(current.revision.id);
    const orphan = await db.query<{ count: number }>('SELECT count(*)::int AS "count" FROM "FascicoloSubject" WHERE "canonicalName" = $1', ["Nuova Autorita"]);
    expect(orphan.rows[0].count).toBe(0);
  });

  it("preserves review for unchanged items, resets modified items, and keeps superseded generations out of CURRENT", async () => {
    const db = await database();
    const ctx = context(db);
    const first = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "5".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const firstFact = first.revision.items.find((item) => item.normalizedText.includes("12:50"))!;
    await reviewCurrentKnowledgeItem({
      ...scope(), itemId: firstFact.id, status: "HUMAN_CONFIRMED", expectedReviewVersion: 0,
      actor: { actorId: "reviewer-1", actorEmail: "reviewer@example.test", actorRole: "GIURIDICO" },
    }, ctx);
    const second = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "6".repeat(64), knowledge: structuredKnowledge({ includeGap: false }),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    expect(second.revision.items.find((item) => item.semanticKey === firstFact.semanticKey)?.status).toBe("HUMAN_CONFIRMED");
    expect(second.classifications.some((item) => item.classification === "NO_LONGER_SUPPORTED")).toBe(true);
    const secondFact = second.revision.items.find((item) => item.normalizedText.includes("12:55"))!;
    await reviewCurrentKnowledgeItem({
      ...scope(), itemId: secondFact.id, status: "REJECTED", expectedReviewVersion: 0,
      actor: { actorId: "reviewer-1", actorEmail: "reviewer@example.test", actorRole: "GIURIDICO" },
    }, ctx);
    const history = await listKnowledgeRevisionHistory(scope(), ctx);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(first.revision.id);
    const currentRead = await loadCurrentStructuredKnowledge("tenant-a", "procedure-a1", queryExecutor(db));
    expect(currentRead?.gaps).toHaveLength(0);
    expect(currentRead?.facts.some((item) => item.id === secondFact.id)).toBe(false);
    expect(currentRead?.facts.find((item) => item.semanticKey === firstFact.semanticKey)?.status).toBe("HUMAN_CONFIRMED");
    const audit = await db.query<{ actorId: string; reviewVersion: number }>('SELECT "actorId", "reviewVersion" FROM "FascicoloKnowledgeReviewEvent"');
    expect(audit.rows).toEqual([
      { actorId: "reviewer-1", reviewVersion: 1 },
      { actorId: "reviewer-1", reviewVersion: 1 },
    ]);

    const third = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "7".repeat(64), knowledge: structuredKnowledge({ factText: "La partenza e avvenuta alle 13:10", includeGap: false }),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    expect(third.revision.items.find((item) => item.normalizedText.includes("13:10"))?.status).toBe("AI_PROPOSED");
  });

  it("isolates procedures and tenants and rejects cross-procedure evidence", async () => {
    const db = await database();
    const ctx = context(db);
    await expect(persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "8".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence({
        documentoId: "document-a2", documentFileVersionId: "version-a2", extractionAttemptId: "attempt-a2",
      })]]),
    }, ctx)).rejects.toMatchObject({ code: "EVIDENCE_SCOPE_MISMATCH" });
    expect(await getCurrentKnowledgeRevision(scope(), ctx)).toBeNull();

    const procedureA2 = await persistStructuredKnowledgeRevision({
      ...scope("procedure-a2", "tenant-a"), corpusFingerprint: "9".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence({
        documentoId: "document-a2", documentFileVersionId: "version-a2", extractionAttemptId: "attempt-a2",
      })]]),
    }, ctx);
    const tenantB = await persistStructuredKnowledgeRevision({
      ...scope("procedure-b1", "tenant-b"), corpusFingerprint: "0".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence({
        documentoId: "document-b1", documentFileVersionId: "version-b1", extractionAttemptId: "attempt-b1",
      })]]),
    }, ctx);
    expect((await getCurrentKnowledgeRevision(scope("procedure-a2", "tenant-a"), ctx))?.id).toBe(procedureA2.revision.id);
    expect((await getCurrentKnowledgeRevision(scope("procedure-b1", "tenant-b"), ctx))?.id).toBe(tenantB.revision.id);
  });

  it("changes content fingerprints for material evidence while keeping semantic keys stable", async () => {
    const db = await database();
    const ctx = context(db);
    const first = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "d".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const second = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "e".repeat(64), knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence({
        extractionAttemptId: "attempt-a1-v2", textSha256: hashB,
      })]]),
    }, ctx);
    const firstFact = first.revision.items.find((item) => item.kind === "FACT")!;
    const secondFact = second.revision.items.find((item) => item.semanticKey === firstFact.semanticKey)!;
    expect(secondFact.semanticKey).toBe(firstFact.semanticKey);
    expect(secondFact.contentFingerprint).not.toBe(firstFact.contentFingerprint);
    expect(secondFact.status).toBe("AI_PROPOSED");
  });

  it("persists legal issues and research questions with origin graph, provenance, and preserved human review", async () => {
    const db = await database();
    const ctx = context(db);
    const lotto3Knowledge = {
      ...structuredKnowledge(),
      legalIssues: [{
        localId: "issue-1",
        title: "Efficacia del decreto",
        normalizedIssue: "efficacia del decreto rispetto alla partenza",
        areaOfLaw: "diritto amministrativo",
        priority: "HIGH" as const,
        rationale: "Il decreto e i fatti registrati richiedono una qualificazione giuridica",
        originatingItemLocalIds: ["fact-a", "measure", "gap"],
        confidence: 90,
        referenceDateBasis: null,
      }],
      researchQuestions: [{
        localId: "question-1",
        legalIssueLocalId: "issue-1",
        canonicalQuestion: "Quale disciplina regola l'efficacia del decreto?",
        priority: "HIGH" as const,
        referenceDate: "2026-09-01",
        referenceDateBasis: { type: "EVENT_DATE" as const, itemLocalId: "event-exact", rationale: "Data esatta della partenza" },
        requestedCapabilities: ["SEMANTIC_DISCOVERY" as const],
        mode: "PRIMARY" as const,
      }],
    };
    const first = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "f".repeat(64), knowledge: lotto3Knowledge,
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const issue = first.revision.items.find((item) => item.kind === "LEGAL_ISSUE")!;
    const question = first.revision.items.find((item) => item.kind === "RESEARCH_QUESTION")!;
    expect(issue.evidence[0]).toMatchObject({ documentoId: "document-a1", pageNumber: 1 });
    expect(first.revision.relations.filter((relation) => relation.relationType === "ISSUE_DERIVED_FROM")).toHaveLength(3);
    expect(first.revision.relations).toContainEqual(expect.objectContaining({
      sourceItemId: question.id,
      targetItemId: issue.id,
      relationType: "QUESTION_FOR_ISSUE",
    }));
    await reviewCurrentKnowledgeItem({ ...scope(), itemId: issue.id, status: "HUMAN_CONFIRMED" }, ctx);
    const second = await persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "9".repeat(64), knowledge: lotto3Knowledge,
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    expect(second.revision.items.find((item) => item.semanticKey === issue.semanticKey)?.status).toBe("HUMAN_CONFIRMED");
    const readModel = await loadCurrentStructuredKnowledge("tenant-a", "procedure-a1", queryExecutor(db));
    expect(readModel?.legalIssues[0]).toMatchObject({ status: "HUMAN_CONFIRMED", originatingItemIds: expect.any(Array) });
    expect(readModel?.legalIssues[0].originatingItemIds).toHaveLength(3);
    expect(readModel?.researchQuestions[0]).toMatchObject({ legalIssueId: readModel!.legalIssues[0].id });
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCanonicalSourceSpans,
  buildFascicoloEvidenceSpanCatalog,
  fascicoloDocumentKnowledgeCandidateProposalSchema,
  fascicoloDocumentKnowledgeProposalSchema,
  fascicoloStructuredKnowledgeSchema,
  getCurrentKnowledgeRevision,
  listKnowledgeRevisionHistory,
  persistStructuredKnowledgeRevision,
  promotePreparedKnowledgeRevision,
  resolveKnowledgeSubjects,
  reviewCurrentKnowledgeItem,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeEvidenceCandidate,
  type KnowledgeSqlExecutor,
  projectStructuredKnowledge,
} from "@/server/fascicolo-knowledge";
import {
  createFascicoloAutomaticAnalysisHandler,
  FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT,
  type FascicoloAutomaticAnalysisDependencies,
} from "@/server/ai/fascicoloAutomaticAnalysisJob";
import {
  createFascicoloDocumentAnalysisService,
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
} from "@/server/ai/fascicoloDocumentAnalysis";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import { SELVARA_PILOT_AUTHORIZATION } from "@/server/ai/selvaraPilotAuthorization";
import {
  buildStructuredFascicoloReport,
  listStructuredFascicoloReportSnapshots,
  persistDraftStructuredFascicoloReport,
  persistStructuredFascicoloReport,
  type StructuredReportRepositoryContext,
  type StructuredReportSqlExecutor,
} from "@/server/fascicolo-report";
import {
  loadCurrentStructuredKnowledge,
  loadStructuredKnowledgeRevision,
  type StructuredKnowledgeQueryExecutor,
} from "@/server/queries/fascicolo-knowledge";
import {
  selvaraOfflineCorpusMetadata,
  selvaraOfflinePages,
  selvaraOfflineStructuredKnowledge,
  selvaraOfflineStructuredKnowledgeBaseline,
} from "../fixtures/selvara-offline-corpus";

const migrations = [
  "20260928_fascicolo_knowledge_foundation",
  "20260929_fascicolo_structured_knowledge",
].map((name) => readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8"));
const documentEvidenceMigrations = [
  "20261010_fascicolo_document_evidence_provenance",
  "20261010_fascicolo_document_knowledge_evidence",
].map((name) => readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8"));
const structuredReportMigration = readFileSync(path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260929_structured_fascicolo_report",
  "migration.sql",
), "utf8");
const databases: PGlite[] = [];
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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

function reportContext(db: PGlite): StructuredReportRepositoryContext {
  const reportExecutor = executor(db) as StructuredReportSqlExecutor;
  return {
    read: reportExecutor,
    transaction: (operation) => db.transaction((tx) => operation(executor(tx) as StructuredReportSqlExecutor)),
    now: () => new Date("2026-10-25T20:00:00.000Z"),
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
    CREATE TABLE "DocumentExtractionAttempt" (
      "id" TEXT PRIMARY KEY,
      "documentoId" TEXT,
      "documentFileVersionId" TEXT,
      "tenantId" TEXT,
      "procedimentoId" TEXT,
      "sourceSha256" TEXT,
      "outcome" TEXT
    );
    CREATE TABLE "DocumentExtractionPage" (
      "id" TEXT PRIMARY KEY,
      "extractionAttemptId" TEXT NOT NULL,
      "pageNumber" INTEGER NOT NULL,
      "textSha256" TEXT NOT NULL
    );
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
  await db.exec(structuredReportMigration);
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
        localId: "position-authority", kind: "PARTY_POSITION" as const, confidence: 85,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: {
          subjectLocalId: "subject-authority",
          positionType: "CLAIM" as const,
          normalizedStatement: "L'autorita sostiene che la prescrizione non sia stata rispettata",
          context: "contestazione",
          relatedItemLocalIds: [],
        },
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
      "PARTY_ROLE", "PARTY_POSITION", "FACT", "EVENT", "LEGAL_ACT", "MEASURE", "CONTRADICTION", "GAP", "DEADLINE_CANDIDATE",
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
    expect(readModel?.partyPositions).toEqual([
      expect.objectContaining({
        kind: "PARTY_POSITION",
        normalizedText: "L'autorita sostiene che la prescrizione non sia stata rispettata",
        evidence: [expect.objectContaining({ basisRef: "DOCUMENT_1.PAGE_1", pageNumber: 1 })],
      }),
    ]);
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

  it("persists a controlled V7 revision for an unchanged corpus without reusing the V1 revision", async () => {
    const db = await database();
    const input = {
      ...scope(),
      corpusFingerprint: "7".repeat(64),
      knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    };
    const first = await persistStructuredKnowledgeRevision(input, context(db));
    const second = await persistStructuredKnowledgeRevision({
      ...input,
      revisionContractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V7",
    }, context(db));

    expect(second.revision.id).not.toBe(first.revision.id);
    expect(second.revision).toMatchObject({
      contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V7",
      corpusFingerprint: "7".repeat(64),
      status: "CURRENT",
    });

    const revisions = await db.query<{
      id: string;
      status: string;
      contractVersion: string;
    }>(`
      SELECT "id", "status", "contractVersion"
      FROM "FascicoloKnowledgeRevision"
      WHERE "tenantId"='tenant-a' AND "procedimentoId"='procedure-a1'
      ORDER BY "createdAt", "id"
    `);
    expect(revisions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.revision.id, status: "SUPERSEDED" }),
      expect.objectContaining({
        id: second.revision.id,
        status: "CURRENT",
        contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V7",
      }),
    ]));
  });

  it("keeps V7 BUILDING and preserves the previous CURRENT until final promotion succeeds", async () => {
    const db = await database();
    const ctx = context(db);
    const first = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "a".repeat(64),
      knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const prepared = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "b".repeat(64),
      knowledge: structuredKnowledge(),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
      revisionContractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V7",
      deferPromotion: true,
    }, ctx);

    expect(prepared.revision.status).toBe("BUILDING");
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(first.revision.id);

    await expect(promotePreparedKnowledgeRevision({
      ...scope(),
      revisionId: prepared.revision.id,
      expectedCurrentRevisionId: first.revision.id,
    }, {
      ...ctx,
      beforeCurrentPromotion: async () => {
        throw new Error("SYNTHETIC_FINALIZATION_FAILURE");
      },
    })).rejects.toThrow("SYNTHETIC_FINALIZATION_FAILURE");
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(first.revision.id);

    const promoted = await promotePreparedKnowledgeRevision({
      ...scope(),
      revisionId: prepared.revision.id,
      expectedCurrentRevisionId: first.revision.id,
    }, ctx);
    expect(promoted.status).toBe("CURRENT");
    expect((await getCurrentKnowledgeRevision(scope(), ctx))?.id).toBe(prepared.revision.id);
  });

  it("blocks CURRENT when one material event loses its evidence even if most proposals remain valid", async () => {
    const db = await database();
    const ctx = context(db);
    await expect(persistStructuredKnowledgeRevision({
      ...scope(), corpusFingerprint: "2".repeat(64),
      knowledge: structuredKnowledge({ eventEvidence: "DOCUMENT_99.PAGE_1" }),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx)).rejects.toMatchObject({
      assessment: expect.objectContaining({
        blockingReasons: expect.arrayContaining([
          "EVIDENCE_COVERAGE_LOST",
          "MATERIAL_ITEMS_LOST",
        ]),
        rejections: expect.arrayContaining([
          expect.objectContaining({
            localId: "event-exact",
            reason: "INVALID_EVIDENCE",
          }),
        ]),
      }),
    });
    expect(await getCurrentKnowledgeRevision(scope(), ctx)).toBeNull();
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

  it("keeps equal facts distinct when they belong to different administrative proceedings", async () => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const identified = {
      ...base,
      items: base.items.map((item) => item.localId === "fact-a" || item.localId === "fact-b"
        ? {
            ...item,
            payload: {
              ...item.payload,
              normalizedStatement: "Il procedimento è ancora pendente",
              subjectLocalIds: ["subject-authority"],
              proceedingIdentity: {
                declaredKey: "shared-declared-key",
                canonicalAnchorLocalId: item.localId === "fact-a" ? "legal-act" : "measure",
                kind: "ADMINISTRATIVE_ORIGINAL" as const,
                evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
              },
            },
          }
        : item),
    };
    const result = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "6".repeat(64),
      knowledge: identified,
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const facts = result.revision.items.filter((item) => item.kind === "FACT"
      && item.normalizedText === "Il procedimento è ancora pendente");
    expect(facts).toHaveLength(2);
    expect(new Set(facts.map((item) => item.semanticKey))).toHaveLength(2);
  });

  it.each([
    ["object", "Titolo A", "Titolo B", null, null],
    ["qualifier", null, null, "originale", "integrazione"],
  ] as const)("keeps anchored facts distinct when %s materially differs", async (
    _field,
    firstObject,
    secondObject,
    firstQualifier,
    secondQualifier,
  ) => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const identified = {
      ...base,
      items: base.items.map((item) => item.localId === "fact-a" || item.localId === "fact-b"
        ? {
            ...item,
            payload: {
              ...item.payload,
              normalizedStatement: "Il titolo è stato depositato",
              subjectLocalIds: ["subject-authority"],
              object: item.localId === "fact-a" ? firstObject : secondObject,
              qualifier: item.localId === "fact-a" ? firstQualifier : secondQualifier,
              proceedingIdentity: {
                canonicalAnchorLocalId: "measure",
                kind: "ADMINISTRATIVE_ORIGINAL" as const,
                evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
              },
            },
          }
        : item),
    };
    const result = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "1".repeat(64),
      knowledge: identified,
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const facts = result.revision.items.filter((item) => item.kind === "FACT"
      && item.normalizedText === "Il titolo è stato depositato");
    expect(facts).toHaveLength(2);
    expect(new Set(facts.map((item) => item.semanticKey))).toHaveLength(2);
  });

  it("keeps anchored events distinct when their titles differ", async () => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const source = base.items.find((item) => item.localId === "event-exact")!;
    if (source.kind !== "EVENT") throw new Error("Expected event fixture.");
    const events = ["Avvio", "Conclusione"].map((title, index) => ({
      ...source,
      localId: `event-collision-${index}`,
      payload: {
        ...source.payload,
        title,
        normalizedStatement: "Stato del procedimento registrato",
        relatedItemLocalIds: ["fact-a"],
        proceedingIdentity: {
          canonicalAnchorLocalId: "measure",
          kind: "ADMINISTRATIVE_ORIGINAL" as const,
          evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
        },
      },
    }));
    const result = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "2".repeat(64),
      knowledge: { ...base, items: [...base.items, ...events] },
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const persisted = result.revision.items.filter((item) => item.normalizedText === "Stato del procedimento registrato");
    expect(persisted).toHaveLength(2);
    expect(new Set(persisted.map((item) => item.semanticKey))).toHaveLength(2);
  });

  it("keeps anchored events distinct when their structural relations differ", async () => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const source = base.items.find((item) => item.localId === "event-exact")!;
    if (source.kind !== "EVENT") throw new Error("Expected event fixture.");
    const events = ["fact-a", "fact-b"].map((relatedItemLocalId, index) => ({
      ...source,
      localId: `event-relation-${index}`,
      payload: {
        ...source.payload,
        title: "Aggiornamento",
        normalizedStatement: "Aggiornamento del procedimento registrato",
        relatedItemLocalIds: [relatedItemLocalId],
        proceedingIdentity: {
          canonicalAnchorLocalId: "measure",
          kind: "ADMINISTRATIVE_ORIGINAL" as const,
          evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
        },
      },
    }));
    const result = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "3".repeat(64),
      knowledge: { ...base, items: [...base.items, ...events] },
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const persisted = result.revision.items.filter((item) => item.normalizedText === "Aggiornamento del procedimento registrato");
    expect(persisted).toHaveLength(2);
    expect(new Set(persisted.map((item) => item.semanticKey))).toHaveLength(2);
  });

  it("keeps anchored event identity stable across relation order and content-only changes", async () => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const withEvent = (relatedItemLocalIds: readonly string[], confidence: number) => ({
      ...base,
      items: base.items.map((item) => item.localId === "event-exact" ? {
        ...item,
        confidence,
        payload: {
          ...item.payload,
          relatedItemLocalIds: [...relatedItemLocalIds],
          proceedingIdentity: {
            canonicalAnchorLocalId: "measure",
            kind: "ADMINISTRATIVE_ORIGINAL" as const,
            evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
          },
        },
      } : item),
    });
    const first = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "5".repeat(64),
      knowledge: withEvent(["fact-a", "fact-b"], 88),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const firstEvent = first.revision.items.find((item) => item.kind === "EVENT"
      && item.normalizedText === "Partenza registrata")!;
    const second = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "7".repeat(64),
      knowledge: withEvent(["fact-b", "fact-a"], 75),
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const secondEvent = second.revision.items.find((item) => item.kind === "EVENT"
      && item.normalizedText === "Partenza registrata")!;
    expect(secondEvent.semanticKey).toBe(firstEvent.semanticKey);
    expect(secondEvent.contentFingerprint).not.toBe(firstEvent.contentFingerprint);
    expect(second.classifications.find((entry) => entry.semanticKey === firstEvent.semanticKey)).toMatchObject({
      classification: "MODIFIED",
      previousItemId: firstEvent.id,
    });
  });

  it("keeps legal issues distinct when their documented origins differ", async () => {
    const db = await database();
    const ctx = context(db);
    const base = structuredKnowledge();
    const issue = (localId: string, originLocalId: string) => ({
      localId,
      title: "Disciplina del procedimento",
      normalizedIssue: "Quale disciplina si applica?",
      areaOfLaw: "diritto amministrativo",
      priority: "HIGH" as const,
      rationale: "La disciplina dipende dai fatti documentati.",
      originatingItemLocalIds: [originLocalId, "measure"],
      confidence: 90,
      referenceDateBasis: null,
      targetProceedingIdentity: {
        canonicalAnchorLocalId: "measure",
        kind: "ADMINISTRATIVE_ORIGINAL" as const,
        evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
      },
    });
    const result = await persistStructuredKnowledgeRevision({
      ...scope(),
      corpusFingerprint: "4".repeat(64),
      knowledge: {
        ...base,
        legalIssues: [issue("issue-a", "fact-a"), issue("issue-b", "fact-b")],
      },
      evidenceByBasisRef: new Map([["DOCUMENT_1.PAGE_1", evidence()]]),
    }, ctx);
    const issues = result.revision.items.filter((item) => item.kind === "LEGAL_ISSUE");
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((item) => item.semanticKey))).toHaveLength(2);
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
      items: structuredKnowledge().items.map((item) => (
        item.localId === "fact-a" || item.localId === "event-exact"
          ? {
              ...item,
              payload: {
                ...item.payload,
                proceedingIdentity: {
                  declaredKey: "administrative-proceeding-a",
                  canonicalAnchorLocalId: "measure",
                  kind: "ADMINISTRATIVE_ORIGINAL" as const,
                  evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
                },
              },
            }
          : item
      )),
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
        targetProceedingIdentity: {
          declaredKey: "administrative-proceeding-a",
          canonicalAnchorLocalId: "measure",
          kind: "ADMINISTRATIVE_ORIGINAL" as const,
          evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
        },
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
    expect(readModel?.legalIssues[0].payload).toMatchObject({
      targetProceedingIdentity: { canonicalAnchorSemanticKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(readModel?.facts.find((item) => item.normalizedText.includes("12:50"))?.payload).toMatchObject({
      proceedingIdentity: { canonicalAnchorSemanticKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(readModel?.legalIssues[0].originatingItemIds).toHaveLength(3);
    expect(readModel?.researchQuestions[0]).toMatchObject({ legalIssueId: readModel!.legalIssues[0].id });
  });

  it("rejects the frozen Selvara baseline because formally valid citations do not prove corpus completeness", () => {
    const sourceTextByBasisRef = new Map(selvaraOfflinePages.map((page) => [page.reference, page.text]));
    const evidenceByBasisRef = new Map(selvaraOfflinePages.map((page) => [page.reference, {
      provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
      documentoId: "document-a1",
      documentFileVersionId: "version-a1",
      documentExtractionAttemptId: "attempt-selvara-offline",
      pageNumber: page.pageNumber,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      quoteSha256: null,
      basisRef: page.reference,
    } satisfies KnowledgeEvidenceCandidate]));
    const baseline = fascicoloStructuredKnowledgeSchema.parse(selvaraOfflineStructuredKnowledgeBaseline);
    const projection = projectStructuredKnowledge({
      knowledge: baseline,
      subjectIdsByLocalId: new Map([
        ["subject-concessionaria", "subject-offline-concessionaria"],
        ["subject-authority", "subject-offline-authority"],
        ["subject-third-operator", "subject-offline-third-operator"],
      ]),
      evidenceByBasisRef,
      sourceTextByBasisRef,
    });

    expect(projection.quality).toMatchObject({
      proposedCount: 35,
      acceptedCount: 35,
      exactCitationCount: 24,
      ambiguousCitationCount: 0,
      nonexistentCitationCount: 0,
      corpusDocumentCount: 0,
      missingInventoryBasisRefCount: 40,
      blockingReasons: ["DOCUMENT_INVENTORY_INCOMPLETE"],
    });
  });

  it.each([
    [6, "determinazione di aggiudicazione"],
    [8, "seconda parte del titolo"],
    [11, "fideiussione"],
    [17, "pagamento"],
    [20, "richiesta di riprogrammazione"],
    [37, "difesa favorevole"],
    [27, "batimetria"],
    [28, "documentazione strutturale"],
    [39, "planimetria M4"],
  ])("blocks CURRENT when page %i (%s) is not inventoried", (pageNumber) => {
    const incomplete = structuredClone(selvaraOfflineStructuredKnowledge);
    incomplete.documentInventory = incomplete.documentInventory.filter((document) => (
      !document.basisRefs.includes(`DOCUMENT_1.PAGE_${pageNumber}`)
    ));
    const parsed = fascicoloStructuredKnowledgeSchema.parse(incomplete);
    const sourceTextByBasisRef = new Map(selvaraOfflinePages.map((page) => [page.reference, page.text]));
    const evidenceByBasisRef = new Map(selvaraOfflinePages.map((page) => [page.reference, {
      provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
      documentoId: "document-a1",
      documentFileVersionId: "version-a1",
      documentExtractionAttemptId: "attempt-selvara-offline",
      pageNumber: page.pageNumber,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      quoteSha256: null,
      basisRef: page.reference,
    } satisfies KnowledgeEvidenceCandidate]));
    const projection = projectStructuredKnowledge({
      knowledge: parsed,
      subjectIdsByLocalId: new Map([
        ["subject-concessionaria", "subject-offline-concessionaria"],
        ["subject-authority", "subject-offline-authority"],
        ["subject-third-operator", "subject-offline-third-operator"],
      ]),
      evidenceByBasisRef,
      sourceTextByBasisRef,
    });

    expect(projection.quality.blockingReasons).toContain("DOCUMENT_INVENTORY_INCOMPLETE");
    expect(projection.quality.missingInventoryBasisRefCount).toBe(1);
  });

  it("applies the same inventory gate to a different two-document procurement dossier", () => {
    const sourceTextByBasisRef = new Map([
      ["DOCUMENT_2.PAGE_1", "Determina 9/2026. Il Comune aggiudica la fornitura per euro 80.000."],
      ["DOCUMENT_2.PAGE_2", "Fattura 44/2026. Il fornitore richiede euro 80.000; il collaudo non e allegato."],
    ]);
    const evidenceByBasisRef = new Map([...sourceTextByBasisRef].map(([basisRef, text], index) => [basisRef, {
      provenanceType: "FASCICOLO_DOCUMENT_EXTRACTION" as const,
      documentoId: "document-procurement",
      documentFileVersionId: "version-procurement",
      documentExtractionAttemptId: "attempt-procurement",
      pageNumber: index + 1,
      textSha256: createHash("sha256").update(text, "utf8").digest("hex"),
      quoteSha256: null,
      basisRef,
    } satisfies KnowledgeEvidenceCandidate]));
    const complete = fascicoloStructuredKnowledgeSchema.parse({
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [],
      items: [{
        localId: "procurement-award",
        kind: "FACT",
        confidence: 100,
        basisRefs: ["DOCUMENT_2.PAGE_1"],
        payload: {
          normalizedStatement: "Il Comune ha aggiudicato la fornitura per euro 80.000.",
          subjectLocalIds: [],
          object: "aggiudicazione",
          qualifier: "determina",
        },
      }, {
        localId: "procurement-invoice-gap",
        kind: "GAP",
        confidence: 100,
        basisRefs: ["DOCUMENT_2.PAGE_2"],
        payload: {
          gapType: "COLLAUDO_MISSING",
          description: "La fattura richiede euro 80.000 ma il collaudo non e allegato.",
          impact: "La liquidabilita richiede verifica.",
          relatedItemLocalIds: ["procurement-award"],
        },
      }],
      sourceQuotes: [{
        itemLocalId: "procurement-award",
        basisRef: "DOCUMENT_2.PAGE_1",
        quote: "Il Comune aggiudica la fornitura per euro 80.000.",
      }, {
        itemLocalId: "procurement-invoice-gap",
        basisRef: "DOCUMENT_2.PAGE_2",
        quote: "Il fornitore richiede euro 80.000; il collaudo non e allegato.",
      }],
      documentInventory: [{
        localId: "procurement-document-1",
        basisRefs: ["DOCUMENT_2.PAGE_1"],
        documentType: "determinazione",
        documentDate: null,
        issuer: "Comune",
        recipients: [],
        proceduralPhase: "aggiudicazione",
        subject: "aggiudicazione fornitura",
        summary: "Atto di aggiudicazione.",
        referencedActs: [],
        attachments: [],
        materialProfiles: ["PROCEDURAL", "ACCOUNTING"],
        classification: "MATERIAL",
        rationale: "Definisce titolo e importo.",
        relatedItemLocalIds: ["procurement-award"],
      }, {
        localId: "procurement-document-2",
        basisRefs: ["DOCUMENT_2.PAGE_2"],
        documentType: "fattura",
        documentDate: null,
        issuer: "Fornitore",
        recipients: ["Comune"],
        proceduralPhase: "esecuzione",
        subject: "richiesta di pagamento",
        summary: "Fattura priva di collaudo allegato.",
        referencedActs: [],
        attachments: [],
        materialProfiles: ["ACCOUNTING", "EVIDENTIARY"],
        classification: "MATERIAL",
        rationale: "Incide sulla liquidabilita.",
        relatedItemLocalIds: ["procurement-invoice-gap"],
      }],
      legalIssues: [],
      researchQuestions: [],
    });
    const projection = projectStructuredKnowledge({
      knowledge: complete,
      subjectIdsByLocalId: new Map(),
      evidenceByBasisRef,
      sourceTextByBasisRef,
    });
    expect(projection.quality).toMatchObject({
      corpusDocumentCount: 2,
      reviewedDocumentCount: 2,
      materialDocumentCount: 2,
      uncoveredMaterialDocumentCount: 0,
      missingInventoryBasisRefCount: 0,
      blockingReasons: [],
    });
  });

  it("compiles raw Selvara provider output through the V7 job to a current readable report", async () => {
    const db = await database();
    await db.query(`
      UPDATE "DocumentFileVersion"
      SET "sha256" = $1
      WHERE "id" = 'version-a1'
    `, [selvaraOfflineCorpusMetadata.sourcePdfSha256]);
    await db.query(`
      INSERT INTO "DocumentExtractionAttempt"
        ("id", "documentoId", "documentFileVersionId", "tenantId", "procedimentoId", "sourceSha256", "outcome")
      VALUES ('attempt-selvara-offline', 'document-a1', 'version-a1', 'tenant-a', 'procedure-a1', $1, 'SUCCEEDED')
    `, [selvaraOfflineCorpusMetadata.sourcePdfSha256]);
    for (const page of selvaraOfflinePages) {
      await db.query(`
        INSERT INTO "DocumentExtractionPage"
          ("id", "extractionAttemptId", "pageNumber", "textSha256")
        VALUES ($1, 'attempt-selvara-offline', $2, $3)
      `, [
        `selvara-page-${page.pageNumber}`,
        page.pageNumber,
        createHash("sha256").update(page.text, "utf8").digest("hex"),
      ]);
    }
    const recoverableSelvaraProposal = {
      ...structuredClone(selvaraOfflineStructuredKnowledge),
      items: selvaraOfflineStructuredKnowledge.items.map((item) => {
        if (item.kind !== "FACT" && item.kind !== "EVENT") return structuredClone(item);
        return {
          ...structuredClone(item),
          payload: {
            ...structuredClone(item.payload),
            proceedingIdentityHint: null,
          },
        };
      }),
      legalIssues: selvaraOfflineStructuredKnowledge.legalIssues.map((issue) => (
        issue.localId === "issue-canoni"
          ? {
              localId: issue.localId,
              title: issue.title,
              normalizedIssue: issue.normalizedIssue,
              areaOfLaw: issue.areaOfLaw,
              priority: issue.priority,
              rationale: issue.rationale,
              originatingItemLocalIds: [...issue.originatingItemLocalIds, "act-concession"],
              confidence: issue.confidence,
              referenceDateBasis: issue.referenceDateBasis,
              targetProceedingHint: {
                declaredKey: "concessione-demariale-17-2023",
                candidateAnchorLocalId: "provider-missing-anchor",
                kind: "ADMINISTRATIVE_ORIGINAL" as const,
                evidenceBasisRefs: ["DOCUMENT_1.PAGE_40"],
              },
            }
          : {
              localId: issue.localId,
              title: issue.title,
              normalizedIssue: issue.normalizedIssue,
              areaOfLaw: issue.areaOfLaw,
              priority: issue.priority,
              rationale: issue.rationale,
              originatingItemLocalIds: [...issue.originatingItemLocalIds],
              confidence: issue.confidence,
              referenceDateBasis: issue.referenceDateBasis,
              targetProceedingHint: null,
            }
      )),
    };
    const selvaraEvidenceSpans = buildFascicoloEvidenceSpanCatalog(
      selvaraOfflinePages.map((page) => ({
        reference: `DOCUMENT_1.PAGE_${page.pageNumber}`,
        pageNumber: page.pageNumber,
        documentVersionId: "attempt-selvara-offline",
        text: page.text,
        textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      })),
    );
    const {
      sourceQuotes: recoverableSourceQuotes,
      ...recoverableCandidateProposal
    } = recoverableSelvaraProposal;
    const providerOutput = {
      summary: {
        text: "Il fascicolo documenta concessione, esecuzione e criticita.",
        basisRefs: ["DOCUMENT_1.PAGE_7"],
      },
      timeline: [{
        recordedAt: "2023-07-14T00:00:00.000Z",
        text: "Rilascio della concessione.",
        basisRefs: ["DOCUMENT_1.PAGE_7"],
      }],
      recordedState: [{
        text: "Il fascicolo contiene quaranta pagine estratte.",
        basisRefs: ["DOCUMENT_1.PAGE_1"],
      }],
      signals: [{
        type: "VERIFY" as const,
        text: "Verificare le lacune documentali censite.",
        basisRefs: ["DOCUMENT_1.PAGE_28"],
      }],
      investigativeQuestions: [{
        text: "Acquisire gli atti mancanti.",
        basisRefs: ["DOCUMENT_1.PAGE_28"],
      }],
      suggestedActivities: [{
        text: "Completare l'istruttoria documentale.",
        basisRefs: ["DOCUMENT_1.PAGE_28"],
      }],
      legalResearchQuestions: [{
        text: "Verificare la disciplina applicabile.",
        basisRefs: ["DOCUMENT_1.PAGE_7"],
      }],
      structuredKnowledge: fascicoloDocumentKnowledgeCandidateProposalSchema.parse({
        ...recoverableCandidateProposal,
        evidenceCandidates: recoverableSourceQuotes.map((sourceQuote) => {
          const span = selvaraEvidenceSpans.find((candidate) => (
            candidate.basisRef === sourceQuote.basisRef
          ));
          if (!span) throw new Error(`Missing Selvara evidence span for ${sourceQuote.itemLocalId}`);
          return {
            itemLocalId: sourceQuote.itemLocalId,
            evidenceSpanId: span.id,
          };
        }),
      }),
    };
    const analysisService = createFascicoloDocumentAnalysisService({
      provider: { analyze: vi.fn(async () => providerOutput) },
      maxInputBytes: 200_000,
      realDataActivation: createRealDataActivationPolicy({
        AI_REAL_DATA_ENABLED: "true",
        AI_REAL_DATA_APPROVAL_ID: "offline-selvara-integration",
        AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
      }),
    });
    const captured: {
      persisted?: Awaited<ReturnType<typeof persistStructuredKnowledgeRevision>>;
      report?: ReturnType<typeof buildStructuredFascicoloReport>;
      archived?: Awaited<ReturnType<typeof persistStructuredFascicoloReport>>;
      draftArchived?: Awaited<ReturnType<typeof persistDraftStructuredFascicoloReport>>;
    } = {};
    const dependencies: FascicoloAutomaticAnalysisDependencies = {
      loadAuthority: async () => ({
        sourceKind: "DOCUMENT_CORPUS",
        tenantId: "tenant-a",
        procedimentoId: "procedure-a1",
        extractionAttemptId: "attempt-selvara-offline",
        artifactSha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
        corpusFingerprint:
          "c9f04d508174cba8e7939704da11921963c60656660df988ee4cb5fdd25cdd5f",
        actorId: "offline-actor",
        documents: [{
          neutralIntakeId: "",
          documentVersionId: "attempt-selvara-offline",
          artifactSha256: selvaraOfflineCorpusMetadata.sourcePdfSha256,
          documentoId: "document-a1",
          documentFileVersionId: "version-a1",
          pages: selvaraOfflinePages.map((page) => ({
            pageNumber: page.pageNumber,
            normalizedText: page.text,
            sourceText: page.text,
            textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
            extractionMethod: "DIRECT_TEXT",
            ocrConfidence: null,
          })),
        }],
      }),
      validateControlledV7Preflight: async () => undefined,
      getCurrentRevision: (input) => getCurrentKnowledgeRevision(input, context(db)),
      findExistingReport: async () => null,
      analyze: (input) => analysisService.analyze(input),
      async persistKnowledge(input) {
        captured.persisted = await persistStructuredKnowledgeRevision({
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          corpusFingerprint: input.corpusFingerprint,
          knowledge: input.knowledge,
          evidenceByBasisRef: input.evidenceByBasisRef,
          sourceTextByBasisRef: input.sourceTextByBasisRef,
          revisionContractVersion: input.forceNewRevision
            ? FASCICOLO_V7_KNOWLEDGE_REVISION_CONTRACT
            : undefined,
          deferPromotion: input.deferPromotion,
          preserveDraftOnQualityFailure: input.preserveDraftOnQualityFailure,
          compilation: input.compilation,
        }, context(db));
        return captured.persisted;
      },
      async prepareStructuredReport(input) {
        const knowledge = await loadStructuredKnowledgeRevision(
          input.tenantId,
          input.procedimentoId,
          input.knowledgeRevisionId,
          queryExecutor(db),
        );
        if (!knowledge) return null;
        captured.report = buildStructuredFascicoloReport({
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          knowledge,
          missions: [],
        });
        return captured.report;
      },
      async finalizeControlledV7(input) {
        const revision = await promotePreparedKnowledgeRevision({
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          revisionId: input.knowledgeRevisionId,
          expectedCurrentRevisionId: input.expectedCurrentRevisionId,
        }, context(db));
        captured.archived = await persistStructuredFascicoloReport(
          input.report,
          reportContext(db),
        );
        return {
          revision,
          outcome: captured.archived.outcome,
          snapshotId: captured.archived.snapshot.id,
        };
      },
      async persistDraftStructuredReport(input) {
        captured.draftArchived = await persistDraftStructuredFascicoloReport(
          input.report,
          reportContext(db),
        );
        return {
          outcome: captured.draftArchived.outcome,
          snapshotId: captured.draftArchived.snapshot.id,
        };
      },
      reconcileKnowledgeMissions: async () => [],
      resolveMissionAssignee: async () => "offline-actor",
      persistReport: async () => {
        throw new Error("Unexpected legacy report persistence.");
      },
      persistMission: async () => {
        throw new Error("Unexpected mission persistence.");
      },
      scheduleMission: async () => {
        throw new Error("Unexpected mission scheduling.");
      },
      listPriorReportIds: async () => [],
    };
    const handler = createFascicoloAutomaticAnalysisHandler(dependencies);
    const reference = handler.parseInput({
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId:
        "c9f04d508174cba8e7939704da11921963c60656660df988ee4cb5fdd25cdd5f",
      referenceVersion: "V1",
      metadata: {
        procedimentoId: "procedure-a1",
        corpusHash:
          "c9f04d508174cba8e7939704da11921963c60656660df988ee4cb5fdd25cdd5f",
        trialContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
        trialPreflightHash: "d".repeat(64),
      },
    });
    await expect(handler.execute(reference, {
      jobId: "offline-selvara-v7-job",
      correlationId: "offline-selvara-v7-correlation",
      attempt: 1,
      isCancellationRequested: async () => false,
      heartbeat: async () => undefined,
    })).resolves.toMatchObject({
      referenceType: "FASCICOLO_KNOWLEDGE_REVISION",
      metadata: {
        persistenceCode: "CREATED",
        structuredReportPersistenceCode: "CREATED",
      },
    });
    const readModel = await loadCurrentStructuredKnowledge(
      "tenant-a",
      "procedure-a1",
      queryExecutor(db),
    );
    expect(readModel).not.toBeNull();
    const reportSnapshots = await listStructuredFascicoloReportSnapshots(
      scope(),
      reportContext(db),
    );
    if (!captured.persisted || !captured.report || !captured.archived) {
      throw new Error("Expected V7 persistence, finalization, and report archival.");
    }
    const persisted = captured.persisted;
    const report = captured.report;
    const archived = captured.archived;

    expect(selvaraOfflinePages).toHaveLength(40);
    expect(selvaraOfflineCorpusMetadata).toMatchObject({
      sourcePdfSha256: "644e04331c5482d28729b2efd91798b404da9940cc4487ee36ad056167c2741c",
      pageCount: 40,
      pageHashScope: "OFFLINE_PDFJS_TEXT_NOT_NEON_CANONICAL",
      canonicalNeonTextHashesAvailable: false,
    });
    expect(selvaraOfflinePages[27]).toMatchObject({
      pageNumber: 28,
      offlineTextSha256: "1aedb653e24eb3b3f05386229be176cd8464f85c1ff4402a4ac2c23230f15b51",
      hashScope: "OFFLINE_PDFJS_TEXT_NOT_NEON_CANONICAL",
    });
    expect(selvaraOfflinePages[27].text).toContain("Portanza attuale non attestabile da\nquesto rapporto");
    expect(selvaraOfflinePages[27].text).toContain("Il valore 40 kN/m² non è un’autorizzazione all’uso con qualsiasi combinazione di carichi.");
    expect(persisted.quality).toMatchObject({
      proposedCount: 59,
      acceptedCount: 59,
      correctedCount: 2,
      rejectedCount: 0,
      evidenceCoverage: 1,
      exactCitationCount: 46,
      recoveredCitationCount: 0,
      optionalMissingRelationCount: 0,
      unresolvedRequiredDependencyCount: 0,
      ambiguousCitationCount: 0,
      nonexistentCitationCount: 0,
      lostLegalIssueCount: 0,
      lostRelationCount: 0,
      corpusDocumentCount: 40,
      reviewedDocumentCount: 40,
      materialDocumentCount: 39,
      nonMaterialDocumentCount: 1,
      uncertainDocumentCount: 0,
      uncoveredMaterialDocumentCount: 0,
      missingInventoryBasisRefCount: 0,
      blockingReasons: [],
    });
    expect(readModel).toMatchObject({
      facts: { length: 12 },
      events: { length: 8 },
      legalActs: { length: 4 },
      measures: { length: 0 },
      contradictions: { length: 1 },
      gaps: { length: 11 },
      legalIssues: { length: 7 },
      researchQuestions: { length: 6 },
    });
    const reconciledIssueIdentity = readModel!.legalIssues.flatMap((issue) => {
      if (!isRecord(issue.payload)) return [];
      const resolution = issue.payload.targetProceedingResolution;
      if (!isRecord(resolution) || !isRecord(resolution.providerClaim)
        || resolution.providerClaim.declaredKey !== "concessione-demariale-17-2023") {
        return [];
      }
      const target = issue.payload.targetProceedingIdentity;
      return isRecord(target)
        ? [{ target, resolution }]
        : [];
    })[0];
    expect(reconciledIssueIdentity).toMatchObject({
      target: {
        canonicalAnchorSemanticKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        evidenceBasisRefs: ["DOCUMENT_1.PAGE_7"],
      },
      resolution: {
        status: "VERIFIED",
        action: "REBUILT",
        providerClaim: { declaredKey: "concessione-demariale-17-2023" },
      },
    });
    expect(reconciledIssueIdentity!.target).not.toHaveProperty("declaredKey");
    expect(readModel!.revision.warnings).toHaveLength(54);
    expect(readModel!.revision.warnings.filter((warning) => (
      warning.startsWith("DOCUMENT_INVENTORY:")
    ))).toHaveLength(40);
    expect(readModel!.revision.warnings.filter((warning) => (
      warning.startsWith("PROCEEDING_IDENTITY:")
    ))).toHaveLength(7);
    expect(readModel!.revision.warnings.filter((warning) => (
      warning.startsWith("COMPILATION:")
    ))).toHaveLength(7);
    expect(readModel!.revision.warnings).toContain(
      "PROCEEDING_IDENTITY:REBUILT:VERIFIED:issue-canoni",
    );
    expect(readModel!.revision.warnings).toContain(
      "DOCUMENT_INVENTORY:document-page-1:NOT_MATERIAL:DOCUMENT_1.PAGE_1:Documento di indice privo di autonomi fatti, obblighi o provvedimenti.",
    );
    expect(archived).toMatchObject({
      outcome: "CREATED",
      snapshot: { status: "CURRENT" },
    });
    expect(reportSnapshots).toHaveLength(1);
    expect(reportSnapshots[0]).toMatchObject({
      status: "CURRENT",
      payload: {
        knowledgeRevisionId: readModel!.revision.id,
        legalIssues: expect.arrayContaining([
          expect.objectContaining({
            proceedingIdentity: expect.objectContaining({
              status: "VERIFIED",
              action: "REBUILT",
              linkedAnchor: expect.objectContaining({
                kind: "LEGAL_ACT",
              }),
              evidenceBasisRefs: ["DOCUMENT_1.PAGE_7"],
              providerClaim: expect.objectContaining({
                declaredKey: "concessione-demariale-17-2023",
              }),
            }),
          }),
        ]),
      },
    });
    const narrative = report.payload.professionalNarrative!;
    expect(narrative).toMatchObject({
      status: "PRELIMINARY_DOCUMENT_BASED",
      documentaryReferences: expect.arrayContaining([
        "DOCUMENT_1.PAGE_7",
        "DOCUMENT_1.PAGE_16",
        "DOCUMENT_1.PAGE_28",
        "DOCUMENT_1.PAGE_40",
      ]),
    });
    expect(narrative.complianceAndAllegedBreaches)
      .toHaveLength(6);
    expect(narrative.technicalAdministrativeAndLegalProfiles)
      .toHaveLength(7);
    expect(narrative.legalResearchStatus)
      .toContain("non costituiscono conclusioni giuridiche definitive");
    expect(report.payload.operationalPlans).toHaveLength(7);
    const canoniPlan = report.payload.operationalPlans?.find((plan) =>
      plan.evidence.includes("DOCUMENT_1.PAGE_36"));
    const structuralPlan = report.payload.operationalPlans?.find((plan) =>
      plan.evidence.includes("DOCUMENT_1.PAGE_28"));
    for (const plan of [canoniPlan, structuralPlan]) {
      expect(plan).toMatchObject({
        professionalStatus: "PRELIMINARY_NOT_APPROVED",
        legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
        actsToForm: expect.any(Array),
        modelsAvailable: expect.any(Array),
      });
      expect(plan!.problem).toBe(plan!.issueText);
      expect(plan!.evidence.length).toBeGreaterThan(0);
      expect(plan!.legalQualification).toContain("nessuna qualificazione definitiva");
      expect(plan!.investigationActivities).toHaveLength(4);
      expect(plan!.alternatives.length).toBeGreaterThan(1);
      expect(plan!.administrativeActs.length).toBeGreaterThanOrEqual(2);
      for (const draft of plan!.administrativeActs) {
        expect(draft).toMatchObject({
          templateSource: "INTERNAL_TEMPLATE_REQUIRED_IF_AVAILABLE",
          automaticExecutionProhibited: true,
          sections: {
            heading: expect.any(String),
            subject: expect.any(String),
            premises: expect.any(Array),
            documentedFacts: expect.any(Array),
            investigation: expect.any(Array),
            reasoning: expect.any(Array),
            legalReferences: expect.any(Array),
            operativePart: expect.any(Array),
            communications: expect.any(Array),
            signature: expect.stringContaining("FIRMA"),
          },
        });
      }
    }
    expect(canoniPlan!.administrativeActs.map((act) => act.actType)).toEqual([
      "ACQUISIZIONE_PARTITARIO_E_ATTESTAZIONE_TESORERIA",
      "RICHIESTA_DOCUMENTI_CONTABILI_AL_CONCESSIONARIO",
      "PROVVEDIMENTO_SU_RIPIANO_O_REGOLARIZZAZIONE",
    ]);
    expect(canoniPlan!.administrativeActs[0].sections.documentedFacts.join(" ")).toContain("euro 20.000");
    expect(canoniPlan!.administrativeActs[0].sections.documentedFacts.join(" ")).toContain("euro 15.000");
    expect(canoniPlan!.administrativeActs[0].sections.documentedFacts.join(" ")).toContain("euro 30.000");
    expect(canoniPlan!.administrativeActs[0].sections.investigation.join(" ")).toContain("partitario ufficiale");
    expect(structuralPlan!.administrativeActs.map((act) => act.actType)).toEqual([
      "RICHIESTA_ACCERTAMENTO_SPECIALISTICO_STRUTTURALE_E_IMPIANTISTICO",
      "DISPOSIZIONE_E_VERBALE_DI_SOPRALLUOGO_TECNICO",
      "PRESCRIZIONE_TECNICA_MOTIVATA",
    ]);
    expect(structuralPlan!.administrativeActs[0].sections.documentedFacts.join(" ")).toContain("portanza");
    expect(structuralPlan!.administrativeActs[0].sections.investigation.join(" ")).toContain("carichi");
    expect(JSON.stringify(report.payload.operationalPlans)).not.toContain("art. 48 cod. nav.");
    expect(JSON.stringify(report.payload.operationalPlans)).not.toContain("art. 54 cod. nav.");

    const insufficientOutput = structuredClone(providerOutput);
    insufficientOutput.structuredKnowledge.evidenceCandidates =
      insufficientOutput.structuredKnowledge.evidenceCandidates.filter((candidate) => (
        candidate.itemLocalId !== "act-concession"
      ));
    const insufficientAnalysisService = createFascicoloDocumentAnalysisService({
      provider: { analyze: vi.fn(async () => insufficientOutput) },
      maxInputBytes: 200_000,
      realDataActivation: createRealDataActivationPolicy({
        AI_REAL_DATA_ENABLED: "true",
        AI_REAL_DATA_APPROVAL_ID: "offline-selvara-integration",
        AI_PROVIDER_PROJECT_CLASS: "REAL_DATA_APPROVED",
      }),
    });
    const draftCorpusFingerprint = "e".repeat(64);
    const draftDependencies: FascicoloAutomaticAnalysisDependencies = {
      ...dependencies,
      loadAuthority: async () => ({
        ...(await dependencies.loadAuthority({
          jobId: "offline-selvara-v7-draft-job",
          reference,
        }))!,
        corpusFingerprint: draftCorpusFingerprint,
      }),
      analyze: (input) => insufficientAnalysisService.analyze(input),
    };
    const draftHandler = createFascicoloAutomaticAnalysisHandler(draftDependencies);
    const draftReference = draftHandler.parseInput({
      referenceType: "FASCICOLO_DOCUMENT_CORPUS",
      referenceId: draftCorpusFingerprint,
      referenceVersion: "V1",
      metadata: {
        procedimentoId: "procedure-a1",
        corpusHash: draftCorpusFingerprint,
        trialContractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        trialApprovalRef: SELVARA_PILOT_AUTHORIZATION.approvalId,
        trialPreflightHash: "f".repeat(64),
      },
    });
    await expect(draftHandler.execute(draftReference, {
      jobId: "offline-selvara-v7-draft-job",
      correlationId: "offline-selvara-v7-draft-correlation",
      attempt: 1,
      isCancellationRequested: async () => false,
      heartbeat: async () => undefined,
    })).rejects.toMatchObject({
      category: "ANALYSIS",
      code: "STRUCTURED_KNOWLEDGE_MATERIALLY_INCOMPLETE",
      retryable: false,
    });
    const revisions = await db.query<{
      id: string;
      status: string;
      warnings: string[];
    }>(`
      SELECT "id", "status", "warnings"
      FROM "FascicoloKnowledgeRevision"
      WHERE "tenantId" = 'tenant-a' AND "procedimentoId" = 'procedure-a1'
      ORDER BY "createdAt", "id"
    `);
    const draftRevision = revisions.rows.find((revision) => revision.status === "BUILDING");
    expect(draftRevision).toBeDefined();
    expect(draftRevision!.warnings.some((warning) => (
      warning.includes("ITEM_EVIDENCE_NOT_VERIFIED")
    ))).toBe(true);
    const currentAfterDraft = await loadCurrentStructuredKnowledge(
      "tenant-a",
      "procedure-a1",
      queryExecutor(db),
    );
    expect(currentAfterDraft?.revision.id).toBe(readModel!.revision.id);
    const snapshotsAfterDraft = await listStructuredFascicoloReportSnapshots(
      scope(),
      reportContext(db),
    );
    expect(snapshotsAfterDraft).toHaveLength(2);
    expect(snapshotsAfterDraft).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "CURRENT",
        knowledgeRevisionId: readModel!.revision.id,
      }),
      expect.objectContaining({
        status: "STALE",
        knowledgeRevisionId: draftRevision!.id,
        staleReasons: ["KNOWLEDGE_DRAFT_NOT_PROMOTED"],
        payload: expect.objectContaining({
          limitations: expect.arrayContaining([
            expect.stringContaining("ITEM_EVIDENCE_NOT_VERIFIED"),
          ]),
        }),
      }),
    ]));
  });
});

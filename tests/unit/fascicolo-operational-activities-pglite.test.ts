import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type { ActDraft } from "@/server/fascicolo-acts/model";
import {
  ACTIVITY_AUDIT_ACTION,
  ACTIVITY_ENTITY,
  activityNeedsReview,
  activityProgress,
  stableActivityKey,
  type ActivityCommand,
  type ActivitySpec,
} from "@/server/fascicolo-operational-activities/model";
import {
  appendActivityCommand,
  listOperationalActivities,
  type ActivityRepositoryContext,
  type ActivityRepositoryExecutor,
} from "@/server/fascicolo-operational-activities/repository";

const databases: PGlite[] = [];
const scope = { tenantId: "tenant-a", procedimentoId: "procedure-a", concessioneId: "concession-a" };
const actor = { actorId: "user-a", actorEmail: "operator@example.test", actorRole: "ADMIN" };
const reportFingerprint = "b".repeat(64);

function spec(): ActivitySpec {
  return {
    activityKey: stableActivityKey(scope.procedimentoId, "issue-a", "CHECK"),
    issueSemanticKey: "issue-a",
    issueText: "Verifica",
    activityCode: "CHECK",
    title: "Verifica documentale",
    action: "Esaminare la documentazione.",
    office: "Ufficio competente",
    requiredDocuments: ["Documento"],
    completionGate: "Riscontro verificato",
    necessity: "REQUIRED",
    legalSummary: "Conclusione preliminare.",
    legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
    alternatives: [],
    documents: [],
    fingerprint: "a".repeat(64),
  };
}

type Sql = { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> };

function makeExecutor(sql: Sql, drafts: readonly ActDraft[] = [], corpusFingerprint = "c".repeat(64)): ActivityRepositoryExecutor {
  return {
    query: (query, params = []) => sql.query(query, [...params]),
    listDrafts: async () => drafts,
    readCorpusFingerprint: async () => corpusFingerprint,
    audit: ({ scope: inputScope, actor: inputActor, metadata }) => sql.query(`
      INSERT INTO "ActivityLog" ("enteId","entita","azione","entitaId","esito","metadata","createdAt","userEmail","currentHash")
      VALUES ($1,$2,$3,$4,'SUCCESS',$5::jsonb,now(),$6,$7)
    `, [
      inputScope.tenantId, ACTIVITY_ENTITY, ACTIVITY_AUDIT_ACTION,
      `${inputScope.procedimentoId}::${metadata.activityKey}`,
      JSON.stringify(metadata), inputActor.actorEmail, "a".repeat(64),
    ]),
  };
}

function context(database: PGlite, drafts: readonly ActDraft[] = [], corpusFingerprint = "c".repeat(64)): ActivityRepositoryContext {
  return {
    read: makeExecutor(database, drafts, corpusFingerprint),
    transaction: <T>(operation: (tx: ActivityRepositoryExecutor) => Promise<T>) =>
      database.transaction((transaction) => operation(makeExecutor(transaction, drafts, corpusFingerprint))),
    now: () => new Date("2026-11-03T12:00:00Z"),
  };
}

async function database(): Promise<PGlite> {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "Concessione" ("id" text PRIMARY KEY, "enteId" text NOT NULL);
    CREATE TABLE "Procedimento" ("id" text PRIMARY KEY, "enteId" text NOT NULL, "concessioneId" text);
    CREATE TABLE "Documento" (
      "id" text PRIMARY KEY, "procedimentoId" text NOT NULL, "enteId" text NOT NULL, "currentFileVersionId" text
    );
    CREATE TABLE "DocumentFileVersion" (
      "id" text PRIMARY KEY, "documentId" text NOT NULL, "canonicalEnteId" text NOT NULL, "sha256" text NOT NULL
    );
    CREATE TABLE "FascicoloKnowledgeRevision" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "procedimentoId" text NOT NULL,
      "status" text NOT NULL, "corpusFingerprint" text NOT NULL
    );
    CREATE TABLE "StructuredFascicoloReportSnapshot" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "procedimentoId" text NOT NULL,
      "knowledgeRevisionId" text NOT NULL, "reportFingerprint" text NOT NULL, "status" text NOT NULL
    );
    CREATE TABLE "FascicoloOperationalProposal" (
      "id" text PRIMARY KEY, "tenantId" text NOT NULL, "procedimentoId" text NOT NULL,
      "status" text NOT NULL, "proposalType" text NOT NULL, "title" text NOT NULL,
      "knowledgeRevisionId" text NOT NULL, "structuredReportFingerprint" text NOT NULL,
      "originatingIssueSemanticKeys" text[] NOT NULL, "proposedPayload" jsonb NOT NULL,
      "approvedPayload" jsonb, "reviewVersion" integer NOT NULL, "supersededAt" timestamptz
    );
    CREATE TABLE "ActivityLog" (
      "id" bigserial PRIMARY KEY, "enteId" text, "entita" text NOT NULL, "azione" text NOT NULL,
      "entitaId" text, "esito" text NOT NULL, "metadata" jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL, "userEmail" text, "currentHash" text NOT NULL
    );
    INSERT INTO "Concessione" VALUES ('concession-a','tenant-a'),('concession-b','tenant-b');
    INSERT INTO "Procedimento" VALUES
      ('procedure-a','tenant-a','concession-a'),('procedure-b','tenant-b','concession-b');
    INSERT INTO "Documento" VALUES
      ('doc-a','procedure-a','tenant-a','version-doc-a'),
      ('doc-b','procedure-a','tenant-a','version-doc-b'),
      ('foreign','procedure-b','tenant-b','version-foreign');
    INSERT INTO "DocumentFileVersion" VALUES
      ('version-doc-a','doc-a','tenant-a',repeat('a',64)),
      ('version-doc-b','doc-b','tenant-a',repeat('a',64)),
      ('version-foreign','foreign','tenant-b',repeat('a',64));
    INSERT INTO "FascicoloKnowledgeRevision" VALUES
      ('revision-a','tenant-a','procedure-a','CURRENT',repeat('c',64)),
      ('revision-b','tenant-b','procedure-b','CURRENT',repeat('c',64));
    INSERT INTO "StructuredFascicoloReportSnapshot" VALUES
      ('report-a','tenant-a','procedure-a','revision-a',repeat('b',64),'CURRENT');
  `);
  return db;
}

function input(command: ActivityCommand, version: number, requestNumber: number) {
  const activity = spec();
  const documentIds = command.kind === "CONFIGURE" ? command.dueDateDocumentIds
    : command.kind === "RECORD_EXECUTION" || command.kind === "RECORD_OUTCOME" ? command.documentIds
      : command.kind === "VERIFY_COMPLETION" ? ["doc-a", "doc-b"] : [];
  return {
    scope,
    actor,
    knowledgeRevisionId: "revision-a",
    reportFingerprint,
    specs: [activity],
    activityKey: activity.activityKey,
    expectedSpecFingerprint: activity.fingerprint,
    expectedCorpusFingerprint: "c".repeat(64),
    expectedVersion: version,
    requestId: `00000000-0000-4000-8000-${String(requestNumber).padStart(12, "0")}`,
    command,
    verifiedDocuments: documentIds.map((id) => ({
      documentId: id, fileVersionId: `version-${id}`, sha256: "a".repeat(64),
    })),
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("isolated activity persistence", () => {
  it("persists an evidenced lifecycle and reloads its immutable history", async () => {
    const db = await database();
    const ctx = context(db);
    await appendActivityCommand(input({ kind: "APPROVE", note: "Iniziativa approvata.", confirmed: true }, 0, 1), ctx);
    await appendActivityCommand(input({ kind: "TAKE_CHARGE", note: "Presa in carico." }, 1, 2), ctx);
    await appendActivityCommand(input({ kind: "RECORD_EXECUTION", note: "Attività svolta.", date: "2026-11-01", documentIds: ["doc-a"] }, 2, 3), ctx);
    await appendActivityCommand(input({ kind: "RECORD_OUTCOME", note: "Riscontro acquisito.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null }, 3, 4), ctx);
    await appendActivityCommand(input({ kind: "VERIFY_COMPLETION", note: "Riscontro verificato.", confirmed: true }, 4, 5), ctx);

    const records = await listOperationalActivities(scope, context(db));
    expect(records).toHaveLength(1);
    expect(records[0].current).toMatchObject({
      version: 5, status: "COMPLETED",
      execution: { documentIds: ["doc-a"], fileVersions: [{ fileVersionId: "version-doc-a", sha256: "a".repeat(64) }] },
      outcome: { documentIds: ["doc-b"], fileVersions: [{ fileVersionId: "version-doc-b", sha256: "a".repeat(64) }] },
    });
    expect(records[0].history.map((item) => item.version)).toEqual([5, 4, 3, 2, 1]);
  });

  it("rejects unavailable evidence and requires a new recorded outcome when a file version changes", async () => {
    const db = await database();
    const ctx = context(db);
    await appendActivityCommand(input({ kind: "APPROVE", note: "Iniziativa approvata.", confirmed: true }, 0, 1), ctx);
    await appendActivityCommand(input({ kind: "TAKE_CHARGE", note: "Presa in carico." }, 1, 2), ctx);
    const execution = input({
      kind: "RECORD_EXECUTION", note: "Esecuzione registrata.", date: "2026-11-01", documentIds: ["doc-a"],
    }, 2, 3);
    await expect(appendActivityCommand({ ...execution, verifiedDocuments: [] }, ctx))
      .rejects.toMatchObject({ code: "EVIDENCE_UNAVAILABLE" });
    await appendActivityCommand(execution, ctx);
    await appendActivityCommand(input({
      kind: "RECORD_OUTCOME", note: "Riscontro ricevuto.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null,
    }, 3, 4), ctx);

    await db.exec(`
      INSERT INTO "DocumentFileVersion" VALUES ('version-new','doc-a','tenant-a',repeat('b',64));
      UPDATE "Documento" SET "currentFileVersionId"='version-new' WHERE "id"='doc-a';
    `);
    const currentFiles = [
      { documentId: "doc-a", fileVersionId: "version-new", sha256: "b".repeat(64) },
      { documentId: "doc-b", fileVersionId: "version-doc-b", sha256: "a".repeat(64) },
    ];
    await expect(appendActivityCommand({
      ...input({ kind: "VERIFY_COMPLETION", note: "Verifica dell'esito.", confirmed: true }, 4, 5),
      verifiedDocuments: currentFiles,
    }, ctx)).rejects.toMatchObject({ code: "EVIDENCE_CHANGED" });
    const corrected = await appendActivityCommand({
      ...input({ kind: "RECORD_EXECUTION", note: "Evidenza aggiornata.", date: "2026-11-01", documentIds: ["doc-a"] }, 4, 6),
      verifiedDocuments: [currentFiles[0]],
    }, ctx);
    expect(corrected).toMatchObject({ status: "EXECUTED", outcome: null });
    await appendActivityCommand(input({
      kind: "RECORD_OUTCOME", note: "Riscontro verificato nuovamente.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null,
    }, 5, 7), ctx);
    await appendActivityCommand({
      ...input({ kind: "VERIFY_COMPLETION", note: "Chiusura verificata.", confirmed: true }, 6, 8),
      verifiedDocuments: currentFiles,
    }, ctx);
    const history = (await listOperationalActivities(scope, ctx))[0].history;
    expect(history[0].execution?.fileVersions?.[0].fileVersionId).toBe("version-new");
    expect(history.find((version) => version.version === 3)?.execution?.fileVersions?.[0].fileVersionId).toBe("version-doc-a");
  });

  it("allows only explicit manual completion on an unchanged, stale corpus and reopens review when it changes again", async () => {
    const db = await database();
    const ctx = context(db);
    await appendActivityCommand(input({ kind: "APPROVE", note: "Iniziativa approvata.", confirmed: true }, 0, 1), ctx);
    await appendActivityCommand(input({ kind: "TAKE_CHARGE", note: "Presa in carico." }, 1, 2), ctx);
    await appendActivityCommand(input({
      kind: "RECORD_EXECUTION", note: "Esecuzione registrata.", date: "2026-11-01", documentIds: ["doc-a"],
    }, 2, 3), ctx);
    await appendActivityCommand(input({
      kind: "RECORD_OUTCOME", note: "Riscontro acquisito.", date: "2026-11-02", documentIds: ["doc-b"], alternativeTitle: null,
    }, 3, 4), ctx);
    const changedFingerprint = "d".repeat(64);
    const changedContext = context(db, [], changedFingerprint);
    const completion = input({ kind: "VERIFY_COMPLETION", note: "Esito verificato.", confirmed: true }, 4, 5);
    await expect(appendActivityCommand(completion, changedContext))
      .rejects.toMatchObject({ code: "STALE_SPEC" });
    await expect(appendActivityCommand({ ...completion, expectedCorpusFingerprint: changedFingerprint }, changedContext))
      .rejects.toMatchObject({ code: "STALE_SPEC" });
    const saved = await appendActivityCommand({
      ...completion, expectedCorpusFingerprint: changedFingerprint,
      command: { kind: "VERIFY_COMPLETION", note: "Esaminati personalmente tutti i documenti aggiornati.", confirmed: true, manualReview: true },
    }, changedContext);
    expect(saved).toMatchObject({
      status: "COMPLETED", completionReviewMode: "MANUAL_CORPUS", completionCorpusFingerprint: changedFingerprint,
    });
    const records = await listOperationalActivities(scope, changedContext);
    const currentCorpus = { fingerprint: changedFingerprint, analysisCurrent: false };
    expect(activityProgress([spec()], records, [spec()], currentCorpus).percentage).toBe(100);
    expect(activityNeedsReview(records[0], [spec()], { ...currentCorpus, fingerprint: "e".repeat(64) })).toBe(true);
    expect(activityProgress([spec()], records, [spec()], { ...currentCorpus, fingerprint: "e".repeat(64) }).percentage).toBe(0);
  });

  it("rejects a command when its archived report was replaced on the same knowledge revision", async () => {
    const db = await database();
    const ctx = context(db);
    await db.exec(`
      UPDATE "StructuredFascicoloReportSnapshot" SET "status"='SUPERSEDED' WHERE "id"='report-a';
      INSERT INTO "StructuredFascicoloReportSnapshot"
        VALUES ('report-new','tenant-a','procedure-a','revision-a',repeat('d',64),'CURRENT');
    `);
    await expect(appendActivityCommand(input({
      kind: "APPROVE", note: "Valutazione superata.", confirmed: true,
    }, 0, 1), ctx)).rejects.toMatchObject({ code: "STALE_SPEC" });
    expect(await listOperationalActivities(scope, ctx)).toHaveLength(0);
  });

  it("makes concurrent retries idempotent and rejects a reused request with different content", async () => {
    const db = await database();
    const ctx = context(db);
    const first = input({ kind: "APPROVE", note: "Iniziativa approvata.", confirmed: true }, 0, 1);
    const [saved, retry] = await Promise.all([
      appendActivityCommand(first, ctx),
      appendActivityCommand(first, ctx),
    ]);
    expect(saved).toEqual(retry);
    expect((await listOperationalActivities(scope, ctx))[0].history).toHaveLength(1);
    await expect(appendActivityCommand({
      ...first, command: { kind: "APPROVE", note: "Motivazione differente.", confirmed: true },
    }, ctx)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(appendActivityCommand(input({ kind: "APPROVE", note: "Altra richiesta.", confirmed: true }, 0, 2), ctx))
      .rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("rejects foreign tenants, documents and stale knowledge without appending events", async () => {
    const db = await database();
    const ctx = context(db);
    await expect(listOperationalActivities({ ...scope, tenantId: "tenant-b" }, ctx))
      .rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
    await appendActivityCommand(input({ kind: "APPROVE", note: "Iniziativa approvata.", confirmed: true }, 0, 1), ctx);
    await appendActivityCommand(input({ kind: "TAKE_CHARGE", note: "Presa in carico." }, 1, 2), ctx);
    await expect(appendActivityCommand(input({
      kind: "RECORD_EXECUTION", note: "Esecuzione tentata.", date: "2026-11-01", documentIds: ["foreign"],
    }, 2, 3), ctx)).rejects.toMatchObject({ code: "UNKNOWN_DOCUMENT" });
    await db.exec(`UPDATE "FascicoloKnowledgeRevision" SET "status"='SUPERSEDED' WHERE "id"='revision-a'`);
    await expect(appendActivityCommand(input({
      kind: "RECORD_EXECUTION", note: "Esecuzione tentata.", date: "2026-11-01", documentIds: ["doc-a"],
    }, 2, 4), ctx)).rejects.toMatchObject({ code: "STALE_SPEC" });
    expect((await listOperationalActivities(scope, ctx))[0].history).toHaveLength(2);
  });

  it("adopts only an unchanged approval for the same current issue and report", async () => {
    const db = await database();
    const ctx = context(db);
    await db.query(`
      INSERT INTO "FascicoloOperationalProposal"
      VALUES ('proposal-a','tenant-a','procedure-a','AMENDED_AND_APPROVED','ACTIVITY',
        'Verifica documentale','revision-a',$1,ARRAY['issue-a'],
        '{"activityCode":"CHECK"}'::jsonb,'{"activityCode":"CHECK","changed":true}'::jsonb,1,NULL)
    `, [reportFingerprint]);
    const adopt = input({ kind: "ADOPT_APPROVAL", note: "Recepita approvazione.", proposalId: "proposal-a", confirmed: true }, 0, 1);
    await expect(appendActivityCommand(adopt, ctx)).rejects.toMatchObject({ code: "APPROVAL_NOT_AVAILABLE" });
    await db.exec(`UPDATE "FascicoloOperationalProposal" SET "approvedPayload"="proposedPayload" WHERE "id"='proposal-a'`);
    const saved = await appendActivityCommand(adopt, ctx);
    expect(saved).toMatchObject({ status: "APPROVED", approvalProposalId: "proposal-a" });
  });

  it.each(["REJECTED", "AMENDED_AND_APPROVED"] as const)(
    "records a distinct, version-checked reevaluation of a %s proposal without changing it",
    async (status) => {
      const db = await database();
      const ctx = context(db);
      await db.query(`
        INSERT INTO "FascicoloOperationalProposal"
        VALUES ('proposal-a','tenant-a','procedure-a',$2,'ACTIVITY',
          'Verifica documentale','revision-a',$1,ARRAY['issue-a'],
          '{"activityCode":"CHECK"}'::jsonb,'{"activityCode":"CHECK","changed":true}'::jsonb,3,NULL)
      `, [reportFingerprint, status]);
      const command = {
        kind: "REEVALUATE_PROPOSAL" as const,
        note: "Riesaminate le precedenti decisioni e il percorso attuale.",
        proposalId: "proposal-a",
        expectedReviewVersion: 3,
        expectedProposalStatus: status,
        confirmed: true as const,
      };
      await expect(appendActivityCommand(input({
        kind: "APPROVE", note: "Tentativo senza riesame.", confirmed: true,
      }, 0, 4), ctx)).rejects.toMatchObject({ code: "APPROVAL_NOT_AVAILABLE" });
      await expect(appendActivityCommand(input({ ...command, expectedReviewVersion: 2 }, 0, 1), ctx))
        .rejects.toMatchObject({ code: "APPROVAL_NOT_AVAILABLE" });
      const saved = await appendActivityCommand(input(command, 0, 2), ctx);
      expect(saved).toMatchObject({
        status: "APPROVED", event: "REEVALUATE_PROPOSAL", issueText: "Verifica",
        approvalProposalId: "proposal-a", approvalReviewVersion: 3, approvalReviewStatus: status,
      });
      const proposal = await db.query<{ status: string; reviewVersion: number; approvedPayload: unknown }>(
        `SELECT "status","reviewVersion","approvedPayload" FROM "FascicoloOperationalProposal" WHERE "id"='proposal-a'`,
      );
      expect(proposal.rows[0]).toMatchObject({
        status, reviewVersion: 3, approvedPayload: { activityCode: "CHECK", changed: true },
      });
      expect((await listOperationalActivities(scope, ctx))[0].history).toHaveLength(1);
    },
  );
});

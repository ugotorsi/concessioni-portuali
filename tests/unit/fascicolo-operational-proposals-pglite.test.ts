import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
  OperationalProposalRepositoryError,
  listOperationalProposals,
  materializeOperationalProposal,
  reconcileOperationalProposals,
  reviewOperationalProposal,
  type OperationalProposalCandidate,
  type OperationalProposalRepositoryContext,
  type OperationalProposalSqlExecutor,
  type OperationalProposalType,
} from "@/server/fascicolo-operational-proposals";

const migration = readFileSync(path.join(
  process.cwd(), "prisma", "migrations", "20260930_fascicolo_operational_proposals", "migration.sql",
), "utf8");
const databases: PGlite[] = [];
const reportFingerprint = "a".repeat(64);

function executor(sql: { query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }> }): OperationalProposalSqlExecutor {
  return {
    query: (query, params = []) => sql.query(query, [...params]),
    audit: (input) => sql.query(`
      INSERT INTO "TestAuditEvent" ("azione","entitaId","metadata") VALUES ($1,$2,$3::jsonb)
    `, [input.azione, input.entitaId, JSON.stringify(input.metadata)]),
  };
}

function repositoryContext(database: PGlite): OperationalProposalRepositoryContext {
  return {
    read: executor(database),
    transaction: <T>(operation: (tx: OperationalProposalSqlExecutor) => Promise<T>) => (
      database.transaction((transaction) => operation(executor(transaction)))
    ),
    now: () => new Date("2026-09-30T12:00:00.000Z"),
  };
}

async function database() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(`
    CREATE TABLE "Ente" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Concessione" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL);
    CREATE TABLE "Procedimento" ("id" TEXT PRIMARY KEY, "enteId" TEXT NOT NULL, "concessioneId" TEXT);
    CREATE TABLE "FascicoloKnowledgeRevision" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "procedimentoId" TEXT NOT NULL, "status" TEXT NOT NULL,
      UNIQUE ("id","tenantId","procedimentoId")
    );
    CREATE TABLE "StructuredFascicoloReportSnapshot" (
      "id" VARCHAR(96) PRIMARY KEY, "tenantId" TEXT NOT NULL, "procedimentoId" TEXT NOT NULL,
      "knowledgeRevisionId" TEXT NOT NULL, "reportFingerprint" CHAR(64) NOT NULL, "status" TEXT NOT NULL
    );
    CREATE TYPE "TipologiaScadenza" AS ENUM ('TERMINE_PROCEDIMENTALE');
    CREATE TYPE "StatoScadenza" AS ENUM ('APERTA');
    CREATE TABLE "Scadenza" (
      "id" TEXT PRIMARY KEY, "concessioneId" TEXT NOT NULL, "tipologia" "TipologiaScadenza" NOT NULL,
      "dataScadenza" TIMESTAMPTZ NOT NULL, "preavvisoGiorni" INTEGER NOT NULL DEFAULT 30,
      "stato" "StatoScadenza" NOT NULL, "descrizione" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL
    );
    CREATE TYPE "TipologiaCriticita" AS ENUM ('GIURIDICA');
    CREATE TYPE "GravitaCriticita" AS ENUM ('MEDIA');
    CREATE TYPE "FonteCriticita" AS ENUM ('ALERT_AUTOMATICO');
    CREATE TYPE "StatoCriticita" AS ENUM ('APERTA');
    CREATE TABLE "Criticita" (
      "id" TEXT PRIMARY KEY, "concessioneId" TEXT NOT NULL, "tipologia" "TipologiaCriticita" NOT NULL,
      "gravita" "GravitaCriticita" NOT NULL, "fonte" "FonteCriticita" NOT NULL,
      "descrizione" TEXT NOT NULL, "azioneConsigliata" TEXT, "stato" "StatoCriticita" NOT NULL,
      "dataUltimoAggiornamento" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE "FascicoloSubject" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "aliases" JSONB NOT NULL DEFAULT '[]', "mergedIntoId" TEXT
    );
    CREATE TABLE "FascicoloSubjectIdentifier" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "subjectId" TEXT NOT NULL,
      "identifierType" TEXT NOT NULL, "normalizedValue" TEXT NOT NULL
    );
    CREATE TABLE "TestAuditEvent" ("azione" TEXT NOT NULL, "entitaId" TEXT, "metadata" JSONB NOT NULL);
    INSERT INTO "Ente" VALUES ('tenant-a'),('tenant-b');
    INSERT INTO "Concessione" VALUES ('concession-a','tenant-a'),('concession-b','tenant-b');
    INSERT INTO "Procedimento" VALUES
      ('procedure-a','tenant-a','concession-a'),
      ('procedure-b','tenant-b','concession-b'),
      ('procedure-neutral','tenant-a',NULL),
      ('procedure-inconsistent','tenant-a','concession-b');
    INSERT INTO "FascicoloKnowledgeRevision" VALUES
      ('revision-a','tenant-a','procedure-a','CURRENT'),('revision-b','tenant-b','procedure-b','CURRENT');
    INSERT INTO "StructuredFascicoloReportSnapshot" VALUES
      ('report-a','tenant-a','procedure-a','revision-a','${reportFingerprint}','CURRENT'),
      ('report-b','tenant-b','procedure-b','revision-b','${reportFingerprint}','CURRENT');
  `);
  await db.exec(migration);
  return db;
}

function candidate(type: OperationalProposalType = "DEADLINE", overrides: Partial<OperationalProposalCandidate> = {}): OperationalProposalCandidate {
  const payload = (type === "DEADLINE" ? {
    title: "Termine istruttorio", dueDate: "2026-10-31", dueDatePrecision: "EXACT",
    tipologia: "TERMINE_PROCEDIMENTALE", preavvisoGiorni: 30,
  } : type === "CRITICALITY" ? {
    severity: "MEDIA", category: "GIURIDICA", description: "Contraddizione documentale", rationale: "Verifica necessaria",
  } : { requestedDocumentType: "MISSING_DOCUMENT", description: "Titolo mancante" }) as OperationalProposalCandidate["proposedPayload"];
  return {
    tenantId: "tenant-a", procedimentoId: "procedure-a", knowledgeRevisionId: "revision-a",
    structuredReportId: "report-a", structuredReportFingerprint: reportFingerprint,
    policyVersion: FASCICOLO_OPERATIONAL_PROPOSAL_POLICY_VERSION,
    proposalType: type, title: `Proposta ${type}`, description: `Descrizione ${type}`,
    proposedPayload: payload, originatingKnowledgeItemIds: [`origin-${type}`],
    originatingIssueSemanticKeys: [], originatingQuestionSemanticKeys: [], relevantResultIds: [],
    rationale: "Razionale strutturato", confidence: 80,
    proposalFingerprint: overrides.proposalFingerprint ?? (type === "DEADLINE" ? "1" : type === "CRITICALITY" ? "2" : "3").repeat(64),
    warningCodes: type === "DOCUMENT_REQUIREMENT" ? ["MANUAL_ACTION_REQUIRED"] : [],
    ...overrides,
  };
}

function customCandidate(type: OperationalProposalType, fingerprintCharacter: string, proposedPayload: OperationalProposalCandidate["proposedPayload"]): OperationalProposalCandidate {
  return candidate(type, {
    proposedPayload,
    proposalFingerprint: fingerprintCharacter.repeat(64),
    warningCodes: [],
  });
}

function reconcile(db: PGlite, candidates: readonly OperationalProposalCandidate[]) {
  return reconcileOperationalProposals({
    tenantId: "tenant-a", procedimentoId: "procedure-a", knowledgeRevisionId: "revision-a",
    structuredReportId: "report-a", structuredReportFingerprint: reportFingerprint, candidates,
  }, repositoryContext(db));
}

function approve(db: PGlite, proposalId: string, action: "APPROVE" | "AMEND_AND_APPROVE" = "APPROVE", approvedPayload?: unknown) {
  return reviewOperationalProposal({
    tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId, action,
    expectedReviewVersion: 0, approvedPayload, reviewNote: "Verifica umana completata",
    actor: { actorId: "reviewer-1", actorEmail: "reviewer@example.test", actorRole: "RESPONSABILE_UFFICIO" },
  }, repositoryContext(db));
}

const materializationActor = { actorId: "operator-1", actorEmail: "operator@example.test", actorRole: "RESPONSABILE_UFFICIO" };

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("Lotto 7 operational proposal persistence", () => {
  it("allows tenant-scoped reads without a concession while preserving tenant and concession authority", async () => {
    const db = await database();
    await expect(listOperationalProposals({
      tenantId: "tenant-a",
      procedimentoId: "procedure-neutral",
    }, repositoryContext(db))).resolves.toEqual([]);
    await expect(listOperationalProposals({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
    }, repositoryContext(db))).resolves.toEqual([]);
    await expect(listOperationalProposals({
      tenantId: "tenant-b",
      procedimentoId: "procedure-neutral",
    }, repositoryContext(db))).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
    await expect(listOperationalProposals({
      tenantId: "tenant-a",
      procedimentoId: "procedure-inconsistent",
    }, repositoryContext(db))).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
  });

  it("keeps write authority restricted to procedimenti with a tenant-consistent concession", async () => {
    const db = await database();
    const neutralCandidate = candidate("DEADLINE", { procedimentoId: "procedure-neutral" });
    await expect(reconcileOperationalProposals({
      tenantId: "tenant-a",
      procedimentoId: "procedure-neutral",
      knowledgeRevisionId: "revision-a",
      structuredReportId: "report-a",
      structuredReportFingerprint: reportFingerprint,
      candidates: [neutralCandidate],
    }, repositoryContext(db))).rejects.toMatchObject({ code: "AUTHORITY_MISMATCH" });
  });

  it("reuses an unchanged proposal with its review and supersedes an approved changed proposal", async () => {
    const db = await database();
    const first = await reconcile(db, [candidate()]);
    expect(first).toMatchObject({ created: 1, reused: 0, stale: 0 });
    const approved = await approve(db, first.proposals[0].id);
    expect(approved).toMatchObject({ status: "APPROVED", reviewVersion: 1 });

    const same = await reconcile(db, [candidate()]);
    expect(same).toMatchObject({ created: 0, reused: 1, stale: 0 });
    expect(same.proposals[0]).toMatchObject({ id: approved.id, status: "APPROVED", reviewVersion: 1 });

    const changed = candidate("DEADLINE", {
      proposalFingerprint: "4".repeat(64),
      proposedPayload: { ...candidate().proposedPayload as object, dueDate: "2026-11-30" },
    });
    const next = await reconcile(db, [changed]);
    expect(next).toMatchObject({ created: 1, reused: 0, stale: 1 });
    expect(next.proposals[0]).toMatchObject({ status: "PROPOSED", reviewVersion: 0 });
    const old = await db.query<{ status: string }>(`SELECT "status" FROM "FascicoloOperationalProposal" WHERE "id"=$1`, [approved.id]);
    expect(old.rows[0].status).toBe("SUPERSEDED");
  });

  it("records immutable review history and allows only one concurrent decision for a review version", async () => {
    const db = await database();
    const proposal = (await reconcile(db, [candidate()])).proposals[0];
    const decisions = await Promise.allSettled([
      approve(db, proposal.id),
      reviewOperationalProposal({
        tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id,
        action: "REJECT", expectedReviewVersion: 0, reviewNote: "Decisione concorrente",
        actor: { actorId: "reviewer-2", actorEmail: null, actorRole: "RESPONSABILE_UFFICIO" },
      }, repositoryContext(db)),
    ]);
    expect(decisions.filter((decision) => decision.status === "fulfilled")).toHaveLength(1);
    expect(decisions.filter((decision) => decision.status === "rejected")).toHaveLength(1);
    const events = await db.query<{ proposedPayload: unknown; approvedPayload: unknown }>(`
      SELECT "proposedPayload","approvedPayload" FROM "FascicoloOperationalProposalReviewEvent"
    `);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].proposedPayload).toEqual(candidate().proposedPayload);
  });

  it("never materializes before approval and materializes one Scadenza exactly once", async () => {
    const db = await database();
    const proposal = (await reconcile(db, [candidate()])).proposals[0];
    await expect(materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id, actor: materializationActor,
    }, repositoryContext(db))).rejects.toMatchObject({ code: "PROPOSAL_NOT_APPROVED" });
    await approve(db, proposal.id);
    const first = await materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id, actor: materializationActor,
    }, repositoryContext(db));
    const second = await materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id, actor: materializationActor,
    }, repositoryContext(db));
    expect(first).toMatchObject({ outcome: "MATERIALIZED", entityType: "Scadenza" });
    expect(second).toMatchObject({ outcome: "REUSED", entityId: first.entityId });
    expect((await db.query(`SELECT * FROM "Scadenza"`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT * FROM "FascicoloOperationalProposalMaterialization"`)).rows).toHaveLength(1);
  });

  it("materializes one Criticita and keeps manual document requirements non-materialized", async () => {
    const db = await database();
    const persisted = await reconcile(db, [candidate("CRITICALITY"), candidate("DOCUMENT_REQUIREMENT")]);
    const criticality = persisted.proposals.find((proposal) => proposal.proposalType === "CRITICALITY")!;
    const document = persisted.proposals.find((proposal) => proposal.proposalType === "DOCUMENT_REQUIREMENT")!;
    await approve(db, criticality.id);
    await approve(db, document.id);
    await expect(materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: document.id, actor: materializationActor,
    }, repositoryContext(db))).rejects.toMatchObject({ code: "MANUAL_ACTION_REQUIRED" });
    await materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: criticality.id, actor: materializationActor,
    }, repositoryContext(db));
    expect((await db.query(`SELECT * FROM "Criticita"`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT * FROM "Scadenza"`)).rows).toHaveLength(0);
  });

  it("rolls back target and link on materialization failure and enforces tenant scope", async () => {
    const db = await database();
    const proposal = (await reconcile(db, [candidate()])).proposals[0];
    await approve(db, proposal.id, "AMEND_AND_APPROVE", {
      ...candidate().proposedPayload as object, dueDate: null, dueDatePrecision: "UNCERTAIN",
    });
    await expect(materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id, actor: materializationActor,
    }, repositoryContext(db))).rejects.toMatchObject({ code: "DEADLINE_EXACT_DATE_REQUIRED" });
    expect((await db.query(`SELECT * FROM "Scadenza"`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT * FROM "FascicoloOperationalProposalMaterialization"`)).rows).toHaveLength(0);
    const state = await db.query<{ status: string }>(`SELECT "status" FROM "FascicoloOperationalProposal" WHERE "id"=$1`, [proposal.id]);
    expect(state.rows[0].status).toBe("AMENDED_AND_APPROVED");
    const audit = await db.query<{ azione: string }>(`SELECT "azione" FROM "TestAuditEvent"`);
    expect(audit.rows.some((event) => event.azione === "OPERATIONAL_PROPOSAL_MATERIALIZED")).toBe(false);
    await expect(reviewOperationalProposal({
      tenantId: "tenant-b", procedimentoId: "procedure-b", proposalId: proposal.id,
      action: "APPROVE", expectedReviewVersion: 1,
      actor: { actorId: "reviewer-b", actorEmail: null, actorRole: "RESPONSABILE_UFFICIO" },
    }, repositoryContext(db))).rejects.toBeInstanceOf(OperationalProposalRepositoryError);
  });

  it("rejects non-current snapshot authority and enforces structured origin at the database boundary", async () => {
    const db = await database();
    await db.query(`UPDATE "StructuredFascicoloReportSnapshot" SET "status"='STALE' WHERE "id"='report-a'`);
    await expect(reconcile(db, [candidate()])).rejects.toMatchObject({ code: "CURRENT_INPUT_REQUIRED" });
    await db.query(`UPDATE "StructuredFascicoloReportSnapshot" SET "status"='CURRENT' WHERE "id"='report-a'`);
    await expect(db.query(`
      INSERT INTO "FascicoloOperationalProposal" (
        "id","tenantId","procedimentoId","knowledgeRevisionId","structuredReportId","structuredReportFingerprint",
        "policyVersion","proposalType","title","description","proposedPayload","originatingKnowledgeItemIds",
        "originatingIssueSemanticKeys","originatingQuestionSemanticKeys","relevantResultIds","rationale","proposalFingerprint"
      ) VALUES ('originless','tenant-a','procedure-a','revision-a','report-a',$1,'V1','NOTE','Nota','Nota','{}','{}','{}','{}','{}','Razionale',$2)
    `, [reportFingerprint, "f".repeat(64)])).rejects.toThrow();
  });

  it("keeps rejected and no-safe-target proposal types non-materialized", async () => {
    const db = await database();
    const proposals = [
      candidate(),
      customCandidate("DOCUMENT_REQUIREMENT", "5", { description: "Documento" }),
      customCandidate("CHECKLIST_ITEM", "6", { description: "Controllo" }),
      customCandidate("ACTIVITY", "7", { description: "Attività" }),
      customCandidate("NOTE", "8", { description: "Nota" }),
    ];
    const persisted = await reconcile(db, proposals);
    const deadline = persisted.proposals.find((proposal) => proposal.proposalType === "DEADLINE")!;
    await reviewOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: deadline.id,
      action: "REJECT", expectedReviewVersion: 0,
      actor: { actorId: "reviewer-1", actorEmail: null, actorRole: "RESPONSABILE_UFFICIO" },
    }, repositoryContext(db));
    await expect(materializeOperationalProposal({
      tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: deadline.id, actor: materializationActor,
    }, repositoryContext(db))).rejects.toMatchObject({ code: "PROPOSAL_NOT_APPROVED" });
    for (const proposal of persisted.proposals.filter((item) => item.proposalType !== "DEADLINE")) {
      await approve(db, proposal.id);
      await expect(materializeOperationalProposal({
        tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: proposal.id, actor: materializationActor,
      }, repositoryContext(db))).rejects.toMatchObject({ code: "MANUAL_ACTION_REQUIRED" });
    }
    expect((await db.query(`SELECT * FROM "FascicoloOperationalProposalMaterialization"`)).rows).toHaveLength(0);
  });

  it("materializes only a safe subject alias and blocks merge or conflicting strong identifiers", async () => {
    const db = await database();
    await db.query(`INSERT INTO "FascicoloSubject" VALUES ('subject-a','tenant-a','[]',NULL),('subject-b','tenant-a','[]',NULL)`);
    await db.query(`INSERT INTO "FascicoloSubjectIdentifier" VALUES ('identifier-b','tenant-a','subject-b','CODICE_FISCALE','rssmra80a01h501u')`);
    const aliases = customCandidate("SUBJECT_UPDATE", "9", { action: "ADD_ALIAS", subjectId: "subject-a", alias: "Mario Rossi" });
    const merge = customCandidate("SUBJECT_UPDATE", "a", { action: "MERGE", subjectId: "subject-a" });
    const identifier = customCandidate("SUBJECT_UPDATE", "b", {
      action: "ADD_STRONG_IDENTIFIER", subjectId: "subject-a", identifierType: "CODICE_FISCALE", identifierValue: "RSSMRA80A01H501U",
    });
    const persisted = await reconcile(db, [aliases, merge, identifier]);
    for (const proposal of persisted.proposals) await approve(db, proposal.id);
    const aliasProposal = persisted.proposals.find((proposal) => (proposal.proposedPayload as { action: string }).action === "ADD_ALIAS")!;
    const mergeProposal = persisted.proposals.find((proposal) => (proposal.proposedPayload as { action: string }).action === "MERGE")!;
    const identifierProposal = persisted.proposals.find((proposal) => (proposal.proposedPayload as { action: string }).action === "ADD_STRONG_IDENTIFIER")!;
    await materializeOperationalProposal({ tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: aliasProposal.id, actor: materializationActor }, repositoryContext(db));
    await expect(materializeOperationalProposal({ tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: mergeProposal.id, actor: materializationActor }, repositoryContext(db)))
      .rejects.toMatchObject({ code: "SUBJECT_MERGE_NOT_AUTOMATIC" });
    await expect(materializeOperationalProposal({ tenantId: "tenant-a", procedimentoId: "procedure-a", proposalId: identifierProposal.id, actor: materializationActor }, repositoryContext(db)))
      .rejects.toMatchObject({ code: "SUBJECT_IDENTIFIER_CONFLICT" });
    const subject = await db.query<{ aliases: string[] }>(`SELECT "aliases" FROM "FascicoloSubject" WHERE "id"='subject-a'`);
    expect(subject.rows[0].aliases).toEqual(["Mario Rossi"]);
    expect((await db.query(`SELECT * FROM "FascicoloOperationalProposalMaterialization"`)).rows).toHaveLength(1);
  });
});
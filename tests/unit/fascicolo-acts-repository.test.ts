import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<{
  entita: string; azione: string; enteId: string; esito: string;
  metadata: unknown; createdAt: Date; userEmail: string | null; currentHash: string; entitaId: string;
}> = [];

const databaseState = vi.hoisted(() => ({
  revisionFingerprint: "c".repeat(64),
  corpusFingerprint: "c".repeat(64),
  reportCurrent: true,
}));

vi.mock("@/lib/prisma", () => {
  const activityLog = {
    findMany: vi.fn(async ({ where }: { where: {
      entita: string; azione: string; enteId: string; esito: string; entitaId: string | { startsWith: string };
    } }) => rows.filter((row) => row.entita === where.entita && row.azione === where.azione
      && row.enteId === where.enteId && row.esito === where.esito
      && (typeof where.entitaId === "string"
        ? row.entitaId === where.entitaId
        : row.entitaId.startsWith(where.entitaId.startsWith)))),
  };
  const tx = {
    activityLog,
    $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
      const sql = query.join("?");
      if (sql.includes('FROM "FascicoloKnowledgeRevision"')) {
        return [{ id: "revision-1", corpusFingerprint: databaseState.revisionFingerprint }];
      }
      if (sql.includes('FROM "StructuredFascicoloReportSnapshot"')) {
        return databaseState.reportCurrent ? [{ id: "report-1" }] : [];
      }
      return [{ acquired: true }];
    }),
  };
  return {
    prisma: {
      activityLog,
      documento: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    },
  };
});

vi.mock("@/server/queries/fascicolo-document-corpus", () => ({
  readFascicoloDocumentCorpusInTransaction: vi.fn(async () => ({ corpusFingerprint: databaseState.corpusFingerprint })),
}));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: vi.fn(async (_tx: unknown, input: {
    entita: string; azione: string; enteId: string; esito: string;
    entitaId: string; metadata: unknown; actor: { userEmail: string };
  }) => {
    rows.push({
      entita: input.entita,
      azione: input.azione,
      enteId: input.enteId,
      esito: input.esito,
      metadata: input.metadata,
      createdAt: new Date(Date.UTC(2026, 10, 3, 12, rows.length)),
      userEmail: input.actor.userEmail,
      currentHash: String(rows.length).padStart(64, "0"),
      entitaId: input.entitaId,
    });
  }),
}));

import {
  ActDraftVersionConflictError,
  archiveIdenticalActDrafts,
  associateLegacyActDraft,
  listActDrafts,
  saveActDraftVersion,
} from "@/server/fascicolo-acts/repository";
import { bodySha256, stableActDraftKey } from "@/server/fascicolo-acts/model";
import {
  ACTIVITY_AUDIT_ACTION,
  ACTIVITY_ENTITY,
  applyActivityCommand,
  stableActivityKey,
  type ActivityRecord,
  type ActivitySpec,
  type ActivityVersion,
} from "@/server/fascicolo-operational-activities/model";

const scope = { tenantId: "ente-1", procedimentoId: "P-1", concessioneId: null };
const actor = { actorId: "user-1", actorEmail: "rup@example.test", actorRole: "ADMIN" };
const content = {
  templateKey: "CATALOG:COMUNICAZIONE_AVVIO",
  issueSemanticKey: null,
  title: "Comunicazione di avvio",
  body: "Testo iniziale",
  status: "BOZZA" as const,
  assignee: null,
  dueDate: null,
  progress: 0,
  dependencies: [],
  attachments: [],
  changeNote: null,
};

function spec(code: string): ActivitySpec {
  return {
    activityKey: stableActivityKey(scope.procedimentoId, "issue-a", code),
    issueSemanticKey: "issue-a",
    issueText: "Problematica di prova",
    activityCode: code,
    title: `Attività ${code}`,
    action: "Verificare il documento.",
    office: "Ufficio da verificare",
    requiredDocuments: ["Documento"],
    completionGate: "Esito verificato",
    necessity: "REQUIRED",
    legalSummary: "Conclusione preliminare.",
    legalSourceStatus: "LEGAL_RESEARCH_REQUIRED",
    alternatives: [],
    documents: [{ templateKey: `PLAN:CURRENT:${code}`, title: "Atto", legacyTemplateKeys: [] }],
    fingerprint: code.toLowerCase().repeat(64),
  };
}

function activeRecord(activity: ActivitySpec, specs: readonly ActivitySpec[]): ActivityRecord {
  let current: ActivityRecord | undefined;
  for (const [index, command] of [
    { kind: "APPROVE" as const, note: "Iniziativa valutata.", confirmed: true as const },
    { kind: "TAKE_CHARGE" as const, note: "Presa in carico." },
  ].entries()) {
    const metadata = applyActivityCommand({
      procedimentoId: scope.procedimentoId,
      spec: activity,
      specs,
      current,
      records: current ? [current] : [],
      drafts: [],
      documentIds: new Set(),
      documentVersions: new Map(),
      corpus: { fingerprint: "c".repeat(64), analysisCurrent: true },
      command,
      requestId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      requestFingerprint: "e".repeat(64),
      today: "2026-11-03",
    });
    const version: ActivityVersion = {
      ...metadata,
      savedAt: new Date(Date.UTC(2026, 10, 3, 10, index)),
      savedBy: actor.actorEmail,
      auditHash: "f".repeat(64),
    };
    rows.push({
      entita: ACTIVITY_ENTITY, azione: ACTIVITY_AUDIT_ACTION, enteId: scope.tenantId, esito: "SUCCESS",
      entitaId: `${scope.procedimentoId}::${activity.activityKey}`,
      metadata, createdAt: version.savedAt, userEmail: version.savedBy, currentHash: version.auditHash,
    });
    current = { activityKey: activity.activityKey, current: version, history: [version, ...(current?.history ?? [])] };
  }
  if (!current) throw new Error("Missing test activity");
  return current;
}

describe("fascicolo act draft repository", () => {
  beforeEach(() => {
    rows.length = 0;
    databaseState.revisionFingerprint = "c".repeat(64);
    databaseState.corpusFingerprint = "c".repeat(64);
    databaseState.reportCurrent = true;
  });

  it("appends versions with optimistic concurrency", async () => {
    const first = await saveActDraftVersion({ scope, draftKey: null, expectedVersion: 0, content, actor });
    expect(first.version).toBe(1);
    expect(first.draftKey).toBe(stableActDraftKey(content.templateKey, content.issueSemanticKey));
    expect(first.creationFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const second = await saveActDraftVersion({
      scope, draftKey: first.draftKey, expectedVersion: 1, actor,
      content: { ...content, body: "Testo rivisto", status: "IN_REVISIONE", progress: 50 },
    });
    expect(second.version).toBe(2);

    await expect(saveActDraftVersion({ scope, draftKey: first.draftKey, expectedVersion: 1, content, actor }))
      .rejects.toBeInstanceOf(ActDraftVersionConflictError);

    const drafts = await listActDrafts(scope);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].current).toMatchObject({ version: 2, body: "Testo rivisto", savedBy: "rup@example.test" });
    expect(drafts[0].history.map((item) => item.version)).toEqual([2, 1]);
  });

  it("makes repeated create requests for the same stable draft idempotent", async () => {
    const draftKey = "act_0123456789abcdef01234567";
    const first = await saveActDraftVersion({
      scope, draftKey, expectedVersion: 0, idempotentCreate: true, content, actor,
    });
    const retry = await saveActDraftVersion({
      scope, draftKey, expectedVersion: 0, idempotentCreate: true,
      content: { ...content, body: "A stale retry must not overwrite the saved draft" },
      actor,
    });

    expect(first).toMatchObject({ draftKey, version: 1, body: "Testo iniziale" });
    expect(retry).toEqual(first);
    expect(rows).toHaveLength(1);
  });

  it("archives historical identical duplicates as immutable versions and preserves the reference", async () => {
    const reference = await saveActDraftVersion({
      scope,
      draftKey: "act_reference00000000000000",
      expectedVersion: 0,
      content,
      actor,
    });
    const duplicateKey = "act_duplicate00000000000000";
    rows.push({
      entita: "FascicoloActDraft",
      azione: "FASCICOLO_ACT_DRAFT_VERSION_SAVED",
      enteId: scope.tenantId,
      esito: "SUCCESS",
      entitaId: `${scope.procedimentoId}::${duplicateKey}`,
      metadata: { ...reference, draftKey: duplicateKey },
      createdAt: new Date("2026-11-03T13:00:00.000Z"),
      userEmail: actor.actorEmail,
      currentHash: "9".repeat(64),
    });

    await expect(archiveIdenticalActDrafts({
      scope,
      actor,
      reference: {
        draftKey: reference.draftKey,
        expectedVersion: reference.version,
        bodySha256: reference.bodySha256,
      },
      duplicates: [{
        draftKey: duplicateKey,
        expectedVersion: 1,
        bodySha256: reference.bodySha256,
      }],
      reason: "Duplicato storico verificato",
    })).resolves.toEqual({ archivedDraftKeys: [duplicateKey] });

    const drafts = await listActDrafts(scope);
    expect(drafts.find((draft) => draft.draftKey === reference.draftKey)?.current.status).toBe("BOZZA");
    const archived = drafts.find((draft) => draft.draftKey === duplicateKey)!;
    expect(archived.current).toMatchObject({
      status: "ARCHIVIATA",
      version: 2,
      bodySha256: reference.bodySha256,
    });
    expect(archived.current.changeNote).toContain(reference.draftKey);
    expect(archived.history).toHaveLength(2);
  });

  it("refuses to archive divergent content or stale duplicate versions", async () => {
    const reference = await saveActDraftVersion({ scope, draftKey: null, expectedVersion: 0, content, actor });
    const duplicateKey = "act_divergent0000000000000";
    const divergentHash = bodySha256("Contenuto diverso");
    rows.push({
      entita: "FascicoloActDraft",
      azione: "FASCICOLO_ACT_DRAFT_VERSION_SAVED",
      enteId: scope.tenantId,
      esito: "SUCCESS",
      entitaId: `${scope.procedimentoId}::${duplicateKey}`,
      metadata: {
        ...reference,
        draftKey: duplicateKey,
        body: "Contenuto diverso",
        bodySha256: divergentHash,
      },
      createdAt: new Date("2026-11-03T13:00:00.000Z"),
      userEmail: actor.actorEmail,
      currentHash: "8".repeat(64),
    });

    await expect(archiveIdenticalActDrafts({
      scope,
      actor,
      reference: {
        draftKey: reference.draftKey,
        expectedVersion: reference.version,
        bodySha256: reference.bodySha256,
      },
      duplicates: [{
        draftKey: duplicateKey,
        expectedVersion: 1,
        bodySha256: divergentHash,
      }],
      reason: "Verifica",
    })).rejects.toThrow("ARCHIVE_DUPLICATE_NOT_IDENTICAL_OR_LINKED");
  });

  it("only creates a guided draft for the current taken-in-charge activity and document", async () => {
    const activity = spec("A");
    const guidedContext = {
      knowledgeRevisionId: "revision-1", reportFingerprint: "b".repeat(64),
      expectedCorpusFingerprint: "c".repeat(64), specs: [activity], spec: activity,
      expectedActivityVersion: 2, templateKey: activity.documents[0].templateKey,
    };
    const guidedContent = {
      ...content, templateKey: activity.documents[0].templateKey, issueSemanticKey: activity.issueSemanticKey, title: "Atto",
    };
    const input = {
      scope, actor, draftKey: stableActDraftKey(guidedContent.templateKey, guidedContent.issueSemanticKey),
      expectedVersion: 0, idempotentCreate: true, guidedContext, content: guidedContent,
    };
    await expect(saveActDraftVersion(input)).rejects.toMatchObject({ code: "STALE_VERSION" });
    activeRecord(activity, [activity]);
    const before = rows.length;
    await expect(saveActDraftVersion({ ...input, guidedContext: { ...guidedContext, expectedActivityVersion: 1 } }))
      .rejects.toMatchObject({ code: "STALE_VERSION" });
    await expect(saveActDraftVersion({ ...input, guidedContext: { ...guidedContext, templateKey: "PLAN:OTHER" } }))
      .rejects.toMatchObject({ code: "INVALID_DRAFT" });
    databaseState.reportCurrent = false;
    await expect(saveActDraftVersion(input)).rejects.toMatchObject({ code: "STALE_SPEC" });
    databaseState.reportCurrent = true;
    databaseState.corpusFingerprint = "d".repeat(64);
    await expect(saveActDraftVersion(input)).rejects.toMatchObject({ code: "STALE_SPEC" });
    databaseState.corpusFingerprint = "c".repeat(64);
    databaseState.revisionFingerprint = "d".repeat(64);
    await expect(saveActDraftVersion(input)).rejects.toMatchObject({ code: "STALE_SPEC" });
    databaseState.revisionFingerprint = "c".repeat(64);
    expect(rows).toHaveLength(before);

    const created = await saveActDraftVersion(input);
    const retry = await saveActDraftVersion({ ...input, content: { ...guidedContent, body: "Retry obsoleto" } });
    expect(created).toEqual(retry);
    expect(created).toMatchObject({ version: 1, body: "Testo iniziale" });
    expect(rows).toHaveLength(before + 1);

    const latestActivity = rows.find((row) => row.entita === ACTIVITY_ENTITY
      && (row.metadata as { version: number }).version === 2);
    if (!latestActivity) throw new Error("Missing test activity");
    (latestActivity.metadata as { blockedReason: string | null }).blockedReason = "Blocco motivato";
    await expect(saveActDraftVersion(input)).rejects.toMatchObject({ code: "STALE_SPEC" });
    expect(rows).toHaveLength(before + 1);
  });

  it("keeps different activities and different document types distinct", async () => {
    const base = spec("A");
    const a: ActivitySpec = {
      ...base,
      documents: [...base.documents, { templateKey: "PLAN:CURRENT:A2", title: "Altro atto", legacyTemplateKeys: [] }],
    };
    const b = spec("B");
    const specs = [a, b];
    activeRecord(a, specs);
    activeRecord(b, specs);
    const create = (activity: ActivitySpec, templateKey: string) => {
      const guidedContent = { ...content, templateKey, issueSemanticKey: activity.issueSemanticKey, title: "Atto" };
      return saveActDraftVersion({
        scope, actor, draftKey: stableActDraftKey(templateKey, activity.issueSemanticKey),
        expectedVersion: 0, idempotentCreate: true, content: guidedContent,
        guidedContext: {
          knowledgeRevisionId: "revision-1", reportFingerprint: "b".repeat(64),
          expectedCorpusFingerprint: "c".repeat(64), specs, spec: activity,
          expectedActivityVersion: 2, templateKey,
        },
      });
    };
    const first = await create(a, a.documents[0].templateKey);
    const secondDocument = await create(a, a.documents[1].templateKey);
    const otherActivity = await create(b, b.documents[0].templateKey);
    expect(new Set([first.draftKey, secondDocument.draftKey, otherActivity.draftKey]).size).toBe(3);
    expect(await listActDrafts(scope)).toHaveLength(3);
  });

  it("rejects unknown dependencies and surfaces tampered or foreign records", async () => {
    await expect(saveActDraftVersion({
      scope, draftKey: null, expectedVersion: 0, actor, content: { ...content, dependencies: ["act_missing"] },
    })).rejects.toThrow("Dipendenza non riconosciuta");

    const saved = await saveActDraftVersion({ scope, draftKey: null, expectedVersion: 0, content, actor });
    (rows[0].metadata as { body: string }).body = "Testo alterato";
    rows.push({ ...rows[0], metadata: { ...(rows[0].metadata as object), procedimentoId: "P-2", version: 2 }, entitaId: `P-1::${saved.draftKey}` });
    await expect(listActDrafts(scope)).rejects.toThrow("cronologia di una bozza non è integra");
    await expect(saveActDraftVersion({ scope, draftKey: saved.draftKey, expectedVersion: 1, content, actor }))
      .rejects.toThrow("cronologia di una bozza non è integra");
  });

  it("associates ambiguous legacy drafts explicitly without deleting history or reusing an identity", async () => {
    const a = spec("A");
    const b = spec("B");
    const specs = [a, b];
    activeRecord(a, specs);
    activeRecord(b, specs);
    const legacy = { ...content, templateKey: "PLAN:Atto", issueSemanticKey: "issue-a", title: "Atto" };
    await saveActDraftVersion({ scope, draftKey: "legacy-1", expectedVersion: 0, content: {
      ...legacy, status: "APPROVATA_INTERNAMENTE",
    }, actor });
    await saveActDraftVersion({ scope, draftKey: "legacy-2", expectedVersion: 0, content: {
      ...legacy, body: "Altra bozza precedente",
    }, actor });
    const association = {
      scope, actor, knowledgeRevisionId: "revision-1", reportFingerprint: "b".repeat(64),
      expectedCorpusFingerprint: "c".repeat(64), specs, spec: a,
      expectedActivityVersion: 2, draftKey: "legacy-1", expectedDraftVersion: 1,
      templateKey: a.documents[0].templateKey, legacyKeys: ["PLAN:Atto"], note: "Verificato il contenuto.",
    };
    const initialLength = rows.length;
    databaseState.reportCurrent = false;
    await expect(associateLegacyActDraft(association)).rejects.toMatchObject({ code: "STALE_SPEC" });
    databaseState.reportCurrent = true;
    databaseState.corpusFingerprint = "d".repeat(64);
    await expect(associateLegacyActDraft(association)).rejects.toMatchObject({ code: "STALE_SPEC" });
    databaseState.corpusFingerprint = "c".repeat(64);
    databaseState.revisionFingerprint = "d".repeat(64);
    await expect(associateLegacyActDraft(association)).rejects.toMatchObject({ code: "STALE_SPEC" });
    expect(rows).toHaveLength(initialLength);
    databaseState.revisionFingerprint = "c".repeat(64);
    const mapped = await associateLegacyActDraft(association);
    expect(mapped).toMatchObject({
      draftKey: "legacy-1", version: 2, templateKey: a.documents[0].templateKey,
      body: "Testo iniziale", status: "IN_REVISIONE",
    });
    const length = rows.length;
    expect(await associateLegacyActDraft(association)).toEqual(mapped);
    expect(rows).toHaveLength(length);
    await expect(associateLegacyActDraft({ ...association, draftKey: "legacy-2" }))
      .rejects.toThrow("Esiste già una bozza");
    const mappedB = await associateLegacyActDraft({
      ...association, spec: b, draftKey: "legacy-2", templateKey: b.documents[0].templateKey,
    });
    expect(mappedB).toMatchObject({ version: 2, body: "Altra bozza precedente" });
    const drafts = await listActDrafts(scope);
    expect(drafts).toHaveLength(2);
    expect(drafts.find((item) => item.draftKey === "legacy-1")?.history.map((item) => item.templateKey))
      .toEqual([a.documents[0].templateKey, "PLAN:Atto"]);
    const reopened = await saveActDraftVersion({
      scope, draftKey: "act_0123456789abcdef01234567", expectedVersion: 0, idempotentCreate: true,
      creationIdentity: { legacyTemplateKeys: [], ambiguousLegacyKeys: ["PLAN:Atto"] },
      content: { ...legacy, templateKey: a.documents[0].templateKey }, actor,
    });
    expect(reopened.draftKey).toBe("legacy-1");
    expect(reopened.version).toBe(2);
  });

  it("blocks creation while an unresolved legacy draft may represent the same document", async () => {
    const legacy = { ...content, templateKey: "PLAN:Atto", issueSemanticKey: "issue-a", title: "Atto" };
    await saveActDraftVersion({ scope, draftKey: "legacy-1", expectedVersion: 0, content: legacy, actor });
    await expect(saveActDraftVersion({
      scope, draftKey: "act_0123456789abcdef01234567", expectedVersion: 0, idempotentCreate: true,
      creationIdentity: { legacyTemplateKeys: [], ambiguousLegacyKeys: ["PLAN:Atto"] },
      content: { ...legacy, templateKey: "PLAN:CURRENT:A" }, actor,
    })).rejects.toThrow("collegamento ambiguo");
    expect(await listActDrafts(scope)).toHaveLength(1);
  });
});

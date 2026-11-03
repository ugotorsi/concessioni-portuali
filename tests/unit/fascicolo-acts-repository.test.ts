import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Array<{ metadata: unknown; createdAt: Date; userEmail: string | null; currentHash: string; entitaId: string }> = [];

vi.mock("@/lib/prisma", () => {
  const activityLog = {
    findMany: vi.fn(async ({ where }: { where: { entitaId: string | { startsWith: string } } }) =>
      rows.filter((row) => typeof where.entitaId === "string"
        ? row.entitaId === where.entitaId
        : row.entitaId.startsWith(where.entitaId.startsWith))),
  };
  const tx = { activityLog, $queryRaw: vi.fn(async () => [{ acquired: true }]) };
  return {
    prisma: {
      activityLog,
      documento: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    },
  };
});

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: vi.fn(async (_tx: unknown, input: { entitaId: string; metadata: unknown; actor: { userEmail: string } }) => {
    rows.push({
      metadata: input.metadata,
      createdAt: new Date(Date.UTC(2026, 10, 3, 12, rows.length)),
      userEmail: input.actor.userEmail,
      currentHash: String(rows.length).padStart(64, "0"),
      entitaId: input.entitaId,
    });
  }),
}));

import { ActDraftVersionConflictError, listActDrafts, saveActDraftVersion } from "@/server/fascicolo-acts/repository";

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

describe("fascicolo act draft repository", () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it("appends versions with optimistic concurrency", async () => {
    const first = await saveActDraftVersion({ scope, draftKey: null, expectedVersion: 0, content, actor });
    expect(first.version).toBe(1);
    expect(first.draftKey).toMatch(/^act_[a-f0-9]{24}$/);

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

  it("rejects unknown dependencies and ignores tampered or foreign records", async () => {
    await expect(saveActDraftVersion({
      scope, draftKey: null, expectedVersion: 0, actor, content: { ...content, dependencies: ["act_missing"] },
    })).rejects.toThrow("Dipendenza non riconosciuta");

    const saved = await saveActDraftVersion({ scope, draftKey: null, expectedVersion: 0, content, actor });
    (rows[0].metadata as { body: string }).body = "Testo alterato";
    rows.push({ ...rows[0], metadata: { ...(rows[0].metadata as object), procedimentoId: "P-2", version: 2 }, entitaId: `P-1::${saved.draftKey}` });
    expect(await listActDrafts(scope)).toEqual([]);
  });
});

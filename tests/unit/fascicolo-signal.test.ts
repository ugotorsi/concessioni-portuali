import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { stableStringify } from "@/server/audit/hash";
import type { FascicoloChange } from "@/server/fascicolo-lifecycle/change";
import {
  FASCICOLO_SIGNAL_KIND,
  FASCICOLO_SIGNAL_RULE_CODE,
  FASCICOLO_SIGNAL_RULE_VERSION,
  FASCICOLO_SIGNAL_SOURCE_OPERATION,
  projectFascicoloSignalInTransaction,
} from "@/server/fascicolo-lifecycle/fascicoloSignal";

const auditMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/audit/auditLog", () => ({ createAuditLogInTransaction: auditMock }));

const observedAt = new Date("2026-10-03T12:00:00.000Z");
const dataScadenza = new Date("2027-01-01T00:00:00.000Z");

function hash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function generationFingerprint(expiry = dataScadenza): string {
  return hash({
    contractVersion: "CONCESSIONE_TIME_WATCH_V1",
    subjectType: "CONCESSIONE",
    subjectId: "concessione-1",
    tenantId: "ente-1",
    dataScadenza: expiry.toISOString(),
  });
}

const thresholds = {
  CONCESSION_90_DAYS: "2026-10-03T00:00:00.000Z",
  CONCESSION_60_DAYS: "2026-11-02T00:00:00.000Z",
  CONCESSION_30_DAYS: "2026-12-02T00:00:00.000Z",
  DEADLINE_DUE: "2027-01-01T00:00:00.000Z",
} as const;

type Threshold = keyof typeof thresholds;

function change(
  threshold: Threshold = "CONCESSION_90_DAYS",
  overrides: Partial<Record<"stateFingerprint" | "subjectId" | "procedimentoId" | "thresholdAt", string>> = {},
): FascicoloChange {
  return {
    kind: "TIME_THRESHOLD_REACHED",
    origin: "WATCHDOG",
    triggeredAt: "1970-01-01T00:00:00.000Z",
    stateFingerprint: overrides.stateFingerprint ?? generationFingerprint(),
    legalAssessmentTarget: { kind: "UNDETERMINED" },
    subjectType: "CONCESSIONE",
    subjectId: overrides.subjectId ?? "concessione-1",
    procedimentoId: overrides.procedimentoId ?? "procedimento-1",
    threshold,
    thresholdAt: overrides.thresholdAt ?? thresholds[threshold],
  };
}

function signal(overrides: Record<string, unknown> = {}) {
  return {
    id: "signal-1",
    enteId: "ente-1",
    concessioneId: "concessione-1",
    procedimentoId: "procedimento-1",
    kind: "CONCESSION_EXPIRY",
    sourceOperation: "FASCICOLO_TIME_WATCH_V1",
    ruleCode: "CONCESSION_EXPIRY_WINDOW",
    ruleVersion: 1,
    subjectType: "CONCESSIONE",
    subjectId: "concessione-1",
    semanticKey: "a".repeat(64),
    generationFingerprint: generationFingerprint(),
    identityKey: "b".repeat(64),
    currentThreshold: "CONCESSION_90_DAYS",
    attentionLevel: "LOW",
    factsSnapshot: {},
    status: "OPEN",
    detectedAt: new Date("2026-10-03T00:00:00.000Z"),
    lastObservedAt: new Date("2026-10-03T01:00:00.000Z"),
    supersededAt: null,
    createdAt: new Date("2026-10-03T00:00:00.000Z"),
    updatedAt: new Date("2026-10-03T00:00:00.000Z"),
    ...overrides,
  };
}

function transaction() {
  return {
    procedimento: {
      findFirst: vi.fn().mockResolvedValue({
        id: "procedimento-1",
        concessione: { id: "concessione-1", enteId: "ente-1", dataScadenza },
      }),
    },
    fascicoloSignal: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => signal(data)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => signal({ id: "signal-created", ...data })),
    },
  };
}

async function project(tx: ReturnType<typeof transaction>, input = change(), at = observedAt) {
  return projectFascicoloSignalInTransaction(tx as never, input, at);
}

describe("Patch F1 persistent concession expiry signal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores changes other than TIME_THRESHOLD_REACHED", async () => {
    const tx = transaction();
    const input = {
      kind: "FASCICOLO_DATA_CHANGED",
      origin: "USER_ACTION",
      triggeredAt: observedAt.toISOString(),
      stateFingerprint: "a".repeat(64),
      legalAssessmentTarget: { kind: "UNDETERMINED" },
      procedimentoId: "procedimento-1",
      changedArea: "GENERAL",
    } as FascicoloChange;

    await expect(project(tx, input)).resolves.toEqual({ outcome: "NOT_APPLICABLE", signalId: null });
    expect(tx.procedimento.findFirst).not.toHaveBeenCalled();
  });

  it("ignores temporal changes for subjects other than concessions", async () => {
    const tx = transaction();
    const input = { ...change(), subjectType: "PROCEDIMENTO", subjectId: "procedimento-1", threshold: "DEADLINE_DUE" } as FascicoloChange;

    await expect(project(tx, input)).resolves.toEqual({ outcome: "NOT_APPLICABLE", signalId: null });
  });

  it("ignores concession thresholds outside the four expiry thresholds", async () => {
    const tx = transaction();
    const input = { ...change(), threshold: "DEADLINE_OVERDUE" } as FascicoloChange;

    await expect(project(tx, input)).resolves.toEqual({ outcome: "NOT_APPLICABLE", signalId: null });
  });

  it("ignores temporal changes without a procedimento target", async () => {
    const tx = transaction();
    const input = { ...change(), procedimentoId: null } as FascicoloChange;

    await expect(project(tx, input)).resolves.toEqual({ outcome: "NOT_APPLICABLE", signalId: null });
  });

  it("fails closed when the canonical procedimento-concessione-tenant relation is missing", async () => {
    const tx = transaction();
    tx.procedimento.findFirst.mockResolvedValue(null);

    await expect(project(tx)).resolves.toEqual({
      outcome: "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH",
      signalId: null,
    });
    expect(tx.fascicoloSignal.findUnique).not.toHaveBeenCalled();
  });

  it("queries the canonical relationship with the queued target ids", async () => {
    const tx = transaction();
    await project(tx);

    expect(tx.procedimento.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "procedimento-1",
        concessioneId: "concessione-1",
        concessione: { enteId: { not: null } },
      },
    }));
  });

  it("rejects a stale temporal generation", async () => {
    const tx = transaction();

    await expect(project(tx, change("CONCESSION_90_DAYS", {
      stateFingerprint: "f".repeat(64),
    }))).resolves.toEqual({ outcome: "NO_OP_STALE_GENERATION", signalId: null });
    expect(tx.fascicoloSignal.create).not.toHaveBeenCalled();
  });

  it("rejects a threshold instant inconsistent with the canonical expiry", async () => {
    const tx = transaction();

    await expect(project(tx, change("CONCESSION_90_DAYS", {
      thresholdAt: "2026-10-04T00:00:00.000Z",
    }))).resolves.toEqual({ outcome: "NO_OP_THRESHOLD_MISMATCH", signalId: null });
  });

  it.each([
    ["CONCESSION_90_DAYS", "LOW"],
    ["CONCESSION_60_DAYS", "MEDIUM"],
    ["CONCESSION_30_DAYS", "HIGH"],
    ["DEADLINE_DUE", "CRITICAL"],
  ] as const)("creates %s with %s attention", async (threshold, attentionLevel) => {
    const tx = transaction();

    await expect(project(tx, change(threshold))).resolves.toEqual({
      outcome: "CREATED",
      signalId: "signal-created",
    });
    expect(tx.fascicoloSignal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: FASCICOLO_SIGNAL_KIND,
        sourceOperation: FASCICOLO_SIGNAL_SOURCE_OPERATION,
        ruleCode: FASCICOLO_SIGNAL_RULE_CODE,
        ruleVersion: FASCICOLO_SIGNAL_RULE_VERSION,
        currentThreshold: threshold,
        attentionLevel,
        status: "OPEN",
        generationFingerprint: generationFingerprint(),
        semanticKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        identityKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it("writes one creation audit in the same transaction", async () => {
    const tx = transaction();
    await project(tx);

    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      azione: "FASCICOLO_SIGNAL_CREATED",
      entita: "FascicoloSignal",
      entitaId: "signal-created",
      enteId: "ente-1",
      concessioneId: "concessione-1",
    }));
  });

  it("replays the same threshold by updating only lastObservedAt without audit", async () => {
    const tx = transaction();
    tx.fascicoloSignal.findUnique.mockResolvedValue(signal());

    await expect(project(tx)).resolves.toEqual({ outcome: "REPLAYED", signalId: "signal-1" });
    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith({
      where: { id: "signal-1" },
      data: { lastObservedAt: observedAt },
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("keeps lastObservedAt monotonic on a delayed replay", async () => {
    const tx = transaction();
    const laterObservation = new Date("2026-10-05T00:00:00.000Z");
    tx.fascicoloSignal.findUnique.mockResolvedValue(signal({ lastObservedAt: laterObservation }));

    await project(tx, change(), observedAt);

    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastObservedAt: laterObservation },
    }));
  });

  it("does not downgrade an existing higher threshold", async () => {
    const tx = transaction();
    tx.fascicoloSignal.findUnique.mockResolvedValue(signal({
      currentThreshold: "CONCESSION_30_DAYS",
      attentionLevel: "HIGH",
    }));

    await expect(project(tx, change("CONCESSION_90_DAYS"))).resolves.toMatchObject({ outcome: "REPLAYED" });
    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastObservedAt: observedAt },
    }));
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("escalates the same generation in place with one semantic audit", async () => {
    const tx = transaction();
    tx.fascicoloSignal.findUnique.mockResolvedValue(signal());

    await expect(project(tx, change("CONCESSION_30_DAYS"))).resolves.toEqual({
      outcome: "ESCALATED",
      signalId: "signal-1",
    });
    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "signal-1" },
      data: expect.objectContaining({ currentThreshold: "CONCESSION_30_DAYS", attentionLevel: "HIGH" }),
    }));
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      azione: "FASCICOLO_SIGNAL_ESCALATED",
    }));
  });

  it("supersedes the open generation before creating a changed generation", async () => {
    const tx = transaction();
    const previous = signal({ generationFingerprint: "c".repeat(64) });
    tx.fascicoloSignal.findFirst.mockResolvedValue(previous);

    await expect(project(tx)).resolves.toEqual({ outcome: "CREATED", signalId: "signal-created" });
    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith({
      where: { id: "signal-1" },
      data: { status: "SUPERSEDED", supersededAt: observedAt },
    });
    expect(tx.fascicoloSignal.create).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls.map(([, input]) => input.azione)).toEqual([
      "FASCICOLO_SIGNAL_SUPERSEDED",
      "FASCICOLO_SIGNAL_CREATED",
    ]);
  });

  it("never reopens a replayed superseded generation", async () => {
    const tx = transaction();
    tx.fascicoloSignal.findUnique.mockResolvedValue(signal({
      status: "SUPERSEDED",
      supersededAt: new Date("2026-10-04T00:00:00.000Z"),
    }));

    await expect(project(tx)).resolves.toEqual({ outcome: "SUPERSEDED_REPLAY", signalId: "signal-1" });
    expect(tx.fascicoloSignal.update).toHaveBeenCalledWith({
      where: { id: "signal-1" },
      data: { lastObservedAt: observedAt },
    });
    expect(tx.fascicoloSignal.findFirst).not.toHaveBeenCalled();
    expect(tx.fascicoloSignal.create).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("keeps one semantic key across escalation thresholds", async () => {
    const first = transaction();
    const second = transaction();
    await project(first, change("CONCESSION_90_DAYS"));
    await project(second, change("DEADLINE_DUE"));

    const firstData = first.fascicoloSignal.create.mock.calls[0][0].data;
    const secondData = second.fascicoloSignal.create.mock.calls[0][0].data;
    expect(firstData.semanticKey).toBe(secondData.semanticKey);
    expect(firstData.identityKey).toBe(secondData.identityKey);
  });

  it("changes identity but not semantic key for a new temporal generation", async () => {
    const first = transaction();
    await project(first);
    const firstData = first.fascicoloSignal.create.mock.calls[0][0].data;

    const extendedExpiry = new Date("2027-02-01T00:00:00.000Z");
    const second = transaction();
    second.procedimento.findFirst.mockResolvedValue({
      id: "procedimento-1",
      concessione: { id: "concessione-1", enteId: "ente-1", dataScadenza: extendedExpiry },
    });
    await project(second, change("CONCESSION_90_DAYS", {
      stateFingerprint: generationFingerprint(extendedExpiry),
      thresholdAt: "2026-11-03T00:00:00.000Z",
    }));
    const secondData = second.fascicoloSignal.create.mock.calls[0][0].data;

    expect(firstData.semanticKey).toBe(secondData.semanticKey);
    expect(firstData.identityKey).not.toBe(secondData.identityKey);
  });

  it("enforces one open generation per semantic signal in PostgreSQL", () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      "prisma/migrations/20260919_patch_f1_fascicolo_signal/migration.sql",
    ), "utf8");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "fascicolo_signal_open_semantic_uq" ON "FascicoloSignal"("semanticKey") WHERE "status" = \'OPEN\';',
    );
    expect(migration).toContain('CONSTRAINT "fascicolo_signal_threshold_attention_ck" CHECK');
  });
});

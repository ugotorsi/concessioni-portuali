import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  admit: vi.fn(),
  tx: {
    concessione: { findFirst: vi.fn() },
    procedimento: { findMany: vi.fn() },
  },
}));

vi.mock("@/server/async-jobs/persistence", () => ({
  admitAsyncJobInTransaction: harness.admit,
}));
vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: vi.fn((callback: (tx: typeof harness.tx) => unknown) => callback(harness.tx)),
}));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  buildConcessioneTimeWatchAdmission,
  createConcessioneTimeWatchHandler,
  deriveConcessioneTimeWatchOccurrences,
  FASCICOLO_TIME_WATCH_OPERATION,
  parseConcessioneTimeWatchReference,
} from "@/server/fascicolo-lifecycle/concessioneTimeWatchJob";
import { parseFascicoloReevaluationReference } from "@/server/fascicolo-lifecycle/fascicoloReevaluationJob";

const expiry = new Date("2027-01-01T00:00:00.000Z");
const concessione = {
  id: "concessione-1",
  enteId: "ente-1",
  dataScadenza: expiry,
  stato: "ATTIVA",
};

function occurrencesAt(now: string, overrides: Partial<typeof concessione> = {}) {
  return deriveConcessioneTimeWatchOccurrences(
    { ...concessione, ...overrides },
    new Date(now),
  );
}

function occurrence(threshold: "CONCESSION_90_DAYS" | "CONCESSION_60_DAYS" | "CONCESSION_30_DAYS" | "DEADLINE_DUE") {
  return occurrencesAt("2026-01-01T00:00:00.000Z").find((item) => item.threshold === threshold)!;
}

describe("Fase 2B Patch E concession time watch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.admit.mockResolvedValue({ outcome: "CREATED", job: { id: "reevaluation-job" } });
  });

  it("derives the four future thresholds in canonical chronological order", () => {
    const derived = occurrencesAt("2026-08-01T00:00:00.000Z");

    expect(derived.map((item) => [item.threshold, item.thresholdAt.toISOString()])).toEqual([
      ["CONCESSION_90_DAYS", "2026-10-03T00:00:00.000Z"],
      ["CONCESSION_60_DAYS", "2026-11-02T00:00:00.000Z"],
      ["CONCESSION_30_DAYS", "2026-12-02T00:00:00.000Z"],
      ["DEADLINE_DUE", "2027-01-01T00:00:00.000Z"],
    ]);
  });

  it.each([
    ["2026-10-18T00:00:00.000Z", ["CONCESSION_90_DAYS", "CONCESSION_60_DAYS", "CONCESSION_30_DAYS", "DEADLINE_DUE"]],
    ["2026-11-17T00:00:00.000Z", ["CONCESSION_60_DAYS", "CONCESSION_30_DAYS", "DEADLINE_DUE"]],
    ["2026-12-12T00:00:00.000Z", ["CONCESSION_30_DAYS", "DEADLINE_DUE"]],
    ["2027-01-02T00:00:00.000Z", ["DEADLINE_DUE"]],
  ])("compacts matured thresholds at %s", (now, expected) => {
    expect(occurrencesAt(now).map((item) => item.threshold)).toEqual(expected);
  });

  it("keeps admission identity stable and availableAt equal to thresholdAt", () => {
    const selected = occurrence("CONCESSION_30_DAYS");
    const first = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(selected));
    const replay = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(selected));

    expect(first.operation).toBe(FASCICOLO_TIME_WATCH_OPERATION);
    expect(first.availableAt.toISOString()).toBe(selected.thresholdAt.toISOString());
    expect(first.idempotencyKey).toBe(replay.idempotencyKey);
    expect(first.requestFingerprint).toBe(replay.requestFingerprint);
    expect(first.admission).toMatchObject({
      admissionType: "AUTHORIZED_SYSTEM",
      tenantId: "ente-1",
      initiatingUserId: null,
      actor: { actorId: "system:fascicolo-time-watch", actorRole: "SYSTEM" },
    });
  });

  it("changes identity for a changed expiry but not for a status-only change", () => {
    const initial = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrencesAt("2026-01-01T00:00:00.000Z")[0]!,
    ));
    const extended = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrencesAt("2026-01-01T00:00:00.000Z", {
        dataScadenza: new Date("2027-02-01T00:00:00.000Z"),
      })[0]!,
    ));
    const statusOnly = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrencesAt("2026-01-01T00:00:00.000Z", { stato: "IN_PROROGA" })[0]!,
    ));

    expect(initial.idempotencyKey).not.toBe(extended.idempotencyKey);
    expect(initial.idempotencyKey).toBe(statusOnly.idempotencyKey);
  });

  it("rejects a tampered bounded reference", () => {
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrence("CONCESSION_30_DAYS"),
    ));
    const tampered = {
      ...admission.inputReference,
      metadata: {
        ...admission.inputReference.metadata,
        thresholdCode: "CONCESSION_60_DAYS",
      },
    };

    expect(() => parseConcessioneTimeWatchReference(tampered)).toThrow("TIME_WATCH_FINGERPRINT_MISMATCH");
  });

  it("revalidates a matured watch and admits one targeted reevaluation per active procedimento", async () => {
    const selected = occurrence("CONCESSION_30_DAYS");
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(selected));
    harness.tx.concessione.findFirst.mockResolvedValue(concessione);
    harness.tx.procedimento.findMany.mockResolvedValue([{ id: "procedimento-1" }, { id: "procedimento-2" }]);
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });

    const output = await handler.execute(handler.parseInput(admission.inputReference), {
      correlationId: admission.correlationId,
    } as never);

    expect(harness.tx.procedimento.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        concessioneId: "concessione-1",
        stato: { in: ["DA_AVVIARE", "IN_CORSO"] },
      },
    }));
    expect(harness.admit).toHaveBeenCalledTimes(2);
    expect(output).toMatchObject({ metadata: { outcomeCode: "THRESHOLD_REACHED", reevaluationJobCount: 2 } });
    for (const [index, procedimentoId] of ["procedimento-1", "procedimento-2"].entries()) {
      const downstream = normalizeAsyncJobAdmission(harness.admit.mock.calls[index][1]);
      const parsed = parseFascicoloReevaluationReference(downstream.inputReference);
      expect(parsed.procedimentoId).toBe(procedimentoId);
      expect(parsed.change).toMatchObject({
        kind: "TIME_THRESHOLD_REACHED",
        origin: "WATCHDOG",
        subjectType: "CONCESSIONE",
        subjectId: "concessione-1",
        procedimentoId,
        threshold: "CONCESSION_30_DAYS",
        thresholdAt: "2026-12-02T00:00:00.000Z",
      });
      if (parsed.change.kind !== "TIME_THRESHOLD_REACHED") throw new Error("Unexpected change kind");
      expect(parsed.change.triggeredAt).not.toBe(parsed.change.thresholdAt);
      expect(downstream.correlationId).toBe(admission.correlationId);
    }
  });

  it("produces identical downstream admissions when the same watch is retried", async () => {
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrence("CONCESSION_30_DAYS"),
    ));
    harness.tx.concessione.findFirst.mockResolvedValue(concessione);
    harness.tx.procedimento.findMany.mockResolvedValue([{ id: "procedimento-1" }]);
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });
    const parsed = handler.parseInput(admission.inputReference);
    const context = { correlationId: admission.correlationId } as never;

    await handler.execute(parsed, context);
    await handler.execute(parsed, context);

    const first = normalizeAsyncJobAdmission(harness.admit.mock.calls[0][1]);
    const retry = normalizeAsyncJobAdmission(harness.admit.mock.calls[1][1]);
    expect(first.idempotencyKey).toBe(retry.idempotencyKey);
    expect(first.requestFingerprint).toBe(retry.requestFingerprint);
  });

  it.each([
    [null, "NO_OP_SUBJECT_NOT_FOUND_OR_SCOPE_MISMATCH"],
    [{ ...concessione, stato: "SCADUTA" }, "NO_OP_SUBJECT_NOT_APPLICABLE"],
    [{ ...concessione, dataScadenza: new Date("2027-02-01T00:00:00.000Z") }, "NO_OP_STALE_OCCURRENCE"],
  ])("returns NO_OP without downstream admission for an inapplicable subject", async (current, outcomeCode) => {
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrence("CONCESSION_30_DAYS"),
    ));
    harness.tx.concessione.findFirst.mockResolvedValue(current);
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });

    const output = await handler.execute(handler.parseInput(admission.inputReference), {
      correlationId: admission.correlationId,
    } as never);

    expect(output).toMatchObject({ metadata: { outcomeCode } });
    expect(harness.admit).not.toHaveBeenCalled();
  });

  it("returns NO_OP when no active procedimento exists", async () => {
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrence("CONCESSION_30_DAYS"),
    ));
    harness.tx.concessione.findFirst.mockResolvedValue(concessione);
    harness.tx.procedimento.findMany.mockResolvedValue([]);
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });

    await expect(handler.execute(handler.parseInput(admission.inputReference), {
      correlationId: admission.correlationId,
    } as never)).resolves.toMatchObject({ metadata: { outcomeCode: "NO_OP_NO_ACTIVE_PROCEDIMENTO" } });
    expect(harness.admit).not.toHaveBeenCalled();
  });

  it("is registered without Criticita, alert, or notification behavior", () => {
    expect(applicationAsyncJobRegistry.resolve(FASCICOLO_TIME_WATCH_OPERATION)).not.toBeNull();
    const source = readFileSync(resolve(
      process.cwd(),
      "src/server/fascicolo-lifecycle/concessioneTimeWatchJob.ts",
    ), "utf8");
    expect(source).not.toMatch(/criticita|notification|alert/i);
  });
});
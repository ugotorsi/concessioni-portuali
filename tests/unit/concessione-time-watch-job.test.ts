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
  buildConcessioneTimeWatchAdmissionV2,
  buildConcessioneTimeWatchReevaluationAdmission,
  createConcessioneTimeWatchHandler,
  createConcessioneTimeWatchV2Handler,
  deriveConcessioneTimeWatchOccurrences,
  deriveConcessioneTimeWatchOccurrencesV2,
  FASCICOLO_TIME_WATCH_OPERATION,
  FASCICOLO_TIME_WATCH_V2_OPERATION,
  parseConcessioneTimeWatchReference,
  parseConcessioneTimeWatchReferenceV2,
} from "@/server/fascicolo-lifecycle/concessioneTimeWatchJob";
import { parseFascicoloReevaluationReference } from "@/server/fascicolo-lifecycle/fascicoloReevaluationJob";

const expiry = new Date("2027-01-01T00:00:00.000Z");
const concessione = {
  id: "concessione-1",
  enteId: "ente-1",
  dataScadenza: expiry,
  expiryGeneration: 0,
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

  it("preserves the literal pre-G2 V1 reference and fixed fingerprints", () => {
    const legacyAdmission = normalizeAsyncJobAdmission({
      operation: "FASCICOLO_TIME_WATCH_V1",
      logicalOperationId: "3f3ade05bca006c1402d29527dbd3c6ede23cb2375f273d7fe92651b58474387",
      purpose: "FASCICOLO_TIME_THRESHOLD_REVALIDATION",
      correlationId: "fascicolo-time-watch:3f3ade05bca006c1402d29527dbd3c6ede23cb2375f273d7fe92651b58474387",
      policyDecisionRef: "FASCICOLO_TIME_WATCH_SYSTEM_ADMISSION_V1",
      inputReference: {
        referenceType: "FASCICOLO_TIME_WATCH",
        referenceId: "concessione-1",
        referenceVersion: "V1",
        metadata: {
          contractVersion: "CONCESSIONE_TIME_WATCH_V1",
          expectedTemporalFingerprintHash: "f480e73dc7ca84c53a7381b7f3ebe721cb2ca0bb8b15f56fac63f9e342afc65e",
          subjectType: "CONCESSIONE",
          tenantId: "ente-1",
          thresholdAt: "2026-12-02T00:00:00.000Z",
          thresholdCode: "CONCESSION_30_DAYS",
          watchFingerprintHash: "3f3ade05bca006c1402d29527dbd3c6ede23cb2375f273d7fe92651b58474387",
        },
      },
      maxAttempts: 3,
      availableAt: new Date("2026-12-02T00:00:00.000Z"),
      admission: {
        admissionType: "AUTHORIZED_SYSTEM",
        tenantId: "ente-1",
        initiatingUserId: null,
        actor: { actorId: "system:fascicolo-time-watch", actorEmail: null, actorRole: "SYSTEM" },
      },
    });

    expect(legacyAdmission.idempotencyKey).toBe("5800b183c778907c6e22d595c470de2ae3bb9e344f324112d95fe1cc8b3443b3");
    expect(legacyAdmission.requestFingerprint).toBe("24c13ad1e3555869574da76fbda93aa4fecad167da7f1eb31ce01a91cca87905");
    expect(parseConcessioneTimeWatchReference(legacyAdmission.inputReference).expectedTemporalFingerprint)
      .toBe("f480e73dc7ca84c53a7381b7f3ebe721cb2ca0bb8b15f56fac63f9e342afc65e");
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

  it("keeps watch and create catch-up reevaluation identity exactly equivalent", async () => {
    const selected = occurrence("CONCESSION_30_DAYS");
    const watchAdmission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(selected));
    harness.tx.concessione.findFirst.mockResolvedValue(concessione);
    harness.tx.procedimento.findMany.mockResolvedValue([{ id: "procedimento-1" }]);
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });

    await handler.execute(handler.parseInput(watchAdmission.inputReference), {
      correlationId: watchAdmission.correlationId,
    } as never);

    const fromWatch = normalizeAsyncJobAdmission(harness.admit.mock.calls[0][1]);
    const fromCreateCatchUp = normalizeAsyncJobAdmission(buildConcessioneTimeWatchReevaluationAdmission({
      occurrence: selected,
      procedimentoId: "procedimento-1",
      triggeredAt: new Date("2026-12-03T08:30:00.000Z"),
    }));
    expect(fromCreateCatchUp.idempotencyKey).toBe(fromWatch.idempotencyKey);
    expect(fromCreateCatchUp.requestFingerprint).toBe(fromWatch.requestFingerprint);
    expect(fromCreateCatchUp.correlationId).toBe(watchAdmission.correlationId);
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

  it("rejects a legacy V1 event after the concession moved to a positive generation", async () => {
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmission(
      occurrence("CONCESSION_30_DAYS"),
    ));
    harness.tx.concessione.findFirst.mockResolvedValue({ ...concessione, expiryGeneration: 1 });
    const handler = createConcessioneTimeWatchHandler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });

    await expect(handler.execute(handler.parseInput(admission.inputReference), {
      correlationId: admission.correlationId,
    } as never)).resolves.toMatchObject({ metadata: { outcomeCode: "NO_OP_STALE_LEGACY_GENERATION" } });
    expect(harness.tx.procedimento.findMany).not.toHaveBeenCalled();
    expect(harness.admit).not.toHaveBeenCalled();
  });

  it("uses V2 only for a positive exact generation and rejects stale generations", async () => {
    const current = { ...concessione, expiryGeneration: 2 };
    const selected = deriveConcessioneTimeWatchOccurrencesV2(
      current,
      new Date("2026-01-01T00:00:00.000Z"),
    ).find((item) => item.threshold === "CONCESSION_30_DAYS")!;
    const admission = normalizeAsyncJobAdmission(buildConcessioneTimeWatchAdmissionV2(selected));
    const parsed = parseConcessioneTimeWatchReferenceV2(admission.inputReference);
    expect(admission.operation).toBe(FASCICOLO_TIME_WATCH_V2_OPERATION);
    expect(parsed.expiryGeneration).toBe(2);

    harness.tx.concessione.findFirst.mockResolvedValue({ ...current, expiryGeneration: 3 });
    const handler = createConcessioneTimeWatchV2Handler({
      now: () => new Date("2026-12-02T12:00:00.000Z"),
    });
    await expect(handler.execute(parsed, { correlationId: admission.correlationId } as never))
      .resolves.toMatchObject({ metadata: { outcomeCode: "NO_OP_STALE_OCCURRENCE" } });
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
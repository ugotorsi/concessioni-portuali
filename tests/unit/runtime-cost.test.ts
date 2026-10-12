import { describe, expect, it, vi } from "vitest";

import {
  releaseRuntimeCost,
  reserveRuntimeCost,
  RuntimeBudgetExceededError,
  RuntimeBudgetPolicyMissingError,
  RuntimeCostReservationConflictError,
  settleRuntimeCost,
  withRuntimeCostGate,
  type RuntimeCostContext,
} from "@/server/runtime/cost";
import type { RuntimeSqlExecutor } from "@/server/runtime/health";

function context(responses: unknown[][]): RuntimeCostContext & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  for (const rows of responses) query.mockResolvedValueOnce({ rows });
  return {
    query,
    transaction: (operation) => operation({ query } as RuntimeSqlExecutor),
  };
}

const reservation = {
  tenantId: "tenant-1",
  procedimentoId: "procedure-1",
  jobId: "job-1",
  provider: "fixture-provider",
  operationType: "SYNTHETIC.TEST",
  estimatedAmount: 2.5,
  idempotencyKey: "logical-call-1",
};

const policies = [
  { id: "policy-global", scope: "GLOBAL", hardCapAmount: "100.000000", windowSeconds: 3600 },
  { id: "policy-tenant", scope: "TENANT", hardCapAmount: "50.000000", windowSeconds: 3600 },
  { id: "policy-procedure", scope: "PROCEDIMENTO", hardCapAmount: "10.000000", windowSeconds: 3600 },
];

describe("Lotto 8 runtime cost gate", () => {
  it("rejects before insertion when a scoped hard cap would be exceeded", async () => {
    const db = context([
      [],
      policies,
      [{ amount: "0.000000" }],
      [{ amount: "0.000000" }],
      [{ amount: "8.000000" }],
    ]);
    await expect(reserveRuntimeCost(reservation, db)).rejects.toBeInstanceOf(RuntimeBudgetExceededError);
    expect(db.query).toHaveBeenCalledTimes(5);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO \"RuntimeCostReservation\""))).toBe(false);
  });

  it("reserves once after locking and checking all applicable policies", async () => {
    const db = context([
      [],
      policies,
      [{ amount: "4.000000" }],
      [{ amount: "4.000000" }],
      [{ amount: "4.000000" }],
      [],
    ]);
    await expect(reserveRuntimeCost(reservation, db)).resolves.toMatchObject({ outcome: "RESERVED" });
    expect(String(db.query.mock.calls[1][0])).toContain("FOR UPDATE");
    expect(String(db.query.mock.calls[5][0])).toContain("INSERT INTO \"RuntimeCostReservation\"");
  });

  it("reuses an existing reservation idempotently", async () => {
    const db = context([[{ id: "reservation-existing", status: "RESERVED", active: true }]]);
    await expect(reserveRuntimeCost(reservation, db)).resolves.toEqual({
      reservationId: "reservation-existing", outcome: "REUSED",
    });
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("does not call a provider when the same reservation is already active", async () => {
    const db = context([[{ id: "reservation-existing", status: "RESERVED", active: true }]]);
    const providerCall = vi.fn();
    await expect(withRuntimeCostGate(reservation, providerCall, db)).rejects
      .toBeInstanceOf(RuntimeCostReservationConflictError);
    expect(providerCall).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("settles an admitted provider call with the actual amount", async () => {
    const db = context([
      [], policies,
      [{ amount: "0.000000" }], [{ amount: "0.000000" }], [{ amount: "0.000000" }],
      [],
      [],
    ]);
    const providerCall = vi.fn(async () => ({ value: "provider-result", actualAmount: 1.25 }));

    await expect(withRuntimeCostGate(reservation, providerCall, db)).resolves.toBe("provider-result");
    expect(providerCall).toHaveBeenCalledOnce();
    expect(String(db.query.mock.calls[6][0])).toContain('"status"=\'SETTLED\'');
  });

  it("releases an admitted reservation when the provider fails", async () => {
    const db = context([
      [], policies,
      [{ amount: "0.000000" }], [{ amount: "0.000000" }], [{ amount: "0.000000" }],
      [],
      [],
    ]);
    const providerFailure = new Error("synthetic provider failure");

    await expect(withRuntimeCostGate(
      reservation,
      async () => { throw providerFailure; },
      db,
    )).rejects.toBe(providerFailure);
    expect(String(db.query.mock.calls[6][0])).toContain('"status"=\'RELEASED\'');
  });

  it("rechecks caps before reactivating a released reservation", async () => {
    const db = context([
      [{ id: "reservation-existing", status: "RELEASED", active: false }],
      policies,
      [{ amount: "0.000000" }],
      [{ amount: "0.000000" }],
      [{ amount: "0.000000" }],
      [],
    ]);
    await expect(reserveRuntimeCost(reservation, db)).resolves.toEqual({
      reservationId: "reservation-existing", outcome: "RESERVED",
    });
    expect(String(db.query.mock.calls[1][0])).toContain("RuntimeBudgetPolicy");
    expect(String(db.query.mock.calls[5][0])).toContain("UPDATE \"RuntimeCostReservation\"");
  });

  it("fails closed when an applicable scoped policy is missing", async () => {
    const db = context([[], [policies[0]]]);
    await expect(reserveRuntimeCost(reservation, db)).rejects.toBeInstanceOf(RuntimeBudgetPolicyMissingError);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("supports settlement and release without reopening terminal reservations", async () => {
    const settleDb = context([[]]);
    await settleRuntimeCost({ reservationId: "reservation-1", actualAmount: 1.75 }, settleDb);
    expect(String(settleDb.query.mock.calls[0][0])).toContain("WHERE \"id\"=$1 AND \"status\"='RESERVED'");
    const releaseDb = context([[]]);
    await releaseRuntimeCost("reservation-1", releaseDb);
    expect(String(releaseDb.query.mock.calls[0][0])).toContain("\"status\"='RELEASED'");
  });
});
import { describe, expect, it, vi } from "vitest";

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  bootstrapConcessioneTimeWatches,
  CONCESSIONE_TIME_WATCH_BOOTSTRAP_PAGE_SIZE,
} from "@/server/fascicolo-lifecycle/concessioneTimeWatchBootstrap";

const futureConcessione = (id: string) => ({
  id,
  enteId: "ente-1",
  dataScadenza: new Date("2027-12-31T00:00:00.000Z"),
  expiryGeneration: 0,
  stato: "ATTIVA",
});

describe("Fase 2B Patch E concession time-watch bootstrap", () => {
  it("pages through concessions with bounded pages and admits their watches", async () => {
    const firstPage = Array.from(
      { length: CONCESSIONE_TIME_WATCH_BOOTSTRAP_PAGE_SIZE },
      (_, index) => futureConcessione(`concessione-${String(index).padStart(3, "0")}`),
    );
    const last = futureConcessione("concessione-last");
    const listPage = vi.fn(async (cursor: string | undefined) => {
      if (cursor === undefined) return firstPage;
      if (cursor === firstPage.at(-1)!.id) return [last];
      return [];
    });
    const admit = vi.fn(async (_rawAdmission: unknown) => ({
      outcome: "CREATED" as const,
      job: { id: "job" } as never,
    }));

    const result = await bootstrapConcessioneTimeWatches({
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      listPage,
      admit,
    });

    expect(listPage).toHaveBeenNthCalledWith(1, undefined);
    expect(listPage).toHaveBeenNthCalledWith(2, firstPage.at(-1)!.id);
    expect(result).toEqual({ scannedCount: 101, admittedCount: 404, reusedCount: 0 });
    expect(admit).toHaveBeenCalledTimes(404);
  });

  it("reuses the same occurrence identities after a restart", async () => {
    const listPage = vi.fn(async () => [futureConcessione("concessione-1")]);
    const identities = new Set<string>();
    const admit = vi.fn(async (rawAdmission) => {
      const key = normalizeAsyncJobAdmission(rawAdmission).idempotencyKey;
      const outcome = identities.has(key) ? "REUSED" as const : "CREATED" as const;
      identities.add(key);
      return { outcome, job: { id: key } as never };
    });
    const dependencies = {
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      listPage,
      admit,
    };

    await expect(bootstrapConcessioneTimeWatches(dependencies)).resolves.toEqual({
      scannedCount: 1,
      admittedCount: 4,
      reusedCount: 0,
    });
    await expect(bootstrapConcessioneTimeWatches(dependencies)).resolves.toEqual({
      scannedCount: 1,
      admittedCount: 0,
      reusedCount: 4,
    });
    expect(identities).toHaveLength(4);
  });

  it("admits only the latest matured occurrence plus future occurrences", async () => {
    const admit = vi.fn(async (_rawAdmission: unknown) => ({
      outcome: "CREATED" as const,
      job: { id: "job" } as never,
    }));

    await bootstrapConcessioneTimeWatches({
      now: () => new Date("2027-12-15T00:00:00.000Z"),
      listPage: vi.fn(async () => [futureConcessione("concessione-1")]),
      admit,
    });

    expect(admit).toHaveBeenCalledTimes(2);
    expect(admit.mock.calls.map(([value]) => normalizeAsyncJobAdmission(value).inputReference.metadata.thresholdCode))
      .toEqual(["CONCESSION_30_DAYS", "DEADLINE_DUE"]);
  });
});
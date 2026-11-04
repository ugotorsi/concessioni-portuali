import { describe, expect, it } from "vitest";

import {
  researchMissionDisplayState,
  RESEARCH_QUEUE_STALL_MS,
  type ResearchMissionDisplayInput,
  type ResearchMissionExecutionJobView,
} from "@/server/legal-research/research-mission-display-state";

const now = new Date("2026-11-05T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const job = (overrides: Partial<ResearchMissionExecutionJobView>): ResearchMissionExecutionJobView => ({
  status: "QUEUED",
  failureCode: null,
  availableAt: ago(60_000),
  leaseExpiresAt: null,
  createdAt: ago(60_000),
  ...overrides,
});
const state = (overrides: Partial<ResearchMissionDisplayInput>) => researchMissionDisplayState({
  status: "PENDING",
  lifecycleStatus: "CURRENT",
  claimExpiresAt: null,
  results: [],
  job: null,
  now,
  ...overrides,
});

describe("research mission display state", () => {
  it("distinguishes requested, queued and running missions", () => {
    expect(state({}).state).toBe("REQUESTED");
    expect(state({ job: job({}) }).state).toBe("QUEUED");
    expect(state({ status: "IN_PROGRESS", job: job({ status: "RUNNING", leaseExpiresAt: new Date(now.getTime() + 60_000) }) }).state).toBe("RUNNING");
    expect(state({ status: "IN_PROGRESS", claimExpiresAt: new Date(now.getTime() + 60_000) }).state).toBe("RUNNING");
  });

  it("never reports a stalled mission as in progress", () => {
    const queued = state({ job: job({ availableAt: ago(72 * 3_600_000) }) });
    expect(queued).toMatchObject({ state: "BLOCKED", stalled: true });
    expect(queued.detail).toContain("circa 72 ore");
    expect(state({ job: job({ availableAt: ago(RESEARCH_QUEUE_STALL_MS - 1) }) }).state).toBe("QUEUED");
    expect(state({ status: "IN_PROGRESS", job: job({ status: "RUNNING", leaseExpiresAt: ago(1) }) })).toMatchObject({ state: "BLOCKED", stalled: true });
    expect(state({ status: "IN_PROGRESS", claimExpiresAt: ago(1) })).toMatchObject({ state: "BLOCKED", stalled: true });
    expect(state({ status: "IN_PROGRESS" })).toMatchObject({ state: "BLOCKED", stalled: true });
  });

  it("explains failures without exposing internal codes", () => {
    const failed = state({ job: job({ status: "TERMINAL_FAILED", failureCode: "RESEARCH_MISSION_NOT_CURRENT" }) });
    expect(failed.state).toBe("FAILED");
    expect(failed.detail).toContain("revisione dell'analisi non più corrente");
    const legacy = state({ job: job({ status: "TERMINAL_FAILED", failureCode: "AUTOMATIC_RESEARCH_POLICY_OR_SCOPE_INVALID" }) });
    expect(legacy.detail).not.toMatch(/[A-Z]+_[A-Z_]+/);
    expect(state({ job: job({ status: "TERMINAL_FAILED", failureCode: "P2010" }) }).detail).toContain("errore tecnico");
    expect(state({ job: job({ status: "CANCELLED" }) }).state).toBe("BLOCKED");
  });

  it("separates empty, unverified and validated outcomes", () => {
    expect(state({ status: "COMPLETED", job: job({ status: "SUCCEEDED" }) }).state).toBe("COMPLETED_NO_RESULTS");
    expect(state({
      status: "COMPLETED",
      results: [{ classificationReviewStatus: "AI_PROPOSED" }, { classificationReviewStatus: "REJECTED" }],
    })).toMatchObject({ state: "COMPLETED_SOURCES_TO_VERIFY", detail: "1 risultato da sottoporre a verifica professionale." });
    expect(state({
      status: "COMPLETED",
      results: [{ classificationReviewStatus: "HUMAN_CONFIRMED" }, { classificationReviewStatus: "AI_PROPOSED" }],
    })).toMatchObject({ state: "VALIDATED", detail: "1 fonte confermata dal professionista." });
    expect(state({ status: "COMPLETED", results: [{ classificationReviewStatus: "REJECTED" }] }).state).toBe("COMPLETED_NO_RESULTS");
  });

  it("blocks historical, deferred and budget-exhausted missions", () => {
    expect(state({ lifecycleStatus: "HISTORICAL", job: job({}) }).state).toBe("BLOCKED");
    expect(state({ status: "DEFERRED" }).state).toBe("BLOCKED");
    expect(state({ status: "BUDGET_EXHAUSTED" }).state).toBe("BLOCKED");
    expect(state({ status: "REJECTED" }).state).toBe("FAILED");
  });

  it("reports an executed but incomplete research as an outcome, not as a policy refusal", () => {
    const withSources = state({
      status: "DEFERRED",
      job: job({ status: "SUCCEEDED" }),
      results: [{ classificationReviewStatus: "AI_PROPOSED" }, { classificationReviewStatus: "AI_PROPOSED" }],
    });
    expect(withSources.state).toBe("COMPLETED_SOURCES_TO_VERIFY");
    expect(withSources.detail).toContain("Ricerca eseguita ma incompleta: 2 risultati");
    const empty = state({ status: "DEFERRED", job: job({ status: "SUCCEEDED" }) });
    expect(empty.state).toBe("COMPLETED_NO_RESULTS");
    expect(empty.detail).toContain("nessuna conclusione giuridica");
    expect(state({ status: "DEFERRED" }).detail).toContain("Non ancora eseguita");
  });
});

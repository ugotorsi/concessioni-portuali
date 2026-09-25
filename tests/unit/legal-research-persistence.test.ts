import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  RESEARCH_BRIDGE_VERSION,
  createResearchMission,
  type ResearchEvidenceBundle,
  type ResearchMission,
  type ResearchMissionInput,
  type ResearchToolExecution,
} from "@/server/legal-research/bridge";
import {
  FUTURE_MCP_RESEARCH_PERSISTENCE_MAPPING,
  ResearchPersistenceError,
  buildResearchMissionAsyncJobAdmission,
  claimResearchMission,
  completeResearchMission,
  createResearchMissionRecord,
  getResearchFascicoloContext,
  getResearchMission,
  listPendingResearchMissions,
  rejectOrDeferResearchMission,
  releaseOrDeferResearchMission,
  researchEvidenceBundleFingerprint,
  submitResearchEvidenceBundle,
  type ResearchPersistenceClient,
  type ResearchPersistenceContext,
} from "@/server/legal-research/persistence";

const actor = { actorId: "user-1", tenantId: "ente-1" } as const;
const start = new Date("2026-09-17T10:00:00.000Z");
let now = start;
let tokenSequence = 0;

function missionInput(overrides: Partial<ResearchMissionInput> = {}): ResearchMissionInput {
  return {
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    caseReference: { caseId: "case-1", fascicoloReference: "fascicolo-1" },
    legalIssueIds: ["issue-1"],
    legalPropositionIds: ["proposition-1"],
    conclusionIds: ["conclusion-1"],
    referenceDate: "2026-01-15T00:00:00.000Z",
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: "Which authorities govern the concession?",
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: ["GIUSTIZIA_AMMINISTRATIVA"],
    missingSourceFamilies: ["CASSAZIONE"],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: true,
      evidenceGaps: true,
      fullTextRequired: false,
    },
    budget: {
      maxTotalResearchCalls: 10,
      maxMoonlitCalls: 4,
      maxSimpliciterCalls: 4,
      maxLegalDataHunterCalls: 4,
    },
    status: "PENDING",
    ...overrides,
  };
}

function researchMission(overrides: Partial<ResearchMissionInput> = {}): ResearchMission {
  return createResearchMission(missionInput(overrides));
}

function toolExecution(
  toolId: "MOONLIT" | "SIMPLICITER" | "LEGAL_DATA_HUNTER",
  callsConsumed = 1,
): ResearchToolExecution {
  const roles = {
    MOONLIT: "CITATION_AUTHORITY_INTELLIGENCE",
    SIMPLICITER: "LEGAL_RESEARCH_STRATEGIST",
    LEGAL_DATA_HUNTER: "BROAD_DISCOVERY",
  } as const;
  return {
    executionRecordId: `tool-${toolId.toLowerCase()}`,
    toolId,
    role: roles[toolId],
    operationType: toolId === "MOONLIT" ? "CITATION_SEARCH" : "SEMANTIC_SEARCH",
    researchQuery: "bounded fixture query",
    sourceFamiliesRequested: ["GIUSTIZIA_AMMINISTRATIVA"],
    resultIdentifiersUsed: [],
    resultCount: 0,
    callsConsumed,
  };
}

function evidenceBundle(
  mission: ResearchMission,
  executionId: string,
  completionState: ResearchEvidenceBundle["completionState"] = "PARTIAL",
  executions: readonly ResearchToolExecution[] = [toolExecution("MOONLIT")],
): ResearchEvidenceBundle {
  return {
    kind: "RESEARCH_EVIDENCE_BUNDLE",
    version: RESEARCH_BRIDGE_VERSION,
    missionId: mission.missionId,
    executionId,
    startedAt: "2026-09-17T10:00:00.000Z",
    completedAt: "2026-09-17T10:05:00.000Z",
    researchToolExecutions: executions,
    authorityCandidates: [],
    citationObservations: [],
    legalResearchSuggestions: [],
    evidenceGaps: [],
    conflicts: [],
    unresolvedQuestions: [],
    suggestedFollowUpMissions: [],
    humanDecisionEscalations: [],
    completionState,
  };
}

function p2002(modelName: string, field: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName, target: [field] },
  });
}

function matchesScalar(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && "lte" in expected) {
    return typeof actual === "number" && actual <= (expected as { lte: number }).lte;
  }
  return actual === expected;
}

function createHarness() {
  const missions = new Map<string, Record<string, any>>();
  const attempts = new Map<string, Record<string, any>>();
  const bundles = new Map<string, Record<string, any>>();

  const missionDelegate = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return missions.get(where.id) ?? null;
      return [...missions.values()].find((item) => item.payloadFingerprint === where.payloadFingerprint) ?? null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const value = missions.get(where.id);
      if (!value) throw new Error("NOT_FOUND");
      return value;
    }),
    findMany: vi.fn(async ({ where, take }: any) => {
      let values = [...missions.values()].filter((item) => item.tenantId === where.tenantId);
      if (where.caseId !== undefined) values = values.filter((item) => item.caseId === where.caseId);
      if (where.fascicoloReference !== undefined) {
        values = values.filter((item) => item.fascicoloReference === where.fascicoloReference);
      }
      if (where.status?.in) values = values.filter((item) => where.status.in.includes(item.status));
      if (where.OR) {
        values = values.filter((item) => ["PENDING", "DEFERRED"].includes(item.status)
          || (item.status === "IN_PROGRESS" && item.claimExpiresAt <= where.OR[1].claimExpiresAt.lte));
      }
      return values
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .slice(0, take);
    }),
    create: vi.fn(async ({ data }: any) => {
      if (missions.has(data.id)) throw p2002("ResearchMissionRecord", "id");
      const value = {
        ...data,
        fascicoloReference: data.fascicoloReference ?? null,
        status: "PENDING",
        stateVersion: 0,
        claimantId: null,
        claimToken: null,
        claimExpiresAt: null,
        activeExecutionId: null,
        completedAt: null,
        deferredAt: null,
        createdAt: now,
        updatedAt: now,
      };
      missions.set(value.id, value);
      return value;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const value = missions.get(where.id);
      if (!value || Object.entries(where).some(([key, expected]) =>
        key !== "id" && !matchesScalar(value[key], expected))) return { count: 0 };
      const next = { ...value };
      for (const [key, update] of Object.entries(data)) {
        next[key] = update && typeof update === "object" && "increment" in update
          ? next[key] + (update as { increment: number }).increment
          : update;
      }
      next.updatedAt = now;
      missions.set(next.id, next);
      return { count: 1 };
    }),
  };

  const attemptDelegate = {
    findUnique: vi.fn(async ({ where }: any) => attempts.get(where.id) ?? null),
    create: vi.fn(async ({ data }: any) => {
      if (attempts.has(data.id)) throw p2002("ResearchExecutionAttempt", "id");
      const value = {
        ...data,
        completedAt: null,
        completionState: null,
        totalCalls: 0,
        moonlitCalls: 0,
        simpliciterCalls: 0,
        legalDataHunterCalls: 0,
        errorCode: null,
        deferReason: null,
        finalBundleId: null,
        createdAt: now,
        updatedAt: now,
      };
      attempts.set(value.id, value);
      return value;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const value = attempts.get(where.id);
      if (!value || Object.entries(where).some(([key, expected]) =>
        key !== "id" && !matchesScalar(value[key], expected))) return { count: 0 };
      const next = { ...value, ...data, updatedAt: now };
      attempts.set(next.id, next);
      return { count: 1 };
    }),
  };

  const bundleDelegate = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return bundles.get(where.id) ?? null;
      return [...bundles.values()].find((item) => item.fingerprint === where.fingerprint) ?? null;
    }),
    findMany: vi.fn(async ({ where, take }: any) => [...bundles.values()]
      .filter((item) => where.missionId.in.includes(item.missionId))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, take)),
    create: vi.fn(async ({ data }: any) => {
      if (bundles.has(data.id)
        || [...bundles.values()].some((item) => item.fingerprint === data.fingerprint)) {
        throw p2002("ResearchEvidenceBundleRecord", "fingerprint");
      }
      const value = { ...data, createdAt: now };
      bundles.set(value.id, value);
      return value;
    }),
  };

  const client = {
    researchMissionRecord: missionDelegate,
    researchExecutionAttempt: attemptDelegate,
    researchEvidenceBundleRecord: bundleDelegate,
  } as unknown as ResearchPersistenceClient;
  const context: Partial<ResearchPersistenceContext> = {
    client,
    transaction: async (operation) => operation(client),
    clock: { now: () => new Date(now) },
    claimToken: () => (++tokenSequence).toString(16).padStart(64, "0"),
  };
  return { missions, attempts, bundles, missionDelegate, attemptDelegate, bundleDelegate, context };
}

async function createAndClaim(harness: ReturnType<typeof createHarness>, overrides: Partial<ResearchMissionInput> = {}) {
  const mission = researchMission(overrides);
  await createResearchMissionRecord({ mission, actor }, harness.context);
  const claimed = await claimResearchMission({
    missionId: mission.missionId,
    executionId: "execution-1",
    executor: { kind: "CHATGPT", claimantId: "chat-session-1" },
    actor,
    leaseDurationMs: 60_000,
  }, harness.context);
  return { mission, claimed };
}

describe("Block 3B.13B research mission persistence", () => {
  beforeEach(() => {
    now = new Date(start);
    tokenSequence = 0;
  });

  it("creates a mission with its immutable accepted snapshot", async () => {
    const harness = createHarness();
    const mission = researchMission();
    const result = await createResearchMissionRecord({ mission, actor }, harness.context);
    expect(result.outcome).toBe("CREATED");
    expect(result.mission.mission).toEqual(mission);
    expect(harness.missions.get(mission.missionId)?.payload).toEqual(mission);
  });

  it("reuses the same mission idempotently", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    await expect(createResearchMissionRecord({ mission, actor }, harness.context))
      .resolves.toMatchObject({ outcome: "REUSED" });
  });

  it("converges concurrent identical mission creation", async () => {
    const harness = createHarness();
    const mission = researchMission();
    const results = await Promise.all([
      createResearchMissionRecord({ mission, actor }, harness.context),
      createResearchMissionRecord({ mission, actor }, harness.context),
    ]);
    expect(results.map((item) => item.outcome).sort()).toEqual(["CREATED", "REUSED"]);
    expect(harness.missions).toHaveLength(1);
  });

  it("creates a distinct mission for materially different research", async () => {
    const harness = createHarness();
    const first = researchMission();
    const second = researchMission({ researchQuestion: "What adverse authorities apply?" });
    await createResearchMissionRecord({ mission: first, actor }, harness.context);
    await createResearchMissionRecord({ mission: second, actor }, harness.context);
    expect(first.missionId).not.toBe(second.missionId);
    expect(harness.missions).toHaveLength(2);
  });

  it("round-trips legal referenceDate separately from operational createdAt", async () => {
    const harness = createHarness();
    const mission = researchMission();
    const result = await createResearchMissionRecord({ mission, actor }, harness.context);
    expect(result.mission.mission.referenceDate).toBe("2026-01-15T00:00:00.000Z");
    expect(result.mission.operational.createdAt.toISOString()).toBe("2026-09-17T10:00:00.000Z");
  });

  it("lists pending and deferred missions plus recoverable stale claims", async () => {
    const harness = createHarness();
    const first = researchMission();
    const second = researchMission({ researchQuestion: "Second question" });
    await createResearchMissionRecord({ mission: first, actor }, harness.context);
    await createResearchMissionRecord({ mission: second, actor }, harness.context);
    harness.missions.get(second.missionId)!.status = "IN_PROGRESS";
    harness.missions.get(second.missionId)!.claimExpiresAt = new Date(start.getTime() - 1);
    expect(await listPendingResearchMissions(actor, harness.context)).toHaveLength(2);
  });

  it("enforces the tenant authorization boundary on reads", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    await expect(getResearchMission(mission.missionId, { actorId: "other", tenantId: "ente-2" }, harness.context))
      .rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
  });

  it("does not mutate a mission when another tenant tries to claim it", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    await expect(claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-other-tenant",
      executor: { kind: "CHATGPT", claimantId: "other-session" },
      actor: { actorId: "other", tenantId: "ente-2" },
      leaseDurationMs: 60_000,
    }, harness.context)).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    expect(harness.missions.get(mission.missionId)).toMatchObject({
      status: "PENDING",
      claimantId: null,
      activeExecutionId: null,
    });
    expect(harness.attempts).toHaveLength(0);
  });

  it("returns only purpose-relevant prior missions and bundles from the same fascicolo scope", async () => {
    const harness = createHarness();
    const current = researchMission({ researchQuestion: "Current FASCICOLO_A question" });
    const priorA = researchMission({ researchQuestion: "FACT_ALPHA", status: "PENDING" });
    const priorB = researchMission({
      caseReference: { caseId: "case-b", fascicoloReference: "fascicolo-b" },
      researchQuestion: "FACT_BETA",
    });
    const otherTenant = researchMission({ researchQuestion: "OTHER_TENANT_FACT" });
    await createResearchMissionRecord({ mission: current, actor }, harness.context);
    await createResearchMissionRecord({ mission: priorA, actor }, harness.context);
    await createResearchMissionRecord({ mission: priorB, actor }, harness.context);
    await createResearchMissionRecord({
      mission: otherTenant,
      actor: { actorId: "user-2", tenantId: "ente-2" },
    }, harness.context);
    for (const item of [priorA, priorB, otherTenant]) {
      const record = harness.missions.get(item.missionId)!;
      record.status = "COMPLETED";
    }
    const bundleA = evidenceBundle(priorA, "execution-alpha", "PARTIAL", []);
    harness.bundles.set("bundle-alpha", {
      id: "bundle-alpha",
      missionId: priorA.missionId,
      executionId: "execution-alpha",
      contractVersion: RESEARCH_BRIDGE_VERSION,
      fingerprint: "a".repeat(64),
      payload: {
        ...bundleA,
        unresolvedQuestions: ["ALPHA_BUNDLE_RESULT"],
      },
      completionState: "PARTIAL",
      totalCalls: 0,
      moonlitCalls: 0,
      simpliciterCalls: 0,
      legalDataHunterCalls: 0,
      submittedByActorId: actor.actorId,
      createdAt: now,
    });
    harness.bundles.set("bundle-beta", {
      ...harness.bundles.get("bundle-alpha")!,
      id: "bundle-beta",
      missionId: priorB.missionId,
      fingerprint: "b".repeat(64),
      payload: {
        ...evidenceBundle(priorB, "execution-beta", "PARTIAL", []),
        unresolvedQuestions: ["BETA_BUNDLE_RESULT"],
      },
    });

    const context = await getResearchFascicoloContext(current.missionId, actor, harness.context);
    const serialized = JSON.stringify(context);
    expect(serialized).toContain("FACT_ALPHA");
    expect(serialized).toContain("ALPHA_BUNDLE_RESULT");
    expect(serialized).not.toContain("FACT_BETA");
    expect(serialized).not.toContain("BETA_BUNDLE_RESULT");
    expect(serialized).not.toContain("OTHER_TENANT_FACT");
    expect(context.items.every((item) => item.fascicoloScopeId === context.scope.scopeId)).toBe(true);
  });

  it("claims a mission with CHATGPT as audit origin", async () => {
    const harness = createHarness();
    const { claimed } = await createAndClaim(harness);
    expect(claimed.outcome).toBe("CLAIMED");
    expect(claimed.claim.execution).toMatchObject({
      executorKind: "CHATGPT",
      claimantId: "chat-session-1",
      completionState: null,
    });
    expect(claimed.claim.mission.operational.status).toBe("IN_PROGRESS");
  });

  it("converges an identical repeated claim", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const repeated = await claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      executor: { kind: "CHATGPT", claimantId: "chat-session-1" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context);
    expect(repeated.outcome).toBe("REUSED");
    expect(repeated.claim.claimToken).toBe(claimed.claim.claimToken);
  });

  it("rejects a second active claimant", async () => {
    const harness = createHarness();
    const { mission } = await createAndClaim(harness);
    await expect(claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-2",
      executor: { kind: "CHATGPT", claimantId: "chat-session-2" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context)).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  });

  it("recovers a stale claim while preserving the expired attempt", async () => {
    const harness = createHarness();
    const { mission } = await createAndClaim(harness);
    now = new Date(start.getTime() + 61_000);
    const recovered = await claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-2",
      executor: { kind: "CONVERSATIONAL_RESEARCH_EXECUTOR", claimantId: "chat-session-2" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context);
    expect(recovered.outcome).toBe("CLAIMED");
    expect(harness.attempts.get("execution-1")).toMatchObject({
      completionState: "FAILED",
      errorCode: "LEASE_EXPIRED",
    });
  });

  it("rejects release by the wrong claimant", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    await expect(releaseOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "wrong-session",
      claimToken: claimed.claim.claimToken,
      actor,
      disposition: "RELEASE",
      reasonCode: "HANDOFF",
    }, harness.context)).rejects.toMatchObject({ code: "STALE_CLAIM" });
  });

  it("defers a mission and preserves the attempt", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const deferred = await releaseOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
      disposition: "DEFER",
      reasonCode: "HUMAN_INPUT_REQUIRED",
    }, harness.context);
    expect(deferred.operational.status).toBe("DEFERRED");
    expect(harness.attempts.get("execution-1")?.completionState).toBe("DEFERRED");
  });

  it("resumes a deferred mission with a new attempt", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    await releaseOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
      disposition: "DEFER",
      reasonCode: "PAUSED",
    }, harness.context);
    const resumed = await claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-2",
      executor: { kind: "CHATGPT", claimantId: "chat-session-2" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context);
    expect(resumed.outcome).toBe("CLAIMED");
    expect(harness.attempts).toHaveLength(2);
  });

  it("releases a mission back to pending", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const released = await releaseOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
      disposition: "RELEASE",
      reasonCode: "VOLUNTARY_RELEASE",
    }, harness.context);
    expect(released.operational.status).toBe("PENDING");
  });

  it("submits and preserves a partial bundle", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const partial = evidenceBundle(mission, "execution-1");
    const result = await submitResearchEvidenceBundle({
      bundle: partial,
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context);
    expect(result.outcome).toBe("CREATED");
    expect(result.bundle.completionState).toBe("PARTIAL");
  });

  it("reuses an identical bundle idempotently", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const partial = evidenceBundle(mission, "execution-1");
    const request = {
      bundle: partial,
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    };
    await submitResearchEvidenceBundle(request, harness.context);
    await expect(submitResearchEvidenceBundle(request, harness.context))
      .resolves.toMatchObject({ outcome: "REUSED" });
    expect(harness.bundles).toHaveLength(1);
  });

  it("converges concurrent identical bundle submissions", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const request = {
      bundle: evidenceBundle(mission, "execution-1"),
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    };
    const results = await Promise.all([
      submitResearchEvidenceBundle(request, harness.context),
      submitResearchEvidenceBundle(request, harness.context),
    ]);
    expect(results.map((item) => item.outcome).sort()).toEqual(["CREATED", "REUSED"]);
    expect(harness.bundles).toHaveLength(1);
  });

  it("requires the original execution owner for an identical bundle replay", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const bundle = evidenceBundle(mission, "execution-1");
    await submitResearchEvidenceBundle({
      bundle,
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context);
    await expect(submitResearchEvidenceBundle({
      bundle,
      claimantId: "other-session",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
  });

  it("preserves materially different bundles for one execution", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const base = {
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    };
    await submitResearchEvidenceBundle({ ...base, bundle: evidenceBundle(mission, "execution-1") }, harness.context);
    await submitResearchEvidenceBundle({
      ...base,
      bundle: evidenceBundle(mission, "execution-1", "COMPLETE", [
        toolExecution("MOONLIT"),
        toolExecution("SIMPLICITER"),
      ]),
    }, harness.context);
    expect(harness.bundles).toHaveLength(2);
  });

  it("keeps partial history after final completion", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const partial = evidenceBundle(mission, "execution-1");
    const final = evidenceBundle(mission, "execution-1", "COMPLETE", [
      toolExecution("MOONLIT"),
      toolExecution("SIMPLICITER"),
    ]);
    const credentials = { claimantId: "chat-session-1", claimToken: claimed.claim.claimToken, actor };
    await submitResearchEvidenceBundle({ bundle: partial, ...credentials }, harness.context);
    const finalResult = await submitResearchEvidenceBundle({ bundle: final, ...credentials }, harness.context);
    await completeResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      bundleId: finalResult.bundle.id,
      ...credentials,
    }, harness.context);
    expect(harness.bundles).toHaveLength(2);
    expect(harness.missions.get(mission.missionId)?.status).toBe("COMPLETED");
  });

  it("persists Moonlit, Simpliciter, and LDH call usage", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    await submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "PARTIAL", [
        toolExecution("MOONLIT", 2),
        toolExecution("SIMPLICITER", 3),
        toolExecution("LEGAL_DATA_HUNTER", 1),
      ]),
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context);
    expect(harness.attempts.get("execution-1")).toMatchObject({
      totalCalls: 6,
      moonlitCalls: 2,
      simpliciterCalls: 3,
      legalDataHunterCalls: 1,
    });
  });

  it("rejects a call-budget overrun", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness, {
      budget: {
        maxTotalResearchCalls: 2,
        maxMoonlitCalls: 2,
        maxSimpliciterCalls: 2,
        maxLegalDataHunterCalls: 2,
      },
    });
    await expect(submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "PARTIAL", [toolExecution("MOONLIT", 3)]),
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "BUDGET_OVERRUN" });
    expect(harness.bundles).toHaveLength(0);
  });

  it("rejects call counters below previously accepted usage", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const credentials = { claimantId: "chat-session-1", claimToken: claimed.claim.claimToken, actor };
    await submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "PARTIAL", [toolExecution("MOONLIT", 2)]),
      ...credentials,
    }, harness.context);
    await expect(submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "PARTIAL", [toolExecution("SIMPLICITER")]),
      ...credentials,
    }, harness.context)).rejects.toMatchObject({ code: "BUDGET_COUNTER_REGRESSION" });
  });

  it("preserves a BUDGET_EXHAUSTED bundle as a non-failure terminal result", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness, {
      budget: {
        maxTotalResearchCalls: 1,
        maxMoonlitCalls: 1,
        maxSimpliciterCalls: 1,
        maxLegalDataHunterCalls: 1,
      },
    });
    const credentials = { claimantId: "chat-session-1", claimToken: claimed.claim.claimToken, actor };
    const submitted = await submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "BUDGET_EXHAUSTED"),
      ...credentials,
    }, harness.context);
    const result = await completeResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      bundleId: submitted.bundle.id,
      ...credentials,
    }, harness.context);
    expect(result.mission.operational.status).toBe("BUDGET_EXHAUSTED");
    expect(harness.bundles).toHaveLength(1);
  });

  it("rejects a bundle for the wrong mission", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const other = researchMission({ researchQuestion: "Other mission" });
    await expect(submitResearchEvidenceBundle({
      bundle: { ...evidenceBundle(mission, "execution-1"), missionId: other.missionId },
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  });

  it("rejects a bundle for the wrong execution", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    await expect(submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-other"),
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "STALE_CLAIM" });
  });

  it("rejects bundle submission after lease expiry", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    now = new Date(start.getTime() + 61_000);
    await expect(submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1"),
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "STALE_CLAIM" });
    expect(harness.bundles).toHaveLength(0);
    expect(harness.missions.get(mission.missionId)).toMatchObject({
      status: "IN_PROGRESS",
      activeExecutionId: "execution-1",
    });
  });

  it("rejects invalid lifecycle transition from completed to claimed", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const credentials = { claimantId: "chat-session-1", claimToken: claimed.claim.claimToken, actor };
    const submitted = await submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "COMPLETE"),
      ...credentials,
    }, harness.context);
    await completeResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      bundleId: submitted.bundle.id,
      ...credentials,
    }, harness.context);
    await expect(claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-2",
      executor: { kind: "CHATGPT", claimantId: "chat-session-2" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("makes duplicate completion idempotent", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const credentials = { claimantId: "chat-session-1", claimToken: claimed.claim.claimToken, actor };
    const submitted = await submitResearchEvidenceBundle({
      bundle: evidenceBundle(mission, "execution-1", "COMPLETE"),
      ...credentials,
    }, harness.context);
    const request = {
      missionId: mission.missionId,
      executionId: "execution-1",
      bundleId: submitted.bundle.id,
      ...credentials,
    };
    await completeResearchMission(request, harness.context);
    await expect(completeResearchMission(request, harness.context))
      .resolves.toMatchObject({ outcome: "REUSED" });
  });

  it("rejects or defers only through the active authorized claim", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const result = await rejectOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
      disposition: "REJECT",
      reasonCode: "OUT_OF_SCOPE",
    }, harness.context);
    expect(result.operational.status).toBe("REJECTED");
  });

  it("rejects credential fields before persistence", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const unsafe = {
      ...evidenceBundle(mission, "execution-1"),
      metadata: { oauthToken: "never-store" },
    } as ResearchEvidenceBundle;
    await expect(submitResearchEvidenceBundle({
      bundle: unsafe,
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "INVALID_BUNDLE" });
    expect(harness.bundleDelegate.create).not.toHaveBeenCalled();
  });

  it("rejects profile enrichment fields before evidence persistence", async () => {
    const harness = createHarness();
    const { mission, claimed } = await createAndClaim(harness);
    const unsafe = {
      ...evidenceBundle(mission, "execution-1"),
      metadata: {
        personalProfile: {
          sensitiveInference: "SYNTHETIC_RESTRICTED_CATEGORY",
        },
      },
    } as ResearchEvidenceBundle;
    await expect(submitResearchEvidenceBundle({
      bundle: unsafe,
      claimantId: "chat-session-1",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context)).rejects.toMatchObject({ code: "INVALID_BUNDLE" });
    expect(harness.bundleDelegate.create).not.toHaveBeenCalled();
  });

  it("does not expose canonical LegalSource or OfficialHit delegates", () => {
    const harness = createHarness();
    expect(harness.context.client).not.toHaveProperty("legalSource");
    expect(harness.context.client).not.toHaveProperty("legalReferenceOfficialHit");
  });

  it("builds only a bounded async-job reference to the research mission", () => {
    const mission = researchMission();
    const admission = buildResearchMissionAsyncJobAdmission({
      mission,
      actor: {
        ...actor,
        actorEmail: "user@example.test",
        actorRole: "GIURIDICO",
        initiatingUserId: "user-1",
        admissionType: "AUTHENTICATED_USER",
      },
      correlationId: "correlation-1",
      policyDecisionRef: null,
      availableAt: start,
      maxAttempts: 3,
    });
    expect(admission.inputReference).toEqual({
      referenceType: "LEGAL_RESEARCH_MISSION",
      referenceId: mission.missionId,
      referenceVersion: RESEARCH_BRIDGE_VERSION,
      metadata: { contractVersion: RESEARCH_BRIDGE_VERSION },
    });
    expect(admission.inputReference).not.toHaveProperty("payload");
    expect(normalizeAsyncJobAdmission(admission).inputReference.referenceId).toBe(mission.missionId);
  });

  it("derives deterministic bundle fingerprints and distinguishes material evidence", () => {
    const mission = researchMission();
    const partial = evidenceBundle(mission, "execution-1");
    expect(researchEvidenceBundleFingerprint(partial)).toBe(researchEvidenceBundleFingerprint(partial));
    expect(researchEvidenceBundleFingerprint(partial)).not.toBe(
      researchEvidenceBundleFingerprint({ ...partial, unresolvedQuestions: ["New question"] }),
    );
  });

  it("publishes the future MCP service mapping without a transport", () => {
    expect(FUTURE_MCP_RESEARCH_PERSISTENCE_MAPPING).toEqual({
      get_pending_research_missions: "listPendingResearchMissions",
      get_research_mission: "getResearchMission",
      claim_research_mission: "claimResearchMission",
      submit_research_evidence_bundle: "submitResearchEvidenceBundle",
      reject_or_defer_research_mission: "rejectOrDeferResearchMission",
      complete_research_mission: "completeResearchMission",
    });
  });

  it("uses no provider or LLM transport", async () => {
    const harness = createHarness();
    await createAndClaim(harness);
    expect(Object.keys(harness.context.client ?? {}).sort()).toEqual([
      "researchEvidenceBundleRecord",
      "researchExecutionAttempt",
      "researchMissionRecord",
    ]);
  });

  it("fails closed for invalid claim tokens", async () => {
    const harness = createHarness();
    const { mission } = await createAndClaim(harness);
    await expect(releaseOrDeferResearchMission({
      missionId: mission.missionId,
      executionId: "execution-1",
      claimantId: "chat-session-1",
      claimToken: "not-a-token",
      actor,
      disposition: "DEFER",
      reasonCode: "PAUSED",
    }, harness.context)).rejects.toBeInstanceOf(ResearchPersistenceError);
    expect(harness.missions.get(mission.missionId)).toMatchObject({
      status: "IN_PROGRESS",
      claimantId: "chat-session-1",
      activeExecutionId: "execution-1",
    });
    expect(harness.attempts.get("execution-1")).toMatchObject({ completionState: null });
  });
});
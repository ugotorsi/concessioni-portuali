import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const documentaryMocks = vi.hoisted(() => ({
  globalRead: vi.fn(() => { throw new Error("GLOBAL_DOCUMENT_CLIENT_FORBIDDEN"); }),
  readBytes: vi.fn(),
  database: null as Record<string, unknown> | null,
  jwtVerify: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({
  documentFileVersion: { findFirst: documentaryMocks.globalRead },
  legalSourceVersion: { findFirst: documentaryMocks.globalRead },
}, { get: (target, property) => Reflect.get(documentaryMocks.database ?? target, property) }) }));
vi.mock("@/server/documents/storage", () => ({ readDocumentFileBoundedFromProvider: documentaryMocks.readBytes }));
vi.mock("jose", () => ({ createRemoteJWKSet: () => vi.fn(), jwtVerify: documentaryMocks.jwtVerify }));

import { POST as trustedReadPost } from "@/app/api/legal-research/trusted/mission/route";
import { POST as trustedActionPost } from "@/app/api/legal-research/trusted/mission/action/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { createAssistedVerificationRouteHandlers } from "@/server/legal-research/assisted-verification-route";
import { syntheticAdverseSearch } from "./assisted-document-fixtures";
import { adverseSearchBasis } from "@/server/legal-research/adverse-search";

import { createTrustedMissionExecutor, projectAssistedVerificationEvidence } from "@/server/legal-research/trusted-mission-executor";
import { createCitationObservation } from "@/server/legal-reasoning/authority-treatment";
import { createLiveAcceptanceMission } from "@/server/legal-research/live-acceptance-mission";
import { createSimpliciterResearchAdapter, createSimpliciterExactRetrievalAdapter, createSimpliciterCrossJurisdictionResearchAdapter,
  createMoonlitResearchAdapter, createMoonlitExactRetrievalAdapter, type ProviderToolRequest } from "@/server/legal-research/provider-research-adapters";
import { createTrustedResearchHttpClient, type TrustedResearchHttpClient } from "@/server/legal-research/trusted-research-http-client";

import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  RESEARCH_BRIDGE_VERSION,
  createAuthorityCandidate,
  createResearchMission,
  validateResearchEvidenceBundle,
  type ResearchEvidenceBundle,
  type ResearchMission,
  type ResearchMissionInput,
  type ResearchToolExecution,
} from "@/server/legal-research/bridge";
import {
  createAssistedVerificationSnapshot,
  type OfficialSourceEvidence,
} from "@/server/legal-research/assisted-verification";
import {
  FUTURE_MCP_RESEARCH_PERSISTENCE_MAPPING,
  ResearchPersistenceError,
  buildResearchMissionAsyncJobAdmission,
  claimResearchMission,
  completeResearchMission,
  createResearchMissionRecord,
  createAssistedVerificationReader,
  getResearchFascicoloContext,
  getLatestAssistedVerification,
  getResearchMission,
  listPendingResearchMissions,
  rejectOrDeferResearchMission,
  releaseOrDeferResearchMission,
  researchEvidenceBundleFingerprint,
  persistAssistedVerification,
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
      citationObservations: false,
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

function officialSource(overrides: Partial<OfficialSourceEvidence> = {}): OfficialSourceEvidence {
  return {
    evidenceSourceId: "evidence-source-a",
    authorityId: "authority-a",
    legalSourceId: "legal-source-a",
    legalExpressionVersionId: "expression-a",
    officialIdentifier: "ECLI:EU:C:2024:1",
    sourceUrl: "https://official.example.test/authority-a",
    providerId: "OFFICIAL_SOURCE",
    accessStatus: "CONSULTABLE",
    identityVerificationStatus: "VERIFIED",
    reviewerAttestation: {
      reviewedByActorId: "user-1",
      reviewedAt: "2026-09-26T09:00:00.000Z",
      rationale: "Official identity and source content checked by the legal reviewer.",
    },
    termsOfUse: {
      status: "PERMITTED",
      basis: "Official public-access terms checked",
      checkedAt: "2026-09-26T09:00:00.000Z",
    },
    fullText: { available: true, contentSha256: "a".repeat(64) },
    ...overrides,
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
  const verifications = new Map<string, Record<string, any>>();
  const persistQuestionResults = vi.fn(async () => []);

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
      if (where.assignedActorId !== undefined) {
        values = values.filter((item) => item.assignedActorId === where.assignedActorId);
      }
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

  const verificationDelegate = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return verifications.get(where.id) ?? null;
      return [...verifications.values()].find((item) => item.fingerprint === where.fingerprint) ?? null;
    }),
    findFirst: vi.fn(async ({ where }: any) => [...verifications.values()]
      .filter((item) => item.missionId === where.missionId && item.tenantId === where.tenantId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null),
    create: vi.fn(async ({ data }: any) => {
      if ([...verifications.values()].some((item) => item.fingerprint === data.fingerprint)) {
        throw p2002("ResearchAssistedVerificationRecord", "fingerprint");
      }
      const value = { ...data, createdAt: data.createdAt ?? now };
      verifications.set(value.id, value);
      return value;
    }),
  };

  const client = {
    researchMissionRecord: missionDelegate,
    researchExecutionAttempt: attemptDelegate,
    researchEvidenceBundleRecord: bundleDelegate,
    researchAssistedVerificationRecord: verificationDelegate,
  } as unknown as ResearchPersistenceClient;
  const context: Partial<ResearchPersistenceContext> = {
    client,
    transaction: async (operation) => operation(client),
    clock: { now: () => new Date(now) },
    claimToken: () => (++tokenSequence).toString(16).padStart(64, "0"),
    persistQuestionResults,
  };
  return {
    missions,
    attempts,
    bundles,
    verifications,
    missionDelegate,
    attemptDelegate,
    bundleDelegate,
    verificationDelegate,
    persistQuestionResults,
    context,
  };
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
    documentaryMocks.globalRead.mockClear();
    documentaryMocks.readBytes.mockReset();
    documentaryMocks.database = null;
    documentaryMocks.jwtVerify.mockReset();
  });

  afterEach(() => {
    documentaryMocks.database = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

  it("isolates list, get, claim, submit, and complete by assigned actor within one tenant", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const otherActor = { actorId: "user-2", tenantId: actor.tenantId } as const;

    await expect(listPendingResearchMissions(otherActor, harness.context)).resolves.toEqual([]);
    await expect(getResearchMission(mission.missionId, otherActor, harness.context))
      .rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
    await expect(claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-other",
      executor: { kind: "CHATGPT", claimantId: "chat-other" },
      actor: otherActor,
      leaseDurationMs: 60_000,
    }, harness.context)).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });

    const claimed = await claimResearchMission({
      missionId: mission.missionId,
      executionId: "execution-owner",
      executor: { kind: "CHATGPT", claimantId: "chat-owner" },
      actor,
      leaseDurationMs: 60_000,
    }, harness.context);
    const bundle = evidenceBundle(mission, "execution-owner");
    await expect(submitResearchEvidenceBundle({
      bundle,
      claimantId: "chat-owner",
      claimToken: claimed.claim.claimToken,
      actor: otherActor,
    }, harness.context)).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });

    const submitted = await submitResearchEvidenceBundle({
      bundle,
      claimantId: "chat-owner",
      claimToken: claimed.claim.claimToken,
      actor,
    }, harness.context);
    await expect(completeResearchMission({
      missionId: mission.missionId,
      executionId: "execution-owner",
      bundleId: submitted.bundle.id,
      claimantId: "chat-owner",
      claimToken: claimed.claim.claimToken,
      actor: otherActor,
    }, harness.context)).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
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
    Object.assign(harness.missions.get(mission.missionId)!, {
      missionFingerprint: "f".repeat(64),
      legalIssueSemanticKey: "i".repeat(64),
      researchQuestionSemanticKey: "q".repeat(64),
    });
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
    expect(harness.persistQuestionResults).toHaveBeenCalledTimes(2);
    expect(harness.persistQuestionResults).toHaveBeenLastCalledWith({
      missionId: mission.missionId,
      bundleId: expect.any(String),
      candidates: partial.authorityCandidates,
    });
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

  it("persists and reloads independently validated assisted evidence", async () => {
    const harness = createHarness();
    const documentContext = {
      ...harness.context,
      readAssistedDocuments: async () => [{ evidenceSourceId: "evidence-source-a", documentId: "document-a", fileVersionId: "file-a", contentSha256: "a".repeat(64) }],
    };
    const mission = researchMission({
      mode: "ADVERSE_SEARCH",
      knownEvidenceGaps: [{ gapId: "gap-document", kind: "MISSING_DOCUMENT" }],
      requiredOutput: {
        authorityCandidates: false,
        citationObservations: true,
        legalResearchSuggestions: true,
        evidenceGaps: true,
        fullTextRequired: true,
      },
      executionPlan: {
        requiredCapabilities: ["FULL_TEXT_RETRIEVAL", "CITATION_NETWORK", "ADVERSE_AUTHORITY_DISCOVERY"],
      },
    });
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const snapshot = createAssistedVerificationSnapshot({
      missionId: mission.missionId,
      sources: [
        officialSource({ fullText: { available: true, contentSha256: "a".repeat(64), documentId: "document-a", fileVersionId: "file-a" } }),
        officialSource({
          evidenceSourceId: "evidence-source-b",
          authorityId: "authority-b",
          legalSourceId: "legal-source-b",
          legalExpressionVersionId: "expression-b",
          officialIdentifier: "ECLI:EU:C:2020:2",
          sourceUrl: "https://official.example.test/authority-b",
          fullText: { available: false },
        }),
      ],
      citationRelation: {
        sourceAuthorityId: "authority-a",
        targetAuthorityId: "authority-b",
        evidenceSourceId: "evidence-source-a",
        documented: true,
        locator: { paragraph: "42" },
      },
      adverseReview: {
        observationSourceAuthorityId: "authority-a",
        observationTargetAuthorityId: "authority-b",
        legalPropositionId: "proposition-1",
        reviewedByActorId: actor.actorId,
        reviewedAt: "2026-09-26T10:00:00.000Z",
        evidenceSourceId: "evidence-source-a",
        rationale: "The documented treatment is adverse to the scoped proposition.",
        decision: "ADVERSE",
      },
      researchSuggestions: [{
        kind: "MISSING_ADMINISTRATIVE_DOCUMENT",
        description: "Acquire the missing administrative document from the official record.",
        rationale: "The persisted document gap requires an explicit reviewer-directed research action.",
        originatingGapId: "gap-document",
        evidenceSourceId: "evidence-source-a",
        reviewedByActorId: actor.actorId,
        reviewedAt: "2026-09-26T10:00:00.000Z",
      }],
    });

    const persisted = await persistAssistedVerification({ snapshot, actor }, documentContext);
    const reloaded = await getLatestAssistedVerification(mission.missionId, actor, documentContext);

    expect(persisted.outcome).toBe("CREATED");
    expect(reloaded?.snapshot).toEqual(snapshot);
    expect(reloaded?.result).toMatchObject({
      adverseAuthorityVerified: true,
      verifiedFullTexts: [{
        officialIdentifier: "ECLI:EU:C:2024:1",
        sourceUrl: "https://official.example.test/authority-a",
        contentSha256: "a".repeat(64),
        termsOfUseBasis: "Official public-access terms checked",
      }],
    });
    expect(reloaded?.result.citationObservations).toHaveLength(1);
    expect(reloaded?.result.adverseAssessments).toHaveLength(1);
    expect(reloaded?.result.legalResearchSuggestions).toHaveLength(1);
    const changedRelation = { ...snapshot.citationRelation!, locator: { paragraph: "99" } };
    await expect(persistAssistedVerification({
      snapshot: createAssistedVerificationSnapshot({ ...snapshot, citationRelation: changedRelation }),
      actor, expectedPreviousRecordId: persisted.verification.recordId,
    }, documentContext)).rejects.toMatchObject({ code: "INVALID_ASSISTED_VERIFICATION" });
    now = new Date(now.getTime() + 1_000);
    const invalidated = await persistAssistedVerification({
      snapshot: createAssistedVerificationSnapshot({ ...snapshot, citationRelation: changedRelation, adverseReview: undefined }),
      actor, expectedPreviousRecordId: persisted.verification.recordId,
    }, documentContext);
    expect(invalidated.verification.result.adverseAuthorityVerified).toBe(false);
    expect(harness.verifications.get(persisted.verification.recordId)?.payload).toEqual(snapshot);
  });

  it.each(["unchanged", "locator", "file-version", "review", "invalidated", "missing-bytes", "observation", "missing-binding", "forged-candidate", "forged-extra-candidate"] as const)(
    "uses the default transactional document reader and checks bundle evidence: %s",
    async (change) => {
      const harness = createHarness();
      const mission = researchMission({
        mode: "ADVERSE_SEARCH", missingSourceFamilies: [],
        requiredOutput: { authorityCandidates: true, citationObservations: true, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: true },
        executionPlan: { requiredCapabilities: ["FULL_TEXT_RETRIEVAL", "CITATION_NETWORK", "ADVERSE_AUTHORITY_DISCOVERY"] },
      });
      const body = Buffer.from("Synthetic documentary evidence for paragraphs 42 and 99");
      const contentSha256 = createHash("sha256").update(body).digest("hex");
      const source = officialSource({
        sourceFamily: "CJEU", courtOrBody: "Court of Justice", documentType: "Judgment",
        fullText: { available: true, documentId: "document-a", fileVersionId: "file-a", contentSha256 },
      });
      const snapshot = createAssistedVerificationSnapshot({
        missionId: mission.missionId,
        sources: [source, officialSource({ evidenceSourceId: "evidence-source-b", authorityId: "authority-b", fullText: { available: false } })],
        citationRelation: { sourceAuthorityId: "authority-a", targetAuthorityId: "authority-b", evidenceSourceId: source.evidenceSourceId, documented: true, locator: { paragraph: "42" } },
        adverseReview: {
          observationSourceAuthorityId: "authority-a", observationTargetAuthorityId: "authority-b",
          legalPropositionId: "proposition-1", reviewedByActorId: actor.actorId, reviewedAt: start.toISOString(),
          evidenceSourceId: source.evidenceSourceId, rationale: "Explicit review of the documented adverse passage.", decision: "ADVERSE",
        },
      });
      const documentRead = vi.fn(async ({ where }) => {
        expect(where.canonicalEnteId).toBe(actor.tenantId);
        expect(where.document.OR[0].procedimentoId.in).toContain(mission.caseReference.caseId);
        return { id: where.id, documentId: where.documentId, sha256: contentSha256, sizeBytes: body.length, storageProvider: "local", storageKey: "synthetic", storageBucket: null };
      });
      const representationRead = vi.fn(async ({ where }) => {
        expect(where.sourceFamilyId).toBe(source.legalSourceId);
        expect(where.legalExpressionVersionId).toBe(source.legalExpressionVersionId);
        expect(where.observedSha256).toBe(contentSha256);
        return { id: "representation-a" };
      });
      const outsideRead = vi.fn(() => { throw new Error("OUTSIDE_TRANSACTION_FORBIDDEN"); });
      const tx = { ...harness.context.client, documentFileVersion: { findFirst: documentRead }, legalSourceVersion: { findFirst: representationRead } } as unknown as ResearchPersistenceClient;
      const documentContext: Partial<ResearchPersistenceContext> = {
        ...harness.context,
        client: { ...tx, documentFileVersion: { findFirst: outsideRead }, legalSourceVersion: { findFirst: outsideRead } } as unknown as ResearchPersistenceClient,
        transaction: async (operation) => operation(tx),
      };
      expect(documentContext.readAssistedDocuments).toBeUndefined();
      documentaryMocks.readBytes.mockResolvedValue({ disposition: "FOUND", body });
      await createResearchMissionRecord({ mission, actor }, documentContext);
      const initial = await persistAssistedVerification({ snapshot, actor }, documentContext);
      expect(initial.verification.result.adverseAuthorityVerified).toBe(true);
      expect(documentRead).toHaveBeenCalledTimes(2);
      const claimed = await claimResearchMission({ missionId: mission.missionId, executionId: "default-document-execution", actor,
        executor: { kind: "AUTHORIZED_WORKER", claimantId: "local-test" }, leaseDurationMs: 60_000,
      }, documentContext);
      expect(documentRead).toHaveBeenCalledTimes(3);
      const credentials = { claimantId: "local-test", claimToken: claimed.claim.claimToken, actor };
      const bundle = { ...evidenceBundle(mission, "default-document-execution", "COMPLETE", []), ...projectAssistedVerificationEvidence(mission, initial.verification.result) };
      expect(bundle.authorityCandidates).toHaveLength(1);
      if (change === "observation") bundle.citationObservations = bundle.citationObservations.map(({ id: _id, ...item }) => createCitationObservation({ ...item, provenance: { ...item.provenance, locator: { paragraph: "99" } } }));
      if (change === "missing-binding") bundle.assistedVerificationFingerprint = undefined;
      if (change === "forged-candidate" || change === "forged-extra-candidate") {
        const { candidateId: _candidateId, ...candidate } = bundle.authorityCandidates[0];
        const forged = createAuthorityCandidate({ ...candidate,
          verifiedEvidence: { ...candidate.verifiedEvidence!, legalSourceId: "caller-declared-source", legalExpressionVersionId: "caller-declared-version" },
        });
        bundle.authorityCandidates = change === "forged-candidate" ? [forged] : [...bundle.authorityCandidates, forged];
      }
      expect(validateResearchEvidenceBundle(mission, bundle)).toEqual([]);
      if (["missing-binding", "forged-candidate", "forged-extra-candidate"].includes(change)) {
        await expect(submitResearchEvidenceBundle({ bundle, ...credentials }, documentContext)).rejects.toMatchObject({ code: "INVALID_BUNDLE" });
        expect(harness.bundles.size).toBe(0);
        expect(harness.missions.get(mission.missionId)?.status).toBe("IN_PROGRESS");
        expect(outsideRead).not.toHaveBeenCalled();
        expect(documentaryMocks.globalRead).not.toHaveBeenCalled();
        return;
      }
      const submitted = await submitResearchEvidenceBundle({ bundle, ...credentials }, documentContext);
      let latest = initial;
      if (["locator", "file-version", "review", "invalidated"].includes(change)) {
        now = new Date(now.getTime() + 1_000);
        if (change === "file-version") {
          latest = await persistAssistedVerification({
            actor, expectedPreviousRecordId: latest.verification.recordId,
            snapshot: createAssistedVerificationSnapshot({
              ...snapshot,
              sources: [{ ...source, fullText: { ...source.fullText, fileVersionId: "file-a-v2" } }, snapshot.sources[1]],
              citationRelation: undefined, adverseReview: undefined,
            }),
          }, documentContext);
          now = new Date(now.getTime() + 1_000);
        }
        latest = await persistAssistedVerification({
          actor, expectedPreviousRecordId: latest.verification.recordId,
          snapshot: createAssistedVerificationSnapshot({
            ...snapshot,
            sources: change === "file-version" ? [{ ...source, fullText: { ...source.fullText, fileVersionId: "file-a-v2" } }, snapshot.sources[1]] : snapshot.sources,
            citationRelation: { ...snapshot.citationRelation!, ...(change === "locator" ? { locator: { paragraph: "99" } } : {}) },
            adverseReview: change === "invalidated" ? undefined : { ...snapshot.adverseReview!, reviewedAt: now.toISOString() },
          }),
        }, documentContext);
        expect(latest.verification.result.adverseAuthorityVerified).toBe(change !== "invalidated");
      }
      if (change === "missing-bytes") documentaryMocks.readBytes.mockResolvedValue({ disposition: "MISSING" });
      const completion = { missionId: mission.missionId, executionId: bundle.executionId, bundleId: submitted.bundle.id, ...credentials };
      const readsBeforeCompletion = documentRead.mock.calls.length;
      if (change === "unchanged") {
        await expect(completeResearchMission(completion, documentContext)).resolves.toMatchObject({ mission: { operational: { status: "COMPLETED" } } });
        await expect(completeResearchMission(completion, documentContext)).resolves.toMatchObject({ outcome: "REUSED" });
      } else {
        await expect(completeResearchMission(completion, documentContext)).rejects.toMatchObject({ code: ["invalidated", "missing-bytes"].includes(change) ? "INVALID_TRANSITION" : "INVALID_BUNDLE" });
        expect(harness.missions.get(mission.missionId)?.status).toBe("IN_PROGRESS");
        expect(harness.attempts.get(bundle.executionId)?.finalBundleId).toBeNull();
        if (change === "locator") {
          const fresh = await submitResearchEvidenceBundle({ ...credentials, bundle: { ...bundle, ...projectAssistedVerificationEvidence(mission, latest.verification.result) } }, documentContext);
          await expect(completeResearchMission({ ...completion, bundleId: fresh.bundle.id }, documentContext)).resolves.toMatchObject({ mission: { operational: { status: "COMPLETED" } } });
        }
      }
      expect(documentRead.mock.calls.length).toBeGreaterThan(readsBeforeCompletion);
      expect(representationRead.mock.calls.length).toBe(documentRead.mock.calls.length);
      expect(outsideRead).not.toHaveBeenCalled();
      expect(documentaryMocks.globalRead).not.toHaveBeenCalled();
    },
  );

  it.each(["complete", "missing", "tampered", "superseded", "invalidated", "lease", "budget", "exact-mismatch", "bundle-mismatch", "http-valid", "http-altered", "http-missing", "http-stale", "negative-valid", "negative-stale", "negative-absent", "negative-unreviewed", "negative-inconclusive", "negative-scope", "negative-forged", "negative-tenant", "negative-missing", "negative-altered"] as const)(
    "runs the unchanged original mission through real services with synthetic evidence: %s", async (scenario) => {
      const harness = createHarness();
      const mission = createLiveAcceptanceMission("2026-09-26T00:00:00.000Z");
      const originalMission = structuredClone(mission);
      const negativeSearch = scenario.startsWith("negative-");
      const blockedSearch = negativeSearch && scenario !== "negative-valid" && scenario !== "negative-stale";
      if (negativeSearch) now = new Date("2026-09-26T10:00:00.000Z");
      expect(mission.knownAuthorities).toEqual([]);
      expect(Object.values(mission.requiredOutput)).toEqual([true, true, true, true, true]);
      expect(mission.executionPlan?.requiredCapabilities).toEqual([
        "SEMANTIC_DISCOVERY", "EXACT_RETRIEVAL", "FULL_TEXT_RETRIEVAL", "CITATION_NETWORK", "CROSS_JURISDICTION_DISCOVERY", "ADVERSE_AUTHORITY_DISCOVERY",
      ]);
      const documents = mission.missingSourceFamilies.map((family) => {
        const body = Buffer.from(`Synthetic ${family} document, paragraphs 42 and 99. Not a real authority.`);
        const source = officialSource({
          evidenceSourceId: `evidence-${family}`, authorityId: `authority-${family}`, legalSourceId: `source-${family}`,
          legalExpressionVersionId: `expression-${family}`, officialIdentifier: `SYNTHETIC:${family}`,
          sourceFamily: family, courtOrBody: "Synthetic issuing body", documentType: "Synthetic document",
          fullText: { available: true, documentId: `document-${family}`, fileVersionId: `file-${family}`, contentSha256: createHash("sha256").update(body).digest("hex") },
        });
        return { source, body, available: true };
      });
      const documentRead = vi.fn(async ({ where }) => {
        const document = documents.find(({ source }) => source.fullText.fileVersionId === where.id && source.fullText.documentId === where.documentId);
        if (!document || where.canonicalEnteId !== actor.tenantId || where.document.enteId !== actor.tenantId
          || !where.document.OR[0].procedimentoId.in.includes(mission.caseReference.caseId)) return null;
        return { id: where.id, documentId: where.documentId, sha256: document.source.fullText.contentSha256,
          sizeBytes: document.body.length, storageProvider: "local", storageKey: where.id, storageBucket: null };
      });
      const representationRead = vi.fn(async ({ where }) => {
        const document = documents.find(({ source, body }) => source.legalSourceId === where.sourceFamilyId
          && source.legalExpressionVersionId === where.legalExpressionVersionId
          && source.fullText.contentSha256 === where.observedSha256 && body.length === where.observedSizeBytes
          && source.officialIdentifier === where.sourceFamily.identityAssertions.some.normalizedValue);
        return document && where.sourceFamily.enteId === actor.tenantId
          && where.sourceFamily.identityAssertions.some.verificationStatus === "VERIFIED" ? { id: document.source.legalExpressionVersionId } : null;
      });
      documentaryMocks.readBytes.mockImplementation(async ({ storageKey }) => {
        const document = documents.find(({ source }) => source.fullText.fileVersionId === storageKey);
        return document?.available ? { disposition: "FOUND", body: document.body } : { disposition: "MISSING" };
      });
      const tx = { ...harness.context.client, documentFileVersion: { findFirst: documentRead }, legalSourceVersion: { findFirst: representationRead } } as unknown as ResearchPersistenceClient;
      const context: Partial<ResearchPersistenceContext> = { ...harness.context, client: tx, transaction: async (operation) => operation(tx) };
      expect(context.readAssistedDocuments).toBeUndefined();
      await createResearchMissionRecord({ mission, actor }, context);
      const european = documents.find(({ source }) => source.sourceFamily === "CJEU")!;
      const cassation = documents.find(({ source }) => source.sourceFamily === "CASSAZIONE")!;
      const target = documents[0].source;
      const snapshot = createAssistedVerificationSnapshot({
        missionId: mission.missionId, sources: documents.map(({ source }) => source),
        citationRelation: { sourceAuthorityId: european.source.authorityId, targetAuthorityId: target.authorityId,
          evidenceSourceId: european.source.evidenceSourceId, documented: true, locator: { paragraph: "42" } },
        researchSuggestions: [{ kind: "POSSIBLE_COUNTERARGUMENT", description: "Synthetic follow-up question about the documented adverse authority.",
          rationale: "Human reviewer requests bounded research into the initially unresolved treatment.", originatingGapId: "ACCEPTANCE_ADVERSE_AUTHORITY",
          evidenceSourceId: european.source.evidenceSourceId, reviewedByActorId: actor.actorId, reviewedAt: now.toISOString() }],
      });
      const initial = await persistAssistedVerification({ snapshot, actor }, context);
      expect(initial.verification.result.adverseAuthorityVerified).toBe(false);
      expect(initial.verification.result.verifiedFullTexts).toHaveLength(5);
      expect(initial.verification.result.authorityCandidates).toHaveLength(1);
      now = new Date(now.getTime() + 1_000);
      let reviewedSnapshot = createAssistedVerificationSnapshot({
        ...snapshot,
        adverseSearch: negativeSearch && scenario !== "negative-absent" ? syntheticAdverseSearch(mission, snapshot.sources) : undefined,
        adverseReview: negativeSearch ? undefined : { observationSourceAuthorityId: european.source.authorityId, observationTargetAuthorityId: target.authorityId,
          legalPropositionId: mission.legalPropositionIds[0], reviewedByActorId: actor.actorId, reviewedAt: now.toISOString(),
          evidenceSourceId: european.source.evidenceSourceId, rationale: "Explicit synthetic adverse review of paragraph 42 for the scoped proposition.", decision: "ADVERSE" },
        gapResolutions: mission.knownEvidenceGaps.filter(gap => !negativeSearch || gap.kind !== "NO_ADVERSE_AUTHORITY_CHECK").map((gap) => ({
          gapId: gap.gapId, evidenceSourceId: gap.kind === "NO_CASSATION_CHECK" ? cassation.source.evidenceSourceId : european.source.evidenceSourceId,
          targetId: gap.kind === "NO_ADVERSE_AUTHORITY_CHECK" ? mission.legalPropositionIds[0]
            : gap.kind === "NO_CASSATION_CHECK" ? cassation.source.authorityId : european.source.authorityId,
        })),
      });
      let reviewed = await persistAssistedVerification({ snapshot: reviewedSnapshot, actor, expectedPreviousRecordId: initial.verification.recordId }, context);
      if (negativeSearch) {
        const routes = createAssistedVerificationRouteHandlers({
          getCurrentTenantContext: async () => ({ userId: actor.actorId, role: "GIURIDICO", isAdmin: false,
            tenantMemberships: [], defaultTenantId: scenario === "negative-tenant" ? "wrong-tenant" : actor.tenantId,
            accessibleTenantIds: [scenario === "negative-tenant" ? "wrong-tenant" : actor.tenantId] }),
          getLatestAssistedVerification: (missionId, reviewer) => getLatestAssistedVerification(missionId, reviewer, context),
          persistAssistedVerification: input => persistAssistedVerification(input, context), now: () => now,
        });
        const postReview = (body: unknown) => routes.POST(new Request("https://synthetic.example.test/api/legal-research/assisted-verification", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        }));
        if (reviewedSnapshot.adverseSearch) {
          await expect(persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId,
            snapshot: createAssistedVerificationSnapshot({ ...reviewedSnapshot, adverseSearchReview: {
              reviewedByActorId: actor.actorId, reviewedAt: now.toISOString(), basisFingerprint: adverseSearchBasis(reviewedSnapshot.adverseSearch, reviewedSnapshot.sources),
            } }),
          }, context)).rejects.toMatchObject({ code: "INVALID_ASSISTED_VERIFICATION" });
        }
        if (scenario === "negative-inconclusive" || scenario === "negative-scope") {
          const search = structuredClone(reviewedSnapshot.adverseSearch!);
          if (scenario === "negative-inconclusive") search.outcome = "INCONCLUSIVE";
          else search.jurisdictions = ["CJEU"];
          expect((await postReview({ action: "SAVE_ADVERSE_SEARCH", missionId: mission.missionId, recordId: reviewed.verification.recordId, search })).status).toBe(201);
          reviewed = { outcome: "CREATED", verification: (await getLatestAssistedVerification(mission.missionId, actor, context))! };
        }
        if (scenario === "negative-missing") european.available = false;
        if (scenario === "negative-altered") european.body = Buffer.alloc(european.body.length, 120);
        if (scenario !== "negative-unreviewed" && scenario !== "negative-absent") {
          const response = await postReview({ action: "REVIEW_ADVERSE_SEARCH", missionId: mission.missionId, recordId: reviewed.verification.recordId,
            ...(scenario === "negative-forged" ? { reviewedByActorId: "forged-reviewer", reviewedAt: now.toISOString() } : {}),
          });
          expect(response.status).toBe(blockedSearch ? scenario === "negative-tenant" ? 403 : 400 : 201);
          reviewed = { outcome: "CREATED", verification: (await getLatestAssistedVerification(mission.missionId, actor, context))! };
        }
        if (!blockedSearch) {
          expect(reviewed.verification.snapshot.adverseSearchReview).toMatchObject({ reviewedByActorId: actor.actorId, reviewedAt: now.toISOString() });
          for (const change of ["scope", "step", "version"] as const) {
            const stale = structuredClone(reviewed.verification.snapshot);
            if (change === "scope") stale.adverseSearch!.temporalScope.from = "1800-01-01T00:00:00.000Z";
            if (change === "step") stale.adverseSearch!.researchSteps[0].queryOrActivity += " Changed synthetic activity.";
            if (change === "version") stale.adverseSearch!.examinedDocuments[0].fileVersionId = "changed-file-version";
            await expect(persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId, snapshot: stale }, context))
              .rejects.toMatchObject({ code: "INVALID_ASSISTED_VERIFICATION" });
          }
          reviewed = await persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId,
            snapshot: createAssistedVerificationSnapshot({ ...reviewed.verification.snapshot, gapResolutions: [
              ...reviewed.verification.snapshot.gapResolutions!, { gapId: "ACCEPTANCE_ADVERSE_AUTHORITY", evidenceSourceId: european.source.evidenceSourceId, targetId: mission.legalPropositionIds[0] },
            ] }),
          }, context);
        } else {
          await expect(claimResearchMission({ missionId: mission.missionId, executionId: "blocked-negative-research",
            actor, executor: { kind: "AUTHORIZED_WORKER", claimantId: "synthetic-executor" }, leaseDurationMs: 60_000,
          }, context)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
          expect(harness.attempts.size).toBe(0);
        }
        reviewedSnapshot = reviewed.verification.snapshot;
        expect(reviewed.verification.result.adverseSearchCompleted).toBe(!blockedSearch);
        expect(reviewed.verification.result.adverseAssessments).toEqual([]);
      }
      if (!blockedSearch) {
        expect(reviewed.verification.result.evidenceGaps).toEqual([]);
        expect(reviewed.verification.result.resolvedGaps).toHaveLength(6);
      }
      expect(reviewed.verification.result.adverseAuthorityVerified).toBe(!negativeSearch);
      expect(reviewed.verification.result.legalResearchSuggestions).toHaveLength(scenario === "negative-missing" || scenario === "negative-altered" ? 0 : 1);
      if (scenario !== "negative-missing" && scenario !== "negative-altered") expect(reviewed.verification.result.authorityCandidates[0].verifiedEvidence).toMatchObject({
        legalSourceId: european.source.legalSourceId, legalExpressionVersionId: european.source.legalExpressionVersionId,
        contentSha256: european.source.fullText.contentSha256, locator: { paragraph: "42" },
      });

      const claimantId = "synthetic-executor";
      const executionId = "synthetic-original-execution";
      let submittedBundle: ResearchEvidenceBundle | undefined;
      let failureCode: string | undefined;
      const client: TrustedResearchHttpClient = {
        readMission: vi.fn<TrustedResearchHttpClient["readMission"]>(async (missionId) => {
          const stored = (await getResearchMission(missionId, actor, context))!;
          return { mission: stored.mission, fascicoloContext: {}, operational: {
            status: stored.operational.status, stateVersion: stored.operational.stateVersion,
            activeExecutionId: stored.operational.activeExecutionId, claimExpiresAt: stored.operational.claimExpiresAt?.toISOString() ?? null,
            completedAt: stored.operational.completedAt?.toISOString() ?? null, deferredAt: stored.operational.deferredAt?.toISOString() ?? null,
          } };
        }),
        claimMission: vi.fn<TrustedResearchHttpClient["claimMission"]>(async (input) => {
          const result = await claimResearchMission({ ...input, actor, executor: { kind: "AUTHORIZED_WORKER", claimantId } }, context);
          return { outcome: result.outcome, missionId: input.missionId, executionId: input.executionId, fascicoloScopeId: "synthetic-scope",
            claimToken: result.claim.claimToken, leaseExpiresAt: result.claim.execution.leaseExpiresAt.toISOString() };
        }),
        submitEvidenceBundle: vi.fn<TrustedResearchHttpClient["submitEvidenceBundle"]>(async ({ bundle, claimToken }) => {
          if (scenario === "budget") bundle = { ...bundle, researchToolExecutions: bundle.researchToolExecutions.map((execution, index) => (
            index === 1 ? { ...execution, callsConsumed: mission.budget.maxTotalResearchCalls + 1 } : execution
          )) };
          if (scenario === "bundle-mismatch") bundle = { ...bundle, citationObservations: bundle.citationObservations.map(({ id: _id, ...observation }) => (
            createCitationObservation({ ...observation, provenance: { ...observation.provenance, locator: { paragraph: "99" } } })
          )) };
          submittedBundle = bundle;
          try {
            const result = await submitResearchEvidenceBundle({ bundle, claimToken, claimantId, actor }, context);
            return { outcome: result.outcome === "CREATED" ? "CREATED" : "DUPLICATE_OR_IDEMPOTENT_SUCCESS", bundleId: result.bundle.id,
              missionId: bundle.missionId, executionId: bundle.executionId, completionState: result.bundle.completionState, fascicoloScopeId: "synthetic-scope" };
          } catch (error) { failureCode = (error as ResearchPersistenceError).code; throw error; }
        }),
        completeMission: vi.fn<TrustedResearchHttpClient["completeMission"]>(async (input) => {
          if (scenario === "tampered") european.body = Buffer.alloc(european.body.length, 120);
          if (scenario === "superseded" || scenario === "invalidated") {
            now = new Date(now.getTime() + 1_000);
            const changed = await persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId,
              snapshot: createAssistedVerificationSnapshot({ ...reviewedSnapshot,
                citationRelation: { ...reviewedSnapshot.citationRelation!, locator: { paragraph: "99" } },
                adverseReview: scenario === "invalidated" ? undefined : { ...reviewedSnapshot.adverseReview!, reviewedAt: now.toISOString(), rationale: "New explicit synthetic adverse review of paragraph 99." },
              }),
            }, context);
            expect(changed.verification.result.adverseAuthorityVerified).toBe(scenario === "superseded");
          }
          if (scenario === "lease") now = new Date(harness.attempts.get(executionId)!.leaseExpiresAt.getTime() + 1);
          try {
            const result = await completeResearchMission({ ...input, claimantId, actor }, context);
            return { outcome: result.outcome, missionId: input.missionId, fascicoloScopeId: "synthetic-scope",
              status: result.mission.operational.status as "COMPLETED" | "BUDGET_EXHAUSTED", stateVersion: result.mission.operational.stateVersion };
          } catch (error) { failureCode = (error as ResearchPersistenceError).code; throw error; }
        }),
        deferMission: vi.fn<TrustedResearchHttpClient["deferMission"]>(async (input) => {
          const result = await releaseOrDeferResearchMission({ ...input, claimantId, actor }, context);
          return { missionId: input.missionId, fascicoloScopeId: "synthetic-scope", status: result.operational.status as "PENDING" | "DEFERRED", stateVersion: result.operational.stateVersion };
        }),
      };
      const callOrder: string[] = [];
      const discovery = vi.fn(async (request: ProviderToolRequest) => {
        callOrder.push("discovery");
        return { structuredContent: { catalog_version: "synthetic", query: request.arguments.query,
          source_keys: request.arguments.source_keys, payload: { normativa: [{ alias: "Legge 84/1994", titolo: "Riordino della legislazione portuale" }] } } };
      });
      const cross = vi.fn(async (request: ProviderToolRequest) => {
        callOrder.push("cross-jurisdiction");
        return { structuredContent: { catalog_version: "synthetic", query: request.arguments.query,
          source_keys: request.arguments.source_keys, payload: { risultati: [{ alias: `SYNTHETIC:${String(request.arguments.source_keys)}` }] } } };
      });
      const moonlitDiscovery = vi.fn(async () => {
        callOrder.push("moonlit-discovery");
        return { content: [{ type: "text", text: JSON.stringify({ success: true, result: { results: [{
          identifier: "synthetic-moonlit-port-law-84", secondaryIdentifier: "Legge 84/1994",
        }] } }) }] };
      });
      const exact = vi.fn(async () => {
        callOrder.push("exact");
        return { content: [{ type: "text", text: JSON.stringify({
          identifier: scenario === "exact-mismatch" ? "synthetic-different-document" : "synthetic-moonlit-port-law-84",
          secondaryIdentifier: "Legge 84/1994",
        }) }] };
      });
      const unsupportedExact = vi.fn();
      const providerAdapters = [createSimpliciterResearchAdapter(discovery), createSimpliciterExactRetrievalAdapter(unsupportedExact),
        createSimpliciterCrossJurisdictionResearchAdapter(cross), createMoonlitResearchAdapter(moonlitDiscovery), createMoonlitExactRetrievalAdapter(exact)];
      const expectedCallOrder = ["discovery", ...Array<string>(4).fill("cross-jurisdiction"), "moonlit-discovery", "exact"];
      if (scenario === "missing") european.available = false;
      if (scenario === "http-valid" || scenario === "http-altered" || scenario === "http-missing" || scenario === "http-stale" || negativeSearch) {
        now = new Date();
        const origin = "https://synthetic.example.test";
        const bearer = "synthetic-http-bearer";
        vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://auth.example.test");
        vi.stubEnv("MCP_RESOURCE_URI", `${origin}/api/mcp`);
        vi.stubEnv("MCP_FASCICOLO_GRANT_SECRET", "synthetic-http-grant-secret-at-least-thirty-two-bytes");
        documentaryMocks.jwtVerify.mockImplementation(async (token) => {
          expect(token).toBe(bearer);
          return { payload: { sub: "synthetic-http-subject",
            "urn:concessioni-portuali:actor_id": actor.actorId,
            "urn:concessioni-portuali:tenant_id": actor.tenantId } };
        });
        const transactions = vi.fn(async (operation: (client: ResearchPersistenceClient) => Promise<unknown>, options: unknown) => {
          expect(options).toEqual({ isolationLevel: "Serializable" });
          return operation(tx);
        });
        const userRead = vi.fn(async ({ where }: { where: { id: string } }) => {
          expect(where.id).toBe(actor.actorId);
          return { attivo: true, ruolo: "ADMIN", tenantMemberships: [{ enteId: actor.tenantId, isDefault: true }] };
        });
        documentaryMocks.database = { ...tx, user: { findUnique: userRead }, $transaction: transactions };
        const mcpSubmissions: ResearchEvidenceBundle[] = [];
        const mcpTools: string[] = [];
        const internalTransport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(String(input), init);
          expect(request.url).toBe(`${origin}/api/mcp`);
          expect(request.headers.get("authorization")).toBe(`Bearer ${bearer}`);
          const envelope = await request.clone().json();
          mcpTools.push(envelope.params.name);
          if (envelope.params.name === "research_submit_evidence_bundle") mcpSubmissions.push(envelope.params.arguments.bundle);
          return mcpPost(request);
        });
        vi.stubGlobal("fetch", internalTransport);
        let authenticatedReads = 0;
        let executorFingerprint: string | undefined;
        const returnedErrors: string[] = [];
        const transport = vi.fn(async (url: string, init: RequestInit) => {
          expect(new URL(url).origin).toBe(origin);
          expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${bearer}`);
          const body = JSON.parse(String(init.body));
          if (body.action === "research_submit_evidence_bundle") {
            executorFingerprint = body.bundle.assistedVerificationFingerprint;
            expect(executorFingerprint).toBe(reviewed.verification.result.assistedVerificationFingerprint);
            if (scenario === "http-altered") body.bundle.assistedVerificationFingerprint = `assisted-evidence:${"0".repeat(64)}`;
            if (scenario === "http-missing") delete body.bundle.assistedVerificationFingerprint;
          }
          if (body.action === "research_complete_mission" && scenario === "negative-stale") {
            now = new Date(now.getTime() + 1_000);
            const search = { ...reviewedSnapshot.adverseSearch!, sufficiencyRationale: "New synthetic scope rationale reviewed after submission; original documents unchanged." };
            const replacement = await persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId, approveAdverseSearch: true,
              snapshot: createAssistedVerificationSnapshot({ ...reviewedSnapshot, adverseSearch: search, adverseSearchReview: undefined }),
            }, context);
            expect(replacement.verification.result.adverseSearchState).toBe("COMPLETED_NO_ADVERSE_FOUND");
            expect(replacement.verification.result.adverseAuthorityVerified).toBe(false);
            expect(replacement.verification.result.evidenceGaps).toEqual([]);
            expect(replacement.verification.result.assistedVerificationFingerprint).not.toBe(executorFingerprint);
          }
          if (body.action === "research_complete_mission" && scenario === "http-stale") {
            now = new Date(now.getTime() + 1_000);
            const replacement = await persistAssistedVerification({ actor, expectedPreviousRecordId: reviewed.verification.recordId,
              snapshot: createAssistedVerificationSnapshot({ ...reviewedSnapshot,
                citationRelation: { ...reviewedSnapshot.citationRelation!, locator: { paragraph: "99" } },
                adverseReview: { ...reviewedSnapshot.adverseReview!, reviewedAt: now.toISOString(), rationale: "New explicit synthetic review of paragraph 99 after HTTP submission." },
              }),
            }, context);
            expect(replacement.verification.result.adverseAuthorityVerified).toBe(true);
            expect(replacement.verification.result.evidenceGaps).toEqual([]);
          }
          const request = new Request(url, { ...init, body: JSON.stringify(body) });
          let response: Response;
          if (new URL(url).pathname === "/api/legal-research/trusted/mission") response = await trustedReadPost(request);
          else {
            expect(new URL(url).pathname).toBe("/api/legal-research/trusted/mission/action");
            response = await trustedActionPost(request);
          }
          expect(response.status).toBe(200);
          const envelope = await response.clone().json();
          const content = envelope.result?.structuredContent;
          if (content?.assistedVerification) {
            if (authenticatedReads === 0) {
              expect(content.mission).toMatchObject(originalMission);
              expect(content.assistedVerification.recordId).toBe(reviewed.verification.recordId);
              expect(content.assistedVerification.snapshot).toEqual(reviewedSnapshot);
              expect(content.assistedVerification.verifiedDocuments).toHaveLength(scenario === "negative-missing" || scenario === "negative-altered" ? 4 : 5);
            }
            authenticatedReads += 1;
          }
          if (content?.error) returnedErrors.push(content.error);
          return response;
        });
        const httpClient = createTrustedResearchHttpClient({ stagingOrigin: `${origin}/`, issuer: "https://auth.example.test",
          resource: `${origin}/api/mcp`, bearerSupplier: async () => bearer, transport });
        const httpResult = await createTrustedMissionExecutor({
          client: httpClient,
          providerAdapters,
          legalDataHunterApiKey: null, now: () => new Date(now), executionId: () => executionId,
        }).execute(mission.missionId);
        expect(authenticatedReads).toBeGreaterThan(0);
        expect(userRead).toHaveBeenCalled();
        expect(documentaryMocks.jwtVerify.mock.calls.length).toBe(transport.mock.calls.length * 2);
        if (blockedSearch) {
          expect(httpResult.status).toBe("BLOCKED");
          expect(httpResult.callsConsumed).toBe(0);
          expect(mcpTools).toEqual(["research_get_mission"]);
          expect(callOrder).toEqual([]);
          expect(harness.attempts.size).toBe(0);
          expect(harness.bundles.size).toBe(0);
          expect(harness.missions.get(mission.missionId)?.payload).toEqual(originalMission);
          expect(harness.missions.get(mission.missionId)?.status).toBe("PENDING");
          return;
        }
        expect(transactions).toHaveBeenCalled();
        expect(documentaryMocks.globalRead).not.toHaveBeenCalled();
        expect(callOrder).toEqual(expectedCallOrder);
        expect(unsupportedExact).not.toHaveBeenCalled();
        expect(exact).toHaveBeenCalledWith({ name: "get_document", arguments: { document_identifier: "synthetic-moonlit-port-law-84" } });
        expect(httpResult.callsConsumed).toBe(7);
        expect(mcpTools).toEqual(expect.arrayContaining(["research_get_mission", "research_claim_mission", "research_submit_evidence_bundle"]));
        expect(mcpSubmissions).toHaveLength(1);
        expect(validateResearchEvidenceBundle(mission, mcpSubmissions[0])).toEqual([]);
        expect(harness.missions.get(mission.missionId)?.payload).toEqual(originalMission);
        expect(mission).toEqual(originalMission);
        expect(harness.verifications.get(reviewed.verification.recordId)?.payload).toEqual(reviewedSnapshot);
        const attempt = harness.attempts.get(executionId)!;
        expect(attempt.claimantId).toBe("workos:synthetic-http-subject");
        if (scenario === "http-valid" || scenario === "negative-valid") {
          expect(httpResult.status).toBe("COMPLETED");
          expect(returnedErrors).toEqual([]);
          expect(mcpTools).toContain("research_complete_mission");
          expect(mcpSubmissions[0].assistedVerificationFingerprint).toBe(executorFingerprint);
          expect(harness.bundles.get(attempt.finalBundleId)?.payload).toEqual(mcpSubmissions[0]);
          expect(attempt).toMatchObject({ totalCalls: 7, simpliciterCalls: 5, moonlitCalls: 2, completionState: "COMPLETE" });
          expect(harness.missions.get(mission.missionId)?.status).toBe("COMPLETED");
        } else {
          expect(httpResult.status).toBe("RECOVERY_REQUIRED");
          expect(returnedErrors).toEqual(["INVALID_EVIDENCE_BUNDLE"]);
          expect(attempt.finalBundleId).toBeNull();
          expect(harness.missions.get(mission.missionId)?.status).toBe("IN_PROGRESS");
          if (scenario === "http-stale" || scenario === "negative-stale") {
            expect(mcpSubmissions[0].assistedVerificationFingerprint).toBe(executorFingerprint);
            expect(harness.bundles.size).toBe(1);
            expect([...harness.bundles.values()][0].payload.assistedVerificationFingerprint).toBe(executorFingerprint);
            expect(mcpTools).toContain("research_complete_mission");
          } else {
            expect(mcpSubmissions[0].assistedVerificationFingerprint).not.toBe(executorFingerprint);
            expect(harness.bundles.size).toBe(0);
            expect(mcpTools).not.toContain("research_complete_mission");
          }
        }
        return;
      }
      const result = await createTrustedMissionExecutor({
        client, providerAdapters,
        assistedVerificationReader: createAssistedVerificationReader(actor, context), legalDataHunterApiKey: null,
        now: () => new Date(now), executionId: () => executionId,
      }).execute(mission.missionId);
      expect(mission).toEqual(originalMission);
      expect(harness.missions.get(mission.missionId)?.payload).toEqual(originalMission);
      expect(harness.verifications.get(reviewed.verification.recordId)?.payload).toEqual(reviewedSnapshot);
      expect(documentaryMocks.globalRead).not.toHaveBeenCalled();
      if (scenario === "missing") {
        expect(result.status).toBe("BLOCKED");
        expect(client.claimMission).not.toHaveBeenCalled();
        expect(client.submitEvidenceBundle).not.toHaveBeenCalled();
        expect(callOrder).toEqual([]);
        expect(harness.missions.get(mission.missionId)?.status).toBe("PENDING");
        return;
      }
      expect(callOrder).toEqual(expectedCallOrder);
      expect(unsupportedExact).not.toHaveBeenCalled();
      expect(exact).toHaveBeenCalledWith({ name: "get_document", arguments: { document_identifier: "synthetic-moonlit-port-law-84" } });
      expect([discovery.mock.calls[0][0], ...cross.mock.calls.map(([request]) => request)].flatMap((request) => request.arguments.source_keys)).toEqual([
        "it.legislation.normativa-italiana", "it.legislation.normativa-ue", "it.case_law.giustizia-amministrativa", "it.case_law.cassazione", "it.case_law.corte-di-giustizia-ue",
      ]);
      expect(result.callsConsumed).toBe(7);
      expect(submittedBundle!.authorityCandidates.some((candidate) => candidate.toolId === "ASSISTED_VERIFICATION" && candidate.verificationState === "OFFICIALLY_VERIFIED")).toBe(true);
      if (scenario === "complete") {
        expect(validateResearchEvidenceBundle(mission, submittedBundle!)).toEqual([]);
        expect(result.status).toBe("COMPLETED");
        expect(submittedBundle!.evidenceGaps).toEqual([]);
        expect(submittedBundle!.citationObservations).toHaveLength(1);
        expect(submittedBundle!.legalResearchSuggestions).toHaveLength(1);
        expect(harness.attempts.get(executionId)).toMatchObject({ totalCalls: 7, simpliciterCalls: 5, moonlitCalls: 2, legalDataHunterCalls: 0, completionState: "COMPLETE" });
        expect(harness.missions.get(mission.missionId)?.status).toBe("COMPLETED");
      } else {
        expect(result.status).not.toBe("COMPLETED");
        expect(harness.missions.get(mission.missionId)?.status).not.toBe("COMPLETED");
        expect(harness.attempts.get(executionId)?.finalBundleId).toBeNull();
        const expectedErrors = { tampered: "INVALID_TRANSITION", superseded: "INVALID_BUNDLE", invalidated: "INVALID_TRANSITION", lease: "STALE_CLAIM", budget: "BUDGET_OVERRUN", "bundle-mismatch": "INVALID_BUNDLE" };
        if (scenario === "exact-mismatch") {
          expect(client.completeMission).not.toHaveBeenCalled();
          expect(submittedBundle!.unresolvedQuestions).toContain("MOONLIT:EXACT_RETRIEVAL:EXACT_RESULT_IDENTITY_MISMATCH");
        } else expect(expectedErrors).toHaveProperty(scenario, failureCode);
      }
    },
  );

  it("rechecks documentary evidence at completion and rejects complete bundles with gaps", async () => {
    const harness = createHarness();
    const mission = researchMission({ missingSourceFamilies: [], requiredOutput: {
      authorityCandidates: false, citationObservations: false, legalResearchSuggestions: false, evidenceGaps: true, fullTextRequired: true,
    } });
    const source = officialSource({ fullText: { available: true, documentId: "document-a", fileVersionId: "file-a", contentSha256: "a".repeat(64) } });
    const readDocuments = vi.fn(async () => [{ evidenceSourceId: source.evidenceSourceId, documentId: "document-a", fileVersionId: "file-a", contentSha256: "a".repeat(64) }]);
    const documentContext = { ...harness.context, readAssistedDocuments: readDocuments };
    await createResearchMissionRecord({ mission, actor }, documentContext);
    const verified = await persistAssistedVerification({ snapshot: createAssistedVerificationSnapshot({ missionId: mission.missionId, sources: [source] }), actor }, documentContext);
    const claimed = await claimResearchMission({ missionId: mission.missionId, executionId: "document-execution", actor,
      executor: { kind: "AUTHORIZED_WORKER", claimantId: "worker-a" }, leaseDurationMs: 60_000,
    }, documentContext);
    const credentials = { claimantId: "worker-a", claimToken: claimed.claim.claimToken, actor };
    const bundle = {
      ...evidenceBundle(mission, "document-execution", "COMPLETE", []),
      assistedVerificationFingerprint: verified.verification.result.assistedVerificationFingerprint,
    };
    const submitted = await submitResearchEvidenceBundle({ bundle, ...credentials }, documentContext);
    const completion = { missionId: mission.missionId, executionId: "document-execution", bundleId: submitted.bundle.id, ...credentials };
    readDocuments.mockResolvedValueOnce([]);
    await expect(completeResearchMission(completion, documentContext)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(harness.missions.get(mission.missionId)?.status).toBe("IN_PROGRESS");
    const gapped = await submitResearchEvidenceBundle({ ...credentials, bundle: { ...bundle, evidenceGaps: [{ gapId: "unresolved", kind: "MISSING_DOCUMENT" }] } }, documentContext);
    await expect(completeResearchMission({ ...completion, bundleId: gapped.bundle.id }, documentContext)).rejects.toMatchObject({ code: "INVALID_BUNDLE" });
    await expect(completeResearchMission(completion, documentContext)).resolves.toMatchObject({ mission: { operational: { status: "COMPLETED" } } });
  });

  it("rejects a documentary claim with residual evidence gaps before mutation", async () => {
    const harness = createHarness();
    const mission = researchMission({ requiredOutput: {
      authorityCandidates: false, citationObservations: false, legalResearchSuggestions: false,
      evidenceGaps: true, fullTextRequired: true,
    } });
    await createResearchMissionRecord({ mission, actor }, harness.context);
    await expect(claimResearchMission({ missionId: mission.missionId, executionId: "blocked-document-claim",
      executor: { kind: "AUTHORIZED_WORKER", claimantId: "worker-a" }, actor, leaseDurationMs: 60_000,
    }, harness.context)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await getResearchMission(mission.missionId, actor, harness.context))?.operational.status).toBe("PENDING");
  });

  it("allows one initial snapshot and appends only from the latest record", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const initialSnapshot = createAssistedVerificationSnapshot({
      missionId: mission.missionId,
      sources: [officialSource()],
    });

    const initial = await persistAssistedVerification({
      snapshot: initialSnapshot,
      actor,
      expectedPreviousRecordId: null,
    }, harness.context);
    await expect(persistAssistedVerification({
      snapshot: initialSnapshot,
      actor,
      expectedPreviousRecordId: null,
    }, harness.context)).rejects.toMatchObject({ code: "ASSISTED_VERIFICATION_CONFLICT" });

    const next = await persistAssistedVerification({
      snapshot: createAssistedVerificationSnapshot({
        missionId: mission.missionId,
        sources: [officialSource({ officialIdentifier: "ECLI:EU:C:2024:2" })],
      }),
      actor,
      expectedPreviousRecordId: initial.verification.recordId,
    }, harness.context);

    expect(next.outcome).toBe("CREATED");
    expect(harness.verifications).toHaveLength(2);
  });

  it("does not read assisted verification across tenants", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    await persistAssistedVerification({
      snapshot: createAssistedVerificationSnapshot({ missionId: mission.missionId, sources: [] }),
      actor,
    }, harness.context);

    await expect(getLatestAssistedVerification(
      mission.missionId,
      { actorId: "user-2", tenantId: "ente-2" },
      harness.context,
    )).rejects.toMatchObject({ code: "AUTHORIZATION_REQUIRED" });
  });

  it("rejects a human review attributed to another actor", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const snapshot = createAssistedVerificationSnapshot({
      missionId: mission.missionId,
      sources: [],
      adverseReview: {
        observationSourceAuthorityId: "authority-a",
        observationTargetAuthorityId: "authority-b",
        legalPropositionId: "proposition-1",
        reviewedByActorId: "user-2",
        reviewedAt: "2026-09-26T10:00:00.000Z",
        evidenceSourceId: "evidence-source-a",
        rationale: "Purported review by another actor.",
        decision: "ADVERSE",
      },
    });

    await expect(persistAssistedVerification({ snapshot, actor }, harness.context))
      .rejects.toMatchObject({ code: "INVALID_ASSISTED_VERIFICATION" });
    expect(harness.verificationDelegate.create).not.toHaveBeenCalled();
  });

  it("rejects a source attestation attributed to another actor", async () => {
    const harness = createHarness();
    const mission = researchMission();
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const snapshot = createAssistedVerificationSnapshot({
      missionId: mission.missionId,
      sources: [officialSource({
        reviewerAttestation: {
          reviewedByActorId: "user-2",
          reviewedAt: "2026-09-26T10:00:00.000Z",
          rationale: "Purported source verification by another actor.",
        },
      })],
    });

    await expect(persistAssistedVerification({ snapshot, actor }, harness.context))
      .rejects.toMatchObject({ code: "INVALID_ASSISTED_VERIFICATION" });
    expect(harness.verificationDelegate.create).not.toHaveBeenCalled();
  });

  it("persists an unverified source without letting it satisfy full text", async () => {
    const harness = createHarness();
    const mission = researchMission({
      requiredOutput: { ...missionInput().requiredOutput, fullTextRequired: true },
    });
    await createResearchMissionRecord({ mission, actor }, harness.context);
    const persisted = await persistAssistedVerification({
      snapshot: createAssistedVerificationSnapshot({
        missionId: mission.missionId,
        sources: [officialSource({ identityVerificationStatus: "UNVERIFIED" })],
      }),
      actor,
    }, harness.context);

    expect(persisted.verification.result.verifiedFullTexts).toEqual([]);
    expect(persisted.verification.result.evidenceGaps)
      .toContainEqual(expect.objectContaining({ kind: "FULL_TEXT_NOT_VERIFIED" }));
  });

  it("uses no provider or LLM transport", async () => {
    const harness = createHarness();
    await createAndClaim(harness);
    expect(Object.keys(harness.context.client ?? {}).sort()).toEqual([
      "researchAssistedVerificationRecord",
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
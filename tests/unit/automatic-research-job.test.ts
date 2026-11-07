import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/legal-research/persisted-research-policy", async () => {
  const automatic = await import("@/server/legal-research/automatic-research-policy");
  const manual = await import("@/server/legal-research/manual-research-policy");
  return {
    evaluatePersistedAutomaticResearchPolicy: (input: {
      tenantId: string;
      mission?: Parameters<typeof automatic.evaluateAutomaticResearchPolicy>[0]["mission"];
    }) => automatic.evaluateAutomaticResearchPolicy({ ...input, env: process.env }),
    evaluatePersistedManualResearchPolicy: (input: {
      tenantId: string;
      mission: Parameters<typeof manual.evaluateManualResearchPolicy>[0]["mission"];
    }) => manual.evaluateManualResearchPolicy({ ...input, env: process.env }),
    getPersistedResearchScopePolicy: () => Promise.resolve({
      researchChannels: ["MOONLIT", "SIMPLICITER", "LEGAL_DATA_HUNTER"],
    }),
  };
});
const getResearchMissionMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/legal-research/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/legal-research/persistence")>()),
  getResearchMission: getResearchMissionMock,
}));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  createAutomaticResearchExecutionHandler,
  ensureAutomaticResearchExecution,
  ensureManualResearchExecution,
} from "@/server/legal-research/automatic-research-job";
import { evaluateAutomaticResearchPolicy } from "@/server/legal-research/automatic-research-policy";
import { evaluateManualResearchPolicy } from "@/server/legal-research/manual-research-policy";
import { createResearchMission, RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";
import { prisma } from "@/lib/prisma";

const mission = createResearchMission({
  kind: "RESEARCH_MISSION",
  version: RESEARCH_BRIDGE_VERSION,
  executionChannel: "SERVER_AUTONOMOUS",
  caseReference: { caseId: "procedure-1", fascicoloReference: "procedure-1" },
  legalIssueIds: ["issue-1"],
  legalPropositionIds: [],
  referenceDate: "2026-09-28T00:00:00.000Z",
  mode: "DISCOVER_AUTHORITIES",
  researchQuestion: "Quali autorità sono pertinenti?",
  knownAuthorities: [],
  excludedAuthorities: [],
  preferredSourceFamilies: ["GIUSTIZIA_AMMINISTRATIVA"],
  missingSourceFamilies: [],
  knownCounterArguments: [],
  knownEvidenceGaps: [],
  requiredOutput: {
    authorityCandidates: true,
    citationObservations: false,
    legalResearchSuggestions: false,
    evidenceGaps: true,
    fullTextRequired: false,
  },
  budget: {
    maxTotalResearchCalls: 2,
    maxMoonlitCalls: 1,
    maxSimpliciterCalls: 1,
    maxLegalDataHunterCalls: 0,
  },
  status: "PENDING",
  executionPlan: { requiredCapabilities: ["SEMANTIC_DISCOVERY"] },
});

const env = {
  AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "true",
  AUTOMATIC_RESEARCH_TENANT_ALLOWLIST: "tenant-1",
  AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST: "procedure-1",
  AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES: "SEMANTIC_DISCOVERY",
  AUTOMATIC_RESEARCH_MAX_CALLS: "2",
  AUTOMATIC_RESEARCH_WORKER_ACTOR_ID: "automatic-worker",
  AUTOMATIC_RESEARCH_LEASE_MS: "60000",
  AUTOMATIC_RESEARCH_PROVIDER_TIMEOUT_MS: "5000",
};

const decision = evaluateAutomaticResearchPolicy({ tenantId: "tenant-1", mission, env });
const manualEnv = {
  MANUAL_RESEARCH_EXECUTION_ENABLED: "true",
  MANUAL_RESEARCH_TENANT_ALLOWLIST: "tenant-1",
  MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST: "procedure-1",
  MANUAL_RESEARCH_ALLOWED_CAPABILITIES: "SEMANTIC_DISCOVERY",
  MANUAL_RESEARCH_MAX_CALLS: "2",
  MANUAL_RESEARCH_WORKER_ACTOR_ID: "manual-worker",
  MANUAL_RESEARCH_LEASE_MS: "60000",
  MANUAL_RESEARCH_PROVIDER_TIMEOUT_MS: "5000",
};
const reference = {
  referenceType: "LEGAL_RESEARCH_MISSION",
  referenceId: mission.missionId,
  referenceVersion: RESEARCH_BRIDGE_VERSION,
  metadata: { contractVersion: RESEARCH_BRIDGE_VERSION },
} as const;
const context = {
  jobId: "research-job-1",
  correlationId: "correlation-1",
  attempt: 1,
  isCancellationRequested: vi.fn(async () => false),
  heartbeat: vi.fn(async () => undefined),
};

describe("automatic research queue job", () => {
  it("is registered in the application worker", () => {
    expect(applicationAsyncJobRegistry.resolve(RESEARCH_MISSION_EXECUTION_OPERATION)).not.toBeNull();
  });

  it("fails closed before admission when policy is absent", async () => {
    await expect(ensureAutomaticResearchExecution({
      mission,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "correlation-1",
      env: {},
    })).resolves.toEqual({
      outcome: "NOT_AUTHORIZED",
      requirementCode: "AUTOMATIC_RESEARCH_POLICY_DISABLED",
      jobId: null,
    });
  });

  it("admits an explicitly requested mission without enabling automatic research", async () => {
    const admitJob = vi.fn(async () => ({ job: { id: "manual-job-1" } }));
    await expect(ensureManualResearchExecution({
      mission,
      tenantId: "tenant-1",
      actorId: "admin-1",
      correlationId: "manual-1",
      env: manualEnv,
    }, {
      findJobByIdempotencyKey: vi.fn(async () => null),
      admitJob,
    })).resolves.toEqual({
      outcome: "ADMITTED",
      requirementCode: null,
      jobId: "manual-job-1",
    });
    expect(admitJob).toHaveBeenCalledWith(expect.objectContaining({
      policyDecisionRef: expect.stringMatching(/^manual-research-policy-v1:/),
      admission: expect.objectContaining({
        initiatingUserId: "admin-1",
        admissionType: "AUTHENTICATED_USER",
        actor: expect.objectContaining({
          actorId: "admin-1",
          actorRole: "MANUAL_FASCICOLO_RESEARCH",
        }),
      }),
    }));
    expect(evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...env, AUTOMATIC_RESEARCH_EXECUTION_ENABLED: "false" },
    }).authorized).toBe(false);
  });

  it("keeps manual policy scope and budget independent from automatic policy", () => {
    expect(evaluateManualResearchPolicy({
      tenantId: "tenant-2",
      mission,
      env: manualEnv,
    }).requirementCode).toBe("MANUAL_RESEARCH_TENANT_NOT_ALLOWED");
    expect(evaluateManualResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...manualEnv, MANUAL_RESEARCH_MAX_CALLS: "1" },
    }).requirementCode).toBe("MANUAL_RESEARCH_BUDGET_NOT_ALLOWED");
    expect(evaluateManualResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: manualEnv,
    }).policyDecisionRef).toMatch(/^manual-research-policy-v1:/);
  });

  it("never admits a ChatGPT connector mission even when autonomous policy is enabled", async () => {
    const { missionId: _missionId, ...missionInput } = mission;
    const chatGptMission = createResearchMission({
      ...missionInput,
      executionChannel: "CHATGPT_CONNECTOR",
    });
    await expect(ensureAutomaticResearchExecution({
      mission: chatGptMission,
      tenantId: "tenant-1",
      actorId: "actor-1",
      correlationId: "correlation-1",
      env,
    })).resolves.toEqual({
      outcome: "NOT_AUTHORIZED",
      requirementCode: "AUTOMATIC_RESEARCH_EXECUTION_CHANNEL_NOT_ALLOWED",
      jobId: null,
    });
  });

  it("reuses a live job and admits a bounded new generation only after the previous job is terminal", async () => {
    const jobs = new Map<string, { id: string; status: string }>();
    const admitted: string[] = [];
    const dependencies = {
      findJobByIdempotencyKey: vi.fn(async (key: string) => jobs.get(key) ?? null),
      admitJob: vi.fn(async (admission: { logicalOperationId: string; inputReference: unknown }) => {
        expect((admission.inputReference as { referenceId: string }).referenceId).toBe(mission.missionId);
        admitted.push(admission.logicalOperationId);
        return { job: { id: `job-${admitted.length}` } };
      }),
    };
    const base = { mission, tenantId: "tenant-1", actorId: "actor-1", correlationId: "c", env };
    const keyOf = async (generation: number) => {
      const { normalizeAsyncJobAdmission } = await import("@/server/async-jobs/domain");
      const { buildResearchMissionAsyncJobAdmission } = await import("@/server/legal-research/persistence");
      return normalizeAsyncJobAdmission(buildResearchMissionAsyncJobAdmission({
        mission,
        actor: {
          actorId: "actor-1", actorEmail: null, actorRole: "AUTOMATIC_FASCICOLO_RESEARCH",
          initiatingUserId: null, admissionType: "AUTHORIZED_SYSTEM", tenantId: "tenant-1",
        },
        correlationId: "c",
        policyDecisionRef: decision.policyDecisionRef,
        availableAt: new Date(),
        maxAttempts: 1,
        executionGeneration: generation,
      })).idempotencyKey;
    };

    await expect(ensureAutomaticResearchExecution(base, dependencies)).resolves.toMatchObject({ jobId: "job-1" });
    expect(admitted).toEqual([mission.missionId]);

    jobs.set(await keyOf(0), { id: "job-1", status: "RUNNING" });
    await expect(ensureAutomaticResearchExecution(base, dependencies)).resolves.toMatchObject({ jobId: "job-1" });
    expect(admitted).toHaveLength(1);

    jobs.set(await keyOf(0), { id: "job-1", status: "TERMINAL_FAILED" });
    await expect(ensureAutomaticResearchExecution(base, dependencies)).resolves.toMatchObject({ jobId: "job-2" });
    expect(admitted[1]).toBe(`${mission.missionId}:execution:1`);

    for (let generation = 1; generation < 5; generation += 1) {
      jobs.set(await keyOf(generation), { id: `old-${generation}`, status: "TERMINAL_FAILED" });
    }
    await expect(ensureAutomaticResearchExecution(base, dependencies)).resolves.toEqual({
      outcome: "NOT_AUTHORIZED",
      requirementCode: "RESEARCH_EXECUTION_RETRY_LIMIT_REACHED",
      jobId: null,
    });
  });

  it("rejects tenant, capability, and budget outside the explicit policy", () => {
    expect(evaluateAutomaticResearchPolicy({ tenantId: "tenant-2", mission, env }).requirementCode)
      .toBe("AUTOMATIC_RESEARCH_TENANT_NOT_ALLOWED");
    expect(evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...env, AUTOMATIC_RESEARCH_PROCEDIMENTO_ALLOWLIST: "procedure-2" },
    }).requirementCode).toBe("AUTOMATIC_RESEARCH_PROCEDIMENTO_NOT_ALLOWED");
    expect(evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...env, AUTOMATIC_RESEARCH_ALLOWED_CAPABILITIES: "KEYWORD_DISCOVERY" },
    }).requirementCode).toBe("AUTOMATIC_RESEARCH_CAPABILITY_NOT_ALLOWED");
    expect(evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...env, AUTOMATIC_RESEARCH_MAX_CALLS: "1" },
    }).requirementCode).toBe("AUTOMATIC_RESEARCH_BUDGET_NOT_ALLOWED");
  });

  it("requires and fingerprints a bounded official-source acquisition policy", () => {
    expect(evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: { ...env, AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED: "true" },
    }).requirementCode).toBe("AUTOMATIC_RESEARCH_POLICY_INVALID");

    const bounded = evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: {
        ...env,
        AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED: "true",
        AUTOMATIC_OFFICIAL_SOURCE_MAX_ACQUISITIONS: "12",
      },
    });
    const narrower = evaluateAutomaticResearchPolicy({
      tenantId: "tenant-1",
      mission,
      env: {
        ...env,
        AUTOMATIC_OFFICIAL_SOURCE_VERIFICATION_ENABLED: "true",
        AUTOMATIC_OFFICIAL_SOURCE_MAX_ACQUISITIONS: "11",
      },
    });

    expect(bounded).toMatchObject({
      authorized: true,
      maxOfficialSourceAcquisitions: 12,
    });
    expect(narrower.policyDecisionRef).not.toBe(bounded.policyDecisionRef);
  });

  it("completes through the handler with one accounted execution", async () => {
    const execute = vi.fn(async () => ({
      status: "COMPLETED" as const,
      missionId: mission.missionId,
      executionId: "execution-1",
      bundleId: "bundle-1",
      callsConsumed: 1,
      blockerCodes: [],
    }));
    const orchestrateSourceChain = vi.fn(async () => undefined);
    const handler = createAutomaticResearchExecutionHandler({
      assertAiExecutionAllowed: vi.fn(async () => undefined),
      loadAuthority: vi.fn(async () => ({
        mission,
        tenantId: "tenant-1",
        actorId: "actor-1",
        decision,
        researchChannels: ["MOONLIT"] as const,
      })),
      createProviderAdapters: vi.fn(async () => [{ capability: "SEMANTIC_DISCOVERY" } as never]),
      execute,
      orchestrateSourceChain,
    });
    await expect(handler.execute(reference, context)).resolves.toMatchObject({
      referenceType: "LEGAL_RESEARCH_RESULT",
      metadata: { callCount: 1, completionCode: "COMPLETED" },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(orchestrateSourceChain).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ bundleId: "bundle-1" }) }));
  });

  it("stops before creating provider adapters when global AI is OFF", async () => {
    const createProviderAdapters = vi.fn();
    const execute = vi.fn();
    const handler = createAutomaticResearchExecutionHandler({
      assertAiExecutionAllowed: vi.fn(async () => {
        throw new Error("AI_GLOBALLY_DISABLED");
      }),
      loadAuthority: vi.fn(async () => ({
        mission,
        tenantId: "tenant-1",
        actorId: "actor-1",
        decision,
        researchChannels: ["MOONLIT"] as const,
      })),
      createProviderAdapters,
      execute,
    });

    await expect(handler.execute(reference, context)).rejects.toThrow("AI_GLOBALLY_DISABLED");
    expect(createProviderAdapters).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks a lost trusted response terminal and never requests an automatic retry", async () => {
    const execute = vi.fn(async () => ({
      status: "RECOVERY_REQUIRED" as const,
      missionId: mission.missionId,
      executionId: "execution-uncertain",
      callsConsumed: 1,
      blockerCodes: ["SUBMIT_OUTCOME_UNCERTAIN"],
    }));
    const handler = createAutomaticResearchExecutionHandler({
      assertAiExecutionAllowed: vi.fn(async () => undefined),
      loadAuthority: vi.fn(async () => ({
        mission,
        tenantId: "tenant-1",
        actorId: "actor-1",
        decision,
        researchChannels: ["MOONLIT"] as const,
      })),
      createProviderAdapters: vi.fn(async () => [{ capability: "SEMANTIC_DISCOVERY" } as never]),
      execute,
    });
    await expect(handler.execute(reference, context)).rejects.toEqual(
      new AsyncJobExecutionError("UNCERTAIN_OUTCOME", "SUBMIT_OUTCOME_UNCERTAIN", false),
    );
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe("research execution authority gates", () => {
  const manualDecision = evaluateManualResearchPolicy({ tenantId: "tenant-1", mission, env: manualEnv });
  const database = prisma as unknown as Record<string, unknown>;
  const arrange = (input: Readonly<{
    job?: Record<string, unknown> | null;
    current?: boolean;
    stored?: boolean;
  }>) => {
    database.asyncJob = {
      findUnique: vi.fn(async () => input.job === undefined
        ? {
          operation: RESEARCH_MISSION_EXECUTION_OPERATION,
          tenantId: "tenant-1",
          actorId: "actor-1",
          policyDecisionRef: manualDecision.policyDecisionRef,
        }
        : input.job),
    };
    database.automaticFascicoloReportMission = { findFirst: vi.fn(async () => null) };
    database.researchMissionRecord = {
      findFirst: vi.fn(async () => (input.current ?? true) ? { id: mission.missionId } : null),
    };
    getResearchMissionMock.mockResolvedValue((input.stored ?? true) ? { mission } : null);
  };
  const denial = async () => {
    const handler = createAutomaticResearchExecutionHandler({ assertAiExecutionAllowed: vi.fn(async () => undefined) });
    return handler.execute(reference, context).then(() => null, (error: unknown) => error);
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    getResearchMissionMock.mockReset();
  });

  it("names each fail-closed gate instead of a generic policy or scope error", async () => {
    for (const [name, value] of Object.entries(manualEnv)) vi.stubEnv(name, value);

    arrange({ job: null });
    expect(await denial()).toMatchObject({ category: "AUTHORIZATION", code: "RESEARCH_JOB_SCOPE_INVALID", retryable: false });

    arrange({ current: false });
    expect(await denial()).toMatchObject({ code: "RESEARCH_MISSION_NOT_CURRENT", retryable: false });

    arrange({ stored: false });
    expect(await denial()).toMatchObject({ code: "RESEARCH_MISSION_NOT_ACCESSIBLE", retryable: false });

    arrange({});
    vi.stubEnv("MANUAL_RESEARCH_MAX_CALLS", "1");
    expect(await denial()).toMatchObject({ code: "MANUAL_RESEARCH_BUDGET_NOT_ALLOWED", retryable: false });

    vi.stubEnv("MANUAL_RESEARCH_MAX_CALLS", "2");
    vi.stubEnv("MANUAL_RESEARCH_LEASE_MS", "90000");
    expect(await denial()).toMatchObject({ code: "RESEARCH_POLICY_CHANGED_SINCE_ADMISSION", retryable: false });
  });

  it("denies a manually admitted job once the manual channel is disabled", async () => {
    for (const [name, value] of Object.entries(manualEnv)) vi.stubEnv(name, value);
    vi.stubEnv("MANUAL_RESEARCH_EXECUTION_ENABLED", "false");
    arrange({});
    expect(await denial()).toMatchObject({ code: "MANUAL_RESEARCH_POLICY_DISABLED", retryable: false });
  });
});

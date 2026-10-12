import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  createAutomaticResearchExecutionHandler,
  ensureAutomaticResearchExecution,
} from "@/server/legal-research/automatic-research-job";
import { evaluateAutomaticResearchPolicy } from "@/server/legal-research/automatic-research-policy";
import { createResearchMission, RESEARCH_BRIDGE_VERSION } from "@/server/legal-research/bridge";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";

const mission = createResearchMission({
  kind: "RESEARCH_MISSION",
  version: RESEARCH_BRIDGE_VERSION,
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
      loadAuthority: vi.fn(async () => ({ mission, tenantId: "tenant-1", actorId: "actor-1", decision })),
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

  it("marks a lost trusted response terminal and never requests an automatic retry", async () => {
    const execute = vi.fn(async () => ({
      status: "RECOVERY_REQUIRED" as const,
      missionId: mission.missionId,
      executionId: "execution-uncertain",
      callsConsumed: 1,
      blockerCodes: ["SUBMIT_OUTCOME_UNCERTAIN"],
    }));
    const handler = createAutomaticResearchExecutionHandler({
      loadAuthority: vi.fn(async () => ({ mission, tenantId: "tenant-1", actorId: "actor-1", decision })),
      createProviderAdapters: vi.fn(async () => [{ capability: "SEMANTIC_DISCOVERY" } as never]),
      execute,
    });
    await expect(handler.execute(reference, context)).rejects.toEqual(
      new AsyncJobExecutionError("UNCERTAIN_OUTCOME", "SUBMIT_OUTCOME_UNCERTAIN", false),
    );
    expect(execute).toHaveBeenCalledOnce();
  });
});

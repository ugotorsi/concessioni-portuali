import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/lib/auth";
import type { CurrentTenantContext } from "@/lib/tenant-auth";
import type { FascicoloDocumentCorpus } from "@/server/queries/fascicolo-document-corpus";
import type { FascicoloAnalysisEvaluationPermit } from "@/server/ai/fascicoloAnalysisEvaluationRepository";
import {
  assertStagingFascicoloEvaluationMutationRequest,
  authorizeAndAdmitStagingFascicoloEvaluation,
  createStagingFascicoloEvaluationAnalyze,
  createStagingFascicoloEvaluationCsrfToken,
  runStagingFascicoloEvaluationOnce,
  STAGING_FASCICOLO_EVALUATION,
  StagingFascicoloEvaluationError,
  verifyStagingFascicoloEvaluationCsrfToken,
  type StagingFascicoloEvaluationDependencies,
  type StagingFascicoloEvaluationExecution,
  type StagingFascicoloEvaluationRunDependencies,
} from "@/server/ai/fascicoloAnalysisEvaluationStaging";

const actor: CurrentUser = {
  id: "admin-1",
  email: "admin@example.test",
  role: "ADMIN",
};
const tenantContext: CurrentTenantContext = {
  userId: actor.id,
  role: actor.role,
  isAdmin: true,
  tenantMemberships: [],
  defaultTenantId: null,
  accessibleTenantIds: [],
};
const environment = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: STAGING_FASCICOLO_EVALUATION.branch,
  NEXTAUTH_URL: STAGING_FASCICOLO_EVALUATION.origin,
};
const corpus = {
  tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
  procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
  corpusFingerprint: STAGING_FASCICOLO_EVALUATION.corpusFingerprint,
  availability: "READY",
  documentCount: 8,
  availableDocumentCount: 8,
  textPageCount: 8,
  documents: [],
  excerpts: [],
} as unknown as FascicoloDocumentCorpus;
const permit: FascicoloAnalysisEvaluationPermit = {
  permitRef: "permit-1",
  evaluationId: STAGING_FASCICOLO_EVALUATION.evaluationId,
  tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
  procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
  corpusFingerprint: STAGING_FASCICOLO_EVALUATION.corpusFingerprint,
  operation: "FASCICOLO.AUTOMATIC_ANALYSIS_EVALUATION_V1",
  testCaseId: "TEST-LEGAL-001",
  maxCostAmount: 0.5,
  authorizedByUserId: actor.id,
  expiresAt: new Date("2026-10-21T12:15:00Z"),
  consumedByJobId: null,
  consumedAt: null,
  revokedAt: null,
};
const job = {
  id: "job-1",
  operation: permit.operation,
  tenantId: permit.tenantId,
  procedimentoId: permit.procedimentoId,
  correlationId: `fascicolo-evaluation:${permit.evaluationId}`,
};

function dependencies(
  overrides: Partial<StagingFascicoloEvaluationDependencies> = {},
): StagingFascicoloEvaluationDependencies {
  return {
    getCurrentUser: vi.fn(async () => actor),
    getCurrentTenantContext: vi.fn(async () => tenantContext),
    loadCorpus: vi.fn(async () => corpus),
    loadPermitByEvaluationId: vi.fn(async () => null),
    loadJob: vi.fn(async () => job),
    authorize: vi.fn(async () => ({ outcome: "CREATED", permit })) as never,
    admit: vi.fn(async () => ({ outcome: "CREATED", job })) as never,
    now: () => new Date("2026-10-21T12:00:00Z"),
    ...overrides,
  };
}

describe("staging fascicolo evaluation admission", () => {
  it("is disabled outside the authorized Git Preview environment", async () => {
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: { ...environment, VERCEL_GIT_COMMIT_REF: "other-branch" },
      dependencies: dependencies(),
    })).rejects.toMatchObject({
      code: "STAGING_EVALUATION_ENVIRONMENT_DISABLED",
    });
  });

  it("rejects missing sessions and non-admin users", async () => {
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: dependencies({ getCurrentUser: vi.fn(async () => null) }),
    })).rejects.toMatchObject({
      code: "STAGING_EVALUATION_AUTHENTICATION_REQUIRED",
    });
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: dependencies({
        getCurrentUser: vi.fn(async () => ({ ...actor, role: "GIURIDICO" as const })),
      }),
    })).rejects.toMatchObject({
      code: "STAGING_EVALUATION_ADMIN_REQUIRED",
    });
  });

  it("rejects a tenant context outside the authorized tenant", async () => {
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: dependencies({
        getCurrentTenantContext: vi.fn(async () => ({
          ...tenantContext,
          isAdmin: false,
          accessibleTenantIds: ["other-tenant"],
        })),
      }),
    })).rejects.toMatchObject({
      code: "STAGING_EVALUATION_TENANT_FORBIDDEN",
    });
  });

  it.each([
    { availability: "PARTIAL" as const },
    { tenantId: "other-tenant" },
    { procedimentoId: "other-procedimento" },
    { corpusFingerprint: "0".repeat(64) },
  ])("rejects an unauthorized corpus projection: %o", async (change) => {
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: dependencies({
        loadCorpus: vi.fn(async () => ({ ...corpus, ...change })),
      }),
    })).rejects.toMatchObject({
      code: "STAGING_EVALUATION_CORPUS_NOT_READY",
    });
  });

  it("authorizes and admits one job without exposing a provider dependency", async () => {
    const deps = dependencies();
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: deps,
    })).resolves.toEqual({
      authorizationOutcome: "CREATED",
      admissionOutcome: "CREATED",
      permitRef: permit.permitRef,
      jobId: job.id,
    });
    expect(deps.authorize).toHaveBeenCalledWith(expect.objectContaining({
      evaluationId: STAGING_FASCICOLO_EVALUATION.evaluationId,
      tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
      procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
      corpusFingerprint: STAGING_FASCICOLO_EVALUATION.corpusFingerprint,
    }));
    expect(deps.admit).toHaveBeenCalledTimes(1);
  });

  it("returns the consumed job on repeat without authorizing or admitting again", async () => {
    const authorize = vi.fn();
    const admit = vi.fn();
    const deps = dependencies({
      loadPermitByEvaluationId: vi.fn(async () => ({
        ...permit,
        consumedByJobId: job.id,
        consumedAt: new Date("2026-10-21T12:01:00Z"),
      })),
      authorize: authorize as never,
      admit: admit as never,
    });
    await expect(authorizeAndAdmitStagingFascicoloEvaluation({
      env: environment,
      dependencies: deps,
    })).resolves.toMatchObject({
      authorizationOutcome: "REUSED",
      admissionOutcome: "REUSED",
      jobId: job.id,
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });
});

describe("staging fascicolo evaluation request security", () => {
  it("requires exact same-origin JSON and a matching signed CSRF token", () => {
    const token = createStagingFascicoloEvaluationCsrfToken({
      actorId: actor.id,
      secret: "test-secret",
      now: new Date("2026-10-21T12:00:00Z"),
    });
    const request = new Request(`${STAGING_FASCICOLO_EVALUATION.origin}/api/admin/fascicolo-analysis-evaluation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: STAGING_FASCICOLO_EVALUATION.origin,
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
    expect(() => assertStagingFascicoloEvaluationMutationRequest(request)).not.toThrow();
    expect(() => verifyStagingFascicoloEvaluationCsrfToken({
      actorId: actor.id,
      secret: "test-secret",
      headerToken: token,
      cookieToken: token,
      now: new Date("2026-10-21T12:05:00Z"),
    })).not.toThrow();
  });
});

    const execution: StagingFascicoloEvaluationExecution = {
      jobId: job.id,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: 1,
      tenantId: permit.tenantId,
      procedimentoId: permit.procedimentoId,
      operation: permit.operation,
      correlationId: job.correlationId,
      policyDecisionRef: permit.permitRef,
      permitRef: permit.permitRef,
      evaluationId: permit.evaluationId,
      corpusFingerprint: permit.corpusFingerprint,
      testCaseId: permit.testCaseId,
      maxCostAmount: permit.maxCostAmount,
      expiresAt: permit.expiresAt,
      consumedByJobId: job.id,
      revokedAt: null,
      artifactCount: 0,
      reservationCount: 0,
    };

    function runDependencies(
      overrides: Partial<StagingFascicoloEvaluationRunDependencies> = {},
    ): StagingFascicoloEvaluationRunDependencies {
      return {
        getAuthenticatedUser: vi.fn(async () => actor),
        getCurrentTenantContext: vi.fn(async () => tenantContext),
        loadExecution: vi.fn(async () => execution),
        loadCorpus: vi.fn(async () => corpus),
        hasBudgetHeadroom: vi.fn(async () => true),
        runJob: vi.fn(async () => ({ outcome: "SUCCEEDED" as const, jobId: job.id })),
        now: () => new Date("2026-10-21T12:00:00Z"),
        ...overrides,
      };
    }

    describe("staging fascicolo evaluation one-shot runner", () => {
      const analyze = vi.fn() as never;

      it("rejects an unauthenticated or non-admin request, including an invalid MFA session", async () => {
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            getAuthenticatedUser: vi.fn(async () => null),
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_AUTHENTICATION_REQUIRED" });
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            getAuthenticatedUser: vi.fn(async () => ({ ...actor, role: "GIURIDICO" as const })),
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_ADMIN_REQUIRED" });
      });

      it.each([
        { status: "RUNNING" },
        { attemptCount: 1 },
        { maxAttempts: 2 },
        { artifactCount: 1 },
        { reservationCount: 1 },
      ])("rejects an already-started or non-one-shot job: %o", async (change) => {
        const runJob = vi.fn();
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            loadExecution: vi.fn(async () => ({ ...execution, ...change })),
            runJob,
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_ALREADY_STARTED" });
        expect(runJob).not.toHaveBeenCalled();
      });

      it.each([
        { consumedByJobId: "other-job" },
        { revokedAt: new Date("2026-10-21T11:00:00Z") },
        { expiresAt: new Date("2026-10-21T11:59:59Z") },
        { corpusFingerprint: "0".repeat(64) },
        { maxCostAmount: 0.51 },
      ])("rejects an invalid permit or evaluation identity: %o", async (change) => {
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            loadExecution: vi.fn(async () => ({ ...execution, ...change })),
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_JOB_CONFLICT" });
      });

      it("rejects insufficient budget and a changed corpus before claiming the job", async () => {
        const runJob = vi.fn();
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            hasBudgetHeadroom: vi.fn(async () => false),
            runJob,
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_BUDGET_INSUFFICIENT" });
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            loadCorpus: vi.fn(async () => ({ ...corpus, documentCount: 7 })),
            runJob,
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_CORPUS_NOT_READY" });
        expect(runJob).not.toHaveBeenCalled();
      });

      it("runs only the exact admitted job and passes the invocation-scoped analyzer", async () => {
        const runJob = vi.fn(async () => ({ outcome: "SUCCEEDED" as const, jobId: job.id }));
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({ runJob }),
        })).resolves.toEqual({ outcome: "SUCCEEDED", jobId: job.id });
        expect(runJob).toHaveBeenCalledTimes(1);
        expect(runJob).toHaveBeenCalledWith({ jobId: job.id, analyze });
      });

      it("fails closed when a concurrent request loses the atomic claim", async () => {
        await expect(runStagingFascicoloEvaluationOnce({
          jobId: job.id,
          analyze,
          env: environment,
          dependencies: runDependencies({
            runJob: vi.fn(async () => ({ outcome: "IDLE" as const })),
          }),
        })).rejects.toMatchObject({ code: "STAGING_EVALUATION_ALREADY_STARTED" });
      });

      it("fails closed when provider secrets are missing or timeout exceeds the function margin", () => {
        expect(() => createStagingFascicoloEvaluationAnalyze({
          AI_OPENAI_TIMEOUT_MS: "45000",
        })).toThrowError(expect.objectContaining({
          code: "STAGING_EVALUATION_CONFIGURATION_INVALID",
        }));
        expect(() => createStagingFascicoloEvaluationAnalyze({
          AI_OPENAI_API_KEY: "test-key",
          AI_OPENAI_REGION: "EU",
          AI_OPENAI_TIMEOUT_MS: "91000",
          AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "100000",
          AI_OPENAI_MAX_OUTPUT_TOKENS: "1000",
          AI_MAX_INPUT_BYTES: "100000",
        })).toThrowError(expect.objectContaining({
          code: "STAGING_EVALUATION_TIMEOUT_UNSAFE",
        }));
      });

      it("creates a scoped analyzer without mutating global AI gates", () => {
        const previous = {
          enabled: process.env.AI_REAL_DATA_ENABLED,
          approval: process.env.AI_REAL_DATA_APPROVAL_ID,
          projectClass: process.env.AI_PROVIDER_PROJECT_CLASS,
        };
        expect(createStagingFascicoloEvaluationAnalyze({
          AI_OPENAI_API_KEY: "test-key",
          AI_OPENAI_REGION: "EU",
          AI_OPENAI_TIMEOUT_MS: "45000",
          AI_OPENAI_MAX_RAW_RESPONSE_BYTES: "100000",
          AI_OPENAI_MAX_OUTPUT_TOKENS: "1000",
          AI_MAX_INPUT_BYTES: "100000",
        })).toBeTypeOf("function");
        expect({
          enabled: process.env.AI_REAL_DATA_ENABLED,
          approval: process.env.AI_REAL_DATA_APPROVAL_ID,
          projectClass: process.env.AI_PROVIDER_PROJECT_CLASS,
        }).toEqual(previous);
      });
    });
describe("staging fascicolo evaluation request rejection", () => {
  it("rejects cross-origin requests and mismatched CSRF tokens", () => {
    const request = new Request(`${STAGING_FASCICOLO_EVALUATION.origin}/api/admin/fascicolo-analysis-evaluation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: "{}",
    });
    expect(() => assertStagingFascicoloEvaluationMutationRequest(request))
      .toThrow(StagingFascicoloEvaluationError);
    expect(() => verifyStagingFascicoloEvaluationCsrfToken({
      actorId: actor.id,
      secret: "test-secret",
      headerToken: "forged",
      cookieToken: "different",
    })).toThrow(StagingFascicoloEvaluationError);
  });
});

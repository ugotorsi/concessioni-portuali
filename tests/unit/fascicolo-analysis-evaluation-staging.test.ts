import { describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/lib/auth";
import type { CurrentTenantContext } from "@/lib/tenant-auth";
import type { FascicoloDocumentCorpus } from "@/server/queries/fascicolo-document-corpus";
import type { FascicoloAnalysisEvaluationPermit } from "@/server/ai/fascicoloAnalysisEvaluationRepository";
import {
  assertStagingFascicoloEvaluationMutationRequest,
  authorizeAndAdmitStagingFascicoloEvaluation,
  createStagingFascicoloEvaluationCsrfToken,
  STAGING_FASCICOLO_EVALUATION,
  StagingFascicoloEvaluationError,
  verifyStagingFascicoloEvaluationCsrfToken,
  type StagingFascicoloEvaluationDependencies,
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

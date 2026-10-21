import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { CurrentUser } from "@/lib/auth";
import {
  requireTenantAccess,
  type CurrentTenantContext,
} from "@/lib/tenant-auth";
import type { AsyncJob } from "@/generated/prisma/client";
import {
  admitFascicoloAnalysisEvaluation,
  authorizeFascicoloAnalysisEvaluation,
  FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR,
  FASCICOLO_ANALYSIS_EVALUATION_OPERATION,
  FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE,
} from "@/server/ai/fascicoloAnalysisEvaluation";
import type { FascicoloAnalysisEvaluationPermit } from "@/server/ai/fascicoloAnalysisEvaluationRepository";
import type { FascicoloDocumentCorpus } from "@/server/queries/fascicolo-document-corpus";

export const STAGING_FASCICOLO_EVALUATION = Object.freeze({
  evaluationId: "TEST-LEGAL-001",
  tenantId: "cmrzd08yp000dqwudd9dvaidl",
  procedimentoId: "procedimento-intake-b50fb05abbfb2ac80e675e92",
  corpusFingerprint: "816b8498ff891bba49ca7ab49f5fb6175f5655fa25c4a0bdfe14e197448efa0e",
  branch: "integration/noetra-staging-20261018",
  origin: "https://concessioni-portuali-demo-git-integra-36a0e7-ugotorsis-projects.vercel.app",
  permitTtlMs: 15 * 60 * 1_000,
});

export const STAGING_FASCICOLO_EVALUATION_CSRF_COOKIE =
  "__Host-noetra-fascicolo-evaluation-csrf";

export const stagingFascicoloEvaluationRequestSchema = z.object({
  action: z.literal("AUTHORIZE_AND_ADMIT"),
  confirmation: z.literal(FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE),
  csrfToken: z.string().min(1).max(2048),
}).strict();

type StagingEnvironment = Readonly<Record<string, string | undefined>>;

export class StagingFascicoloEvaluationError extends Error {
  constructor(readonly code:
    | "STAGING_EVALUATION_ENVIRONMENT_DISABLED"
    | "STAGING_EVALUATION_AUTHENTICATION_REQUIRED"
    | "STAGING_EVALUATION_ADMIN_REQUIRED"
    | "STAGING_EVALUATION_TENANT_FORBIDDEN"
    | "STAGING_EVALUATION_CORPUS_NOT_READY"
    | "STAGING_EVALUATION_PERMIT_CONFLICT"
    | "STAGING_EVALUATION_JOB_CONFLICT"
    | "STAGING_EVALUATION_CSRF_INVALID"
    | "STAGING_EVALUATION_ORIGIN_INVALID") {
    super(code);
    this.name = "StagingFascicoloEvaluationError";
  }
}

export function isAuthorizedStagingFascicoloEvaluationEnvironment(
  env: StagingEnvironment = process.env,
): boolean {
  let nextAuthOrigin: string | null = null;
  try {
    nextAuthOrigin = env.NEXTAUTH_URL ? new URL(env.NEXTAUTH_URL).origin : null;
  } catch {
    nextAuthOrigin = null;
  }
  return env.VERCEL_ENV === "preview"
    && env.VERCEL_GIT_COMMIT_REF === STAGING_FASCICOLO_EVALUATION.branch
    && nextAuthOrigin === STAGING_FASCICOLO_EVALUATION.origin;
}

export function assertAuthorizedStagingFascicoloEvaluationEnvironment(
  env: StagingEnvironment = process.env,
): void {
  if (!isAuthorizedStagingFascicoloEvaluationEnvironment(env)) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_ENVIRONMENT_DISABLED");
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createStagingFascicoloEvaluationCsrfToken(input: {
  actorId: string;
  secret: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const payload = Buffer.from(JSON.stringify({
    actorId: input.actorId,
    expiresAt: now.getTime() + 10 * 60 * 1_000,
    nonce: randomBytes(24).toString("hex"),
  })).toString("base64url");
  return `${payload}.${signature(payload, input.secret).toString("base64url")}`;
}

export function verifyStagingFascicoloEvaluationCsrfToken(input: {
  actorId: string;
  secret: string;
  headerToken: string | null;
  cookieToken: string | null;
  now?: Date;
}): void {
  if (!input.headerToken || !input.cookieToken || input.headerToken !== input.cookieToken) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
  }
  const [payload, encodedSignature, extra] = input.headerToken.split(".");
  if (!payload || !encodedSignature || extra) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
  }
  const actualSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signature(payload, input.secret);
  if (actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
  }
  const value = z.object({
    actorId: z.string().min(1),
    expiresAt: z.number().int(),
    nonce: z.string().regex(/^[0-9a-f]{48}$/),
  }).strict().safeParse(parsed);
  const now = (input.now ?? new Date()).getTime();
  if (!value.success || value.data.actorId !== input.actorId || value.data.expiresAt <= now) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CSRF_INVALID");
  }
}

export function assertStagingFascicoloEvaluationMutationRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!contentType.startsWith("application/json")
    || origin !== STAGING_FASCICOLO_EVALUATION.origin
    || (fetchSite !== null && fetchSite !== "same-origin")) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_ORIGIN_INVALID");
  }
}

function deterministicExpiry(now: Date): Date {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  return new Date(minute + STAGING_FASCICOLO_EVALUATION.permitTtlMs);
}

function assertPermitMatches(
  permit: FascicoloAnalysisEvaluationPermit,
  actor: CurrentUser,
): void {
  if (permit.evaluationId !== STAGING_FASCICOLO_EVALUATION.evaluationId
    || permit.tenantId !== STAGING_FASCICOLO_EVALUATION.tenantId
    || permit.procedimentoId !== STAGING_FASCICOLO_EVALUATION.procedimentoId
    || permit.corpusFingerprint !== STAGING_FASCICOLO_EVALUATION.corpusFingerprint
    || permit.operation !== FASCICOLO_ANALYSIS_EVALUATION_OPERATION
    || permit.testCaseId !== FASCICOLO_ANALYSIS_EVALUATION_TEST_CASE
    || permit.maxCostAmount !== FASCICOLO_ANALYSIS_EVALUATION_MAX_COST_EUR
    || permit.authorizedByUserId !== actor.id
    || permit.revokedAt) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_PERMIT_CONFLICT");
  }
}

function assertJobMatches(job: Pick<AsyncJob,
  "id" | "operation" | "tenantId" | "procedimentoId" | "correlationId"
>): void {
  if (job.operation !== FASCICOLO_ANALYSIS_EVALUATION_OPERATION
    || job.tenantId !== STAGING_FASCICOLO_EVALUATION.tenantId
    || job.procedimentoId !== STAGING_FASCICOLO_EVALUATION.procedimentoId
    || job.correlationId !== `fascicolo-evaluation:${STAGING_FASCICOLO_EVALUATION.evaluationId}`) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_JOB_CONFLICT");
  }
}

export interface StagingFascicoloEvaluationDependencies {
  getCurrentUser(): Promise<CurrentUser | null>;
  getCurrentTenantContext(): Promise<CurrentTenantContext | null>;
  loadCorpus(input: {
    tenantId: string;
    procedimentoId: string;
  }): Promise<FascicoloDocumentCorpus | null>;
  loadPermitByEvaluationId(evaluationId: string): Promise<FascicoloAnalysisEvaluationPermit | null>;
  loadJob(jobId: string): Promise<Pick<AsyncJob,
    "id" | "operation" | "tenantId" | "procedimentoId" | "correlationId"
  > | null>;
  authorize: typeof authorizeFascicoloAnalysisEvaluation;
  admit: typeof admitFascicoloAnalysisEvaluation;
  now(): Date;
}

export async function authorizeAndAdmitStagingFascicoloEvaluation(input: {
  env?: StagingEnvironment;
  dependencies: StagingFascicoloEvaluationDependencies;
}) {
  assertAuthorizedStagingFascicoloEvaluationEnvironment(input.env);
  const actor = await input.dependencies.getCurrentUser();
  if (!actor) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_AUTHENTICATION_REQUIRED");
  }
  if (actor.role !== "ADMIN") {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_ADMIN_REQUIRED");
  }
  const tenantContext = await input.dependencies.getCurrentTenantContext();
  if (!tenantContext) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_AUTHENTICATION_REQUIRED");
  }
  try {
    requireTenantAccess(tenantContext, STAGING_FASCICOLO_EVALUATION.tenantId, {
      mode: "write",
      allowWhenEnteMissing: false,
    });
  } catch {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_TENANT_FORBIDDEN");
  }
  const corpus = await input.dependencies.loadCorpus({
    tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
    procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
  });
  if (!corpus
    || corpus.tenantId !== STAGING_FASCICOLO_EVALUATION.tenantId
    || corpus.procedimentoId !== STAGING_FASCICOLO_EVALUATION.procedimentoId
    || corpus.availability !== "READY"
    || corpus.documentCount !== 8
    || corpus.availableDocumentCount !== 8
    || corpus.corpusFingerprint !== STAGING_FASCICOLO_EVALUATION.corpusFingerprint) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_CORPUS_NOT_READY");
  }

  let permit = await input.dependencies.loadPermitByEvaluationId(
    STAGING_FASCICOLO_EVALUATION.evaluationId,
  );
  let authorizationOutcome: "CREATED" | "REUSED" = "REUSED";
  if (!permit) {
    const authorization = await input.dependencies.authorize({
      evaluationId: STAGING_FASCICOLO_EVALUATION.evaluationId,
      tenantId: STAGING_FASCICOLO_EVALUATION.tenantId,
      procedimentoId: STAGING_FASCICOLO_EVALUATION.procedimentoId,
      corpusFingerprint: STAGING_FASCICOLO_EVALUATION.corpusFingerprint,
      expiresAt: deterministicExpiry(input.dependencies.now()),
    });
    permit = authorization.permit;
    authorizationOutcome = authorization.outcome;
  }
  assertPermitMatches(permit, actor);

  if (permit.consumedByJobId) {
    const job = await input.dependencies.loadJob(permit.consumedByJobId);
    if (!job) {
      throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_JOB_CONFLICT");
    }
    assertJobMatches(job);
    return {
      authorizationOutcome,
      admissionOutcome: "REUSED" as const,
      permitRef: permit.permitRef,
      jobId: job.id,
    };
  }
  if (permit.expiresAt <= input.dependencies.now()) {
    throw new StagingFascicoloEvaluationError("STAGING_EVALUATION_PERMIT_CONFLICT");
  }
  const admitted = await input.dependencies.admit({
    permitRef: permit.permitRef,
    evaluationId: permit.evaluationId,
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
  });
  assertJobMatches(admitted.job);
  return {
    authorizationOutcome,
    admissionOutcome: admitted.outcome,
    permitRef: permit.permitRef,
    jobId: admitted.job.id,
  };
}

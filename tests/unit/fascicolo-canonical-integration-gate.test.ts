import { describe, expect, it, vi } from "vitest";

import {
  CANONICAL_IDENTITY_V3_PREVIEW_BRANCH,
  CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID,
  CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID,
  isCanonicalIdentityV3Enabled,
  isCanonicalIdentityRevision,
  persistStructuredKnowledgeForConfiguredEngine,
} from "@/server/fascicolo-knowledge";

const input = {
  tenantId: "tenant-test",
  procedimentoId: "procedure-test",
  corpusFingerprint: "a".repeat(64),
  knowledge: {},
  evidenceByBasisRef: new Map(),
  sourceTextByBasisRef: new Map(),
};

describe("canonical identity V3 integration gate", () => {
  it("is disabled by default and remains disabled in production", () => {
    expect(isCanonicalIdentityV3Enabled({})).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID,
      VERCEL_GIT_COMMIT_REF: CANONICAL_IDENTITY_V3_PREVIEW_BRANCH,
      NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true",
    })).toBe(false);
  });

  it("is enabled for tests and only for the authorized Vercel Preview", () => {
    expect(isCanonicalIdentityV3Enabled({
      NODE_ENV: "test",
      NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true",
    })).toBe(true);
    const authorizedPreview = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_ID: CANONICAL_IDENTITY_V3_PREVIEW_PROJECT_ID,
      VERCEL_GIT_COMMIT_REF: CANONICAL_IDENTITY_V3_PREVIEW_BRANCH,
      NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true",
    };
    expect(isCanonicalIdentityV3Enabled(authorizedPreview)).toBe(true);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedPreview,
      VERCEL_PROJECT_ID: "prj_other",
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedPreview,
      VERCEL_GIT_COMMIT_REF: "other-branch",
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedPreview,
      VERCEL_ENV: undefined,
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedPreview,
      NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "false",
    })).toBe(false);
  });

  it("routes only an isolated one-shot worker targeting the V3 Preview database to canonical", async () => {
    const authorizedWorker = {
      NODE_ENV: "production",
      DATABASE_URL: `postgresql://role:secret@${CANONICAL_IDENTITY_V3_PREVIEW_DATABASE_ENDPOINT_ID}-pooler.c-9.us-east-1.aws.neon.tech/neondb`,
      NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true",
      ASYNC_WORKER_DEDICATED_MODE: "true",
      ASYNC_PROVIDER_EXECUTION_ENABLED: "true",
      ASYNC_WORKER_CONCURRENCY: "1",
      ASYNC_WORKER_MAX_PROCESSED_JOBS: "1",
      ASYNC_WORKER_EXIT_ON_IDLE: "true",
      ASYNC_WORKER_BOOTSTRAP_TIME_WATCHES: "false",
      ASYNC_WORKER_TARGET_JOB_ID: "analysis-job-only",
      ASYNC_WORKER_TARGET_TENANT_ID: "tenant-only",
      ASYNC_WORKER_OPERATION_ALLOWLIST: "FASCICOLO.AUTOMATIC_ANALYSIS_V1",
      ASYNC_WORKER_PROCEDIMENTO_ALLOWLIST: "procedure-test",
    };
    expect(isCanonicalIdentityV3Enabled(authorizedWorker)).toBe(true);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedWorker,
      DATABASE_URL: "postgresql://role:secret@other-endpoint.neon.tech/neondb",
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedWorker,
      ASYNC_WORKER_MAX_PROCESSED_JOBS: "2",
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedWorker,
      ASYNC_WORKER_OPERATION_ALLOWLIST: "FASCICOLO.AUTOMATIC_ANALYSIS_V1,OTHER",
    })).toBe(false);
    expect(isCanonicalIdentityV3Enabled({
      ...authorizedWorker,
      VERCEL_ENV: "preview",
    })).toBe(false);
    const legacy = vi.fn(async () => ({ engine: "legacy" })) as never;
    const canonical = vi.fn(async () => ({ engine: "canonical" })) as never;
    await expect(persistStructuredKnowledgeForConfiguredEngine(input, {
      environment: authorizedWorker,
      legacy,
      canonical,
    })).resolves.toEqual({ engine: "canonical" });
    expect(canonical).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("recognizes canonical revisions independently from the runtime gate", () => {
    expect(isCanonicalIdentityRevision({
      contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      items: [{ identityState: null }],
    })).toBe(false);
    expect(isCanonicalIdentityRevision({
      contractVersion: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1_CANONICAL_V3",
      items: [
        { identityState: "VERIFIED_NEW" },
        { identityState: "VERIFIED_CONTINUATION" },
        { identityState: "AMBIGUOUS" },
      ],
    })).toBe(true);
  });

  it("keeps the legacy path exclusive with the gate off", async () => {
    const legacy = vi.fn(async () => ({ engine: "legacy" })) as never;
    const canonical = vi.fn(async () => ({ engine: "canonical" })) as never;
    await expect(persistStructuredKnowledgeForConfiguredEngine(input, {
      environment: { NODE_ENV: "test" },
      legacy,
      canonical,
    })).resolves.toEqual({ engine: "legacy" });
    expect(legacy).toHaveBeenCalledOnce();
    expect(canonical).not.toHaveBeenCalled();
  });

  it("uses only V3 with the gate on and never falls back after an error", async () => {
    const failure = new Error("CANONICAL_FAILURE");
    const legacy = vi.fn(async () => ({ engine: "legacy" })) as never;
    const canonical = vi.fn(async () => {
      throw failure;
    }) as never;
    await expect(persistStructuredKnowledgeForConfiguredEngine(input, {
      environment: {
        NODE_ENV: "test",
        NOETRA_CANONICAL_IDENTITY_V3_ENABLED: "true",
      },
      legacy,
      canonical,
    })).rejects.toBe(failure);
    expect(canonical).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });
});

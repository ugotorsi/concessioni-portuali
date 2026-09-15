import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  tx: {
    asyncJob: { findUnique: vi.fn(), create: vi.fn() },
    legalReferenceMention: { findUnique: vi.fn() },
    legalReferenceOfficialLookup: { findUnique: vi.fn(), create: vi.fn() },
    legalReferenceMatch: { update: vi.fn(), updateMany: vi.fn() },
    legalSource: { create: vi.fn(), upsert: vi.fn() },
    legalSourceIdentityAssertion: { create: vi.fn(), upsert: vi.fn() },
    legalSourceCandidateResolution: { create: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runTransaction,
}));

import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { normalizeAsyncJobAdmission } from "@/server/async-jobs/domain";
import {
  buildLegalReferenceOfficialLookupAdmission,
  createLegalReferenceOfficialLookupHandler,
  LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
  officialLookupLogicalOperationId,
} from "@/server/intake/neutralIntakeLegalReferenceOfficialLookupJob";
import {
  buildNormattivaQuery,
  NORMATTIVA_LOOKUP_VERSION,
  NORMATTIVA_PROVIDER,
} from "@/server/intake/official-source-lookup/normattiva";
import {
  OfficialLegalReferenceProviderError,
  OfficialLegalReferenceProviderRegistry,
} from "@/server/intake/official-source-lookup/providers";

const providerIdentity = {
  providerKey: NORMATTIVA_PROVIDER,
  lookupVersion: NORMATTIVA_LOOKUP_VERSION,
};

function testRegistry(lookup: ReturnType<typeof vi.fn>) {
  return new OfficialLegalReferenceProviderRegistry([{
    ...providerIdentity,
    supports: (reference) => buildNormattivaQuery(reference) !== null,
    lookup,
  }]);
}

const provenance = {
  tenantId: "ente-1",
  admissionType: "AUTHORIZED_SYSTEM" as const,
  initiatingUserId: null,
  actorId: "worker-1",
  actorEmail: null,
  actorRole: "SYSTEM",
  policyDecisionRef: "LOCAL_MATCHING_V1",
  correlationId: "correlation-1",
};

function mention(overrides: Record<string, unknown> = {}) {
  return {
    id: "mention-1",
    kind: "LEGISLATION",
    actType: "LEGGE",
    actNumber: "241",
    year: 1990,
    extractionAttempt: { neutralIntake: { enteId: "ente-1" } },
    matches: [{ status: "NO_MATCH", reason: "NO_CATALOG_MATCH" }],
    ...overrides,
  };
}

const context = {
  jobId: "lookup-job-1",
  correlationId: "correlation-1",
  attempt: 1,
  isCancellationRequested: vi.fn(async () => false),
  heartbeat: vi.fn(async () => undefined),
};

describe("B2C12 Block 3B.6C official lookup job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-1", providerIdentity),
      tenantId: "ente-1",
    });
    mocks.tx.legalReferenceMention.findUnique.mockResolvedValue(mention());
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(null);
    mocks.tx.legalReferenceOfficialLookup.create.mockImplementation(async ({ data }) => ({
      id: "lookup-1",
      status: data.status,
      resultCount: data.resultCount,
    }));
  });

  it("registers on the existing async core and builds deterministic admission", () => {
    expect(applicationAsyncJobRegistry.resolve(LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION)).not.toBeNull();
    const first = normalizeAsyncJobAdmission(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance));
    const retry = normalizeAsyncJobAdmission(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance));
    expect(first.idempotencyKey).toBe(retry.idempotencyKey);
    expect(first.inputReference).toEqual({
      referenceType: "LEGAL_REFERENCE_OFFICIAL_LOOKUP",
      referenceId: "mention-1",
      referenceVersion: "V1",
      metadata: { providerCode: NORMATTIVA_PROVIDER, lookupVersion: NORMATTIVA_LOOKUP_VERSION },
    });
  });

  it("persists one bounded unique result without mutating local matching or sources", async () => {
    const lookup = vi.fn(async () => ({
      status: "FOUND_UNIQUE" as const,
      resultCount: 1 as const,
      hits: [{
        providerRecordId: "090G0291",
        sourceType: "LEGGE",
        actNumber: "241",
        actYear: 1990,
        issuedAt: new Date("1990-08-07"),
        description: null,
        title: "Procedimento amministrativo",
        publicationNumber: null,
        publishedAt: null,
      }] as const,
    }));
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .resolves.toMatchObject({ metadata: { status: "FOUND_UNIQUE", resultCount: 1, reused: false } });
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
      id: "mention-1", actType: "LEGGE", actNumber: "241", year: 1990,
    }));
    expect(mocks.tx.legalReferenceOfficialLookup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mentionId: "mention-1", status: "FOUND_UNIQUE", resultCount: 1 }),
    }));
    expect(mocks.tx.legalReferenceMatch.update).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceIdentityAssertion.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ matches: [{ status: "MATCHED", reason: "EXACT_IDENTITY" }] }, "matched"],
    [{ matches: [{ status: "AMBIGUOUS", reason: "MULTIPLE_EXACT_MATCHES" }] }, "ambiguous"],
    [{ matches: [{ status: "NO_MATCH", reason: "INSUFFICIENT_IDENTITY" }] }, "insufficient"],
    [{ kind: "CASE_LAW", actType: null }, "case law"],
    [{ actType: "LEGGE_REGIONALE" }, "regional law"],
  ])("fails closed before provider access for %s", async (overrides) => {
    mocks.tx.legalReferenceMention.findUnique.mockResolvedValue(mention(overrides));
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .rejects.toMatchObject({ retryable: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reuses persisted lookup without another provider call", async () => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue({
      id: "lookup-1",
      status: "NOT_FOUND",
      resultCount: 0,
    });
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .resolves.toMatchObject({ metadata: { reused: true, status: "NOT_FOUND" } });
    expect(lookup).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialLookup.create).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-tenant", () => mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-1", providerIdentity),
      tenantId: "ente-2",
    })],
    ["mismatched mention/job", () => mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-2", providerIdentity),
      tenantId: "ente-1",
    })],
  ])("denies %s authority before existing-result reuse", async (_label, arrange) => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue({ id: "lookup-1", status: "NOT_FOUND", resultCount: 0 });
    arrange();
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(
      buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference,
    ), context)).rejects.toMatchObject({ code: "OFFICIAL_LOOKUP_AUTHORITY_MISMATCH", retryable: false });
    expect(mocks.tx.legalReferenceOfficialLookup.findUnique).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("denies an unregistered provider/version before existing-result reuse", async () => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue({ id: "lookup-1", status: "NOT_FOUND", resultCount: 0 });
    const unknownIdentity = { providerKey: "SIMPLICITER_MCP_V1", lookupVersion: "SIMPLICITER_LOOKUP_V1" };
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-1", unknownIdentity),
      tenantId: "ente-1",
    });
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(
      buildLegalReferenceOfficialLookupAdmission("mention-1", unknownIdentity, provenance).inputReference,
    ), context)).rejects.toMatchObject({ code: "OFFICIAL_LOOKUP_AUTHORITY_MISMATCH", retryable: false });
    expect(mocks.tx.legalReferenceOfficialLookup.findUnique).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("maps provider retry policy onto the existing async failure contract", async () => {
    const lookup = vi.fn(async () => {
      throw new OfficialLegalReferenceProviderError(NORMATTIVA_PROVIDER, "RATE_LIMITED", true);
    });
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup));
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .rejects.toMatchObject({ code: `${NORMATTIVA_PROVIDER}_RATE_LIMITED`, retryable: true });
  });

  it("contains no AI, source mutation, human resolution, or raw response persistence path", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/server/intake/neutralIntakeLegalReferenceOfficialLookupJob.ts", "utf8"));
    expect(source).not.toMatch(/openai|anthropic|embedding|rawResponse|rawHtml/i);
    expect(source).not.toMatch(/legalSource\.(create|upsert)|legalSourceIdentityAssertion\.(create|upsert)|legalSourceCandidateResolution\.(create|upsert)/i);
  });
});
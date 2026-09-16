import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  admitReconciliation: vi.fn(),
  tx: {
    asyncJob: { findUnique: vi.fn(), create: vi.fn() },
    legalReferenceMention: { findUnique: vi.fn() },
    legalReferenceOfficialLookup: { findUnique: vi.fn(), create: vi.fn() },
    legalReferenceMatch: { update: vi.fn(), updateMany: vi.fn() },
    legalSource: { create: vi.fn(), upsert: vi.fn() },
    legalSourceIdentityAssertion: { create: vi.fn(), upsert: vi.fn() },
    legalSourceCandidateResolution: { create: vi.fn(), upsert: vi.fn() },
    legalExpressionVersion: { create: vi.fn() },
    legalSourceVersion: { create: vi.fn() },
    legalSourceAcquisition: { create: vi.fn() },
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
  createLegalDataHunterProvider,
  LEGAL_DATA_HUNTER_LOOKUP_VERSION,
  LEGAL_DATA_HUNTER_PROVIDER,
} from "@/server/intake/official-source-lookup/legalDataHunter";
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

async function lookupLdhDuplicates(documents: Record<string, unknown>[]) {
  const responses = [
    new Response(JSON.stringify({ country: "IT", sources: [{
      source_id: "IT/TAR-Campania", data_types: ["case_law"],
      court_name: "TAR Campania Napoli", document_count: documents.length,
    }] }), { headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ match_type: "exact", documents }), {
      headers: { "Content-Type": "application/json" },
    }),
  ];
  const provider = createLegalDataHunterProvider({
    apiKey: "test-key",
    transport: vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })),
  });
  return provider.lookup({
    kind: "CASE_LAW", authorityHint: "TAR CAMPANIA NAPOLI", actType: null,
    actNumber: "500", year: 2025, chamberSection: null,
  });
}

const ldhDuplicate = {
  source: "IT/TAR-Campania", source_id: "tar-500", authority: "TAR",
  court: "TAR Campania Napoli", decision_number: "500", year: 2025,
  decision_type: "SENTENZA", chamber: "I", ecli: "ECLI:IT:TARNA:2025:500",
  title: "TAR Campania Napoli n. 500/2025",
};

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
      ...provenance,
    });
    mocks.tx.legalReferenceMention.findUnique.mockResolvedValue(mention());
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(null);
    mocks.tx.legalReferenceOfficialLookup.create.mockImplementation(async ({ data }) => ({
      id: "lookup-1",
      status: data.status,
      resultCount: data.resultCount,
    }));
    mocks.admitReconciliation.mockResolvedValue({ outcome: "CREATED" });
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
        documentKind: "LEGISLATION" as const,
        providerRecordId: "090G0291",
        providerSourceId: NORMATTIVA_PROVIDER,
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
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .resolves.toMatchObject({ metadata: { status: "FOUND_UNIQUE", resultCount: 1, reused: false } });
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
      id: "mention-1", actType: "LEGGE", actNumber: "241", year: 1990,
    }));
    expect(mocks.tx.legalReferenceOfficialLookup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mentionId: "mention-1", status: "FOUND_UNIQUE", resultCount: 1 }),
    }));
    expect(mocks.admitReconciliation).toHaveBeenCalledWith(
      mocks.tx,
      "lookup-1",
      provenance,
    );
    expect(mocks.tx.legalReferenceMatch.update).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceIdentityAssertion.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceCandidateResolution.create).not.toHaveBeenCalled();
  });

  it("persists provider-neutral case-law identity in the existing hit family", async () => {
    const identity = {
      providerKey: LEGAL_DATA_HUNTER_PROVIDER,
      lookupVersion: LEGAL_DATA_HUNTER_LOOKUP_VERSION,
    };
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-1", identity),
      ...provenance,
    });
    mocks.tx.legalReferenceMention.findUnique.mockResolvedValue(mention({
      kind: "CASE_LAW",
      authorityHint: "CASSAZIONE",
      actType: null,
      actNumber: "1234",
      year: 2024,
      chamberSection: "III",
    }));
    const lookup = vi.fn(async () => ({
      status: "FOUND_UNIQUE" as const,
      resultCount: 1 as const,
      hits: [{
        documentKind: "CASE_LAW" as const,
        providerRecordId: "decision-1234",
        providerSourceId: "IT/Cassazione",
        authority: "CASSAZIONE",
        court: "Corte Suprema di Cassazione",
        decisionNumber: "1234",
        decisionYear: 2024,
        decidedAt: new Date("2024-03-15"),
        chamberSection: "III",
        decisionType: "SENTENZA",
        ecli: "ECLI:IT:CASS:2024:1234",
        publicationDate: new Date("2024-03-16"),
        subject: "Concessione portuale",
        outcome: "Rigetto",
        title: "Cassazione n. 1234/2024",
        sourceUrl: "https://example.test/decision-1234",
      }] as const,
    }));
    const registry = new OfficialLegalReferenceProviderRegistry([{
      ...identity,
      supports: (reference) => reference.kind === "CASE_LAW",
      lookup,
    }]);
    const handler = createLegalReferenceOfficialLookupHandler(registry, mocks.admitReconciliation);

    await expect(handler.execute(handler.parseInput(
      buildLegalReferenceOfficialLookupAdmission("mention-1", identity, provenance).inputReference,
    ), context)).resolves.toMatchObject({ metadata: { status: "FOUND_UNIQUE", resultCount: 1 } });

    expect(mocks.tx.legalReferenceOfficialLookup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: LEGAL_DATA_HUNTER_PROVIDER,
        hits: { create: [expect.objectContaining({
          documentKind: "CASE_LAW",
          providerSourceId: "IT/Cassazione",
          providerRecordId: "decision-1234",
          authority: "CASSAZIONE",
          court: "Corte Suprema di Cassazione",
          decisionNumber: "1234",
          decisionYear: 2024,
          chamberSection: "III",
          ecli: "ECLI:IT:CASS:2024:1234",
          publicationDate: new Date("2024-03-16"),
          subject: "Concessione portuale",
          outcome: "Rigetto",
        })] },
      }),
    }));
    const persistedHit = mocks.tx.legalReferenceOfficialLookup.create.mock.calls.at(-1)?.[0].data.hits.create[0];
    expect(persistedHit).not.toHaveProperty("denominazioneAtto");
    expect(persistedHit).not.toHaveProperty("numeroProvvedimento");
    expect(persistedHit).not.toHaveProperty("annoProvvedimento");
    expect(mocks.tx.legalExpressionVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSourceAcquisition.create).not.toHaveBeenCalled();
  });

  it("matches a precise provider court even when provider authority is generic TAR", async () => {
    const responses = [
      new Response(JSON.stringify({ country: "IT", sources: [{
        source_id: "IT/TAR-Lazio", data_types: ["case_law"],
        court_name: "TAR Lazio Roma", document_count: 1,
      }] }), { headers: { "Content-Type": "application/json" } }),
      new Response(JSON.stringify({ match_type: "exact", documents: [{
        source: "IT/TAR-Lazio", source_id: "tar-500", authority: "TAR",
        court: "TAR Lazio Roma", decision_number: "500", year: 2025,
        decision_type: "SENTENZA", title: "TAR Lazio Roma n. 500/2025",
      }] }), { headers: { "Content-Type": "application/json" } }),
    ];
    const provider = createLegalDataHunterProvider({
      apiKey: "test-key",
      transport: vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 })),
    });
    await expect(provider.lookup({
      kind: "CASE_LAW", authorityHint: "TAR LAZIO ROMA", actType: null,
      actNumber: "500", year: 2025, chamberSection: null,
    })).resolves.toMatchObject({
      status: "FOUND_UNIQUE",
      hits: [{ authority: "TAR", court: "TAR Lazio Roma" }],
    });
  });

  it.each([
    ["ECLI", { ecli: "ECLI:IT:TARSA:2025:500" }],
    ["court locality", { court: "TAR Campania Salerno" }],
    ["decision type", { decision_type: "ORDINANZA" }],
    ["section", { chamber: "II" }],
  ])("fails closed for duplicate LDH records with contradictory %s", async (_label, conflicting) => {
    await expect(lookupLdhDuplicates([
      ldhDuplicate,
      { ...ldhDuplicate, ...conflicting },
    ])).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_CONFLICT", retryable: false });
    await expect(lookupLdhDuplicates([
      { ...ldhDuplicate, ...conflicting },
      ldhDuplicate,
    ])).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_CONFLICT", retryable: false });
  });

  it("collapses compatible LDH duplicates independently of non-identity metadata and ordering", async () => {
    const variants = [
      ldhDuplicate,
      { ...ldhDuplicate, title: "Alternate title", outcome: "Accoglimento" },
    ];
    const forward = await lookupLdhDuplicates(variants);
    const reverse = await lookupLdhDuplicates([...variants].reverse());
    expect(forward).toMatchObject({ status: "FOUND_UNIQUE", resultCount: 1 });
    expect(reverse).toEqual(forward);
  });

  it("collapses an identical LDH duplicate with the same ECLI and branch", async () => {
    await expect(lookupLdhDuplicates([ldhDuplicate, { ...ldhDuplicate }])).resolves.toMatchObject({
      status: "FOUND_UNIQUE", resultCount: 1,
      hits: [{ ecli: "ECLI:IT:TARNA:2025:500", court: "TAR Campania Napoli" }],
    });
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
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
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
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
    await expect(handler.execute(handler.parseInput(buildLegalReferenceOfficialLookupAdmission("mention-1", providerIdentity, provenance).inputReference), context))
      .resolves.toMatchObject({ metadata: { reused: true, status: "NOT_FOUND" } });
    expect(lookup).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialLookup.create).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-tenant", () => mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-1", providerIdentity),
      ...provenance,
      tenantId: "ente-2",
    })],
    ["mismatched mention/job", () => mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_LOOKUP_OPERATION,
      logicalOperationId: officialLookupLogicalOperationId("mention-2", providerIdentity),
      ...provenance,
    })],
  ])("denies %s authority before existing-result reuse", async (_label, arrange) => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue({ id: "lookup-1", status: "NOT_FOUND", resultCount: 0 });
    arrange();
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
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
      ...provenance,
    });
    const lookup = vi.fn();
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
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
    const handler = createLegalReferenceOfficialLookupHandler(testRegistry(lookup), mocks.admitReconciliation);
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
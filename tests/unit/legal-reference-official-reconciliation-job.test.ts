import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildLegalReferenceOfficialReconciliationAdmission,
  createLegalReferenceOfficialReconciliationHandler,
  LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
  LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION,
  isOfficialReconciliationRetryableP2002,
  reconcileOfficialLookupInTransaction,
} from "@/server/intake/neutralIntakeLegalReferenceOfficialReconciliationJob";
import { applicationAsyncJobRegistry } from "@/server/async-jobs/applicationWorker";
import { NORMATTIVA_PROVIDER } from "@/server/intake/official-source-lookup/normattiva";
import { buildOfficialHitIdentityV1 } from "@/server/intake/official-hit-reconciliation/identity";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  tx: {
    asyncJob: { findUnique: vi.fn() },
    legalReferenceOfficialLookup: { findUnique: vi.fn() },
    legalSource: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    legalReferenceOfficialReconciliation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    legalReferenceOfficialReconciliationEvidence: { create: vi.fn(), findMany: vi.fn() },
    legalReferenceMatch: { createMany: vi.fn() },
  },
}));

vi.mock("@/server/db/serializableTransaction", () => ({
  runSerializableTransactionWithRetry: mocks.runTransaction,
}));

const provenance = {
  tenantId: "ente-1",
  admissionType: "AUTHORIZED_SYSTEM" as const,
  initiatingUserId: null,
  actorId: "worker-1",
  actorEmail: null,
  actorRole: "SYSTEM",
  policyDecisionRef: "OFFICIAL_LOOKUP_V1",
  correlationId: "correlation-1",
};

const completedAt = new Date("2026-09-16T10:00:00.000Z");
const validStoredIdentity = {
  identityVersion: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
  normalizedIdentity: {
    kind: "LEGISLATION", jurisdiction: "IT", actType: "LEGGE", actNumber: "241", year: 1990,
  },
  identityFingerprint: "1268cdbb8375a1ac7980582baf2e42845f6776aa53f546b68d131bbdfcc898fa",
};

function legislationHit(overrides: Record<string, unknown> = {}) {
  return {
    id: "hit-1",
    documentKind: "LEGISLATION",
    providerSourceId: "NORMATTIVA",
    providerRecordId: "090G0291",
    denominazioneAtto: "LEGGE",
    numeroProvvedimento: "241",
    annoProvvedimento: 1990,
    dataEmanazione: new Date("1990-08-07"),
    titoloAtto: "Procedimento amministrativo",
    authority: null,
    decisionNumber: null,
    decisionYear: null,
    decisionDate: null,
    chamberSection: null,
    sourceUrl: null,
    reconciliationEvidence: [],
    ...overrides,
  };
}

function caseLawHit(overrides: Record<string, unknown> = {}) {
  return {
    id: "hit-case-1", documentKind: "CASE_LAW", providerSourceId: "GA",
    providerRecordId: "decision-500", denominazioneAtto: null, numeroProvvedimento: null,
    annoProvvedimento: null, dataEmanazione: null, titoloAtto: "TAR decision",
    authority: "TAR", court: "TAR Campania Salerno", decisionNumber: "500",
    decisionYear: 2025, decisionDate: new Date("2025-02-01"), chamberSection: "I",
    decisionType: "SENTENZA", ecli: "ECLI:IT:TARSA:2025:500",
    publicationDate: new Date("2025-02-02"), sourceUrl: null,
    reconciliationEvidence: [], ...overrides,
  };
}

function lookup(overrides: Record<string, unknown> = {}) {
  return {
    id: "lookup-1",
    provider: NORMATTIVA_PROVIDER,
    lookupVersion: "NORMATTIVA_V1",
    status: "FOUND_UNIQUE",
    resultCount: 1,
    completedAt,
    mention: {
      id: "mention-1",
      kind: "LEGISLATION",
      extractionAttempt: { neutralIntake: { enteId: "ente-1" } },
    },
    hits: [legislationHit()],
    ...overrides,
  };
}

const tx = mocks.tx as unknown as Prisma.TransactionClient;

describe("B2C14 Block 3B.8B official-hit reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTransaction.mockImplementation(async (callback) => callback(mocks.tx));
    const admission = buildLegalReferenceOfficialReconciliationAdmission("lookup-1", provenance);
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
      logicalOperationId: admission.logicalOperationId,
      tenantId: "ente-1",
    });
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup());
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(null);
    mocks.tx.legalSource.findUnique.mockResolvedValue(null);
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-1",
      revision: 0,
      legalSourceId: null,
      ...create,
    }));
    mocks.tx.legalReferenceOfficialReconciliation.create.mockImplementation(async ({ data }) => ({
      id: "reconciliation-incomplete",
      revision: 0,
      legalSourceId: null,
      ...data,
    }));
    mocks.tx.legalReferenceOfficialReconciliation.update.mockImplementation(async ({ data }) => ({
      id: "reconciliation-1",
      kind: "LEGISLATION",
      identityFingerprint: "fingerprint",
      normalizedIdentity: {},
      legalSourceId: data.legalSourceId ?? null,
      state: data.state,
    }));
    mocks.tx.legalReferenceOfficialReconciliationEvidence.create.mockResolvedValue({ id: "evidence-1" });
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([]);
    mocks.tx.legalReferenceMatch.createMany.mockResolvedValue({ count: 1 });
  });

  it("keeps a complete new identity pending without creating canonical truth", async () => {
    await expect(reconcileOfficialLookupInTransaction(tx, {
      jobId: "job-1",
      lookupId: "lookup-1",
    })).resolves.toEqual({ reconciliationId: "reconciliation-1", reused: false });

    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ state: "PENDING_REVIEW", legalSourceId: null }),
      update: {},
    }));
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disposition: "COMPATIBLE", officialHitId: "hit-1" }),
    });
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("reuses an exact global canonical source and appends a V2 match", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-1",
      identityAssertions: [{
        normalizedValue: "1268cdbb8375a1ac7980582baf2e42845f6776aa53f546b68d131bbdfcc898fa",
      }],
    });
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-1",
      revision: 0,
      ...create,
    }));

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ state: "LINKED_EXISTING", legalSourceId: "source-1" }),
    }));
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith({
      data: [{
        mentionId: "mention-1",
        matchingVersion: LEGAL_REFERENCE_RECONCILED_MATCHING_VERSION,
        status: "MATCHED",
        reason: "EXACT_IDENTITY",
        legalSourceId: "source-1",
        candidateCount: 1,
      }],
      skipDuplicates: true,
    });
  });

  it("does not auto-link a canonical-key match without a verified V2 assertion", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({ id: "source-unverified", identityAssertions: [] });

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: "PENDING_REVIEW", legalSourceId: null }) }),
    );
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("reuses evidence idempotently without another write", async () => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      hits: [legislationHit({
        reconciliationEvidence: [{
          reconciliationId: "reconciliation-existing",
          reconciliation: validStoredIdentity,
        }],
      })],
    }));

    await expect(reconcileOfficialLookupInTransaction(tx, {
      jobId: "job-1",
      lookupId: "lookup-1",
    })).resolves.toEqual({ reconciliationId: "reconciliation-existing", reused: true });
    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).not.toHaveBeenCalled();
  });

  it.each([
    ["tampered normalized identity", {
      ...validStoredIdentity,
      normalizedIdentity: { ...validStoredIdentity.normalizedIdentity, year: 1991 },
    }],
    ["mismatched fingerprint", { ...validStoredIdentity, identityFingerprint: "f".repeat(64) }],
    ["unsupported version", { ...validStoredIdentity, identityVersion: "UNSUPPORTED_V3" }],
  ])("fails closed for automatic reuse with %s", async (_label, reconciliation) => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      hits: [legislationHit({
        reconciliationEvidence: [{ reconciliationId: "reconciliation-existing", reconciliation }],
      })],
    }));
    await expect(reconcileOfficialLookupInTransaction(tx, {
      jobId: "job-1", lookupId: "lookup-1",
    })).rejects.toMatchObject({ code: "OFFICIAL_RECONCILIATION_IDENTITY_INTEGRITY_FAILED" });
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("verifies a valid stored Identity V2 before automatic source resolution", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue({
      ...validStoredIdentity, state: "PENDING_REVIEW",
    });
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockResolvedValue({
      id: "reconciliation-existing", revision: 2, legalSourceId: null,
      kind: "LEGISLATION", state: "PENDING_REVIEW", ...validStoredIdentity,
    });
    await expect(reconcileOfficialLookupInTransaction(tx, {
      jobId: "job-1", lookupId: "lookup-1",
    })).resolves.toEqual({ reconciliationId: "reconciliation-existing", reused: false });
    expect(mocks.tx.legalSource.findUnique).toHaveBeenCalledOnce();
  });

  it("keeps an incomplete stored identity away from canonical auto-linking", async () => {
    const incomplete = {
      identityVersion: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
      normalizedIdentity: {
        kind: "LEGISLATION", jurisdiction: "IT", actType: "LEGGE", actNumber: null, year: 1990,
      },
      identityFingerprint: null,
      state: "INCOMPLETE",
    };
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(incomplete);
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockResolvedValue({
      id: "reconciliation-incomplete", revision: 1, legalSourceId: null,
      kind: "LEGISLATION", ...incomplete,
    });
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalSource.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ legalSourceId: null }) }),
    );
  });

  it("isolates incomplete evidence in a distinct reconciliation", async () => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      hits: [legislationHit({ numeroProvvedimento: null })],
    }));

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ state: "INCOMPLETE", identityFingerprint: null }),
        update: {},
      }),
    );
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reconciliationId: "reconciliation-1",
        disposition: "INCOMPLETE",
      }),
    });
  });

  it("enriches missing fields on the same mention without provider voting", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockResolvedValue({
      id: "reconciliation-existing",
      mentionId: "mention-1",
      kind: "LEGISLATION",
      state: "INCOMPLETE",
      revision: 1,
      legalSourceId: null,
      identityVersion: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
      identityFingerprint: null,
      normalizedIdentity: {
        kind: "LEGISLATION", jurisdiction: "IT", actType: "LEGGE", actNumber: null, year: 1990,
      },
    });

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-existing" },
      data: expect.objectContaining({
        identityFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        state: "PENDING_REVIEW",
        revision: { increment: 1 },
      }),
    });
  });

  it("converges complete identities and tolerates JSONB key reordering", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-existing",
      revision: 1,
      ...create,
      normalizedIdentity: Object.fromEntries(Object.entries(create.normalizedIdentity).reverse()),
    }));

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    const upsert = mocks.tx.legalReferenceOfficialReconciliation.upsert.mock.calls[0][0];
    expect(upsert.where.mentionId_identityVersion).toEqual({
      mentionId: "mention-1",
      identityVersion: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
    });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).not.toHaveBeenCalled();
  });

  it("keeps identical provider identities isolated by mention resolution scope", async () => {
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      mention: {
        id: "mention-2",
        kind: "LEGISLATION",
        extractionAttempt: { neutralIntake: { enteId: "ente-1" } },
      },
    }));
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert.mock.calls.map(
      ([input]) => input.where.mentionId_identityVersion.mentionId,
    )).toEqual(["mention-1", "mention-2"]);
  });

  it("fails closed and records conflicting identity evidence", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-existing",
      revision: 2,
      legalSourceId: null,
      ...create,
    }));
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([{
      classification: "OFFICIAL_AUTHORITY",
      evidenceFingerprint: "prior",
      officialHit: legislationHit({ numeroProvvedimento: "999" }),
    }]);

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-existing" },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disposition: "CONFLICTING" }),
    });
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("links a pending candidate when its canonical source appears concurrently", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-concurrent",
      identityAssertions: [{
        normalizedValue: "1268cdbb8375a1ac7980582baf2e42845f6776aa53f546b68d131bbdfcc898fa",
      }],
    });
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-existing",
      revision: 3,
      ...create,
      state: "PENDING_REVIEW",
      legalSourceId: null,
    }));
    mocks.tx.legalReferenceOfficialReconciliation.update.mockImplementation(async ({ data }) => ({
      id: "reconciliation-existing",
      revision: 4,
      kind: "LEGISLATION",
      identityFingerprint: "fingerprint",
      normalizedIdentity: {},
      state: data.state,
      legalSourceId: data.legalSourceId,
    }));

    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });

    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-existing" },
      data: {
        state: "LINKED_EXISTING",
        legalSourceId: "source-concurrent",
        revision: { increment: 1 },
      },
    });
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ legalSourceId: "source-concurrent" })],
    }));
  });

  it("rejects cross-tenant authority before reconciliation writes", async () => {
    mocks.tx.asyncJob.findUnique.mockResolvedValue({
      operation: LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION,
      logicalOperationId: buildLegalReferenceOfficialReconciliationAdmission("lookup-1", provenance).logicalOperationId,
      tenantId: "ente-other",
    });

    await expect(reconcileOfficialLookupInTransaction(tx, {
      jobId: "job-1",
      lookupId: "lookup-1",
    })).rejects.toMatchObject({ code: "RECONCILIATION_AUTHORITY_MISMATCH", retryable: false });
    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).not.toHaveBeenCalled();
  });

  it("preserves a richer court when authority is generic", async () => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      mention: {
        id: "mention-case", kind: "CASE_LAW",
        extractionAttempt: { neutralIntake: { enteId: "ente-1" } },
      },
      hits: [caseLawHit()],
    }));
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ courtFamily: "TAR", courtLocality: "CAMPANIA SALERNO" }),
      }),
    );
  });

  it("records compatible evidence after terminal acceptance without reopening it", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-terminal", revision: 4, ...create,
      state: "ACCEPTED_NEW", legalSourceId: "source-1",
    }));
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([{
      classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "prior",
      officialHit: legislationHit(),
    }]);
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disposition: "RECORDED_AFTER_TERMINAL" }),
    });
  });

  it("records compatible evidence after LINKED_EXISTING without invalidating its canonical link", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue({
      ...validStoredIdentity, state: "LINKED_EXISTING",
    });
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockResolvedValue({
      id: "reconciliation-terminal", revision: 4, kind: "LEGISLATION",
      state: "LINKED_EXISTING", legalSourceId: "source-1", ...validStoredIdentity,
    });
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([{
      classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "prior",
      officialHit: legislationHit(),
    }]);
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disposition: "RECORDED_AFTER_TERMINAL" }),
    });
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ legalSourceId: "source-1" })] }),
    );
  });

  it("reopens a terminal linked identity as conflicted on contradictory evidence", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-terminal", revision: 4, ...create,
      state: "LINKED_EXISTING", legalSourceId: "source-1",
    }));
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([{
      classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "prior",
      officialHit: legislationHit({ numeroProvvedimento: "999" }),
    }]);
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-terminal" },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
    expect(mocks.tx.legalReferenceOfficialReconciliationEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disposition: "CONFLICTING" }),
    });
  });

  it("does not auto-link when one verified assertion contradicts the match", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-1",
      identityAssertions: [
        { normalizedValue: "1268cdbb8375a1ac7980582baf2e42845f6776aa53f546b68d131bbdfcc898fa" },
        { normalizedValue: "f".repeat(64) },
      ],
    });
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ state: "PENDING_REVIEW", legalSourceId: null }) }),
    );
  });

  it("recognizes only reconciliation and evidence compound P2002 targets", () => {
    const error = (modelName: string, target: string[]) => new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: { modelName, target },
    });
    expect(isOfficialReconciliationRetryableP2002(error(
      "LegalReferenceOfficialReconciliation", ["mentionId", "identityVersion"],
    ))).toBe(true);
    expect(isOfficialReconciliationRetryableP2002(error(
      "LegalReferenceOfficialReconciliationEvidence", ["officialHitId", "identityVersion"],
    ))).toBe(true);
    expect(isOfficialReconciliationRetryableP2002(error(
      "LegalReferenceOfficialReconciliation", ["mentionId_identityVersion"],
    ))).toBe(true);
    expect(isOfficialReconciliationRetryableP2002(error(
      "LegalReferenceOfficialReconciliationEvidence", ["officialHitId_identityVersion"],
    ))).toBe(true);
    expect(isOfficialReconciliationRetryableP2002(error("LegalReferenceMatch", ["mentionId", "matchingVersion"])))
      .toBe(false);
    expect(isOfficialReconciliationRetryableP2002(error("LegalSource", ["sourceKey"]))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(error(
      "LegalReferenceOfficialReconciliation", ["mentionId_identityVersion", "unrelated"],
    ))).toBe(false);
  });

  it("requires the complete PrismaPg unique-violation signature for retry", () => {
    const adapterError = (cause: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0",
      meta: { modelName: "LegalReferenceOfficialReconciliation", driverAdapterError: { cause } },
    });
    const fields = ["mentionId", "identityVersion"];
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "UniqueConstraintViolation", originalCode: "23505", constraint: { fields },
    }))).toBe(true);
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "ForeignKeyConstraintViolation", originalCode: "23505", constraint: { fields },
    }))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "UniqueConstraintViolation", originalCode: "23503", constraint: { fields },
    }))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "UniqueConstraintViolation", constraint: { fields },
    }))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "UniqueConstraintViolation", originalCode: "23505",
      constraint: { fields: ["unrelated"] },
    }))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(adapterError({
      kind: "UniqueConstraintViolation", originalCode: "23505",
    }))).toBe(false);
    expect(isOfficialReconciliationRetryableP2002(adapterError({ fields }))).toBe(false);
  });

  it("registers and executes the production handler through the shared retry helper", async () => {
    const handler = applicationAsyncJobRegistry.resolve(LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_OPERATION);
    expect(handler).not.toBeNull();
    const admission = buildLegalReferenceOfficialReconciliationAdmission("lookup-1", provenance);
    await expect(handler!.execute(handler!.parseInput(admission.inputReference), {
      jobId: "job-1", correlationId: "correlation-1", attempt: 1,
      isCancellationRequested: vi.fn(async () => false),
      heartbeat: vi.fn(async () => undefined),
    })).resolves.toMatchObject({ referenceType: "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_RESULT" });
    expect(mocks.runTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isRetryableError: isOfficialReconciliationRetryableP2002,
    });
  });

  it("reuses a compatible reconciliation winner only after a fresh verified attempt", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0",
      meta: { modelName: "LegalReferenceOfficialReconciliation", target: ["mentionId", "identityVersion"] },
    });
    mocks.tx.legalReferenceOfficialReconciliation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...validStoredIdentity, state: "PENDING_REVIEW" });
    mocks.tx.legalReferenceOfficialReconciliation.upsert
      .mockRejectedValueOnce(race)
      .mockResolvedValueOnce({
        id: "reconciliation-winner", revision: 2, kind: "LEGISLATION",
        state: "PENDING_REVIEW", legalSourceId: null, ...validStoredIdentity,
      });
    mocks.runTransaction.mockImplementation(async (callback, options) => {
      try {
        return await callback(mocks.tx);
      } catch (error) {
        if (!options.isRetryableError(error)) throw error;
        return callback(mocks.tx);
      }
    });
    const handler = createLegalReferenceOfficialReconciliationHandler();
    const admission = buildLegalReferenceOfficialReconciliationAdmission("lookup-1", provenance);
    await expect(handler.execute(handler.parseInput(admission.inputReference), {
      jobId: "job-1", correlationId: "correlation-1", attempt: 1,
      isCancellationRequested: vi.fn(async () => false), heartbeat: vi.fn(async () => undefined),
    })).resolves.toMatchObject({ referenceId: "reconciliation-winner" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.findUnique).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the fresh reconciliation winner has incompatible identity", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0",
      meta: { modelName: "LegalReferenceOfficialReconciliation", target: ["mentionId", "identityVersion"] },
    });
    const incompatibleIdentity = buildOfficialHitIdentityV1({
      documentKind: "LEGISLATION", denominazioneAtto: "LEGGE", numeroProvvedimento: "999",
      annoProvvedimento: 1990, authority: null, decisionNumber: null, decisionYear: null,
      chamberSection: null,
    });
    const incompatibleWinner = {
      identityVersion: incompatibleIdentity.identityVersion,
      normalizedIdentity: incompatibleIdentity.normalizedIdentity,
      identityFingerprint: incompatibleIdentity.identityFingerprint,
      state: "PENDING_REVIEW",
    };
    mocks.tx.legalReferenceOfficialReconciliation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(incompatibleWinner);
    mocks.tx.legalReferenceOfficialReconciliation.upsert
      .mockRejectedValueOnce(race)
      .mockResolvedValueOnce({
        id: "reconciliation-winner", revision: 2, kind: "LEGISLATION",
        legalSourceId: null, ...incompatibleWinner,
      });
    mocks.tx.legalReferenceOfficialReconciliation.update.mockResolvedValueOnce({
      id: "reconciliation-winner", revision: 3, kind: "LEGISLATION",
      legalSourceId: null, ...incompatibleWinner, state: "CONFLICTED",
    });
    mocks.runTransaction.mockImplementation(async (callback, options) => {
      try {
        return await callback(mocks.tx);
      } catch (error) {
        if (!options.isRetryableError(error)) throw error;
        return callback(mocks.tx);
      }
    });
    const handler = createLegalReferenceOfficialReconciliationHandler();
    const admission = buildLegalReferenceOfficialReconciliationAdmission("lookup-1", provenance);
    await expect(handler.execute(handler.parseInput(admission.inputReference), {
      jobId: "job-1", correlationId: "correlation-1", attempt: 1,
      isCancellationRequested: vi.fn(async () => false), heartbeat: vi.fn(async () => undefined),
    })).resolves.toMatchObject({ referenceId: "reconciliation-winner" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-winner" },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
  });

  it("uses the same persisted Identity V2 verifier in review and automatic production paths", () => {
    const automatic = readFileSync(
      "src/server/intake/neutralIntakeLegalReferenceOfficialReconciliationJob.ts", "utf8",
    );
    const review = readFileSync("src/server/intake/official-hit-reconciliation/review.ts", "utf8");
    expect(automatic).toContain("verifyPersistedOfficialIdentityV2");
    expect(review).toContain("verifyPersistedOfficialIdentityV2");
  });

  it.each([
    ["locality", { court: "TAR Campania Napoli" }],
    ["decision type", { decisionType: "ORDINANZA" }],
    ["section", { chamberSection: "II" }],
    ["ECLI", { ecli: "ECLI:IT:TARSA:2025:999" }],
  ])("marks terminal case-law %s contradiction as CONFLICTED", async (_label, priorOverride) => {
    mocks.tx.legalReferenceOfficialLookup.findUnique.mockResolvedValue(lookup({
      mention: {
        id: "mention-case", kind: "CASE_LAW",
        extractionAttempt: { neutralIntake: { enteId: "ente-1" } },
      },
      hits: [caseLawHit()],
    }));
    mocks.tx.legalReferenceOfficialReconciliation.upsert.mockImplementation(async ({ create }) => ({
      id: "reconciliation-terminal", revision: 4, ...create,
      state: "ACCEPTED_NEW", legalSourceId: "source-1",
    }));
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([{
      classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "prior",
      officialHit: caseLawHit(priorOverride),
    }]);
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-terminal" },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
  });

  it("never resolves explicit contradiction by two-provider majority", async () => {
    mocks.tx.legalReferenceOfficialReconciliationEvidence.findMany.mockResolvedValue([
      { classification: "OFFICIAL_AUTHORITY", evidenceFingerprint: "a", officialHit: legislationHit() },
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "b", officialHit: legislationHit() },
      { classification: "COMMERCIAL_CORROBORATION", evidenceFingerprint: "c", officialHit: legislationHit({ numeroProvvedimento: "999" }) },
    ]);
    await reconcileOfficialLookupInTransaction(tx, { jobId: "job-1", lookupId: "lookup-1" });
    expect(mocks.tx.legalReferenceOfficialReconciliation.update).toHaveBeenCalledWith({
      where: { id: "reconciliation-1" },
      data: { state: "CONFLICTED", revision: { increment: 1 } },
    });
  });
});
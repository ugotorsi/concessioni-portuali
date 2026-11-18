import { Prisma } from "@/generated/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  prisma: { $transaction: vi.fn() },
  requireRole: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentTenantContext: vi.fn(),
  revalidatePath: vi.fn(),
  tx: {
    legalReferenceOfficialReconciliation: { findUnique: vi.fn(), updateMany: vi.fn() },
    legalSource: { findUnique: vi.fn(), create: vi.fn() },
    legalSourceIdentityAssertion: { createMany: vi.fn() },
    legalReferenceMatch: {
      createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/server/audit/auditLog", () => ({
  createAuditLogInTransaction: mocks.audit,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => ({
  requireRole: mocks.requireRole,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/tenant-auth", () => ({
  getCurrentTenantContext: mocks.getCurrentTenantContext,
  requireTenantAccess: (context: typeof tenantContext, enteId: string) => {
    if (!context.isAdmin && !context.accessibleTenantIds.includes(enteId)) {
      throw new Error("Tenant access denied.");
    }
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  OfficialReconciliationReviewConflictError,
  reviewOfficialReconciliation,
  reviewOfficialReconciliationInTransaction,
} from "@/server/intake/official-hit-reconciliation/review";
import { buildOfficialHitIdentityV1 } from "@/server/intake/official-hit-reconciliation/identity";
import { reviewLegalReferenceOfficialReconciliation } from "@/server/actions/legal-reference-official-reconciliation";

const reviewer = {
  userId: "user-1",
  actorId: "user-1",
  email: "legal@example.test",
  role: "GIURIDICO",
};
const tenantContext = { isAdmin: false, accessibleTenantIds: ["ente-1"], role: "GIURIDICO" as const };
const validIdentity = buildOfficialHitIdentityV1({
  documentKind: "LEGISLATION", denominazioneAtto: "LEGGE", numeroProvvedimento: "241",
  annoProvvedimento: 1990, authority: null, decisionNumber: null, decisionYear: null,
  chamberSection: null,
});

function reconciliation(overrides: Record<string, unknown> = {}) {
  return {
    id: "reconciliation-1",
    kind: "LEGISLATION",
    state: "PENDING_REVIEW",
    revision: 2,
    identityFingerprint: validIdentity.identityFingerprint,
    normalizedIdentity: validIdentity.normalizedIdentity,
    identityVersion: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
    mention: { extractionAttempt: { neutralIntake: { enteId: "ente-1" } } },
    evidence: [
      { officialHit: { lookup: { mentionId: "mention-1" } } },
      { officialHit: { lookup: { mentionId: "mention-1" } } },
      { officialHit: { lookup: { mentionId: "mention-2" } } },
    ],
    ...overrides,
  };
}

const tx = mocks.tx as unknown as Prisma.TransactionClient;

describe("B2C14 official reconciliation controlled review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation());
    mocks.tx.legalReferenceOfficialReconciliation.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.legalSource.findUnique.mockResolvedValue(null);
    mocks.tx.legalSource.create.mockResolvedValue({ id: "source-new" });
    mocks.tx.legalReferenceMatch.createMany.mockResolvedValue({ count: 2 });
    mocks.audit.mockResolvedValue({ id: "audit-1" });
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    mocks.requireRole.mockResolvedValue("GIURIDICO");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", email: "legal@example.test", role: "GIURIDICO" });
    mocks.getCurrentTenantContext.mockResolvedValue(tenantContext);
  });

  it("creates canonical truth only for an explicit ACCEPT_NEW review", async () => {
    const result = await reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: "Identita verificata.",
      reviewer,
      tenantContext,
    });

    expect(result).toEqual({
      reconciliationId: "reconciliation-1",
      state: "ACCEPTED_NEW",
      legalSourceId: "source-new",
    });
    expect(mocks.tx.legalSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Legge 241/1990",
        canonicalKey: "LEGGE:241:1990",
        identityScopeKey: "GLOBAL",
        sourceOrigin: "HUMAN_REVIEWED_OFFICIAL_EVIDENCE",
        humanReviewRequired: false,
        status: "IDENTITY_VERIFIED_PENDING_VALIDITY",
      }),
      select: { id: true },
    });
    expect(mocks.tx.legalSourceIdentityAssertion.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        sourceFamilyId: "source-new",
        identifierScheme: "LEGAL_REFERENCE_OFFICIAL_IDENTITY_V2",
        normalizedValue: validIdentity.identityFingerprint,
        verificationStatus: "VERIFIED",
      })],
      skipDuplicates: true,
    });
    expect(mocks.tx.legalReferenceOfficialReconciliation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "reconciliation-1", revision: 2 }),
      data: expect.objectContaining({
        state: "ACCEPTED_NEW",
        legalSourceId: "source-new",
        revision: { increment: 1 },
        reviewedByActorId: "user-1",
      }),
    });
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ mentionId: "mention-1", legalSourceId: "source-new" }),
        expect.objectContaining({ mentionId: "mention-2", legalSourceId: "source-new" }),
      ],
      skipDuplicates: true,
    });
    expect(mocks.audit).toHaveBeenCalledWith(tx, expect.objectContaining({
      azione: "LEGAL_REFERENCE_OFFICIAL_RECONCILIATION_REVIEW",
      metadata: expect.objectContaining({
        semanticMarker: "HUMAN_CANONICAL_IDENTITY_DECISION_PROVIDER_HIT_IS_EVIDENCE_ONLY",
      }),
    }));
  });

  it("appends V2 matches without updating, deleting, or replacing an existing V1 match", async () => {
    const existingV1Match = {
      id: "match-v1", matchingVersion: "LEGAL_REFERENCE_MATCHING_V1",
      status: "NO_MATCH", reason: "NO_CATALOG_MATCH", legalSourceId: null,
    };
    const originalV1Match = structuredClone(existingV1Match);
    mocks.tx.legalReferenceMatch.update.mockImplementation(async ({ data }) =>
      Object.assign(existingV1Match, data));
    mocks.tx.legalReferenceMatch.delete.mockImplementation(async () => {
      existingV1Match.status = "DELETED";
    });
    await reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    });
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        matchingVersion: "LEGAL_REFERENCE_MATCHING_V2_OFFICIAL_RECONCILIATION",
      })]),
    }));
    expect(mocks.tx.legalReferenceMatch.update).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.delete).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.deleteMany).not.toHaveBeenCalled();
    expect(existingV1Match).toEqual(originalV1Match);
  });

  it("links only an existing source with the exact global canonical identity", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-existing",
      identityNamespace: "LEGAL_REFERENCE_DISCOVERY_V1",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE:241:1990",
      identityAssertions: [{ normalizedValue: validIdentity.identityFingerprint }],
    });

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "LINK_EXISTING", legalSourceId: "source-existing" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).resolves.toMatchObject({ state: "LINKED_EXISTING", legalSourceId: "source-existing" });
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
  });

  it("fails closed when the selected source identity differs", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-wrong",
      identityNamespace: "LEGAL_REFERENCE_DISCOVERY_V1",
      identityScopeKey: "GLOBAL",
      canonicalKey: "LEGGE:241:1991",
    });

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "LINK_EXISTING", legalSourceId: "source-wrong" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).rejects.toThrow("OFFICIAL_RECONCILIATION_SOURCE_IDENTITY_MISMATCH");
    expect(mocks.tx.legalReferenceOfficialReconciliation.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects without creating or linking a legal source", async () => {
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "REJECT" },
      reviewNote: "Provider evidence is not sufficient.",
      reviewer,
      tenantContext,
    })).resolves.toMatchObject({ state: "REJECTED", legalSourceId: null });
    expect(mocks.tx.legalSource.findUnique).not.toHaveBeenCalled();
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it("rejects a stale revision and rolls back the decision path", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.updateMany.mockResolvedValue({ count: 0 });

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "REJECT" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).rejects.toBeInstanceOf(OfficialReconciliationReviewConflictError);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("converges ACCEPT_NEW onto a canonical source created concurrently", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-concurrent",
      identityAssertions: [{ normalizedValue: validIdentity.identityFingerprint }],
    });

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).resolves.toMatchObject({
      state: "LINKED_EXISTING",
      legalSourceId: "source-concurrent",
    });
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
    expect(mocks.tx.legalReferenceMatch.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ legalSourceId: "source-concurrent" }),
      ]),
    }));
  });

  it("propagates P2002 without querying the failed transaction again", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValueOnce(null);
    mocks.tx.legalSource.create.mockRejectedValue({ code: "P2002" });

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.tx.legalSource.findUnique).toHaveBeenCalledTimes(1);
  });

  it("propagates non-P2002 source creation failures", async () => {
    mocks.tx.legalSource.create.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).rejects.toThrow("DATABASE_UNAVAILABLE");
    expect(mocks.tx.legalSourceIdentityAssertion.createMany).not.toHaveBeenCalled();
  });

  it("does not permit incomplete evidence to create or link canonical truth", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation({
      state: "INCOMPLETE",
      identityFingerprint: null,
      normalizedIdentity: {
        kind: "LEGISLATION",
        jurisdiction: "IT",
        actType: "LEGGE",
        actNumber: null,
        year: 1990,
      },
    }));

    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1",
      expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Incomplete" },
      reviewNote: null,
      reviewer,
      tenantContext,
    })).rejects.toThrow("OFFICIAL_RECONCILIATION_INCOMPLETE_IDENTITY");
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
  });

  it("denies a foreign tenant using ownership loaded from the reconciliation", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation({
      mention: { extractionAttempt: { neutralIntake: { enteId: "ente-foreign" } } },
    }));
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "REJECT" }, reviewNote: null, reviewer, tenantContext,
    })).rejects.toThrow("Tenant access denied");
    expect(mocks.tx.legalReferenceOfficialReconciliation.updateMany).not.toHaveBeenCalled();
  });

  it("allows ADMIN under the repository global tenant semantics", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation({
      mention: { extractionAttempt: { neutralIntake: { enteId: "ente-foreign" } } },
    }));
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "REJECT" }, reviewNote: null, reviewer,
      tenantContext: { isAdmin: true, accessibleTenantIds: [], role: "ADMIN" },
    })).resolves.toMatchObject({ state: "REJECTED" });
  });

  it.each([
    ["fingerprint", { identityFingerprint: "b".repeat(64) }],
    ["identity", { normalizedIdentity: { ...validIdentity.normalizedIdentity, year: 1991 } }],
    ["version", { identityVersion: "UNSUPPORTED_V3" }],
  ])("rejects tampered persisted %s before promotion", async (_label, overrides) => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation(overrides));
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Unsafe" }, reviewNote: null,
      reviewer, tenantContext,
    })).rejects.toThrow("OFFICIAL_RECONCILIATION_IDENTITY_INTEGRITY_FAILED");
    expect(mocks.tx.legalSource.create).not.toHaveBeenCalled();
  });

  it("rejects one matching plus one contradictory verified assertion", async () => {
    mocks.tx.legalSource.findUnique.mockResolvedValue({
      id: "source-existing", identityNamespace: "LEGAL_REFERENCE_DISCOVERY_V1",
      identityScopeKey: "GLOBAL", canonicalKey: "LEGGE:241:1990",
      identityAssertions: [
        { normalizedValue: validIdentity.identityFingerprint },
        { normalizedValue: "f".repeat(64) },
      ],
    });
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "LINK_EXISTING", legalSourceId: "source-existing" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toThrow("OFFICIAL_RECONCILIATION_SOURCE_IDENTITY_MISMATCH");
  });

  it("rolls back the review path when the audit write fails", async () => {
    mocks.audit.mockRejectedValue(new Error("AUDIT_WRITE_FAILED"));
    await expect(reviewOfficialReconciliationInTransaction(tx, {
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toThrow("AUDIT_WRITE_FAILED");
  });

  it.each([
    ["audit", true],
    ["promotion", false],
  ])("commits no transaction-local mutations when %s fails", async (_label, auditFailure) => {
    const committed: string[] = [];
    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      const pending: string[] = [];
      const localTx = {
        legalReferenceOfficialReconciliation: {
          findUnique: vi.fn(async () => reconciliation()),
          updateMany: vi.fn(async () => {
            if (!auditFailure) throw new Error("PROMOTION_FAILED");
            pending.push("reconciliation");
            return { count: 1 };
          }),
        },
        legalSource: {
          findUnique: vi.fn(async () => null),
          create: vi.fn(async () => { pending.push("source"); return { id: "source-new" }; }),
        },
        legalSourceIdentityAssertion: {
          createMany: vi.fn(async () => { pending.push("assertion"); return { count: 1 }; }),
        },
        legalReferenceMatch: {
          createMany: vi.fn(async () => { pending.push("match"); return { count: 2 }; }),
        },
      } as unknown as Prisma.TransactionClient;
      const result = await callback(localTx);
      committed.push(...pending);
      return result;
    });
    mocks.audit.mockImplementation(async () => {
      if (auditFailure) throw new Error("AUDIT_WRITE_FAILED");
      return { id: "audit-1" };
    });

    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toThrow(auditFailure ? "AUDIT_WRITE_FAILED" : "PROMOTION_FAILED");
    expect(committed).toEqual([]);
    if (!auditFailure) expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("retries the whole transaction and validates a compatible canonical winner", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0",
      meta: { modelName: "LegalSource", target: ["identityNamespace", "identityScopeKey", "canonicalKey"] },
    });
    mocks.tx.legalSource.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "source-winner", identityAssertions: [{ normalizedValue: validIdentity.identityFingerprint }] });
    mocks.tx.legalSource.create.mockRejectedValueOnce(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).resolves.toMatchObject({ state: "LINKED_EXISTING", legalSourceId: "source-winner" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mocks.tx.legalSource.findUnique).toHaveBeenCalledTimes(2);
  });

  it("retries a valid PrismaPg LegalSource unique violation with exact metadata", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: {
        modelName: "LegalSource",
        driverAdapterError: { cause: {
          kind: "UniqueConstraintViolation", originalCode: "23505",
          constraint: { fields: ["identityNamespace", "identityScopeKey", "canonicalKey"] },
        } },
      },
    });
    mocks.tx.legalSource.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "source-winner", identityAssertions: [{ normalizedValue: validIdentity.identityFingerprint }],
      });
    mocks.tx.legalSource.create.mockRejectedValueOnce(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).resolves.toMatchObject({ legalSourceId: "source-winner" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["wrong kind", { kind: "ForeignKeyConstraintViolation", originalCode: "23505" }],
    ["wrong code", { kind: "UniqueConstraintViolation", originalCode: "23503" }],
    ["missing code", { kind: "UniqueConstraintViolation" }],
    ["malformed cause", { fields: ["identityNamespace", "identityScopeKey", "canonicalKey"] }],
  ])("does not retry PrismaPg metadata with %s", async (_label, cause) => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: {
        modelName: "LegalSource",
        driverAdapterError: { cause: {
          ...cause,
          constraint: { fields: ["identityNamespace", "identityScopeKey", "canonicalKey"] },
        } },
      },
    });
    mocks.tx.legalSource.create.mockRejectedValue(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toBe(race);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does not retry a PrismaPg 23505 for an unauthorized LegalSource target", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: {
        modelName: "LegalSource",
        driverAdapterError: { cause: {
          kind: "UniqueConstraintViolation", originalCode: "23505",
          constraint: { fields: ["title"] },
        } },
      },
    });
    mocks.tx.legalSource.create.mockRejectedValue(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toBe(race);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the fresh-transaction winner is incompatible", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0",
      meta: { modelName: "LegalSource", target: ["identityNamespace", "identityScopeKey", "canonicalKey"] },
    });
    mocks.tx.legalSource.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "source-winner", identityAssertions: [{ normalizedValue: "f".repeat(64) }] });
    mocks.tx.legalSource.create.mockRejectedValueOnce(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toThrow("OFFICIAL_RECONCILIATION_SOURCE_IDENTITY_MISMATCH");
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unknown P2002 target", async () => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: { modelName: "LegalSource", target: ["title"] },
    });
    mocks.tx.legalSource.create.mockRejectedValue(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).rejects.toBe(race);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [["identityNamespace_identityScopeKey_canonicalKey"]],
    [["sourceKey"]],
  ])("retries an exact LegalSource shorthand target %j", async (target) => {
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "7.8.0", meta: { modelName: "LegalSource", target },
    });
    mocks.tx.legalSource.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "source-winner", identityAssertions: [{ normalizedValue: validIdentity.identityFingerprint }] });
    mocks.tx.legalSource.create.mockRejectedValueOnce(race);
    await expect(reviewOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "ACCEPT_NEW", title: "Legge 241/1990" },
      reviewNote: null, reviewer, tenantContext,
    })).resolves.toMatchObject({ legalSourceId: "source-winner" });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("denies a foreign reconciliation through the real server action", async () => {
    mocks.tx.legalReferenceOfficialReconciliation.findUnique.mockResolvedValue(reconciliation({
      mention: { extractionAttempt: { neutralIntake: { enteId: "ente-foreign" } } },
    }));
    await expect(reviewLegalReferenceOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "REJECT" },
    })).rejects.toThrow("Tenant access denied");
    expect(mocks.tx.legalReferenceOfficialReconciliation.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept client-supplied tenant ownership", async () => {
    await expect(reviewLegalReferenceOfficialReconciliation({
      reconciliationId: "reconciliation-1", expectedRevision: 2,
      decision: { action: "REJECT" }, tenantId: "ente-1",
    } as never)).rejects.toThrow();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
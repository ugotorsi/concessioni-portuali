import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  CANONICAL_SOURCE_SPAN_OFFSET_CONVENTION,
  CanonicalIdentityServiceError,
  continueVerifiedKnowledgeIdentity,
  createAmbiguousKnowledgeItem,
  createVerifiedKnowledgeIdentity,
  isRetryableCanonicalIdentityPersistenceError,
  validateCanonicalSourceSpan,
  type CanonicalIdentityServiceContext,
  type CreateVerifiedKnowledgeIdentityInput,
  type KnowledgeSqlExecutor,
} from "@/server/fascicolo-knowledge";

const text = "Atto unico firmato";
const quote = "unico";
const quoteSha256 = createHash("sha256").update(quote, "utf8").digest("hex");
const textSha256 = createHash("sha256").update(text, "utf8").digest("hex");

function input(
  overrides: Partial<CreateVerifiedKnowledgeIdentityInput> = {},
): CreateVerifiedKnowledgeIdentityInput {
  return {
    tenantId: "tenant-a",
    procedimentoId: "procedure-a",
    revisionId: "revision-new",
    idempotencyKey: "request-0000000001",
    candidate: {
      kind: "FACT",
      normalizedIdentity: "atto-unico",
      normalizedText: "Atto unico firmato",
      structuredPayload: { statement: "Atto unico firmato" },
      confidence: 90,
      semanticKey: "a".repeat(64),
      semanticKeyVersion: "SEMANTIC_KEY_V1",
      contentFingerprint: "b".repeat(64),
      evidence: [{
        provenanceType: "DOCUMENT_EXTRACTION",
        documentoId: "document-a",
        documentFileVersionId: "version-a",
        extractionAttemptId: "attempt-a",
        pageNumber: 1,
        textSha256,
        quoteSha256,
        basisRef: "DOCUMENT_1.PAGE_1",
      }],
    },
    sourceSpans: [{
      basisRef: "DOCUMENT_1.PAGE_1",
      startOffset: 5,
      endOffset: 10,
      quote,
      quoteSha256,
    }],
    ...overrides,
  };
}

function context(handler?: (sql: string, params: readonly unknown[]) => unknown[]): {
  context: CanonicalIdentityServiceContext;
  queries: string[];
} {
  const queries: string[] = [];
  const executor: KnowledgeSqlExecutor = {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      queries.push(sql);
      if (handler) return { rows: handler(sql, params) as T[] };
      if (sql.includes("lock-revision")) {
        return { rows: [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }] as T[] };
      }
      if (sql.includes("trusted-neutral-page")) return { rows: [{ text }] as T[] };
      return { rows: [] };
    },
  };
  return {
    queries,
    context: { transaction: (operation) => operation(executor) },
  };
}

describe("inactive canonical identity service", () => {
  it("defines offsets as exact UTF-16 code units over stored text", () => {
    expect(CANONICAL_SOURCE_SPAN_OFFSET_CONVENTION).toBe("UTF16_CODE_UNITS_EXACT_STORED_TEXT_V1");
    const unicodeText = "A😀e\u0301Z";
    const unicodeQuote = "😀e\u0301";
    const hash = createHash("sha256").update(unicodeQuote, "utf8").digest("hex");
    expect(validateCanonicalSourceSpan({
      trustedText: unicodeText,
      startOffset: 1,
      endOffset: 5,
      quote: unicodeQuote,
      quoteSha256: hash,
    })).toEqual({ quoteSha256: hash });
  });

  it.each([
    {
      name: "invalid offsets",
      value: { startOffset: 10, endOffset: 30, quote },
      code: "SOURCE_SPAN_INVALID",
    },
    {
      name: "provider hash mismatch",
      value: { startOffset: 5, endOffset: 10, quote, quoteSha256: "0".repeat(64) },
      code: "SOURCE_SPAN_HASH_MISMATCH",
    },
    {
      name: "normalization mismatch",
      value: { trustedText: "Cafe\u0301", startOffset: 0, endOffset: 4, quote: "Café" },
      code: "SOURCE_SPAN_INVALID",
    },
  ])("rejects $name", ({ value, code }) => {
    const spanInput = Object.assign({
      trustedText: text,
      startOffset: 5,
      endOffset: 10,
      quote,
      quoteSha256,
    }, value);
    expect(() => validateCanonicalSourceSpan(spanInput)).toThrowError(expect.objectContaining({ code }));
  });

  it("rejects a quote repeated in the trusted page", () => {
    expect(() => validateCanonicalSourceSpan({
      trustedText: "atto atto",
      startOffset: 0,
      endOffset: 4,
      quote: "atto",
      quoteSha256: createHash("sha256").update("atto").digest("hex"),
    })).toThrowError(expect.objectContaining({ code: "SOURCE_SPAN_NOT_UNIQUE" }));
  });

  it("creates the root, first item, evidence, and span in one transaction", async () => {
    const fixture = context();
    const result = await createVerifiedKnowledgeIdentity(input(), fixture.context);
    expect(result).toMatchObject({ state: "VERIFIED_NEW", replayed: false });
    expect(result.identityId).toMatch(/^identity:[a-f0-9]{64}$/);
    expect(fixture.queries.some((sql) => sql.includes("insert-root"))).toBe(true);
    expect(fixture.queries.some((sql) => sql.includes("insert-item"))).toBe(true);
    expect(fixture.queries.some((sql) => sql.includes("insert-evidence"))).toBe(true);
    expect(fixture.queries.some((sql) => sql.includes("insert-span"))).toBe(true);
  });

  it("rolls the whole operation back when the item insert fails", async () => {
    let rolledBack = false;
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("insert-item")) throw new Error("insert failed");
      return [];
    });
    const transactionalContext: CanonicalIdentityServiceContext = {
      transaction: async (operation) => {
        try {
          return await fixture.context.transaction(operation);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    };
    await expect(createVerifiedKnowledgeIdentity(input(), transactionalContext)).rejects.toThrow("insert failed");
    expect(rolledBack).toBe(true);
  });

  it("replays a committed operation without creating another root", async () => {
    let existing: Record<string, unknown> | null = null;
    const fixture = context((sql, params) => {
      if (sql.includes("lock-revision")) {
        return [{
          id: "revision-new",
          status: existing ? "CURRENT" : "BUILDING",
          createdAt: new Date("2026-10-23"),
        }];
      }
      if (sql.includes("load-operation")) return existing ? [existing] : [];
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("insert-item")) {
        existing = {
          id: params[0],
          identityId: params[11],
          identityState: params[12],
          identityBasis: null,
          revisionId: params[3],
          kind: params[4],
          semanticKey: params[5],
          contentFingerprint: params[7],
          identityCommandFingerprint: params[14],
        };
      }
      return [];
    });
    const first = await createVerifiedKnowledgeIdentity(input(), fixture.context);
    const second = await createVerifiedKnowledgeIdentity(input(), fixture.context);
    expect(second).toEqual({ ...first, replayed: true });
    expect(fixture.queries.filter((sql) => sql.includes("insert-root"))).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a materially different command", async () => {
    let existing: Record<string, unknown> | null = null;
    const fixture = context((sql, params) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: existing ? "CURRENT" : "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("load-operation")) return existing ? [existing] : [];
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("insert-item")) {
        existing = {
          id: params[0],
          identityId: params[11],
          identityState: params[12],
          identityBasis: null,
          revisionId: params[3],
          kind: params[4],
          semanticKey: params[5],
          contentFingerprint: params[7],
          identityCommandFingerprint: params[14],
        };
      }
      return [];
    });
    await createVerifiedKnowledgeIdentity(input(), fixture.context);
    await expect(createVerifiedKnowledgeIdentity(input({
      candidate: {
        ...input().candidate,
        normalizedText: "Contenuto sostanzialmente diverso",
        structuredPayload: { statement: "Contenuto sostanzialmente diverso" },
      },
    }), fixture.context)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("starts cleanly after a rolled-back attempt", async () => {
    let attempt = 0;
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("insert-root") && attempt++ === 0) throw new Error("rollback");
      return [];
    });
    await expect(createVerifiedKnowledgeIdentity(input(), fixture.context)).rejects.toThrow("rollback");
    await expect(createVerifiedKnowledgeIdentity(input(), fixture.context)).resolves.toMatchObject({
      state: "VERIFIED_NEW",
      replayed: false,
    });
  });

  it.each([
    ["cross-tenant or cross-fascicolo", "AUTHORITY_MISMATCH", (sql: string) => sql.includes("lock-revision")],
    ["neutral intake from another document", "EVIDENCE_SCOPE_MISMATCH", (sql: string) => sql.includes("trusted-neutral-page")],
  ])("rejects %s", async (_name, code, emptyAt) => {
    const fixture = context((sql) => {
      if (emptyAt(sql)) return [];
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      return [];
    });
    await expect(createVerifiedKnowledgeIdentity(input(), fixture.context)).rejects.toEqual(
      new CanonicalIdentityServiceError(code as "AUTHORITY_MISMATCH"),
    );
  });

  it("rejects altered page hashes because no trusted page matches", async () => {
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      return [];
    });
    const altered = input({
      candidate: {
        ...input().candidate,
        evidence: [{ ...input().candidate.evidence[0], textSha256: "f".repeat(64) }],
      },
    });
    await expect(createVerifiedKnowledgeIdentity(altered, fixture.context)).rejects.toMatchObject({
      code: "EVIDENCE_SCOPE_MISMATCH",
    });
  });

  it("persists ambiguity without assigning a canonical identity", async () => {
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("validate-ambiguous-candidates")) {
        return ["old-a", "old-b"].map((id) => ({
          id,
          identityId: `identity-${id}`,
          kind: "FACT",
          revisionId: `revision-${id}`,
          revisionCreatedAt: new Date("2026-10-22"),
          revisionStatus: "SUPERSEDED",
          isLatest: true,
        }));
      }
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      return [];
    });
    const result = await createAmbiguousKnowledgeItem({
      ...input({
        sourceSpans: [],
        candidate: {
          ...input().candidate,
          evidence: [{ ...input().candidate.evidence[0], quoteSha256: null }],
        },
      }),
      candidatePredecessorItemIds: ["old-a", "old-b"],
      reasonCodes: ["MULTIPLE_PREDECESSORS", "SOURCE_SPAN_MISSING"],
    }, fixture.context);
    expect(result).toMatchObject({
      identityId: null,
      state: "AMBIGUOUS",
      basis: {
        type: "AMBIGUOUS_CONTINUITY",
        candidatePredecessorItemIds: ["old-a", "old-b"],
      },
    });
    expect(fixture.queries.some((sql) => sql.includes("insert-root"))).toBe(false);
  });

  it("continues a verified identity only with persisted source-span continuity", async () => {
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("lock-predecessor")) {
        return [{
          id: "item-old",
          identityId: "identity-old",
          kind: "FACT",
          revisionId: "revision-old",
          revisionCreatedAt: new Date("2026-10-22"),
          revisionStatus: "CURRENT",
        }];
      }
      if (sql.includes("latest-predecessor")) return [{ id: "item-old" }];
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("predecessor-spans")) {
        return [{
          documentoId: "document-a",
          documentFileVersionId: "version-a",
          pageNumber: 1,
          startOffset: 5,
          endOffset: 10,
          textSha256,
          quoteSha256,
        }];
      }
      return [];
    });
    const result = await continueVerifiedKnowledgeIdentity({
      ...input(),
      predecessorItemId: "item-old",
    }, fixture.context);
    expect(result).toMatchObject({
      identityId: "identity-old",
      state: "VERIFIED_CONTINUATION",
      basis: {
        type: "VERIFIED_SOURCE_SPAN_CONTINUITY",
        predecessorItemId: "item-old",
        predecessorRevisionId: "revision-old",
      },
    });
  });

  it.each([
    {
      name: "missing predecessor",
      code: "PREDECESSOR_NOT_FOUND",
      predecessor: [],
      predecessorSpans: [],
      occupied: [],
    },
    {
      name: "predecessor of another kind",
      code: "PREDECESSOR_IDENTITY_MISMATCH",
      predecessor: [{
        id: "item-old",
        identityId: "identity-old",
        kind: "EVENT",
        revisionId: "revision-old",
        revisionCreatedAt: new Date("2026-10-22"),
        revisionStatus: "CURRENT",
      }],
      predecessorSpans: [],
      occupied: [],
      latest: "item-old",
    },
    {
      name: "predecessor from unfinished revision",
      code: "PREDECESSOR_REVISION_NOT_ADMISSIBLE",
      predecessor: [{
        id: "item-old",
        identityId: "identity-old",
        kind: "FACT",
        revisionId: "revision-old",
        revisionCreatedAt: new Date("2026-10-22"),
        revisionStatus: "BUILDING",
      }],
      predecessorSpans: [],
      occupied: [],
      latest: "item-old",
    },
    {
      name: "stale predecessor when a newer version exists",
      code: "PREDECESSOR_NOT_LATEST",
      predecessor: [{
        id: "item-old",
        identityId: "identity-old",
        kind: "FACT",
        revisionId: "revision-old",
        revisionCreatedAt: new Date("2026-10-22"),
        revisionStatus: "SUPERSEDED",
      }],
      predecessorSpans: [],
      occupied: [],
      latest: "item-newer",
    },
    {
      name: "insufficient document continuity",
      code: "DOCUMENT_CONTINUITY_NOT_VERIFIED",
      predecessor: [{
        id: "item-old",
        identityId: "identity-old",
        kind: "FACT",
        revisionId: "revision-old",
        revisionCreatedAt: new Date("2026-10-22"),
        revisionStatus: "SUPERSEDED",
      }],
      predecessorSpans: [{
        documentoId: "document-a",
        documentFileVersionId: "version-old",
        pageNumber: 1,
        startOffset: 5,
        endOffset: 10,
        textSha256,
        quoteSha256,
      }],
      occupied: [],
      latest: "item-old",
    },
    {
      name: "two candidates claiming one identity position",
      code: "TARGET_IDENTITY_POSITION_TAKEN",
      predecessor: [{
        id: "item-old",
        identityId: "identity-old",
        kind: "FACT",
        revisionId: "revision-old",
        revisionCreatedAt: new Date("2026-10-22"),
        revisionStatus: "SUPERSEDED",
      }],
      predecessorSpans: [{
        documentoId: "document-a",
        documentFileVersionId: "version-a",
        pageNumber: 1,
        startOffset: 5,
        endOffset: 10,
        textSha256,
        quoteSha256,
      }],
      occupied: [{ id: "item-competing" }],
      latest: "item-old",
    },
  ])("rejects $name", async ({ code, predecessor, predecessorSpans, occupied, latest }) => {
    const fixture = context((sql) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("lock-predecessor")) return predecessor;
      if (sql.includes("latest-predecessor")) return latest ? [{ id: latest }] : [];
      if (sql.includes("trusted-neutral-page")) return [{ text }];
      if (sql.includes("predecessor-spans")) return predecessorSpans;
      if (sql.includes("check-position")) return occupied;
      return [];
    });
    await expect(continueVerifiedKnowledgeIdentity({
      ...input(),
      predecessorItemId: "item-old",
    }, fixture.context)).rejects.toMatchObject({ code });
  });

  it("rejects ambiguous predecessor candidates outside the verified scoped lineage", async () => {
      const fixture = context((sql) => {
        if (sql.includes("lock-revision")) {
          return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
        }
        if (sql.includes("validate-ambiguous-candidates")) {
          return [{
            id: "old-a",
            identityId: "identity-old-a",
            kind: "FACT",
            revisionId: "revision-old-a",
            revisionCreatedAt: new Date("2026-10-22"),
            revisionStatus: "SUPERSEDED",
            isLatest: true,
          }];
        }
        return [];
      });
      await expect(createAmbiguousKnowledgeItem({
        ...input({
          sourceSpans: [],
          candidate: {
            ...input().candidate,
            evidence: [{ ...input().candidate.evidence[0], quoteSha256: null }],
          },
        }),
        candidatePredecessorItemIds: ["old-a", "cross-tenant-missing"],
        reasonCodes: ["MULTIPLE_PREDECESSORS"],
      }, fixture.context)).rejects.toMatchObject({ code: "AMBIGUOUS_CANDIDATE_INVALID" });
    });

  it("derives the parent evidence quote hash and rejects a contradictory provider hash", async () => {
      const fixture = context();
      await expect(createVerifiedKnowledgeIdentity(input({
        candidate: {
          ...input().candidate,
          evidence: [{
            ...input().candidate.evidence[0],
            quoteSha256: "f".repeat(64),
          }],
        },
      }), fixture.context)).rejects.toMatchObject({ code: "EVIDENCE_QUOTE_HASH_MISMATCH" });
    });

  it("stores a null parent quote hash when one evidence has multiple verified spans", async () => {
    let parentQuoteHash: unknown = "not-inserted";
    const trustedText = "Atto unico firmato oggi";
    const signedQuote = "firmato";
    const signedHash = createHash("sha256").update(signedQuote).digest("hex");
    const fixture = context((sql, params) => {
      if (sql.includes("lock-revision")) {
        return [{ id: "revision-new", status: "BUILDING", createdAt: new Date("2026-10-23") }];
      }
      if (sql.includes("trusted-neutral-page")) return [{ text: trustedText }];
      if (sql.includes("insert-evidence")) parentQuoteHash = params[11];
      return [];
    });
    await createVerifiedKnowledgeIdentity(input({
      candidate: {
        ...input().candidate,
        evidence: [{ ...input().candidate.evidence[0], quoteSha256: null }],
      },
      sourceSpans: [
        ...input().sourceSpans,
        {
          basisRef: "DOCUMENT_1.PAGE_1",
          startOffset: 11,
          endOffset: 18,
          quote: signedQuote,
          quoteSha256: signedHash,
        },
      ],
    }), fixture.context);
    expect(parentQuoteHash).toBeNull();
    expect(fixture.queries.filter((sql) => sql.includes("insert-span"))).toHaveLength(2);
  });

  it.each([
      {
        target: ["revisionId", "semanticKeyVersion", "semanticKey"],
        code: "SEMANTIC_KEY_COLLISION",
      },
      {
        target: ["revisionId", "identityId"],
        code: "TARGET_IDENTITY_POSITION_TAKEN",
      },
      {
        target: ["unexpected"],
        code: "PERSISTENCE_CONFLICT",
      },
    ])("maps structural unique collision $code to a stable domain error", async ({ target, code }) => {
      const error = new Prisma.PrismaClientKnownRequestError("collision", {
        code: "P2002",
        clientVersion: "7.8.0",
        meta: { modelName: "FascicoloKnowledgeItem", target },
      });
      await expect(createVerifiedKnowledgeIdentity(input(), {
        transaction: async () => {
          throw error;
        },
      })).rejects.toMatchObject({ code });
    });

  it.each([
    {
      fields: ['"revisionId"', '"semanticKeyVersion"', '"semanticKey"'],
      code: "SEMANTIC_KEY_COLLISION",
    },
    {
      fields: ['"revisionId"', '"identityId"'],
      code: "TARGET_IDENTITY_POSITION_TAKEN",
    },
  ])("normalizes raw-query P2010 uniqueness to $code", async ({ fields, code }) => {
    const error = new Prisma.PrismaClientKnownRequestError("raw unique collision", {
      code: "P2010",
      clientVersion: "7.8.0",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { fields },
          },
        },
      },
    });
    await expect(createVerifiedKnowledgeIdentity(input(), {
      transaction: async () => {
        throw error;
      },
    })).rejects.toMatchObject({ code });
  });

  it("retries only deterministic raw-query primary-key races", () => {
    const rawUnique = (fields: string[]) => new Prisma.PrismaClientKnownRequestError("raw unique collision", {
      code: "P2010",
      clientVersion: "7.8.0",
      meta: {
        driverAdapterError: {
          cause: {
            kind: "UniqueConstraintViolation",
            constraint: { fields },
          },
        },
      },
    });
    expect(isRetryableCanonicalIdentityPersistenceError(rawUnique(["id"]))).toBe(true);
    expect(isRetryableCanonicalIdentityPersistenceError(
      rawUnique(["revisionId", "semanticKeyVersion", "semanticKey"]),
    )).toBe(false);
  });

  it("retries Prisma raw-query transaction write conflicts", () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", {
      code: "P2010",
      clientVersion: "7.8.0",
      meta: {
        driverAdapterError: {
          cause: { kind: "TransactionWriteConflict" },
        },
      },
    });
    expect(isRetryableCanonicalIdentityPersistenceError(conflict)).toBe(true);
  });

  it("uses distinct server identities for distinct concurrent-new idempotency keys", async () => {
    const left = context();
    const right = context();
    const [first, second] = await Promise.all([
      createVerifiedKnowledgeIdentity(input(), left.context),
      createVerifiedKnowledgeIdentity(input({ idempotencyKey: "request-0000000002" }), right.context),
    ]);
    expect(first.identityId).not.toBe(second.identityId);
  });

  it("never promotes legacy or human-confirmed state implicitly", async () => {
    const fixture = context();
    await createVerifiedKnowledgeIdentity(input(), fixture.context);
    const itemQuery = fixture.queries.find((sql) => sql.includes("insert-item")) ?? "";
    expect(itemQuery).toContain("'AI_PROPOSED'");
    expect(itemQuery).not.toContain("HUMAN_CONFIRMED");
    expect(itemQuery).not.toContain("LEGACY_UNVERIFIED");
    expect(fixture.queries.every((sql) => {
      const statement = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      return !/^(?:UPDATE|DELETE)\b/.test(statement);
    })).toBe(true);
  });
});

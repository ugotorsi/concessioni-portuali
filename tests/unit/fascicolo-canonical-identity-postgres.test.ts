import { createHash } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  continueVerifiedKnowledgeIdentity,
  createAmbiguousKnowledgeItem,
  createVerifiedKnowledgeIdentity,
  buildKnowledgeResearchMissionPlans,
  CANONICAL_IDENTITY_V3_CONTRACT_VERSION,
  isRetryableCanonicalIdentityPersistenceError,
  persistCanonicalStructuredKnowledgeRevision,
  persistStructuredKnowledgeRevision,
  type CanonicalIdentityServiceContext,
  type CreateAmbiguousKnowledgeItemInput,
  type CreateVerifiedKnowledgeIdentityInput,
  type FascicoloStructuredKnowledge,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeEvidenceCandidate,
  type KnowledgeSqlExecutor,
} from "@/server/fascicolo-knowledge";
import {
  buildStructuredFascicoloReport,
  STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
} from "@/server/fascicolo-report";
import { loadCurrentStructuredKnowledge } from "@/server/queries/fascicolo-knowledge";

const runPostgres = process.env.CANONICAL_IDENTITY_POSTGRES_E2E === "1";
const postgresDescribe = runPostgres ? describe : describe.skip;
const databaseUrl = process.env.CANONICAL_IDENTITY_POSTGRES_URL ?? "";
const pageText = "Atto unico firmato oggi";
const textSha256 = createHash("sha256").update(pageText).digest("hex");
const quote = "unico";
const quoteSha256 = createHash("sha256").update(quote).digest("hex");
const artifactSha256 = "d".repeat(64);

let primary: PrismaClient;
let secondary: PrismaClient;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function client(): PrismaClient {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  return new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  });
}

function executor(
  transaction: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
  failAtMarker?: string,
): KnowledgeSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      if (failAtMarker && sql.includes(failAtMarker)) {
        throw new Error(`INJECTED_FAILURE:${failAtMarker}`);
      }
      const rows = await transaction.$queryRawUnsafe<T[]>(sql, ...params);
      return { rows };
    },
  };
}

function realContext(prisma: PrismaClient, failAtMarker?: string): CanonicalIdentityServiceContext {
  return {
    async transaction(operation) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await prisma.$transaction(
            (tx) => operation(executor(tx, failAtMarker)),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        } catch (error) {
          const retryable = (
            error instanceof Prisma.PrismaClientKnownRequestError
            && error.code === "P2034"
          ) || isRetryableCanonicalIdentityPersistenceError(error);
          if (!retryable || attempt === 3) throw error;
        }

      }
      throw new Error("SERIALIZABLE_RETRY_EXHAUSTED");
    },
  };
}

function repositoryContext(prisma: PrismaClient): Partial<FascicoloKnowledgeRepositoryContext> {
  return {
    read: executor(prisma),
    transaction: (operation) => prisma.$transaction(
      (tx) => operation(executor(tx)),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  };
}

function command(input: {
  revisionId: string;
  idempotencyKey: string;
  semanticSeed: string;
  content?: string;
  tenantId?: string;
  procedimentoId?: string;
  documentoId?: string;
  versionId?: string;
  attemptId?: string;
  evidenceQuoteSha256?: string | null;
  sourceTextSha256?: string;
}): CreateVerifiedKnowledgeIdentityInput {
  const content = input.content ?? `Fatto ${input.semanticSeed}`;
  return {
    tenantId: input.tenantId ?? "tenant-a",
    procedimentoId: input.procedimentoId ?? "procedure-a",
    revisionId: input.revisionId,
    idempotencyKey: input.idempotencyKey,
    candidate: {
      kind: "FACT",
      normalizedIdentity: `identity-${input.semanticSeed}`,
      normalizedText: content,
      structuredPayload: { statement: content },
      confidence: 90,
      semanticKey: createHash("sha256").update(`semantic:${input.semanticSeed}`).digest("hex"),
      semanticKeyVersion: "SEMANTIC_KEY_V1",
      contentFingerprint: createHash("sha256").update(`content:${content}`).digest("hex"),
      evidence: [{
        provenanceType: "DOCUMENT_EXTRACTION",
        documentoId: input.documentoId ?? "document-a",
        documentFileVersionId: input.versionId ?? "version-a",
        extractionAttemptId: input.attemptId ?? "attempt-a",
        pageNumber: 1,
        textSha256: input.sourceTextSha256 ?? textSha256,
        quoteSha256: input.evidenceQuoteSha256 === undefined
          ? quoteSha256
          : input.evidenceQuoteSha256,
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
  };
}

async function seedAuthority(): Promise<void> {
  const existing = await primary.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM "Ente" WHERE "id" = 'tenant-a'`,
  );
  if (existing[0].count === BigInt(1)) return;
  try {
    await primary.$executeRawUnsafe(`
    DO $seed$
    BEGIN
    INSERT INTO "Ente" ("id", "nome", "codice", "updatedAt") VALUES
      ('tenant-a', 'Tenant A', 'TENANT_A', now()),
      ('tenant-b', 'Tenant B', 'TENANT_B', now());

    INSERT INTO "Concessionario" ("id", "denominazione", "updatedAt") VALUES
      ('operator-a', 'Operatore A', now()),
      ('operator-b', 'Operatore B', now());

    INSERT INTO "Concessione" (
      "id", "numeroAtto", "dataRilascio", "dataScadenza", "normaRiferimento",
      "tipologiaBene", "attivita", "stato", "concessionarioId", "enteId", "updatedAt"
    ) VALUES
      ('concession-a', 'A-1', '2020-01-01', '2030-01-01', 'ALTRO', 'ALTRO', 'ALTRO', 'ATTIVA', 'operator-a', 'tenant-a', now()),
      ('concession-a2', 'A-2', '2020-01-01', '2030-01-01', 'ALTRO', 'ALTRO', 'ALTRO', 'ATTIVA', 'operator-a', 'tenant-a', now()),
      ('concession-b', 'B-1', '2020-01-01', '2030-01-01', 'ALTRO', 'ALTRO', 'ALTRO', 'ATTIVA', 'operator-b', 'tenant-b', now());

    INSERT INTO "Procedimento" ("id", "tipologia", "stato", "enteId", "concessioneId", "updatedAt") VALUES
      ('procedure-a', 'ALTRO', 'DA_AVVIARE', 'tenant-a', 'concession-a', now()),
      ('procedure-a2', 'ALTRO', 'DA_AVVIARE', 'tenant-a', 'concession-a2', now()),
      ('procedure-b', 'ALTRO', 'DA_AVVIARE', 'tenant-b', 'concession-b', now());

    INSERT INTO "Documento" ("id", "nome", "tipologia", "enteId", "procedimentoId", "updatedAt") VALUES
      ('document-a', 'Documento A', 'ALTRO', 'tenant-a', 'procedure-a', now()),
      ('document-a2', 'Documento A2', 'ALTRO', 'tenant-a', 'procedure-a2', now()),
      ('document-b', 'Documento B', 'ALTRO', 'tenant-b', 'procedure-b', now());

    INSERT INTO "DocumentFileVersion" (
      "id", "documentId", "canonicalEnteId", "storageProvider", "storageKey",
      "mimeType", "sizeBytes", "sha256", "createdByActorId", "createdByRole"
    ) VALUES
      ('version-a', 'document-a', 'tenant-a', 'local', 'version-a', 'text/plain', 24, '${artifactSha256}', 'e2e', 'TEST'),
      ('version-a2', 'document-a2', 'tenant-a', 'local', 'version-a2', 'text/plain', 24, '${artifactSha256}', 'e2e', 'TEST'),
      ('version-b', 'document-b', 'tenant-b', 'local', 'version-b', 'text/plain', 24, '${artifactSha256}', 'e2e', 'TEST');

    UPDATE "Documento" SET "currentFileVersionId" = 'version-a' WHERE "id" = 'document-a';
    UPDATE "Documento" SET "currentFileVersionId" = 'version-a2' WHERE "id" = 'document-a2';
    UPDATE "Documento" SET "currentFileVersionId" = 'version-b' WHERE "id" = 'document-b';

    INSERT INTO "NeutralIntake" (
      "id", "idempotencyKey", "storageProvider", "storageKey", "sha256", "mimeType",
      "sizeBytes", "ingressChannel", "receivedByActorId", "receivedByRole", "enteId"
    ) VALUES
      ('intake-a', '${"a".repeat(64)}', 'local', 'intake-a', '${artifactSha256}', 'text/plain', 24, 'TEST', 'e2e', 'TEST', 'tenant-a'),
      ('intake-a2', '${"b".repeat(64)}', 'local', 'intake-a2', '${artifactSha256}', 'text/plain', 24, 'TEST', 'e2e', 'TEST', 'tenant-a'),
      ('intake-b', '${"c".repeat(64)}', 'local', 'intake-b', '${artifactSha256}', 'text/plain', 24, 'TEST', 'e2e', 'TEST', 'tenant-b');

    INSERT INTO "NeutralIntakeDestination" (
      "neutralIntakeId", "procedimentoId", "contractVersion", "authoritySource",
      "establishedByActorId", "establishedByRole"
    ) VALUES
      ('intake-a', 'procedure-a', 'V1', 'E2E', 'e2e', 'TEST'),
      ('intake-a2', 'procedure-a2', 'V1', 'E2E', 'e2e', 'TEST'),
      ('intake-b', 'procedure-b', 'V1', 'E2E', 'e2e', 'TEST');

    INSERT INTO "NeutralIntakeExtractionAttempt" (
      "id", "neutralIntakeId", "policyVersion", "outcome", "artifactSha256",
      "declaredMimeType", "artifactSizeBytes", "startedAt", "completedAt"
    ) VALUES
      ('attempt-a', 'intake-a', 'E2E', 'SUCCEEDED', '${artifactSha256}', 'text/plain', 24, now(), now()),
      ('attempt-a2', 'intake-a2', 'E2E', 'SUCCEEDED', '${artifactSha256}', 'text/plain', 24, now(), now()),
      ('attempt-b', 'intake-b', 'E2E', 'SUCCEEDED', '${artifactSha256}', 'text/plain', 24, now(), now());

    INSERT INTO "NeutralIntakeExtractionPage" (
      "id", "extractionAttemptId", "pageNumber", "extractionMethod", "text",
      "normalizedText", "textSha256", "normalizedCharacterCount"
    ) VALUES
      ('page-a', 'attempt-a', 1, 'DIRECT_TEXT', '${pageText}', '${pageText}', '${textSha256}', ${pageText.length}),
      ('page-a2', 'attempt-a2', 1, 'DIRECT_TEXT', '${pageText}', '${pageText}', '${textSha256}', ${pageText.length}),
      ('page-b', 'attempt-b', 1, 'DIRECT_TEXT', '${pageText}', '${pageText}', '${textSha256}', ${pageText.length});
    END
    $seed$;
    `);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("PostgreSQL seed failed", error.code, error.meta);
    }
    throw error;
  }
}

async function revision(input: {
  id: string;
  tenantId?: string;
  procedimentoId?: string;
  status?: "BUILDING" | "CURRENT" | "SUPERSEDED";
  createdAt: string;
}): Promise<void> {
  await primary.$executeRawUnsafe(`
    INSERT INTO "FascicoloKnowledgeRevision" (
      "id", "tenantId", "procedimentoId", "corpusFingerprint", "contractVersion",
      "status", "warnings", "createdAt", "completedAt"
    ) VALUES ($1, $2, $3, $4, 'FASCICOLO_KNOWLEDGE_V1',
      $5::"FascicoloKnowledgeRevisionStatus", '[]'::jsonb, $6::timestamp,
      CASE WHEN $5 = 'BUILDING' THEN NULL ELSE $6::timestamp END)
  `, input.id, input.tenantId ?? "tenant-a", input.procedimentoId ?? "procedure-a",
  createHash("sha256").update(`corpus:${input.id}`).digest("hex"),
  input.status ?? "BUILDING", input.createdAt);
}

async function truncateKnowledge(): Promise<void> {
  await primary.$executeRawUnsafe(`
    TRUNCATE TABLE
      "FascicoloKnowledgeEvidenceSpan",
      "FascicoloKnowledgeEvidence",
      "FascicoloKnowledgeRelation",
      "FascicoloKnowledgeReviewEvent",
      "FascicoloKnowledgeItem",
      "FascicoloKnowledgeIdentity",
      "FascicoloKnowledgeRevision"
    RESTART IDENTITY CASCADE
  `);
}

postgresDescribe.sequential("canonical identity on PostgreSQL 16", () => {
  beforeAll(async () => {
    const probe = new Pool({ connectionString: databaseUrl });
    await probe.query("SELECT 1");
    await probe.end();
    primary = client();
    secondary = client();
    await seedAuthority();
  });

  beforeEach(truncateKnowledge);

  afterAll(async () => {
    await Promise.all([
      primary?.$disconnect(),
      secondary?.$disconnect(),
    ]);
  });

  it("commits root, first item, evidence and span atomically", async () => {
    await revision({ id: "revision-atomic", createdAt: "2026-10-23T10:00:00Z" });
    const result = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-atomic",
      idempotencyKey: "atomic-command-0001",
      semanticSeed: "atomic",
    }), realContext(primary));

    const [identityCount, itemCount, evidenceCount, spanCount] = await Promise.all([
      primary.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "FascicoloKnowledgeIdentity" WHERE "id" = $1`,
        result.identityId,
      ),
      primary.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "FascicoloKnowledgeItem" WHERE "id" = $1`,
        result.physicalItemId,
      ),
      primary.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "FascicoloKnowledgeEvidence" WHERE "itemId" = $1`,
        result.physicalItemId,
      ),
      primary.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "FascicoloKnowledgeEvidenceSpan"`,
      ),
    ]);
    expect([identityCount[0].count, itemCount[0].count, evidenceCount[0].count, spanCount[0].count])
      .toEqual([BigInt(1), BigInt(1), BigInt(1), BigInt(1)]);
  });

  it.each([
    ["after root", "canonical-identity:insert-item"],
    ["after item before span", "canonical-identity:insert-span"],
  ])("rolls back completely %s", async (_label, marker) => {
    await revision({ id: `revision-rollback-${marker.length}`, createdAt: "2026-10-23T10:00:00Z" });
    await expect(createVerifiedKnowledgeIdentity(command({
      revisionId: `revision-rollback-${marker.length}`,
      idempotencyKey: `rollback-command-${marker.length}`,
      semanticSeed: `rollback-${marker.length}`,
    }), realContext(primary, marker))).rejects.toThrow(`INJECTED_FAILURE:${marker}`);
    const rows = await primary.$queryRawUnsafe<Array<{ identities: bigint; items: bigint }>>(`
      SELECT
        (SELECT count(*) FROM "FascicoloKnowledgeIdentity")::bigint AS identities,
        (SELECT count(*) FROM "FascicoloKnowledgeItem")::bigint AS items
    `);
    expect(rows[0]).toEqual({ identities: BigInt(0), items: BigInt(0) });
  });

  it("continues the latest completed version without mutating history", async () => {
    await revision({ id: "revision-v1", createdAt: "2026-10-21T10:00:00Z" });
    const first = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-v1",
      idempotencyKey: "continuity-command-0001",
      semanticSeed: "continuity-v1",
      content: "Contenuto versione uno",
    }), realContext(primary));
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = now()
      WHERE "id" = 'revision-v1'
    `);
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeItem"
      SET "status" = 'HUMAN_CONFIRMED', "reviewVersion" = 1
      WHERE "id" = $1
    `, first.physicalItemId);
    await revision({ id: "revision-v2", createdAt: "2026-10-22T10:00:00Z" });

    const second = await continueVerifiedKnowledgeIdentity({
      ...command({
        revisionId: "revision-v2",
        idempotencyKey: "continuity-command-0002",
        semanticSeed: "continuity-v2",
        content: "Contenuto versione due verificato",
      }),
      predecessorItemId: first.physicalItemId,
    }, realContext(primary));

    const versions = await primary.$queryRawUnsafe<Array<{
      id: string;
      identityId: string | null;
      status: string;
      contentFingerprint: string;
    }>>(`
      SELECT "id", "identityId", "status", "contentFingerprint"
      FROM "FascicoloKnowledgeItem"
      WHERE "identityId" = $1
      ORDER BY "createdAt", "id"
    `, first.identityId);
    expect(second.identityId).toBe(first.identityId);
    expect(versions).toHaveLength(2);
    expect(versions[0].status).toBe("HUMAN_CONFIRMED");
    expect(versions[1].status).toBe("AI_PROPOSED");
    expect(versions[0].contentFingerprint).not.toBe(versions[1].contentFingerprint);
  });

  it("serializes identical concurrent requests into one creation and one replay", async () => {
    await revision({ id: "revision-concurrent-new", createdAt: "2026-10-23T10:00:00Z" });
    const request = command({
      revisionId: "revision-concurrent-new",
      idempotencyKey: "concurrent-command-0001",
      semanticSeed: "concurrent-new",
    });
    const results = await Promise.all([
      createVerifiedKnowledgeIdentity(request, realContext(primary)),
      createVerifiedKnowledgeIdentity(request, realContext(secondary)),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    const counts = await primary.$queryRawUnsafe<Array<{ identities: bigint; items: bigint }>>(`
      SELECT
        (SELECT count(*) FROM "FascicoloKnowledgeIdentity")::bigint AS identities,
        (SELECT count(*) FROM "FascicoloKnowledgeItem")::bigint AS items
    `);
    expect(counts[0]).toEqual({ identities: BigInt(1), items: BigInt(1) });
  });

  it("rejects changed commands and structural semantic-key collisions", async () => {
    await revision({ id: "revision-collisions", createdAt: "2026-10-23T10:00:00Z" });
    const original = command({
      revisionId: "revision-collisions",
      idempotencyKey: "collision-command-0001",
      semanticSeed: "collision",
    });
    await createVerifiedKnowledgeIdentity(original, realContext(primary));
    await expect(createVerifiedKnowledgeIdentity({
      ...original,
      candidate: { ...original.candidate, normalizedText: "Mutazione non idempotente" },
    }, realContext(primary))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    try {
      await createVerifiedKnowledgeIdentity(command({
        revisionId: "revision-collisions",
        idempotencyKey: "collision-command-0002",
        semanticSeed: "collision",
        content: "Fatto distinto stessa semantic key",
      }), realContext(primary));
      throw new Error("EXPECTED_SEMANTIC_COLLISION");
    } catch (error) {
      expect(error).toMatchObject({ code: "SEMANTIC_KEY_COLLISION" });
    }
    const roots = await primary.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "FascicoloKnowledgeIdentity"`,
    );
    expect(roots[0].count).toBe(BigInt(1));
  });

  it("allows only one concurrent continuation for an identity revision position", async () => {
    await revision({ id: "revision-parent", createdAt: "2026-10-20T10:00:00Z" });
    const parent = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-parent",
      idempotencyKey: "parent-command-0001",
      semanticSeed: "parent",
    }), realContext(primary));
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = now()
      WHERE "id" = 'revision-parent'
    `);
    await revision({ id: "revision-child", createdAt: "2026-10-21T10:00:00Z" });
    const left = {
      ...command({
        revisionId: "revision-child",
        idempotencyKey: "child-command-0001",
        semanticSeed: "child-left",
      }),
      predecessorItemId: parent.physicalItemId,
    };
    const right = {
      ...command({
        revisionId: "revision-child",
        idempotencyKey: "child-command-0002",
        semanticSeed: "child-right",
      }),
      predecessorItemId: parent.physicalItemId,
    };
    const outcomes = await Promise.allSettled([
      continueVerifiedKnowledgeIdentity(left, realContext(primary)),
      continueVerifiedKnowledgeIdentity(right, realContext(secondary)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "TARGET_IDENTITY_POSITION_TAKEN" },
    });
  });

  it("rejects invalid lineage and preserves ambiguity without fusion", async () => {
    await revision({ id: "revision-building-parent", createdAt: "2026-10-19T10:00:00Z" });
    const buildingParent = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-building-parent",
      idempotencyKey: "building-parent-0001",
      semanticSeed: "building-parent",
    }), realContext(primary));
    await revision({ id: "revision-lineage-target", createdAt: "2026-10-23T10:00:00Z" });
    await expect(continueVerifiedKnowledgeIdentity({
      ...command({
        revisionId: "revision-lineage-target",
        idempotencyKey: "invalid-lineage-0001",
        semanticSeed: "invalid-lineage",
      }),
      predecessorItemId: buildingParent.physicalItemId,
    }, realContext(primary))).rejects.toMatchObject({ code: "PREDECESSOR_REVISION_NOT_ADMISSIBLE" });

    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = now()
      WHERE "id" = 'revision-building-parent'
    `);
    const secondParent = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-lineage-target",
      idempotencyKey: "second-parent-0001",
      semanticSeed: "second-parent",
    }), realContext(primary));
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'SUPERSEDED', "completedAt" = now()
      WHERE "id" = 'revision-building-parent'
    `);
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = now()
      WHERE "id" = 'revision-lineage-target'
    `);
    await revision({ id: "revision-ambiguous", createdAt: "2026-10-24T10:00:00Z" });
    const ambiguousCommand: CreateAmbiguousKnowledgeItemInput = {
      ...command({
        revisionId: "revision-ambiguous",
        idempotencyKey: "ambiguous-command-0001",
        semanticSeed: "ambiguous",
        evidenceQuoteSha256: null,
      }),
      sourceSpans: [],
      candidatePredecessorItemIds: [buildingParent.physicalItemId, secondParent.physicalItemId],
      reasonCodes: ["MULTIPLE_PREDECESSORS"],
    };
    const ambiguous = await createAmbiguousKnowledgeItem(ambiguousCommand, realContext(primary));
    expect(ambiguous).toMatchObject({ state: "AMBIGUOUS", identityId: null });
    await expect(createAmbiguousKnowledgeItem(ambiguousCommand, realContext(primary)))
      .resolves.toMatchObject({ state: "AMBIGUOUS", identityId: null, replayed: true });
  });

  it("uses revision id as a stable lineage tie-breaker for equal timestamps", async () => {
    const timestamp = "2026-10-25T10:00:00Z";
    await revision({ id: "revision-equal-a", createdAt: timestamp });
    const predecessor = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-equal-a",
      idempotencyKey: "equal-parent-command-0001",
      semanticSeed: "equal-parent",
    }), realContext(primary));
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = now()
      WHERE "id" = 'revision-equal-a'
    `);
    await revision({ id: "revision-equal-b", createdAt: timestamp });

    await expect(continueVerifiedKnowledgeIdentity({
      ...command({
        revisionId: "revision-equal-b",
        idempotencyKey: "equal-child-command-0001",
        semanticSeed: "equal-child",
      }),
      predecessorItemId: predecessor.physicalItemId,
    }, realContext(primary))).resolves.toMatchObject({
      identityId: predecessor.identityId,
      state: "VERIFIED_CONTINUATION",
    });

    await expect(createAmbiguousKnowledgeItem({
      ...command({
        revisionId: "revision-equal-b",
        idempotencyKey: "equal-ambiguous-command-0001",
        semanticSeed: "equal-ambiguous",
        evidenceQuoteSha256: null,
      }),
      sourceSpans: [],
      candidatePredecessorItemIds: [predecessor.physicalItemId],
      reasonCodes: ["CONTINUITY_CLAIM_UNVERIFIED"],
    }, realContext(primary))).resolves.toMatchObject({
      identityId: null,
      state: "AMBIGUOUS",
    });
  });

  it.each([
    {
      name: "cross-fascicolo document",
      override: { documentoId: "document-a2", versionId: "version-a2", attemptId: "attempt-a2" },
    },
    {
      name: "cross-tenant document",
      override: { documentoId: "document-b", versionId: "version-b", attemptId: "attempt-b" },
    },
    {
      name: "altered page hash",
      override: { sourceTextSha256: "f".repeat(64) },
    },
  ])("rejects untrusted provenance: $name", async ({ override }) => {
    await revision({ id: `revision-provenance-${override.documentoId ?? "hash"}`, createdAt: "2026-10-23T10:00:00Z" });
    await expect(createVerifiedKnowledgeIdentity(command({
      revisionId: `revision-provenance-${override.documentoId ?? "hash"}`,
      idempotencyKey: `provenance-command-${override.documentoId ?? "hash"}`,
      semanticSeed: `provenance-${override.documentoId ?? "hash"}`,
      ...override,
    }), realContext(primary))).rejects.toMatchObject({ code: "EVIDENCE_SCOPE_MISMATCH" });
  });

  it("persists server-derived hashes for one and multiple spans", async () => {
    await revision({ id: "revision-spans-one", createdAt: "2026-10-22T10:00:00Z" });
    const one = await createVerifiedKnowledgeIdentity(command({
      revisionId: "revision-spans-one",
      idempotencyKey: "spans-command-0001",
      semanticSeed: "spans-one",
    }), realContext(primary));
    const oneHash = await primary.$queryRawUnsafe<Array<{ parentHash: string | null; spanHash: string }>>(`
      SELECT e."quoteSha256" AS "parentHash", s."quoteSha256" AS "spanHash"
      FROM "FascicoloKnowledgeEvidence" e
      JOIN "FascicoloKnowledgeEvidenceSpan" s ON s."evidenceId" = e."id"
      WHERE e."itemId" = $1
    `, one.physicalItemId);
    expect(oneHash[0]).toEqual({ parentHash: quoteSha256, spanHash: quoteSha256 });

    await revision({ id: "revision-spans-many", createdAt: "2026-10-23T10:00:00Z" });
    const signedQuote = "firmato";
    const signedHash = createHash("sha256").update(signedQuote).digest("hex");
    const manyCommand = command({
      revisionId: "revision-spans-many",
      idempotencyKey: "spans-command-0002",
      semanticSeed: "spans-many",
      evidenceQuoteSha256: null,
    });
    manyCommand.sourceSpans.push({
      basisRef: "DOCUMENT_1.PAGE_1",
      startOffset: 11,
      endOffset: 18,
      quote: signedQuote,
      quoteSha256: signedHash,
    });
    const many = await createVerifiedKnowledgeIdentity(manyCommand, realContext(primary));
    const manyHashes = await primary.$queryRawUnsafe<Array<{ parentHash: string | null; spanHash: string }>>(`
      SELECT e."quoteSha256" AS "parentHash", s."quoteSha256" AS "spanHash"
      FROM "FascicoloKnowledgeEvidence" e
      JOIN "FascicoloKnowledgeEvidenceSpan" s ON s."evidenceId" = e."id"
      WHERE e."itemId" = $1
      ORDER BY s."startOffset"
    `, many.physicalItemId);
    expect(manyHashes).toEqual([
      { parentHash: null, spanHash: quoteSha256 },
      { parentHash: null, spanHash: signedHash },
    ]);
  });

  it("enforces canonical check constraints and scoped foreign keys", async () => {
    await revision({ id: "revision-constraints", createdAt: "2026-10-23T10:00:00Z" });
    await expect(primary.$executeRawUnsafe(`
      INSERT INTO "FascicoloKnowledgeItem" (
        "id", "tenantId", "procedimentoId", "revisionId", "kind", "semanticKey",
        "semanticKeyVersion", "contentFingerprint", "normalizedText", "structuredPayload",
        "identityState", "identityBasis", "identityCommandFingerprint"
      ) VALUES (
        'invalid-check', 'tenant-a', 'procedure-a', 'revision-constraints', 'FACT',
        '${"1".repeat(64)}', 'SEMANTIC_KEY_V1', '${"2".repeat(64)}',
        'invalid', '{}'::jsonb, 'VERIFIED_NEW', NULL, '${"3".repeat(64)}'
      )
    `)).rejects.toBeDefined();
    const constraints = await primary.$queryRawUnsafe<Array<{ conname: string; convalidated: boolean }>>(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conrelid IN (
        '"FascicoloKnowledgeIdentity"'::regclass,
        '"FascicoloKnowledgeItem"'::regclass,
        '"FascicoloKnowledgeEvidence"'::regclass,
        '"FascicoloKnowledgeEvidenceSpan"'::regclass
      )
    `);
    expect(constraints.some((constraint) => (
      constraint.conname === "fascicolo_knowledge_item_identity_state_ck"
      && constraint.convalidated
    ))).toBe(true);
    expect(constraints.some((constraint) => (
      constraint.conname === "fascicolo_knowledge_item_identity_scope_kind_fk"
      && constraint.convalidated
    ))).toBe(true);
    expect(constraints.some((constraint) => (
      constraint.conname === "fascicolo_knowledge_evidence_document_scope_fk"
      && !constraint.convalidated
    ))).toBe(true);
  });

  it("runs the gated V3 identity, reconciliation, mission, query and report pipeline", async () => {
    const evidence: KnowledgeEvidenceCandidate = {
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-a",
      documentFileVersionId: "version-a",
      extractionAttemptId: "attempt-a",
      pageNumber: 1,
      textSha256,
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    };
    const evidenceByBasisRef = new Map([[evidence.basisRef, evidence]]);
    const sourceTextByBasisRef = new Map([[evidence.basisRef, pageText]]);
    const date = {
      precision: "EXACT" as const,
      from: "2026-01-10",
      to: null,
      originalText: "10 gennaio 2026",
      confidence: 100,
    };
    const knowledge = (phase: "FIRST" | "SECOND"): FascicoloStructuredKnowledge => ({
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [],
      items: [
        {
          localId: "anchor-a",
          kind: "LEGAL_ACT",
          confidence: 100,
          basisRefs: ["DOCUMENT_1.PAGE_1"],
          payload: {
            documentBasisRef: "DOCUMENT_1.PAGE_1",
            actType: "PROCEDIMENTO_A",
            proceduralRole: "CHALLENGED_ACT",
            authoritySubjectLocalId: null,
            number: "A",
            date,
            title: "Procedimento A",
            declaredEffects: [],
          },
        },
        {
          localId: "anchor-b",
          kind: "LEGAL_ACT",
          confidence: 100,
          basisRefs: ["DOCUMENT_1.PAGE_1"],
          payload: {
            documentBasisRef: "DOCUMENT_1.PAGE_1",
            actType: "PROCEDIMENTO_B",
            proceduralRole: "CHALLENGED_ACT",
            authoritySubjectLocalId: null,
            number: "B",
            date,
            title: "Procedimento B",
            declaredEffects: [],
          },
        },
        {
          localId: "fact-a",
          kind: "FACT",
          confidence: 95,
          basisRefs: ["DOCUMENT_1.PAGE_1"],
          payload: {
            normalizedStatement: "Atto unico",
            subjectLocalIds: [],
            object: "unico",
            qualifier: null,
            proceedingIdentity: {
              declaredKey: phase === "FIRST" ? "A-DA-VERIFICARE" : "A",
              canonicalAnchorLocalId: "anchor-a",
              kind: "ADMINISTRATIVE_ORIGINAL",
              evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
            },
          },
        },
        {
          localId: "fact-b",
          kind: "FACT",
          confidence: 95,
          basisRefs: ["DOCUMENT_1.PAGE_1"],
          payload: {
            normalizedStatement: "firmato oggi",
            subjectLocalIds: [],
            object: "firmato",
            qualifier: null,
            proceedingIdentity: {
              declaredKey: "B",
              canonicalAnchorLocalId: "anchor-b",
              kind: "ADMINISTRATIVE_OTHER",
              evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
            },
          },
        },
        ...(phase === "FIRST" ? [
          {
            localId: "duplicate-one",
            kind: "FACT" as const,
            confidence: 70,
            basisRefs: ["DOCUMENT_1.PAGE_1"],
            payload: {
              normalizedStatement: "Atto",
              subjectLocalIds: [],
              object: "Atto",
              qualifier: null,
              proceedingIdentity: {
                declaredKey: "A",
                canonicalAnchorLocalId: "anchor-a",
                kind: "ADMINISTRATIVE_ORIGINAL" as const,
                evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
              },
            },
          },
          {
            localId: "duplicate-two",
            kind: "FACT" as const,
            confidence: 70,
            basisRefs: ["DOCUMENT_1.PAGE_1"],
            payload: {
              normalizedStatement: "Atto unico firmato",
              subjectLocalIds: [],
              object: "Atto",
              qualifier: null,
              proceedingIdentity: {
                declaredKey: "A",
                canonicalAnchorLocalId: "anchor-a",
                kind: "ADMINISTRATIVE_ORIGINAL" as const,
                evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
              },
            },
          },
        ] : [{
          localId: "duplicate-merged",
          kind: "FACT" as const,
          confidence: 75,
          basisRefs: ["DOCUMENT_1.PAGE_1"],
          payload: {
            normalizedStatement: "Atto unico firmato oggi",
            subjectLocalIds: [],
            object: "Atto",
            qualifier: null,
            proceedingIdentity: {
              declaredKey: "A",
              canonicalAnchorLocalId: "anchor-a",
              kind: "ADMINISTRATIVE_ORIGINAL" as const,
              evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
            },
          },
        }]),
      ],
      legalIssues: [
        {
          localId: "issue-a",
          title: "Disciplina del procedimento A",
          normalizedIssue: "Disciplina applicabile al procedimento A",
          areaOfLaw: "CONTENZIOSO",
          priority: "HIGH",
          rationale: "Verifica normativa e transitoria.",
          originatingItemLocalIds: ["anchor-a", "fact-a"],
          confidence: 90,
          referenceDateBasis: null,
          targetProceedingIdentity: {
            declaredKey: "A",
            canonicalAnchorLocalId: "anchor-a",
            kind: "ADMINISTRATIVE_ORIGINAL",
            evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
          },
        },
        ...(phase === "SECOND" ? [{
          localId: "issue-ambiguous",
          title: "Questione fondata sul fatto ambiguo",
          normalizedIssue: "Verifica della ricostruzione ambigua",
          areaOfLaw: "CONCESSIONI",
          priority: "MEDIUM" as const,
          rationale: "Il fatto richiede verifica.",
          originatingItemLocalIds: ["anchor-a", "duplicate-merged"],
          confidence: 60,
          referenceDateBasis: null,
          targetProceedingIdentity: {
            declaredKey: "A",
            canonicalAnchorLocalId: "anchor-a",
            kind: "ADMINISTRATIVE_ORIGINAL" as const,
            evidenceBasisRefs: ["DOCUMENT_1.PAGE_1"],
          },
        }] : []),
      ],
      researchQuestions: [
        {
          localId: "question-a",
          legalIssueLocalId: "issue-a",
          canonicalQuestion: "Quale disciplina, inclusa quella transitoria, si applica?",
          priority: "HIGH",
          referenceDate: "2026-01-10",
          referenceDateBasis: {
            type: "CHALLENGED_ACT_DATE",
            itemLocalId: "anchor-a",
            rationale: "Data dell'atto impugnato.",
            userConfirmedDateSource: null,
          },
          requestedCapabilities: ["SEMANTIC_DISCOVERY"],
          mode: "PRIMARY",
        },
        ...(phase === "SECOND" ? [{
          localId: "question-ambiguous",
          legalIssueLocalId: "issue-ambiguous",
          canonicalQuestion: "La ricostruzione ambigua consente una conclusione definitiva?",
          priority: "MEDIUM" as const,
          referenceDate: "2026-01-10",
          referenceDateBasis: {
            type: "CHALLENGED_ACT_DATE" as const,
            itemLocalId: "anchor-a",
            rationale: "Data dell'atto impugnato.",
            userConfirmedDateSource: null,
          },
          requestedCapabilities: ["SEMANTIC_DISCOVERY" as const],
          mode: "PRIMARY" as const,
        }] : []),
      ],
    });
    const first = await persistCanonicalStructuredKnowledgeRevision({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint: digest("integrated-corpus-first"),
      knowledge: knowledge("FIRST"),
      evidenceByBasisRef,
      sourceTextByBasisRef,
    }, repositoryContext(primary));
    const firstFact = first.revision.items.find((item) => item.normalizedText === "Atto unico");
    if (!firstFact?.identityId) throw new Error("FIRST_FACT_IDENTITY_REQUIRED");
    await primary.$executeRawUnsafe(`
      UPDATE "FascicoloKnowledgeItem"
      SET "status" = 'HUMAN_CONFIRMED', "reviewVersion" = 2
      WHERE "id" = $1
    `, firstFact.id);

    const second = await persistCanonicalStructuredKnowledgeRevision({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint: digest("integrated-corpus-second"),
      knowledge: knowledge("SECOND"),
      evidenceByBasisRef,
      sourceTextByBasisRef,
    }, repositoryContext(primary));
    const corrected = second.revision.items.find((item) => (
      item.normalizedText === "Atto unico" && item.identityState === "VERIFIED_CONTINUATION"
    ));
    const distinctB = second.revision.items.find((item) => item.normalizedText === "firmato oggi");
    const ambiguous = second.revision.items.find((item) => (
      item.normalizedText === "Atto unico firmato oggi" && item.identityState === "AMBIGUOUS"
    ));
    expect(corrected).toMatchObject({
      identityId: firstFact.identityId,
      identityState: "VERIFIED_CONTINUATION",
      status: "AI_PROPOSED",
    });
    expect(distinctB?.identityId).not.toBe(corrected?.identityId);
    expect(ambiguous).toMatchObject({ identityId: null, identityState: "AMBIGUOUS" });
    const historical = await primary.$queryRawUnsafe<Array<{ status: string; reviewVersion: number }>>(
      `SELECT "status", "reviewVersion" FROM "FascicoloKnowledgeItem" WHERE "id" = $1`,
      firstFact.id,
    );
    expect(historical[0]).toEqual({ status: "HUMAN_CONFIRMED", reviewVersion: 2 });
    expect(second.classifications.filter((entry) => (
      entry.previousItemId === firstFact.id
    )).map((entry) => entry.classification)).toEqual(["MODIFIED"]);

    const plans = buildKnowledgeResearchMissionPlans(second.revision, { maxQuestionsPerWave: 10 });
    expect(plans.find((plan) => plan.questionSemanticKey === second.revision.items
      .find((item) => item.normalizedText.includes("disciplina, inclusa"))?.semanticKey)?.execution)
      .toBe("ADMITTED");
    expect(plans.some((plan) => (
      plan.execution === "BLOCKED_FOR_REVIEW"
      && plan.blockReason === "ISSUE_OR_ORIGIN_INVALID"
    ))).toBe(true);

    const readModel = await loadCurrentStructuredKnowledge(
      "tenant-a",
      "procedure-a",
      { query: (sql, params) => executor(primary).query(sql, params) },
    );
    if (!readModel) throw new Error("READ_MODEL_REQUIRED");
    expect(readModel.facts.some((item) => item.identityState === "AMBIGUOUS")).toBe(true);
    const report = buildStructuredFascicoloReport({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      knowledge: readModel,
      missions: [],
      contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
    });
    expect(report.payload.contractVersion).toBe(STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION);
    expect(report.payload.legalApplicability?.applications).toEqual([]);
    expect(report.payload.documentedFramework.facts.some((item) => (
      item.normalizedText === "Atto unico"
    ))).toBe(true);
  });

  it("does not continue a different fact that lacks shared source-span continuity", async () => {
    const evidence: KnowledgeEvidenceCandidate = {
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-a",
      documentFileVersionId: "version-a",
      extractionAttemptId: "attempt-a",
      pageNumber: 1,
      textSha256,
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    };
    const factKnowledge = (statement: string): FascicoloStructuredKnowledge => ({
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [],
      items: [{
        localId: "fact",
        kind: "FACT",
        confidence: 90,
        basisRefs: ["DOCUMENT_1.PAGE_1"],
        payload: {
          normalizedStatement: statement,
          subjectLocalIds: [],
          object: "unico",
          qualifier: null,
          proceedingIdentity: null,
        },
      }],
      legalIssues: [],
      researchQuestions: [],
    });
    const common = {
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      evidenceByBasisRef: new Map([[evidence.basisRef, evidence]]),
      sourceTextByBasisRef: new Map([[evidence.basisRef, pageText]]),
    };
    const first = await persistCanonicalStructuredKnowledgeRevision({
      ...common,
      corpusFingerprint: digest("distinct-fact-first"),
      knowledge: factKnowledge("Atto"),
    }, repositoryContext(primary));
    const second = await persistCanonicalStructuredKnowledgeRevision({
      ...common,
      corpusFingerprint: digest("distinct-fact-second"),
      knowledge: factKnowledge("oggi"),
    }, repositoryContext(primary));
    expect(first.revision.items[0].identityId).not.toBeNull();
    expect(second.revision.items[0]).toMatchObject({ identityState: "VERIFIED_NEW" });
    expect(second.revision.items[0].identityId).not.toBe(first.revision.items[0].identityId);
    expect(second.classifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        classification: "NO_LONGER_SUPPORTED",
        previousItemId: first.revision.items[0].id,
      }),
    ]));
  });

  it("creates a canonical revision when the current legacy revision has the same corpus", async () => {
    const evidence: KnowledgeEvidenceCandidate = {
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-a",
      documentFileVersionId: "version-a",
      extractionAttemptId: "attempt-a",
      pageNumber: 1,
      textSha256,
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    };
    const knowledge: FascicoloStructuredKnowledge = {
      version: "FASCICOLO_STRUCTURED_KNOWLEDGE_V1",
      subjects: [],
      items: [{
        localId: "fact",
        kind: "FACT",
        confidence: 90,
        basisRefs: [evidence.basisRef],
        payload: {
          normalizedStatement: "Atto",
          subjectLocalIds: [],
          object: null,
          qualifier: null,
          proceedingIdentity: null,
        },
      }],
      legalIssues: [],
      researchQuestions: [],
    };
    const corpusFingerprint = digest("same-corpus-legacy-to-v3");
    const legacy = await persistStructuredKnowledgeRevision({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint,
      knowledge,
      evidenceByBasisRef: new Map([[evidence.basisRef, evidence]]),
    }, repositoryContext(primary));
    const canonical = await persistCanonicalStructuredKnowledgeRevision({
      tenantId: "tenant-a",
      procedimentoId: "procedure-a",
      corpusFingerprint,
      knowledge,
      evidenceByBasisRef: new Map([[evidence.basisRef, evidence]]),
      sourceTextByBasisRef: new Map([[evidence.basisRef, pageText]]),
    }, repositoryContext(primary));

    expect(legacy.revision.contractVersion).toBe("FASCICOLO_STRUCTURED_KNOWLEDGE_V1");
    expect(canonical.revision).toMatchObject({
      contractVersion: CANONICAL_IDENTITY_V3_CONTRACT_VERSION,
      status: "CURRENT",
    });
    expect(canonical.revision.items[0]).toMatchObject({ identityState: "VERIFIED_NEW" });
    const revisions = await primary.$queryRawUnsafe<Array<{ contractVersion: string; status: string }>>(`
      SELECT "contractVersion", "status"
      FROM "FascicoloKnowledgeRevision"
      WHERE "tenantId" = 'tenant-a' AND "procedimentoId" = 'procedure-a'
        AND "corpusFingerprint" = $1
      ORDER BY "contractVersion"
    `, corpusFingerprint);
    expect(revisions).toHaveLength(2);
    expect(revisions.map((revision) => revision.status).sort()).toEqual(["CURRENT", "SUPERSEDED"]);
  });
});

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  FASCICOLO_KNOWLEDGE_CONTRACT_VERSION,
  knowledgeItemCandidateSchema,
  preparedKnowledgeItemCandidateSchema,
  knowledgeScopeSchema,
  type JsonValue,
  type KnowledgeItemCandidate,
  type PreparedKnowledgeItemCandidate,
  type KnowledgeItemReviewStatus,
  type KnowledgeReconciliationClassification,
  type KnowledgeRelationType,
  type KnowledgeScope,
} from "./contracts";
import { reconcileKnowledgeItems } from "./reconciliation";
import { resolveFascicoloSubjects, type FascicoloSubjectRecord } from "./subjects";
import type { FascicoloSubjectCandidate } from "./structuredContracts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionInputSchema = knowledgeScopeSchema.extend({
  corpusFingerprint: sha256Schema,
  contractVersion: z.string().trim().min(1).max(64).default(FASCICOLO_KNOWLEDGE_CONTRACT_VERSION),
  warnings: z.array(z.string().trim().min(1).max(512)).max(10_000).default([]),
}).strict();
const scopedRevisionSchema = knowledgeScopeSchema.extend({ revisionId: z.string().trim().min(1).max(256) }).strict();

export interface KnowledgeSqlExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface FascicoloKnowledgeRepositoryContext {
  readonly read: KnowledgeSqlExecutor;
  readonly transaction: <T>(operation: (tx: KnowledgeSqlExecutor) => Promise<T>) => Promise<T>;
  readonly now?: () => Date;
  readonly id?: () => string;
  readonly beforeCurrentPromotion?: (tx: KnowledgeSqlExecutor) => Promise<void>;
}

export class FascicoloKnowledgeRepositoryError extends Error {
  constructor(readonly code:
    | "AUTHORITY_MISMATCH"
    | "REVISION_NOT_BUILDING"
    | "REVISION_NOT_CURRENT"
    | "REVISION_NOT_FOUND"
    | "STALE_CURRENT_REVISION"
    | "EVIDENCE_SCOPE_MISMATCH"
    | "ITEM_SCOPE_MISMATCH"
    | "RELATION_SCOPE_MISMATCH"
    | "ITEM_NOT_CURRENT"
    | "STALE_ITEM_REVIEW"
    | "CONCURRENT_PROMOTION") {
    super(code);
    this.name = "FascicoloKnowledgeRepositoryError";
  }
}

type RevisionStatus = "BUILDING" | "CURRENT" | "SUPERSEDED";

interface RevisionRow {
  id: string;
  tenantId: string;
  procedimentoId: string;
  corpusFingerprint: string;
  contractVersion: string;
  status: RevisionStatus;
  warnings: readonly string[];
  createdAt: Date;
  completedAt: Date | null;
  supersededAt: Date | null;
}

interface ItemRow {
  id: string;
  tenantId: string;
  procedimentoId: string;
  revisionId: string;
  kind: string;
  semanticKey: string;
  semanticKeyVersion: string;
  contentFingerprint: string;
  normalizedText: string;
  structuredPayload: JsonValue;
  confidence: number | null;
  status: KnowledgeItemReviewStatus;
  reviewVersion: number;
  createdAt: Date;
  supersededAt: Date | null;
}

interface EvidenceRow {
  id: string;
  tenantId: string;
  procedimentoId: string;
  itemId: string;
  provenanceType: "DOCUMENT_EXTRACTION";
  documentoId: string;
  documentFileVersionId: string | null;
  extractionAttemptId: string | null;
  pageNumber: number;
  textSha256: string;
  quoteSha256: string | null;
  basisRef: string | null;
  createdAt: Date;
}

interface RelationRow {
  id: string;
  tenantId: string;
  procedimentoId: string;
  revisionId: string;
  sourceItemId: string;
  targetItemId: string;
  relationType: KnowledgeRelationType;
  confidence: number | null;
  createdAt: Date;
}

export interface KnowledgeRevisionSnapshot extends RevisionRow {
  readonly items: readonly (ItemRow & { evidence: readonly EvidenceRow[] })[];
  readonly relations: readonly RelationRow[];
}

export interface KnowledgeReconciliationResult {
  readonly revision: KnowledgeRevisionSnapshot;
  readonly classifications: readonly {
    classification: KnowledgeReconciliationClassification;
    semanticKey: string;
    previousItemId: string | null;
    nextItemId: string | null;
  }[];
}

function prismaExecutor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): KnowledgeSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await client.$queryRawUnsafe<T[]>(sql, ...params);
      return { rows };
    },
  };
}

const defaultContext: FascicoloKnowledgeRepositoryContext = {
  read: prismaExecutor(prisma),
  transaction: (operation) => runSerializableTransactionWithRetry((tx) => operation(prismaExecutor(tx))),
};

function context(overrides: Partial<FascicoloKnowledgeRepositoryContext>): FascicoloKnowledgeRepositoryContext {
  return { ...defaultContext, ...overrides };
}

async function assertProcedureAuthority(tx: KnowledgeSqlExecutor, scope: KnowledgeScope): Promise<void> {
  const result = await tx.query<{ id: string }>(`
    SELECT p."id"
    FROM "Procedimento" p
    INNER JOIN "Concessione" c ON c."id" = p."concessioneId"
    WHERE p."id" = $1 AND c."enteId" = $2
  `, [scope.procedimentoId, scope.tenantId]);
  if (result.rows.length !== 1) throw new FascicoloKnowledgeRepositoryError("AUTHORITY_MISMATCH");
}

async function loadRevisionSnapshot(
  tx: KnowledgeSqlExecutor,
  revision: RevisionRow,
): Promise<KnowledgeRevisionSnapshot> {
  const [itemsResult, evidenceResult, relationsResult] = await Promise.all([
    tx.query<ItemRow>(`
      SELECT * FROM "FascicoloKnowledgeItem"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
      ORDER BY "createdAt" ASC, "id" ASC
    `, [revision.tenantId, revision.procedimentoId, revision.id]),
    tx.query<EvidenceRow>(`
      SELECT e.* FROM "FascicoloKnowledgeEvidence" e
      INNER JOIN "FascicoloKnowledgeItem" i ON i."id" = e."itemId"
        AND i."tenantId" = e."tenantId" AND i."procedimentoId" = e."procedimentoId"
      WHERE e."tenantId" = $1 AND e."procedimentoId" = $2 AND i."revisionId" = $3
      ORDER BY e."createdAt" ASC, e."id" ASC
    `, [revision.tenantId, revision.procedimentoId, revision.id]),
    tx.query<RelationRow>(`
      SELECT * FROM "FascicoloKnowledgeRelation"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
      ORDER BY "createdAt" ASC, "id" ASC
    `, [revision.tenantId, revision.procedimentoId, revision.id]),
  ]);
  const evidenceByItem = new Map<string, EvidenceRow[]>();
  for (const evidence of evidenceResult.rows) {
    const current = evidenceByItem.get(evidence.itemId) ?? [];
    current.push(evidence);
    evidenceByItem.set(evidence.itemId, current);
  }
  return {
    ...revision,
    items: itemsResult.rows.map((item) => ({ ...item, evidence: evidenceByItem.get(item.id) ?? [] })),
    relations: relationsResult.rows,
  };
}

async function validateEvidenceScope(
  tx: KnowledgeSqlExecutor,
  scope: KnowledgeScope,
  candidates: readonly KnowledgeItemCandidate[],
): Promise<void> {
  for (const candidate of candidates) {
    for (const evidence of candidate.evidence) {
      const page = await tx.query<{ id: string }>(`
        SELECT p."id"
        FROM "Documento" d
        INNER JOIN "DocumentFileVersion" v
          ON v."id" = $4 AND v."documentId" = d."id" AND v."canonicalEnteId" = d."enteId"
        INNER JOIN "NeutralIntakeExtractionAttempt" a
          ON a."id" = $5 AND a."artifactSha256" = v."sha256"
        INNER JOIN "NeutralIntake" n
          ON n."id" = a."neutralIntakeId" AND n."enteId" = d."enteId"
        INNER JOIN "NeutralIntakeDestination" destination
          ON destination."neutralIntakeId" = n."id" AND destination."procedimentoId" = d."procedimentoId"
        INNER JOIN "NeutralIntakeExtractionPage" p
          ON p."extractionAttemptId" = a."id" AND p."pageNumber" = $6 AND p."textSha256" = $7
        WHERE d."id" = $1 AND d."enteId" = $2 AND d."procedimentoId" = $3
      `, [evidence.documentoId, scope.tenantId, scope.procedimentoId, evidence.documentFileVersionId,
        evidence.extractionAttemptId, evidence.pageNumber, evidence.textSha256]);
      if (page.rows.length !== 1) throw new FascicoloKnowledgeRepositoryError("EVIDENCE_SCOPE_MISMATCH");
    }
  }
}

export async function createBuildingKnowledgeRevision(
  rawInput: z.input<typeof revisionInputSchema>,
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<RevisionRow> {
  const input = revisionInputSchema.parse(rawInput);
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    await assertProcedureAuthority(tx, input);
    const result = await tx.query<RevisionRow>(`
      INSERT INTO "FascicoloKnowledgeRevision" (
        "id", "tenantId", "procedimentoId", "corpusFingerprint", "contractVersion", "status", "warnings"
      ) VALUES ($1, $2, $3, $4, $5, 'BUILDING', $6::jsonb)
      RETURNING *
    `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, input.corpusFingerprint,
      input.contractVersion, JSON.stringify(input.warnings)]);
    return result.rows[0];
  });
}

export async function getCurrentKnowledgeRevision(
  rawScope: KnowledgeScope,
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<KnowledgeRevisionSnapshot | null> {
  const scope = knowledgeScopeSchema.parse(rawScope);
  const ctx = context(overrides);
  await assertProcedureAuthority(ctx.read, scope);
  const result = await ctx.read.query<RevisionRow>(`
    SELECT * FROM "FascicoloKnowledgeRevision"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'CURRENT'
  `, [scope.tenantId, scope.procedimentoId]);
  return result.rows[0] ? loadRevisionSnapshot(ctx.read, result.rows[0]) : null;
}

export async function listKnowledgeRevisionHistory(
  rawScope: KnowledgeScope,
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<readonly KnowledgeRevisionSnapshot[]> {
  const scope = knowledgeScopeSchema.parse(rawScope);
  const ctx = context(overrides);
  await assertProcedureAuthority(ctx.read, scope);
  const result = await ctx.read.query<RevisionRow>(`
    SELECT * FROM "FascicoloKnowledgeRevision"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'SUPERSEDED'
    ORDER BY "createdAt" ASC, "id" ASC
  `, [scope.tenantId, scope.procedimentoId]);
  return Promise.all(result.rows.map((revision) => loadRevisionSnapshot(ctx.read, revision)));
}

export async function reviewCurrentKnowledgeItem(
  rawInput: KnowledgeScope & {
    itemId: string;
    status: Exclude<KnowledgeItemReviewStatus, "AI_PROPOSED">;
    expectedReviewVersion?: number;
    actor?: { actorId: string; actorEmail?: string | null; actorRole: string };
  },
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<ItemRow> {
  const input = knowledgeScopeSchema.extend({
    itemId: z.string().trim().min(1).max(256),
    status: z.enum(["HUMAN_CONFIRMED", "REJECTED"]),
    expectedReviewVersion: z.number().int().nonnegative().optional(),
    actor: z.object({
      actorId: z.string().trim().min(1).max(256),
      actorEmail: z.string().email().max(320).nullable().optional().transform((value) => value ?? null),
      actorRole: z.string().trim().min(1).max(128),
    }).strict().optional().default({ actorId: "UNSPECIFIED", actorEmail: null, actorRole: "UNSPECIFIED" }),
  }).strict().parse(rawInput);
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    await assertProcedureAuthority(tx, input);
    const current = await tx.query<ItemRow>(`
      SELECT i.* FROM "FascicoloKnowledgeItem" i
      INNER JOIN "FascicoloKnowledgeRevision" r ON r."id" = i."revisionId"
        AND r."tenantId" = i."tenantId" AND r."procedimentoId" = i."procedimentoId"
      WHERE i."id" = $1 AND i."tenantId" = $2 AND i."procedimentoId" = $3
        AND r."status" = 'CURRENT' AND i."supersededAt" IS NULL
      FOR UPDATE
    `, [input.itemId, input.tenantId, input.procedimentoId]);
    const previous = current.rows[0];
    if (!previous) throw new FascicoloKnowledgeRepositoryError("ITEM_NOT_CURRENT");
    if (input.expectedReviewVersion !== undefined && previous.reviewVersion !== input.expectedReviewVersion) {
      throw new FascicoloKnowledgeRepositoryError("STALE_ITEM_REVIEW");
    }
    const result = await tx.query<ItemRow>(`
      UPDATE "FascicoloKnowledgeItem" i
      SET "status" = $4::"FascicoloKnowledgeItemStatus", "reviewVersion" = "reviewVersion" + 1
      FROM "FascicoloKnowledgeRevision" r
      WHERE i."revisionId" = r."id"
        AND i."id" = $1 AND i."tenantId" = $2 AND i."procedimentoId" = $3
        AND r."tenantId" = $2 AND r."procedimentoId" = $3 AND r."status" = 'CURRENT'
        AND i."supersededAt" IS NULL
      RETURNING i.*
    `, [input.itemId, input.tenantId, input.procedimentoId, input.status]);
    if (!result.rows[0]) throw new FascicoloKnowledgeRepositoryError("ITEM_NOT_CURRENT");
    await tx.query(`
      INSERT INTO "FascicoloKnowledgeReviewEvent" (
        "id", "tenantId", "procedimentoId", "itemId", "previousStatus", "nextStatus",
        "reviewVersion", "actorId", "actorEmail", "actorRole"
      ) VALUES ($1, $2, $3, $4, $5::"FascicoloKnowledgeItemStatus", $6::"FascicoloKnowledgeItemStatus", $7, $8, $9, $10)
    `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, input.itemId,
      previous.status, input.status, result.rows[0].reviewVersion, input.actor.actorId,
      input.actor.actorEmail, input.actor.actorRole]);
    return result.rows[0];
  });
}

export async function createKnowledgeRelation(
  rawInput: KnowledgeScope & {
    revisionId: string;
    sourceItemId: string;
    targetItemId: string;
    relationType: KnowledgeRelationType;
    confidence?: number | null;
  },
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<RelationRow> {
  const input = scopedRevisionSchema.extend({
    sourceItemId: z.string().trim().min(1).max(256),
    targetItemId: z.string().trim().min(1).max(256),
    relationType: z.enum(["RELATED_TO", "SUPERSEDES", "CONTRADICTS", "ISSUE_DERIVED_FROM", "QUESTION_FOR_ISSUE"]),
    confidence: z.number().int().min(0).max(100).nullable().optional().transform((value) => value ?? null),
  }).strict().refine((value) => value.sourceItemId !== value.targetItemId).parse(rawInput);
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    await assertProcedureAuthority(tx, input);
    const revision = await tx.query<{ id: string }>(`
      SELECT "id" FROM "FascicoloKnowledgeRevision"
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "status" = 'CURRENT'
      FOR UPDATE
    `, [input.revisionId, input.tenantId, input.procedimentoId]);
    if (revision.rows.length !== 1) throw new FascicoloKnowledgeRepositoryError("REVISION_NOT_CURRENT");
    const items = await tx.query<{ id: string; revisionId: string }>(`
      SELECT "id", "revisionId" FROM "FascicoloKnowledgeItem"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "id" IN ($3, $4)
    `, [input.tenantId, input.procedimentoId, input.sourceItemId, input.targetItemId]);
    const source = items.rows.find((item) => item.id === input.sourceItemId);
    const target = items.rows.find((item) => item.id === input.targetItemId);
    if (!source || !target || source.revisionId !== input.revisionId
      || (input.relationType !== "SUPERSEDES" && target.revisionId !== input.revisionId)) {
      throw new FascicoloKnowledgeRepositoryError("RELATION_SCOPE_MISMATCH");
    }
    const result = await tx.query<RelationRow>(`
      INSERT INTO "FascicoloKnowledgeRelation" (
        "id", "tenantId", "procedimentoId", "revisionId", "sourceItemId", "targetItemId", "relationType", "confidence"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::"FascicoloKnowledgeRelationType", $8)
      RETURNING *
    `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, input.revisionId,
      input.sourceItemId, input.targetItemId, input.relationType, input.confidence]);
    return result.rows[0];
  });
}

export async function reconcileAndPromoteKnowledgeRevision(
  rawInput: KnowledgeScope & {
    revisionId: string;
    expectedCurrentRevisionId: string | null;
    candidates: readonly (KnowledgeItemCandidate | PreparedKnowledgeItemCandidate)[];
    relations?: readonly {
      sourceSemanticKey: string;
      targetSemanticKey: string;
      relationType: Extract<KnowledgeRelationType, "RELATED_TO" | "CONTRADICTS" | "ISSUE_DERIVED_FROM" | "QUESTION_FOR_ISSUE">;
    }[];
  },
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<KnowledgeReconciliationResult> {
  const input = scopedRevisionSchema.extend({
    expectedCurrentRevisionId: z.string().trim().min(1).max(256).nullable(),
    candidates: z.array(z.union([knowledgeItemCandidateSchema, preparedKnowledgeItemCandidateSchema])).max(10_000),
    relations: z.array(z.object({
      sourceSemanticKey: sha256Schema,
      targetSemanticKey: sha256Schema,
      relationType: z.enum(["RELATED_TO", "CONTRADICTS", "ISSUE_DERIVED_FROM", "QUESTION_FOR_ISSUE"]),
    }).strict().refine((value) => value.sourceSemanticKey !== value.targetSemanticKey)).max(20_000).default([]),
  }).strict().parse(rawInput);
  const ctx = context(overrides);
  const now = (ctx.now ?? (() => new Date()))();
  return ctx.transaction(async (tx) => {
    await assertProcedureAuthority(tx, input);
    const targetResult = await tx.query<RevisionRow>(`
      SELECT * FROM "FascicoloKnowledgeRevision"
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3
      FOR UPDATE
    `, [input.revisionId, input.tenantId, input.procedimentoId]);
    const target = targetResult.rows[0];
    if (!target) throw new FascicoloKnowledgeRepositoryError("REVISION_NOT_FOUND");
    if (target.status !== "BUILDING") throw new FascicoloKnowledgeRepositoryError("REVISION_NOT_BUILDING");
    const currentResult = await tx.query<RevisionRow>(`
      SELECT * FROM "FascicoloKnowledgeRevision"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'CURRENT'
      FOR UPDATE
    `, [input.tenantId, input.procedimentoId]);
    const current = currentResult.rows[0] ?? null;
    if ((current?.id ?? null) !== input.expectedCurrentRevisionId) {
      throw new FascicoloKnowledgeRepositoryError("STALE_CURRENT_REVISION");
    }
    const priorItems = current
      ? (await tx.query<ItemRow>(`
          SELECT * FROM "FascicoloKnowledgeItem"
          WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
        `, [input.tenantId, input.procedimentoId, current.id])).rows
      : [];
    const reconciliation = reconcileKnowledgeItems(priorItems, input.candidates);
    await validateEvidenceScope(tx, input, input.candidates);
    const classifications: Array<KnowledgeReconciliationResult["classifications"][number]> = [];
    for (const entry of reconciliation) {
      if (!entry.candidate || !entry.nextStatus) {
        classifications.push({
          classification: entry.classification,
          semanticKey: entry.semanticKey,
          previousItemId: entry.previousItemId,
          nextItemId: null,
        });
        continue;
      }
      const itemId = (ctx.id ?? randomUUID)();
      await tx.query(`
        INSERT INTO "FascicoloKnowledgeItem" (
          "id", "tenantId", "procedimentoId", "revisionId", "kind", "semanticKey",
          "semanticKeyVersion", "contentFingerprint", "normalizedText", "structuredPayload", "confidence", "status"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::"FascicoloKnowledgeItemStatus")
      `, [itemId, input.tenantId, input.procedimentoId, input.revisionId, entry.candidate.kind,
        entry.candidate.semanticKey, entry.candidate.semanticKeyVersion, entry.candidate.contentFingerprint,
        entry.candidate.normalizedText, JSON.stringify(entry.candidate.structuredPayload),
        entry.candidate.confidence, entry.nextStatus]);
      for (const evidence of entry.candidate.evidence) {
        await tx.query(`
          INSERT INTO "FascicoloKnowledgeEvidence" (
            "id", "tenantId", "procedimentoId", "itemId", "provenanceType", "documentoId",
            "documentFileVersionId", "extractionAttemptId", "pageNumber", "textSha256", "quoteSha256", "basisRef"
          ) VALUES ($1, $2, $3, $4, $5::"FascicoloKnowledgeProvenanceType", $6, $7, $8, $9, $10, $11, $12)
        `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, itemId, evidence.provenanceType,
          evidence.documentoId, evidence.documentFileVersionId, evidence.extractionAttemptId,
          evidence.pageNumber, evidence.textSha256, evidence.quoteSha256, evidence.basisRef]);
      }
      if (entry.classification === "MODIFIED" && entry.previousItemId) {
        await tx.query(`
          INSERT INTO "FascicoloKnowledgeRelation" (
            "id", "tenantId", "procedimentoId", "revisionId", "sourceItemId", "targetItemId", "relationType"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'SUPERSEDES')
        `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, input.revisionId, itemId, entry.previousItemId]);
      }
      classifications.push({
        classification: entry.classification,
        semanticKey: entry.semanticKey,
        previousItemId: entry.previousItemId,
        nextItemId: itemId,
      });
    }
    if (input.relations.length > 0) {
      const relationItems = await tx.query<{ id: string; semanticKey: string }>(`
        SELECT "id", "semanticKey" FROM "FascicoloKnowledgeItem"
        WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
      `, [input.tenantId, input.procedimentoId, input.revisionId]);
      const itemIdBySemanticKey = new Map(relationItems.rows.map((item) => [item.semanticKey, item.id]));
      for (const relation of input.relations) {
        const sourceItemId = itemIdBySemanticKey.get(relation.sourceSemanticKey);
        const targetItemId = itemIdBySemanticKey.get(relation.targetSemanticKey);
        if (!sourceItemId || !targetItemId) {
          throw new FascicoloKnowledgeRepositoryError("RELATION_SCOPE_MISMATCH");
        }
        await tx.query(`
          INSERT INTO "FascicoloKnowledgeRelation" (
            "id", "tenantId", "procedimentoId", "revisionId", "sourceItemId", "targetItemId", "relationType"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::"FascicoloKnowledgeRelationType")
        `, [(ctx.id ?? randomUUID)(), input.tenantId, input.procedimentoId, input.revisionId,
          sourceItemId, targetItemId, relation.relationType]);
      }
    }
    if (current) {
      await tx.query(`
        UPDATE "FascicoloKnowledgeItem" SET "supersededAt" = $4
        WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3 AND "supersededAt" IS NULL
      `, [input.tenantId, input.procedimentoId, current.id, now]);
      const superseded = await tx.query<{ id: string }>(`
        UPDATE "FascicoloKnowledgeRevision"
        SET "status" = 'SUPERSEDED', "supersededAt" = $4
        WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "status" = 'CURRENT'
        RETURNING "id"
      `, [current.id, input.tenantId, input.procedimentoId, now]);
      if (superseded.rows.length !== 1) throw new FascicoloKnowledgeRepositoryError("CONCURRENT_PROMOTION");
    }
    await ctx.beforeCurrentPromotion?.(tx);
    const promoted = await tx.query<RevisionRow>(`
      UPDATE "FascicoloKnowledgeRevision"
      SET "status" = 'CURRENT', "completedAt" = $4
      WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3 AND "status" = 'BUILDING'
      RETURNING *
    `, [target.id, input.tenantId, input.procedimentoId, now]);
    if (promoted.rows.length !== 1) throw new FascicoloKnowledgeRepositoryError("CONCURRENT_PROMOTION");
    return {
      revision: await loadRevisionSnapshot(tx, promoted.rows[0]),
      classifications,
    };
  });
}

export async function resolveKnowledgeSubjects(
  rawInput: KnowledgeScope & { candidates: readonly FascicoloSubjectCandidate[] },
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<ReadonlyMap<string, FascicoloSubjectRecord>> {
  const input = knowledgeScopeSchema.extend({
    candidates: z.array(z.unknown()).max(500),
  }).strict().parse(rawInput);
  const ctx = context(overrides);
  return ctx.transaction(async (tx) => {
    await assertProcedureAuthority(tx, input);
    return resolveFascicoloSubjects({ tenantId: input.tenantId, candidates: rawInput.candidates }, tx, ctx.id ?? randomUUID);
  });
}

export async function runInFascicoloKnowledgeTransaction<T>(
  operation: (transactionContext: FascicoloKnowledgeRepositoryContext) => Promise<T>,
  overrides: Partial<FascicoloKnowledgeRepositoryContext> = {},
): Promise<T> {
  const ctx = context(overrides);
  return ctx.transaction((tx) => operation({
    ...ctx,
    read: tx,
    transaction: (nestedOperation) => nestedOperation(tx),
  }));
}
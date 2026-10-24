import { createHash } from "node:crypto";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransactionWithRetry } from "@/server/db/serializableTransaction";

import {
  knowledgeIdentityBasisSchema,
  knowledgeScopeSchema,
  preparedKnowledgeItemCandidateSchema,
  type JsonValue,
  type KnowledgeIdentityBasis,
  type KnowledgeIdentityState,
  type PreparedKnowledgeItemCandidate,
} from "./contracts";
import type { KnowledgeSqlExecutor } from "./repository";

export const CANONICAL_SOURCE_SPAN_OFFSET_CONVENTION = "UTF16_CODE_UNITS_EXACT_STORED_TEXT_V1" as const;

const identifierSchema = z.string().trim().min(1).max(256);
const idempotencyKeySchema = z.string().trim().min(16).max(512);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSpanClaimSchema = z.object({
  basisRef: z.string().regex(/^DOCUMENT_[1-9]\d*\.PAGE_[1-9]\d*$/),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  quote: z.string().min(1).max(100_000),
  quoteSha256: sha256Schema,
}).strict().refine((value) => value.endOffset > value.startOffset, {
  message: "SOURCE_SPAN_END_NOT_AFTER_START",
});
const commonOperationSchema = knowledgeScopeSchema.extend({
  revisionId: identifierSchema,
  idempotencyKey: idempotencyKeySchema,
  candidate: preparedKnowledgeItemCandidateSchema,
  sourceSpans: z.array(sourceSpanClaimSchema).max(1_000),
}).strict();
const createVerifiedSchema = commonOperationSchema.extend({
  sourceSpans: z.array(sourceSpanClaimSchema).min(1).max(1_000),
}).strict();
const continueVerifiedSchema = createVerifiedSchema.extend({
  predecessorItemId: identifierSchema,
}).strict();
const ambiguousSchema = commonOperationSchema.extend({
  candidatePredecessorItemIds: z.array(identifierSchema).min(1).max(100)
    .transform((values) => [...new Set(values)].sort()),
  reasonCodes: z.array(z.enum([
    "SOURCE_SPAN_MISSING",
    "SOURCE_SPAN_NOT_UNIQUE",
    "MULTIPLE_PREDECESSORS",
    "MULTIPLE_CANDIDATES_FOR_PREDECESSOR",
    "DOCUMENT_VERSION_CHANGED",
    "CONTINUITY_CLAIM_UNVERIFIED",
  ])).min(1).max(20).transform((values) => [...new Set(values)].sort()),
}).strict();

type CommonOperation = z.output<typeof commonOperationSchema>;
export type CreateVerifiedKnowledgeIdentityInput = z.input<typeof createVerifiedSchema>;
export type ContinueVerifiedKnowledgeIdentityInput = z.input<typeof continueVerifiedSchema>;
export type CreateAmbiguousKnowledgeItemInput = z.input<typeof ambiguousSchema>;

export interface CanonicalIdentityServiceContext {
  readonly transaction: <T>(operation: (tx: KnowledgeSqlExecutor) => Promise<T>) => Promise<T>;
}

export interface CanonicalIdentityResult {
  readonly physicalItemId: string;
  readonly identityId: string | null;
  readonly state: Extract<KnowledgeIdentityState, "VERIFIED_NEW" | "VERIFIED_CONTINUATION" | "AMBIGUOUS">;
  readonly basis: KnowledgeIdentityBasis | null;
  readonly replayed: boolean;
}

export class CanonicalIdentityServiceError extends Error {
  constructor(readonly code:
    | "AUTHORITY_MISMATCH"
    | "REVISION_NOT_BUILDING"
    | "EVIDENCE_SCOPE_MISMATCH"
    | "SOURCE_SPAN_MISSING"
    | "SOURCE_SPAN_INVALID"
    | "SOURCE_SPAN_HASH_MISMATCH"
    | "SOURCE_SPAN_NOT_UNIQUE"
    | "EVIDENCE_QUOTE_HASH_MISMATCH"
    | "PREDECESSOR_NOT_FOUND"
    | "PREDECESSOR_IDENTITY_MISMATCH"
    | "PREDECESSOR_REVISION_NOT_ADMISSIBLE"
    | "PREDECESSOR_NOT_LATEST"
    | "AMBIGUOUS_CANDIDATE_INVALID"
    | "DOCUMENT_CONTINUITY_NOT_VERIFIED"
    | "TARGET_IDENTITY_POSITION_TAKEN"
    | "SEMANTIC_KEY_COLLISION"
    | "PERSISTENCE_CONFLICT"
    | "IDEMPOTENCY_CONFLICT") {
    super(code);
    this.name = "CanonicalIdentityServiceError";
  }
}

interface RevisionRow {
  id: string;
  createdAt: Date;
  status: "BUILDING" | "CURRENT" | "SUPERSEDED";
}

interface TrustedPageRow {
  evidenceId?: string;
  text: string;
}

interface PredecessorRow {
  id: string;
  identityId: string | null;
  kind: string;
  revisionId: string;
  revisionCreatedAt: Date;
  revisionStatus: RevisionRow["status"];
}

interface ExistingItemRow {
  id: string;
  identityId: string | null;
  identityState: KnowledgeIdentityState | null;
  identityBasis: JsonValue | null;
  revisionId: string;
  kind: string;
  semanticKey: string;
  contentFingerprint: string;
  identityCommandFingerprint: string | null;
}

interface AmbiguousCandidateRow extends PredecessorRow {
  isLatest: boolean;
}

interface ValidatedSpan {
  basisRef: string;
  startOffset: number;
  endOffset: number;
  quoteSha256: string;
  fingerprint: string;
}

interface PersistedSpanRow {
  documentoId: string;
  documentFileVersionId: string;
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  textSha256: string;
  quoteSha256: string;
}

function prismaExecutor(client: Pick<Prisma.TransactionClient, "$queryRawUnsafe">): KnowledgeSqlExecutor {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await client.$queryRawUnsafe<T[]>(sql, ...params);
      return { rows };
    },
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function uniqueConstraintFields(error: unknown): readonly string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code === "P2002") {
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/^"(.*)"$/, "$1"));
    }
    return typeof target === "string" ? [target.replace(/^"(.*)"$/, "$1")] : [];
  }
  if (error.code !== "P2010") return null;
  const driverError = objectRecord(error.meta?.driverAdapterError);
  const cause = objectRecord(driverError?.cause);
  if (cause?.kind !== "UniqueConstraintViolation") return null;
  const constraint = objectRecord(cause.constraint);
  const fields = constraint?.fields;
  return Array.isArray(fields)
    ? fields.filter((value): value is string => typeof value === "string")
      .map((value) => value.replace(/^"(.*)"$/, "$1"))
    : [];
}

export function isRetryableCanonicalIdentityPersistenceError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
    const driverError = objectRecord(error.meta?.driverAdapterError);
    const cause = objectRecord(driverError?.cause);
    if (cause?.kind === "TransactionWriteConflict") return true;
  }
  const fields = uniqueConstraintFields(error);
  return fields?.length === 1 && (
    fields[0] === "id" || fields[0].endsWith("_pkey")
  );
}

function persistenceError(error: unknown): never {
  const fields = uniqueConstraintFields(error);
  if (fields === null) throw error;
  if (
    fields.includes("semanticKey")
    || fields.includes("fascicolo_knowledge_item_revision_semantic_uq")
  ) {
    throw new CanonicalIdentityServiceError("SEMANTIC_KEY_COLLISION");
  }
  if (
    fields.includes("identityId")
    || fields.includes("fascicolo_knowledge_item_revision_identity_uq")
  ) {
    throw new CanonicalIdentityServiceError("TARGET_IDENTITY_POSITION_TAKEN");
  }
  throw new CanonicalIdentityServiceError("PERSISTENCE_CONFLICT");
}

const defaultContext: CanonicalIdentityServiceContext = {
  transaction: (operation) => runSerializableTransactionWithRetry(
    (tx) => operation(prismaExecutor(tx)),
    { isRetryableError: isRetryableCanonicalIdentityPersistenceError },
  ),
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(",")}}`;
}

function commandFingerprint(
  operation: "VERIFIED_NEW" | "VERIFIED_CONTINUATION" | "AMBIGUOUS",
  input: CommonOperation,
  operationFields: Readonly<Record<string, unknown>> = {},
): string {
  return digest(canonicalJson({
    version: "FASCICOLO_CANONICAL_COMMAND_V1",
    operation,
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    revisionId: input.revisionId,
    idempotencyKey: input.idempotencyKey,
    candidate: input.candidate,
    sourceSpans: input.sourceSpans,
    ...operationFields,
  }));
}

function serverId(prefix: "identity" | "item" | "evidence" | "span", input: CommonOperation, suffix = ""): string {
  return `${prefix}:${digest([
    "FASCICOLO_CANONICAL_IDENTITY_V1",
    input.tenantId,
    input.procedimentoId,
    input.revisionId,
    input.idempotencyKey,
    suffix,
  ].join("\u001f"))}`;
}

function countExactOccurrences(text: string, quote: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - quote.length) {
    const match = text.indexOf(quote, offset);
    if (match < 0) break;
    count += 1;
    offset = match + 1;
  }
  return count;
}

function sourceSpanFingerprint(span: PersistedSpanRow): string {
  return digest(JSON.stringify({
    offsetConvention: CANONICAL_SOURCE_SPAN_OFFSET_CONVENTION,
    documentoId: span.documentoId,
    documentFileVersionId: span.documentFileVersionId,
    pageNumber: span.pageNumber,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    textSha256: span.textSha256,
    quoteSha256: span.quoteSha256,
  }));
}

export function validateCanonicalSourceSpan(input: {
  trustedText: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  quoteSha256: string;
}): { quoteSha256: string } {
  if (
    input.startOffset < 0
    || input.endOffset <= input.startOffset
    || input.endOffset > input.trustedText.length
  ) {
    throw new CanonicalIdentityServiceError("SOURCE_SPAN_INVALID");
  }
  const actualQuote = input.trustedText.slice(input.startOffset, input.endOffset);
  if (actualQuote !== input.quote) {
    throw new CanonicalIdentityServiceError("SOURCE_SPAN_INVALID");
  }
  const actualHash = digest(actualQuote);
  if (actualHash !== input.quoteSha256) {
    throw new CanonicalIdentityServiceError("SOURCE_SPAN_HASH_MISMATCH");
  }
  if (countExactOccurrences(input.trustedText, actualQuote) !== 1) {
    throw new CanonicalIdentityServiceError("SOURCE_SPAN_NOT_UNIQUE");
  }
  return { quoteSha256: actualHash };
}

async function lockBuildingRevision(tx: KnowledgeSqlExecutor, input: CommonOperation): Promise<RevisionRow> {
  const result = await tx.query<RevisionRow>(`
    /* canonical-identity:lock-revision */
    SELECT r."id", r."createdAt", r."status"
    FROM "FascicoloKnowledgeRevision" r
    INNER JOIN "Procedimento" p
      ON p."id" = r."procedimentoId" AND p."enteId" = r."tenantId"
    WHERE r."id" = $1 AND r."tenantId" = $2 AND r."procedimentoId" = $3
    FOR UPDATE
  `, [input.revisionId, input.tenantId, input.procedimentoId]);
  const revision = result.rows[0];
  if (!revision) throw new CanonicalIdentityServiceError("AUTHORITY_MISMATCH");
  return revision;
}

function assertBuildingRevision(revision: RevisionRow): void {
  if (revision.status !== "BUILDING") {
    throw new CanonicalIdentityServiceError("REVISION_NOT_BUILDING");
  }
}

async function loadExistingOperation(
  tx: KnowledgeSqlExecutor,
  input: CommonOperation,
  itemId: string,
): Promise<ExistingItemRow | null> {
  const result = await tx.query<ExistingItemRow>(`
    /* canonical-identity:load-operation */
    SELECT "id", "identityId", "identityState", "identityBasis", "revisionId", "kind",
      "semanticKey", "contentFingerprint", "identityCommandFingerprint"
    FROM "FascicoloKnowledgeItem"
    WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3
    FOR UPDATE
  `, [itemId, input.tenantId, input.procedimentoId]);
  return result.rows[0] ?? null;
}

function replay(
  existing: ExistingItemRow,
  input: CommonOperation,
  expectedState: CanonicalIdentityResult["state"],
  expectedIdentityId: string | null,
  expectedBasis: KnowledgeIdentityBasis | null,
  expectedCommandFingerprint: string,
): CanonicalIdentityResult {
  const matches = existing.revisionId === input.revisionId
    && existing.kind === input.candidate.kind
    && existing.semanticKey === input.candidate.semanticKey
    && existing.contentFingerprint === input.candidate.contentFingerprint
    && existing.identityState === expectedState
    && existing.identityId === expectedIdentityId
    && existing.identityCommandFingerprint === expectedCommandFingerprint
    && canonicalJson(existing.identityBasis) === canonicalJson(expectedBasis);
  if (!matches) throw new CanonicalIdentityServiceError("IDEMPOTENCY_CONFLICT");
  return {
    physicalItemId: existing.id,
    identityId: existing.identityId,
    state: expectedState,
    basis: expectedBasis,
    replayed: true,
  };
}

function replayContinuation(
  existing: ExistingItemRow,
  input: z.output<typeof continueVerifiedSchema>,
  expectedCommandFingerprint: string,
): CanonicalIdentityResult {
  const basis = knowledgeIdentityBasisSchema.parse(existing.identityBasis);
  if (
    basis.type !== "VERIFIED_SOURCE_SPAN_CONTINUITY"
    || basis.predecessorItemId !== input.predecessorItemId
    || existing.identityId === null
  ) {
    throw new CanonicalIdentityServiceError("IDEMPOTENCY_CONFLICT");
  }
  return replay(
    existing,
    input,
    "VERIFIED_CONTINUATION",
    existing.identityId,
    basis,
    expectedCommandFingerprint,
  );
}

function replayAmbiguous(
  existing: ExistingItemRow,
  input: z.output<typeof ambiguousSchema>,
  expectedCommandFingerprint: string,
): CanonicalIdentityResult {
  const basis = knowledgeIdentityBasisSchema.parse(existing.identityBasis);
  if (
    basis.type !== "AMBIGUOUS_CONTINUITY"
    || JSON.stringify(basis.candidatePredecessorItemIds) !== JSON.stringify(input.candidatePredecessorItemIds)
    || JSON.stringify(basis.reasonCodes) !== JSON.stringify(input.reasonCodes)
  ) {
    throw new CanonicalIdentityServiceError("IDEMPOTENCY_CONFLICT");
  }
  return replay(existing, input, "AMBIGUOUS", null, basis, expectedCommandFingerprint);
}

async function trustedPage(
  tx: KnowledgeSqlExecutor,
  input: CommonOperation,
  evidence: PreparedKnowledgeItemCandidate["evidence"][number],
): Promise<TrustedPageRow> {
  const result = evidence.provenanceType === "DOCUMENT_EXTRACTION"
    ? await tx.query<TrustedPageRow>(`
      /* canonical-identity:trusted-neutral-page */
      SELECT p."text"
      FROM "Documento" d
      INNER JOIN "DocumentFileVersion" v
        ON v."id" = $4 AND v."documentId" = d."id" AND v."canonicalEnteId" = d."enteId"
      INNER JOIN "NeutralIntakeExtractionAttempt" a
        ON a."id" = $5 AND a."artifactSha256" = v."sha256" AND a."outcome" = 'SUCCEEDED'
      INNER JOIN "NeutralIntake" n
        ON n."id" = a."neutralIntakeId" AND n."enteId" = d."enteId"
      INNER JOIN "NeutralIntakeDestination" destination
        ON destination."neutralIntakeId" = n."id"
        AND destination."procedimentoId" = d."procedimentoId"
      INNER JOIN "NeutralIntakeExtractionPage" p
        ON p."extractionAttemptId" = a."id"
        AND p."pageNumber" = $6
        AND p."textSha256" = $7
      WHERE d."id" = $1 AND d."enteId" = $2 AND d."procedimentoId" = $3
        AND d."currentFileVersionId" = v."id"
    `, [evidence.documentoId, input.tenantId, input.procedimentoId,
      evidence.documentFileVersionId, evidence.extractionAttemptId ?? null,
      evidence.pageNumber, evidence.textSha256])
    : await tx.query<TrustedPageRow>(`
      /* canonical-identity:trusted-document-page */
      SELECT p."text"
      FROM "Documento" d
      INNER JOIN "DocumentFileVersion" v
        ON v."id" = $4 AND v."documentId" = d."id" AND v."canonicalEnteId" = d."enteId"
      INNER JOIN "DocumentExtractionAttempt" a
        ON a."id" = $5
        AND a."documentoId" = d."id"
        AND a."documentFileVersionId" = v."id"
        AND a."tenantId" = d."enteId"
        AND a."procedimentoId" = d."procedimentoId"
        AND a."sourceSha256" = v."sha256"
        AND a."outcome" = 'SUCCEEDED'
      INNER JOIN "DocumentExtractionPage" p
        ON p."extractionAttemptId" = a."id"
        AND p."pageNumber" = $6
        AND p."textSha256" = $7
      WHERE d."id" = $1 AND d."enteId" = $2 AND d."procedimentoId" = $3
        AND d."currentFileVersionId" = v."id"
    `, [evidence.documentoId, input.tenantId, input.procedimentoId,
      evidence.documentFileVersionId, evidence.documentExtractionAttemptId ?? null,
      evidence.pageNumber, evidence.textSha256]);
  if (result.rows.length !== 1) {
    throw new CanonicalIdentityServiceError("EVIDENCE_SCOPE_MISMATCH");
  }
  return result.rows[0];
}

async function validateEvidenceAndSpans(
  tx: KnowledgeSqlExecutor,
  input: CommonOperation,
  requireEveryEvidenceSpan: boolean,
): Promise<readonly ValidatedSpan[]> {
  const evidenceByBasisRef = new Map(input.candidate.evidence.map((entry) => [entry.basisRef, entry]));
  const claimsByBasisRef = new Map<string, typeof input.sourceSpans>();
  for (const claim of input.sourceSpans) {
    if (!evidenceByBasisRef.has(claim.basisRef)) {
      throw new CanonicalIdentityServiceError("SOURCE_SPAN_MISSING");
    }
    claimsByBasisRef.set(claim.basisRef, [...(claimsByBasisRef.get(claim.basisRef) ?? []), claim]);
  }
  const validated: ValidatedSpan[] = [];
  for (const evidence of input.candidate.evidence) {
    const page = await trustedPage(tx, input, evidence);
    const claims = claimsByBasisRef.get(evidence.basisRef) ?? [];
    if (requireEveryEvidenceSpan && claims.length === 0) {
      throw new CanonicalIdentityServiceError("SOURCE_SPAN_MISSING");
    }
    for (const claim of claims) {
      const { quoteSha256 } = validateCanonicalSourceSpan({
        trustedText: page.text,
        startOffset: claim.startOffset,
        endOffset: claim.endOffset,
        quote: claim.quote,
        quoteSha256: claim.quoteSha256,
      });
      validated.push({
        basisRef: evidence.basisRef,
        startOffset: claim.startOffset,
        endOffset: claim.endOffset,
        quoteSha256,
        fingerprint: sourceSpanFingerprint({
          documentoId: evidence.documentoId,
          documentFileVersionId: evidence.documentFileVersionId,
          pageNumber: evidence.pageNumber,
          startOffset: claim.startOffset,
          endOffset: claim.endOffset,
          textSha256: evidence.textSha256,
          quoteSha256,
        }),
      });
    }
    const evidenceSpans = validated.filter((span) => span.basisRef === evidence.basisRef);
    const derivedParentQuoteSha256 = evidenceSpans.length === 1
      ? evidenceSpans[0].quoteSha256
      : null;
    if (
      evidence.quoteSha256 !== null
      && evidence.quoteSha256 !== derivedParentQuoteSha256
    ) {
      throw new CanonicalIdentityServiceError("EVIDENCE_QUOTE_HASH_MISMATCH");
    }
  }
  return validated;
}

async function insertItemGraph(
  tx: KnowledgeSqlExecutor,
  input: CommonOperation,
  itemId: string,
  identityId: string | null,
  state: CanonicalIdentityResult["state"],
  basis: KnowledgeIdentityBasis | null,
  spans: readonly ValidatedSpan[],
  identityCommandFingerprint: string,
): Promise<void> {
  const candidate = input.candidate;
  await tx.query(`
    /* canonical-identity:insert-item */
    INSERT INTO "FascicoloKnowledgeItem" (
      "id", "tenantId", "procedimentoId", "revisionId", "kind", "semanticKey",
      "semanticKeyVersion", "contentFingerprint", "normalizedText", "structuredPayload",
      "confidence", "status", "identityId", "identityState", "identityBasis",
      "identityCommandFingerprint"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11,
      'AI_PROPOSED', $12, $13::"FascicoloKnowledgeIdentityState", $14::jsonb, $15
    )
  `, [itemId, input.tenantId, input.procedimentoId, input.revisionId, candidate.kind,
    candidate.semanticKey, candidate.semanticKeyVersion, candidate.contentFingerprint,
    candidate.normalizedText, JSON.stringify(candidate.structuredPayload), candidate.confidence,
    identityId, state, basis === null ? null : JSON.stringify(basis), identityCommandFingerprint]);
  for (const [evidenceIndex, evidence] of candidate.evidence.entries()) {
    const evidenceId = serverId("evidence", input, `${evidenceIndex}:${evidence.basisRef}`);
    const evidenceSpans = spans.filter((span) => span.basisRef === evidence.basisRef);
    await tx.query(`
      /* canonical-identity:insert-evidence */
      INSERT INTO "FascicoloKnowledgeEvidence" (
        "id", "tenantId", "procedimentoId", "itemId", "provenanceType", "documentoId",
        "documentFileVersionId", "extractionAttemptId", "documentExtractionAttemptId",
        "pageNumber", "textSha256", "quoteSha256", "basisRef"
      ) VALUES ($1, $2, $3, $4, $5::"FascicoloKnowledgeProvenanceType", $6, $7, $8, $9, $10, $11, $12, $13)
    `, [evidenceId, input.tenantId, input.procedimentoId, itemId, evidence.provenanceType,
      evidence.documentoId, evidence.documentFileVersionId,
      evidence.provenanceType === "DOCUMENT_EXTRACTION" ? evidence.extractionAttemptId ?? null : null,
      evidence.provenanceType === "FASCICOLO_DOCUMENT_EXTRACTION"
        ? evidence.documentExtractionAttemptId ?? null
        : null,
      evidence.pageNumber, evidence.textSha256,
      evidenceSpans.length === 1 ? evidenceSpans[0].quoteSha256 : null,
      evidence.basisRef]);
    for (const [spanIndex, span] of evidenceSpans.entries()) {
      await tx.query(`
        /* canonical-identity:insert-span */
        INSERT INTO "FascicoloKnowledgeEvidenceSpan" (
          "id", "tenantId", "procedimentoId", "evidenceId", "startOffset", "endOffset", "quoteSha256"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [serverId("span", input, `${evidenceIndex}:${spanIndex}:${span.fingerprint}`),
        input.tenantId, input.procedimentoId, evidenceId, span.startOffset, span.endOffset,
        span.quoteSha256]);
    }
  }
}

async function inTransaction<T>(
  context: Partial<CanonicalIdentityServiceContext>,
  operation: (tx: KnowledgeSqlExecutor) => Promise<T>,
): Promise<T> {
  try {
    return await (context.transaction ?? defaultContext.transaction)(operation);
  } catch (error) {
    return persistenceError(error);
  }
}

export async function createVerifiedKnowledgeIdentity(
  rawInput: CreateVerifiedKnowledgeIdentityInput,
  context: Partial<CanonicalIdentityServiceContext> = {},
): Promise<CanonicalIdentityResult> {
  const input = createVerifiedSchema.parse(rawInput);
  const fingerprint = commandFingerprint("VERIFIED_NEW", input);
  return inTransaction(context, async (tx) => {
    const revision = await lockBuildingRevision(tx, input);
    const itemId = serverId("item", input);
    const identityId = serverId("identity", input);
    const existing = await loadExistingOperation(tx, input, itemId);
    if (existing) return replay(existing, input, "VERIFIED_NEW", identityId, null, fingerprint);
    assertBuildingRevision(revision);
    const spans = await validateEvidenceAndSpans(tx, input, true);
    const creationBasis = knowledgeIdentityBasisSchema.parse({
      type: "SERVER_ASSIGNED_NEW",
      sourceSpanFingerprints: spans.map((span) => span.fingerprint),
    });
    await tx.query(`
      /* canonical-identity:insert-root */
      INSERT INTO "FascicoloKnowledgeIdentity" (
        "id", "tenantId", "procedimentoId", "kind", "createdInRevisionId", "creationBasis"
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `, [identityId, input.tenantId, input.procedimentoId, input.candidate.kind,
      input.revisionId, JSON.stringify(creationBasis)]);
    await insertItemGraph(tx, input, itemId, identityId, "VERIFIED_NEW", null, spans, fingerprint);
    return { physicalItemId: itemId, identityId, state: "VERIFIED_NEW", basis: null, replayed: false };
  });
}

export async function continueVerifiedKnowledgeIdentity(
  rawInput: ContinueVerifiedKnowledgeIdentityInput,
  context: Partial<CanonicalIdentityServiceContext> = {},
): Promise<CanonicalIdentityResult> {
  const input = continueVerifiedSchema.parse(rawInput);
  const fingerprint = commandFingerprint("VERIFIED_CONTINUATION", input, {
    predecessorItemId: input.predecessorItemId,
  });
  return inTransaction(context, async (tx) => {
    const targetRevision = await lockBuildingRevision(tx, input);
    const itemId = serverId("item", input);
    const existing = await loadExistingOperation(tx, input, itemId);
    if (existing) return replayContinuation(existing, input, fingerprint);
    assertBuildingRevision(targetRevision);
    const predecessorResult = await tx.query<PredecessorRow>(`
      /* canonical-identity:lock-predecessor */
      SELECT i."id", i."identityId", i."kind", i."revisionId",
        r."createdAt" AS "revisionCreatedAt", r."status" AS "revisionStatus"
      FROM "FascicoloKnowledgeItem" i
      INNER JOIN "FascicoloKnowledgeRevision" r
        ON r."id" = i."revisionId" AND r."tenantId" = i."tenantId"
        AND r."procedimentoId" = i."procedimentoId"
      INNER JOIN "FascicoloKnowledgeIdentity" identity
        ON identity."id" = i."identityId" AND identity."tenantId" = i."tenantId"
        AND identity."procedimentoId" = i."procedimentoId" AND identity."kind" = i."kind"
      WHERE i."id" = $1 AND i."tenantId" = $2 AND i."procedimentoId" = $3
        AND i."identityState" IN ('VERIFIED_NEW', 'VERIFIED_CONTINUATION')
      FOR UPDATE OF i, identity
    `, [input.predecessorItemId, input.tenantId, input.procedimentoId]);
    const predecessor = predecessorResult.rows[0];
    if (!predecessor) throw new CanonicalIdentityServiceError("PREDECESSOR_NOT_FOUND");
    if (!predecessor.identityId || predecessor.kind !== input.candidate.kind) {
      throw new CanonicalIdentityServiceError("PREDECESSOR_IDENTITY_MISMATCH");
    }
    if (
      !["CURRENT", "SUPERSEDED"].includes(predecessor.revisionStatus)
      ||
      predecessor.revisionId === input.revisionId
      || (
        new Date(predecessor.revisionCreatedAt).getTime() > new Date(targetRevision.createdAt).getTime()
        || (
          new Date(predecessor.revisionCreatedAt).getTime() === new Date(targetRevision.createdAt).getTime()
          && predecessor.revisionId >= targetRevision.id
        )
      )
    ) {
      throw new CanonicalIdentityServiceError("PREDECESSOR_REVISION_NOT_ADMISSIBLE");
    }
    const latestPredecessor = await tx.query<{ id: string }>(`
      /* canonical-identity:latest-predecessor */
      SELECT i2."id"
      FROM "FascicoloKnowledgeItem" i2
      INNER JOIN "FascicoloKnowledgeRevision" r2
        ON r2."id" = i2."revisionId" AND r2."tenantId" = i2."tenantId"
        AND r2."procedimentoId" = i2."procedimentoId"
      WHERE i2."tenantId" = $1 AND i2."procedimentoId" = $2
        AND i2."identityId" = $3
        AND i2."identityState" IN ('VERIFIED_NEW', 'VERIFIED_CONTINUATION')
        AND r2."status" IN ('CURRENT', 'SUPERSEDED')
        AND (r2."createdAt", r2."id") < ($4, $5)
      ORDER BY r2."createdAt" DESC, r2."id" DESC, i2."createdAt" DESC, i2."id" DESC
      LIMIT 1
    `, [
      input.tenantId,
      input.procedimentoId,
      predecessor.identityId,
      targetRevision.createdAt,
      targetRevision.id,
    ]);
    if (latestPredecessor.rows[0]?.id !== predecessor.id) {
      throw new CanonicalIdentityServiceError("PREDECESSOR_NOT_LATEST");
    }
    const spans = await validateEvidenceAndSpans(tx, input, true);
    const predecessorSpans = await tx.query<PersistedSpanRow>(`
      /* canonical-identity:predecessor-spans */
      SELECT e."documentoId", e."documentFileVersionId", e."pageNumber",
        s."startOffset", s."endOffset", e."textSha256", s."quoteSha256"
      FROM "FascicoloKnowledgeEvidence" e
      INNER JOIN "FascicoloKnowledgeEvidenceSpan" s
        ON s."evidenceId" = e."id" AND s."tenantId" = e."tenantId"
        AND s."procedimentoId" = e."procedimentoId"
      WHERE e."itemId" = $1 AND e."tenantId" = $2 AND e."procedimentoId" = $3
    `, [predecessor.id, input.tenantId, input.procedimentoId]);
    const previousFingerprints = new Set(predecessorSpans.rows.map(sourceSpanFingerprint));
    if (!spans.some((span) => previousFingerprints.has(span.fingerprint))) {
      throw new CanonicalIdentityServiceError("DOCUMENT_CONTINUITY_NOT_VERIFIED");
    }
    const basis = knowledgeIdentityBasisSchema.parse({
      type: "VERIFIED_SOURCE_SPAN_CONTINUITY",
      predecessorItemId: predecessor.id,
      predecessorRevisionId: predecessor.revisionId,
      sourceSpanFingerprints: spans.map((span) => span.fingerprint),
    });
    const occupied = await tx.query<{ id: string }>(`
      /* canonical-identity:check-position */
      SELECT "id" FROM "FascicoloKnowledgeItem"
      WHERE "revisionId" = $1 AND "identityId" = $2
      FOR UPDATE
    `, [input.revisionId, predecessor.identityId]);
    if (occupied.rows.length > 0) {
      throw new CanonicalIdentityServiceError("TARGET_IDENTITY_POSITION_TAKEN");
    }
    await insertItemGraph(
      tx,
      input,
      itemId,
      predecessor.identityId,
      "VERIFIED_CONTINUATION",
      basis,
      spans,
      fingerprint,
    );
    return {
      physicalItemId: itemId,
      identityId: predecessor.identityId,
      state: "VERIFIED_CONTINUATION",
      basis,
      replayed: false,
    };
  });
}

export async function createAmbiguousKnowledgeItem(
  rawInput: CreateAmbiguousKnowledgeItemInput,
  context: Partial<CanonicalIdentityServiceContext> = {},
): Promise<CanonicalIdentityResult> {
  const input = ambiguousSchema.parse(rawInput);
  const fingerprint = commandFingerprint("AMBIGUOUS", input, {
    candidatePredecessorItemIds: input.candidatePredecessorItemIds,
    reasonCodes: input.reasonCodes,
  });
  return inTransaction(context, async (tx) => {
    const revision = await lockBuildingRevision(tx, input);
    const itemId = serverId("item", input);
    const existing = await loadExistingOperation(tx, input, itemId);
    if (existing) return replayAmbiguous(existing, input, fingerprint);
    assertBuildingRevision(revision);
    const candidates = await tx.query<AmbiguousCandidateRow>(`
      /* canonical-identity:validate-ambiguous-candidates */
      SELECT i."id", i."identityId", i."kind", i."revisionId",
        r."createdAt" AS "revisionCreatedAt", r."status" AS "revisionStatus",
        NOT EXISTS (
          SELECT 1
          FROM "FascicoloKnowledgeItem" later
          INNER JOIN "FascicoloKnowledgeRevision" later_revision
            ON later_revision."id" = later."revisionId"
            AND later_revision."tenantId" = later."tenantId"
            AND later_revision."procedimentoId" = later."procedimentoId"
          WHERE later."tenantId" = i."tenantId"
            AND later."procedimentoId" = i."procedimentoId"
            AND later."identityId" = i."identityId"
            AND later."identityState" IN ('VERIFIED_NEW', 'VERIFIED_CONTINUATION')
            AND later_revision."status" IN ('CURRENT', 'SUPERSEDED')
            AND (later_revision."createdAt", later_revision."id") < ($5, $6)
            AND (
              later_revision."createdAt",
              later_revision."id",
              later."createdAt",
              later."id"
            ) > (r."createdAt", r."id", i."createdAt", i."id")
        ) AS "isLatest"
      FROM "FascicoloKnowledgeItem" i
      INNER JOIN "FascicoloKnowledgeRevision" r
        ON r."id" = i."revisionId" AND r."tenantId" = i."tenantId"
        AND r."procedimentoId" = i."procedimentoId"
      INNER JOIN "FascicoloKnowledgeIdentity" identity
        ON identity."id" = i."identityId" AND identity."tenantId" = i."tenantId"
        AND identity."procedimentoId" = i."procedimentoId" AND identity."kind" = i."kind"
      WHERE i."id" = ANY($1::text[])
        AND i."tenantId" = $2 AND i."procedimentoId" = $3
        AND i."kind" = $4
        AND i."identityState" IN ('VERIFIED_NEW', 'VERIFIED_CONTINUATION')
        AND r."status" IN ('CURRENT', 'SUPERSEDED')
        AND (r."createdAt", r."id") < ($5, $6)
      FOR UPDATE OF i, identity
    `, [input.candidatePredecessorItemIds, input.tenantId, input.procedimentoId,
      input.candidate.kind, revision.createdAt, revision.id]);
    if (
      candidates.rows.length !== input.candidatePredecessorItemIds.length
      || candidates.rows.some((candidate) => (
        candidate.identityId === null
        || candidate.kind !== input.candidate.kind
        || !candidate.isLatest
      ))
    ) {
      throw new CanonicalIdentityServiceError("AMBIGUOUS_CANDIDATE_INVALID");
    }
    const spans = await validateEvidenceAndSpans(tx, input, false);
    const basis = knowledgeIdentityBasisSchema.parse({
      type: "AMBIGUOUS_CONTINUITY",
      candidatePredecessorItemIds: input.candidatePredecessorItemIds,
      reasonCodes: input.reasonCodes,
      sourceSpanFingerprints: spans.map((span) => span.fingerprint),
    });
    await insertItemGraph(tx, input, itemId, null, "AMBIGUOUS", basis, spans, fingerprint);
    return {
      physicalItemId: itemId,
      identityId: null,
      state: "AMBIGUOUS",
      basis,
      replayed: false,
    };
  });
}

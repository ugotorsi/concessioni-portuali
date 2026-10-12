import { prisma } from "@/lib/prisma";
import type { JsonValue, KnowledgeItemReviewStatus } from "@/server/fascicolo-knowledge";

type KnowledgeKind = "PARTY_ROLE" | "FACT" | "EVENT" | "LEGAL_ACT" | "MEASURE" | "CONTRADICTION" | "GAP" | "DEADLINE_CANDIDATE" | "LEGAL_ISSUE" | "RESEARCH_QUESTION";

export interface StructuredKnowledgeReadItem {
  id: string;
  kind: KnowledgeKind;
  semanticKey: string;
  contentFingerprint: string;
  normalizedText: string;
  payload: JsonValue;
  confidence: number | null;
  status: KnowledgeItemReviewStatus;
  reviewVersion: number;
  evidence: readonly {
    provenanceType?: "DOCUMENT_EXTRACTION" | "FASCICOLO_DOCUMENT_EXTRACTION";
    basisRef: string | null;
    documentoId: string;
    documentFileVersionId: string | null;
    extractionAttemptId?: string | null;
    documentExtractionAttemptId?: string | null;
    pageNumber: number;
    textSha256: string;
  }[];
}

export interface StructuredKnowledgeReadModel {
  revision: {
    id: string;
    corpusFingerprint: string;
    contractVersion: string;
    createdAt: Date;
    completedAt: Date | null;
    warnings: readonly string[];
  };
  subjects: readonly { id: string; canonicalName: string; subjectType: string; aliases: readonly string[] }[];
  partyRoles: readonly StructuredKnowledgeReadItem[];
  facts: readonly StructuredKnowledgeReadItem[];
  events: readonly StructuredKnowledgeReadItem[];
  legalActs: readonly StructuredKnowledgeReadItem[];
  measures: readonly StructuredKnowledgeReadItem[];
  contradictions: readonly (StructuredKnowledgeReadItem & { contradictedItemIds: readonly string[] })[];
  gaps: readonly StructuredKnowledgeReadItem[];
  deadlineCandidates: readonly StructuredKnowledgeReadItem[];
  legalIssues: readonly (StructuredKnowledgeReadItem & { originatingItemIds: readonly string[] })[];
  researchQuestions: readonly (StructuredKnowledgeReadItem & { legalIssueId: string | null })[];
  timeline: readonly StructuredKnowledgeReadItem[];
}

interface RevisionRow { id: string; corpusFingerprint: string; contractVersion: string; createdAt: Date; completedAt: Date | null; warnings: unknown }
interface ItemRow extends Omit<StructuredKnowledgeReadItem, "payload" | "evidence"> { structuredPayload: JsonValue }
interface EvidenceRow {
  itemId: string;
  provenanceType: "DOCUMENT_EXTRACTION" | "FASCICOLO_DOCUMENT_EXTRACTION";
  basisRef: string | null;
  documentoId: string;
  documentFileVersionId: string | null;
  extractionAttemptId: string | null;
  documentExtractionAttemptId: string | null;
  pageNumber: number;
  textSha256: string;
}
interface RelationRow { sourceItemId: string; targetItemId: string; relationType: string }
interface SubjectRow { id: string; canonicalName: string; subjectType: string; aliases: unknown }

export interface StructuredKnowledgeQueryExecutor {
  query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

const defaultExecutor: StructuredKnowledgeQueryExecutor = {
  async query<T>(sql: string, params: readonly unknown[] = []) {
    return { rows: await prisma.$queryRawUnsafe<T[]>(sql, ...params) };
  },
};

function record(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const timelineRank: Readonly<Record<string, number>> = {
  EXACT: 0,
  INTERVAL: 1,
  MONTH: 2,
  YEAR: 3,
  UNCERTAIN: 4,
  UNKNOWN: 5,
};

function timelineOrder(left: StructuredKnowledgeReadItem, right: StructuredKnowledgeReadItem): number {
  const leftDate = record(record(left.payload).date);
  const rightDate = record(record(right.payload).date);
  const precision = (timelineRank[String(leftDate.precision)] ?? 6) - (timelineRank[String(rightDate.precision)] ?? 6);
  if (precision !== 0) return precision;
  const date = String(leftDate.from ?? "9999").localeCompare(String(rightDate.from ?? "9999"));
  return date !== 0 ? date : left.semanticKey.localeCompare(right.semanticKey);
}

export async function loadCurrentStructuredKnowledge(
  tenantId: string,
  procedimentoId: string,
  executor: StructuredKnowledgeQueryExecutor = defaultExecutor,
): Promise<StructuredKnowledgeReadModel | null> {
  const revisions = await executor.query<RevisionRow>(`
    SELECT "id", "corpusFingerprint", "contractVersion", "createdAt", "completedAt", "warnings"
    FROM "FascicoloKnowledgeRevision"
    WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "status" = 'CURRENT'
  `, [tenantId, procedimentoId]);
  const revision = revisions.rows[0];
  if (!revision) return null;
  const [itemRows, evidenceRows, relationRows] = await Promise.all([
    executor.query<ItemRow>(`
      SELECT "id", "kind", "semanticKey", "contentFingerprint", "normalizedText", "structuredPayload", "confidence", "status", "reviewVersion"
      FROM "FascicoloKnowledgeItem"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
        AND "supersededAt" IS NULL
      ORDER BY "createdAt", "id"
    `, [tenantId, procedimentoId, revision.id]),
    executor.query<EvidenceRow>(`
      SELECT e."itemId", e."provenanceType", e."basisRef", e."documentoId", e."documentFileVersionId",
        e."extractionAttemptId", e."documentExtractionAttemptId", e."pageNumber", e."textSha256"
      FROM "FascicoloKnowledgeEvidence" e
      INNER JOIN "FascicoloKnowledgeItem" i ON i."id" = e."itemId"
        AND i."tenantId" = e."tenantId" AND i."procedimentoId" = e."procedimentoId"
      WHERE e."tenantId" = $1 AND e."procedimentoId" = $2 AND i."revisionId" = $3
        AND i."supersededAt" IS NULL
      ORDER BY e."createdAt", e."id"
    `, [tenantId, procedimentoId, revision.id]),
    executor.query<RelationRow>(`
      SELECT "sourceItemId", "targetItemId", "relationType"
      FROM "FascicoloKnowledgeRelation"
      WHERE "tenantId" = $1 AND "procedimentoId" = $2 AND "revisionId" = $3
      ORDER BY "createdAt", "id"
    `, [tenantId, procedimentoId, revision.id]),
  ]);
  const items = itemRows.rows.map((item) => ({
    id: item.id,
    kind: item.kind,
    semanticKey: item.semanticKey,
    contentFingerprint: item.contentFingerprint,
    normalizedText: item.normalizedText,
    payload: item.structuredPayload,
    confidence: item.confidence,
    status: item.status,
    reviewVersion: item.reviewVersion,
    evidence: evidenceRows.rows.filter((evidence) => evidence.itemId === item.id).map(({ itemId: _itemId, ...evidence }) => evidence),
  }));
  const subjectIds = [...new Set(items.flatMap((item) => strings(record(item.payload).subjectIds)))];
  const subjects = subjectIds.length === 0 ? [] : (await executor.query<SubjectRow>(`
    SELECT "id", "canonicalName", "subjectType", "aliases"
    FROM "FascicoloSubject"
    WHERE "tenantId" = $1 AND "mergedIntoId" IS NULL AND "id" = ANY($2::text[])
    ORDER BY "normalizedName", "id"
  `, [tenantId, subjectIds])).rows;
  const byKind = (kind: KnowledgeKind) => items.filter((item) => item.kind === kind);
  const visibleByKind = (kind: KnowledgeKind) => byKind(kind).filter((item) => item.status !== "REJECTED");
  const contradictions = visibleByKind("CONTRADICTION").map((item) => ({
    ...item,
    contradictedItemIds: relationRows.rows.filter((relation) => relation.sourceItemId === item.id
      && relation.relationType === "CONTRADICTS").map((relation) => relation.targetItemId),
  }));
  const events = visibleByKind("EVENT");
  const legalIssues = byKind("LEGAL_ISSUE").map((item) => ({
    ...item,
    originatingItemIds: relationRows.rows.filter((relation) => relation.sourceItemId === item.id
      && relation.relationType === "ISSUE_DERIVED_FROM").map((relation) => relation.targetItemId),
  }));
  const researchQuestions = byKind("RESEARCH_QUESTION").map((item) => ({
    ...item,
    legalIssueId: relationRows.rows.find((relation) => relation.sourceItemId === item.id
      && relation.relationType === "QUESTION_FOR_ISSUE")?.targetItemId ?? null,
  }));
  return {
    revision: { ...revision, warnings: strings(revision.warnings) },
    subjects: subjects.map((subject) => ({ ...subject, aliases: strings(subject.aliases) })),
    partyRoles: visibleByKind("PARTY_ROLE"),
    facts: visibleByKind("FACT"),
    events,
    legalActs: visibleByKind("LEGAL_ACT"),
    measures: visibleByKind("MEASURE"),
    contradictions,
    gaps: visibleByKind("GAP"),
    deadlineCandidates: visibleByKind("DEADLINE_CANDIDATE"),
    legalIssues,
    researchQuestions,
    timeline: [...events].sort(timelineOrder),
  };
}
import { createHash } from "node:crypto";

import {
  CANONICAL_IDENTITY_V3_CONTRACT_VERSION,
} from "./canonicalIntegrationGate";
import {
  CanonicalIdentityServiceError,
  continueVerifiedKnowledgeIdentity,
  createAmbiguousKnowledgeItem,
  createVerifiedKnowledgeIdentity,
  type CanonicalIdentityServiceContext,
} from "./canonicalIdentityService";
import { canonicalJson } from "./canonicalization";
import type {
  JsonValue,
  KnowledgeEvidenceCandidate,
  KnowledgeIdentityState,
  KnowledgeReconciliationClassification,
  KnowledgeScope,
  PreparedKnowledgeItemCandidate,
} from "./contracts";
import {
  createBuildingKnowledgeRevision,
  getCurrentKnowledgeRevision,
  reconcileAndPromoteKnowledgeRevision,
  resolveKnowledgeSubjects,
  runInFascicoloKnowledgeTransaction,
  type FascicoloKnowledgeRepositoryContext,
  type KnowledgeReconciliationResult,
} from "./repository";
import {
  fascicoloStructuredKnowledgeSchema,
} from "./structuredContracts";
import {
  assertStructuredKnowledgeQuality,
  projectStructuredKnowledge,
} from "./structuredProjection";
import type { StructuredKnowledgePersistenceResult } from "./structuredPersistence";

type SnapshotItem = NonNullable<Awaited<ReturnType<typeof getCurrentKnowledgeRevision>>>["items"][number];

const verifiedIdentityStates = new Set<KnowledgeIdentityState>([
  "VERIFIED_NEW",
  "VERIFIED_CONTINUATION",
]);

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function record(value: JsonValue): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function continuityMaterial(kind: string, payloadValue: JsonValue): JsonValue {
  const payload = record(payloadValue);
  const proceeding = record(payload.proceedingIdentity);
  const targetProceeding = record(payload.targetProceedingIdentity);
  switch (kind) {
    case "PARTY_ROLE":
      return { kind, subjectIds: payload.subjectIds ?? [], role: payload.role ?? null, context: payload.context ?? null };
    case "PARTY_POSITION":
      return {
        kind,
        subjectIds: payload.subjectIds ?? [],
        positionType: payload.positionType ?? null,
        context: payload.context ?? null,
      };
    case "FACT":
      return {
        kind,
        subjectIds: payload.subjectIds ?? [],
        object: payload.object ?? null,
        qualifier: payload.qualifier ?? null,
        proceedingAnchor: proceeding.canonicalAnchorSemanticKey ?? null,
        proceedingKind: proceeding.kind ?? null,
      };
    case "EVENT":
      return {
        kind,
        subjectIds: payload.subjectIds ?? [],
        date: payload.date ?? null,
        proceedingAnchor: proceeding.canonicalAnchorSemanticKey ?? null,
        proceedingKind: proceeding.kind ?? null,
      };
    case "LEGAL_ACT":
    case "MEASURE":
      return {
        kind,
        documentBasisRef: payload.documentBasisRef ?? null,
        actType: payload.actType ?? null,
        subjectIds: payload.subjectIds ?? [],
        number: payload.number ?? null,
        date: payload.date ?? null,
      };
    case "CONTRADICTION":
      return { kind, relatedSemanticKeys: payload.relatedSemanticKeys ?? [] };
    case "GAP":
      return {
        kind,
        gapType: payload.gapType ?? null,
        relatedSemanticKeys: payload.relatedSemanticKeys ?? [],
      };
    case "DEADLINE_CANDIDATE":
      return { kind, deadlineType: payload.deadlineType ?? null, baseDate: payload.baseDate ?? null };
    case "LEGAL_ISSUE":
      return {
        kind,
        areaOfLaw: payload.areaOfLaw ?? null,
        proceedingAnchor: targetProceeding.canonicalAnchorSemanticKey ?? null,
        proceedingKind: targetProceeding.kind ?? null,
      };
    case "RESEARCH_QUESTION":
      return {
        kind,
        legalIssueSemanticKey: payload.legalIssueSemanticKey ?? null,
        referenceDateBasis: payload.referenceDateBasis ?? null,
        mode: payload.mode ?? null,
      };
    default:
      return { kind, payload };
  }
}

function continuityKey(item: Pick<SnapshotItem, "kind" | "structuredPayload"> | PreparedKnowledgeItemCandidate): string {
  const payload = "structuredPayload" in item ? item.structuredPayload : null;
  return digest(canonicalJson(continuityMaterial(item.kind, payload)));
}

export function buildCanonicalSourceSpans(
  candidate: PreparedKnowledgeItemCandidate,
  sourceTextByBasisRef: ReadonlyMap<string, string>,
) {
  const payload = candidate.structuredPayload;
  const sourceQuotes = payload && typeof payload === "object" && !Array.isArray(payload)
    && Array.isArray(payload.sourceQuotes)
    ? payload.sourceQuotes.flatMap((sourceQuote) => (
        sourceQuote
        && typeof sourceQuote === "object"
        && !Array.isArray(sourceQuote)
        && typeof sourceQuote.basisRef === "string"
        && typeof sourceQuote.quote === "string"
          ? [{ basisRef: sourceQuote.basisRef, quote: sourceQuote.quote }]
          : []
      ))
    : [];
  const evidenceBasisRefs = new Set(candidate.evidence.map((evidence) => evidence.basisRef));
  if (sourceQuotes.some((sourceQuote) => !evidenceBasisRefs.has(sourceQuote.basisRef))) {
    throw new Error(`CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED:${candidate.semanticKey}`);
  }
  return candidate.evidence.flatMap((evidence) => {
    const trustedText = sourceTextByBasisRef.get(evidence.basisRef);
    if (!trustedText) throw new Error(`CANONICAL_SOURCE_TEXT_MISSING:${evidence.basisRef}`);
    if (digest(trustedText) !== evidence.textSha256) {
      throw new Error(`CANONICAL_SOURCE_TEXT_HASH_MISMATCH:${evidence.basisRef}`);
    }
    const quotes = sourceQuotes.filter((sourceQuote) => sourceQuote.basisRef === evidence.basisRef);
    if (quotes.length === 0) {
      throw new Error(`CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED:${candidate.semanticKey}:${evidence.basisRef}`);
    }
    return quotes.map(({ quote }) => {
      const startOffset = trustedText.indexOf(quote);
      const consumesWholePage = startOffset >= 0
        && trustedText.slice(0, startOffset).trim().length === 0
        && trustedText.slice(startOffset + quote.length).trim().length === 0;
      if (quote.length === 0 || startOffset < 0
        || startOffset !== trustedText.lastIndexOf(quote) || consumesWholePage) {
        throw new Error(`CANONICAL_ITEM_SOURCE_QUOTE_REQUIRED:${candidate.semanticKey}:${evidence.basisRef}`);
      }
      return {
        basisRef: evidence.basisRef,
        startOffset,
        endOffset: startOffset + quote.length,
        quote,
        quoteSha256: digest(quote),
      };
    });
  });
}

function idempotencyKey(revisionId: string, candidate: PreparedKnowledgeItemCandidate): string {
  return `canonical-v3:${digest(`${revisionId}\u001f${candidate.kind}\u001f${candidate.semanticKey}`)}`;
}

function priorCandidates(
  candidate: PreparedKnowledgeItemCandidate,
  previousItems: readonly SnapshotItem[],
): readonly SnapshotItem[] {
  const eligible = previousItems.filter((item) => (
    item.kind === candidate.kind
    && item.identityId
    && item.identityState
    && verifiedIdentityStates.has(item.identityState)
  ));
  const exact = eligible.filter((item) => (
    item.semanticKeyVersion === candidate.semanticKeyVersion
    && item.semanticKey === candidate.semanticKey
  ));
  if (exact.length > 0) return exact;
  const key = continuityKey(candidate);
  return eligible.filter((item) => continuityKey(item) === key);
}

function classification(
  predecessor: SnapshotItem | null,
  candidate: PreparedKnowledgeItemCandidate,
): KnowledgeReconciliationClassification {
  if (!predecessor) return "ADDED";
  return predecessor.contentFingerprint === candidate.contentFingerprint ? "UNCHANGED" : "MODIFIED";
}

export async function persistCanonicalStructuredKnowledgeRevision(input: KnowledgeScope & {
  corpusFingerprint: string;
  knowledge: unknown;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  sourceTextByBasisRef: ReadonlyMap<string, string>;
}, overrides: Partial<FascicoloKnowledgeRepositoryContext> = {}): Promise<StructuredKnowledgePersistenceResult> {
  const knowledge = fascicoloStructuredKnowledgeSchema.parse(input.knowledge);
  return runInFascicoloKnowledgeTransaction(async (transactionContext) => {
    const subjects = await resolveKnowledgeSubjects({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      candidates: knowledge.subjects,
    }, transactionContext);
    const subjectIdsByLocalId = new Map([...subjects].map(([localId, subject]) => [localId, subject.id]));
    const projection = projectStructuredKnowledge({
      knowledge,
      subjectIdsByLocalId,
      evidenceByBasisRef: input.evidenceByBasisRef,
      sourceTextByBasisRef: input.sourceTextByBasisRef,
    });
    assertStructuredKnowledgeQuality(projection.quality);
    const current = await getCurrentKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
    }, transactionContext);
    const building = await createBuildingKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      corpusFingerprint: input.corpusFingerprint,
      contractVersion: CANONICAL_IDENTITY_V3_CONTRACT_VERSION,
      warnings: [...projection.warnings],
    }, transactionContext);
    const serviceContext: Partial<CanonicalIdentityServiceContext> = {
      transaction: transactionContext.transaction,
    };
    const predecessorsByCandidate = projection.candidates.map((candidate) => (
      priorCandidates(candidate, current?.items ?? [])
    ));
    const predecessorClaimCounts = new Map<string, number>();
    for (const predecessors of predecessorsByCandidate) {
      if (predecessors.length !== 1) continue;
      const predecessorId = predecessors[0].id;
      predecessorClaimCounts.set(
        predecessorId,
        (predecessorClaimCounts.get(predecessorId) ?? 0) + 1,
      );
    }
    const associatedPredecessorIds = new Set<string>();
    const classifications: KnowledgeReconciliationResult["classifications"][number][] = [];
    for (const [candidateIndex, candidate] of projection.candidates.entries()) {
      const predecessors = predecessorsByCandidate[candidateIndex];
      const contestedPredecessor = predecessors.length === 1
        && (predecessorClaimCounts.get(predecessors[0].id) ?? 0) > 1;
      const spans = buildCanonicalSourceSpans(candidate, input.sourceTextByBasisRef);
      const common = {
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        revisionId: building.id,
        idempotencyKey: idempotencyKey(building.id, candidate),
        candidate,
        sourceSpans: spans,
      };
      let predecessor = predecessors.length === 1 && !contestedPredecessor
        ? predecessors[0]
        : null;
      let result;
      if (predecessors.length === 0) {
        result = await createVerifiedKnowledgeIdentity(common, serviceContext);
      } else if (predecessor) {
        try {
          result = await continueVerifiedKnowledgeIdentity({
            ...common,
            predecessorItemId: predecessor.id,
          }, serviceContext);
          associatedPredecessorIds.add(predecessor.id);
        } catch (error) {
          if (!(error instanceof CanonicalIdentityServiceError)
            || error.code !== "DOCUMENT_CONTINUITY_NOT_VERIFIED") throw error;
          predecessor = null;
          result = await createVerifiedKnowledgeIdentity(common, serviceContext);
        }
      } else {
        result = await createAmbiguousKnowledgeItem({
          ...common,
          candidatePredecessorItemIds: predecessors.map((item) => item.id),
          reasonCodes: [
            contestedPredecessor
              ? "MULTIPLE_CANDIDATES_FOR_PREDECESSOR"
              : "MULTIPLE_PREDECESSORS",
          ],
        }, serviceContext);
        for (const candidatePredecessor of predecessors) {
          associatedPredecessorIds.add(candidatePredecessor.id);
        }
      }
      if (predecessor?.contentFingerprint === candidate.contentFingerprint
        && predecessor.status === "HUMAN_CONFIRMED") {
        await transactionContext.read.query(`
          UPDATE "FascicoloKnowledgeItem"
          SET "status" = 'HUMAN_CONFIRMED', "reviewVersion" = $4
          WHERE "id" = $1 AND "tenantId" = $2 AND "procedimentoId" = $3
            AND "revisionId" = $5 AND "identityId" = $6
        `, [
          result.physicalItemId,
          input.tenantId,
          input.procedimentoId,
          predecessor.reviewVersion,
          building.id,
          result.identityId,
        ]);
      }
      if (predecessor && result.state === "VERIFIED_CONTINUATION") {
        await transactionContext.read.query(`
          INSERT INTO "FascicoloKnowledgeRelation" (
            "id", "tenantId", "procedimentoId", "revisionId",
            "sourceItemId", "targetItemId", "relationType"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'SUPERSEDES')
        `, [
          `relation:${digest(`${building.id}\u001f${result.physicalItemId}\u001f${predecessor.id}`)}`,
          input.tenantId,
          input.procedimentoId,
          building.id,
          result.physicalItemId,
          predecessor.id,
        ]);
      }
      classifications.push({
        classification: predecessors.length > 1 || contestedPredecessor
          ? "MODIFIED"
          : classification(predecessor, candidate),
        semanticKey: candidate.semanticKey,
        previousItemId: predecessor?.id ?? null,
        nextItemId: result.physicalItemId,
      });
    }
    const nextSemanticKeys = new Set(projection.candidates.map((candidate) => candidate.semanticKey));
    for (const previous of current?.items ?? []) {
      if (!nextSemanticKeys.has(previous.semanticKey)
        && !associatedPredecessorIds.has(previous.id)) {
        classifications.push({
          classification: "NO_LONGER_SUPPORTED",
          semanticKey: previous.semanticKey,
          previousItemId: previous.id,
          nextItemId: null,
        });
      }
    }
    const promoted = await reconcileAndPromoteKnowledgeRevision({
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      revisionId: building.id,
      expectedCurrentRevisionId: current?.id ?? null,
      candidates: [],
      relations: projection.relations,
    }, transactionContext);
    return {
      ...promoted,
      classifications,
      warnings: projection.warnings,
      subjectIdsByLocalId,
      quality: projection.quality,
    };
  }, overrides);
}

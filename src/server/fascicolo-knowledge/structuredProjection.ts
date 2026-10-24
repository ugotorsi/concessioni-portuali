import {
  buildKnowledgeSemanticKey,
  prepareKnowledgeItemCandidate,
} from "./canonicalization";
import type {
  KnowledgeEvidenceCandidate,
  KnowledgeItemCandidate,
  KnowledgeRelationType,
  PreparedKnowledgeItemCandidate,
} from "./contracts";
import {
  FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
  fascicoloStructuredKnowledgeSchema,
  type FascicoloStructuredKnowledge,
  type StructuredKnowledgeItem,
} from "./structuredContracts";

export interface StructuredKnowledgeRelationPlan {
  sourceSemanticKey: string;
  targetSemanticKey: string;
  relationType: Extract<KnowledgeRelationType, "CONTRADICTS" | "RELATED_TO" | "ISSUE_DERIVED_FROM" | "QUESTION_FOR_ISSUE">;
}

export interface StructuredKnowledgeProjection {
  candidates: readonly PreparedKnowledgeItemCandidate[];
  relations: readonly StructuredKnowledgeRelationPlan[];
  warnings: readonly string[];
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function resolvedSubjectIds(item: StructuredKnowledgeItem, subjects: ReadonlyMap<string, string>): readonly string[] {
  const localIds = item.kind === "PARTY_ROLE" || item.kind === "PARTY_POSITION" ? [item.payload.subjectLocalId]
    : item.kind === "FACT" || item.kind === "EVENT" ? item.payload.subjectLocalIds
      : item.kind === "LEGAL_ACT" || item.kind === "MEASURE"
        ? [item.payload.authoritySubjectLocalId].filter((value): value is string => value !== null)
        : [];
  return sorted(localIds.map((localId) => {
    const subjectId = subjects.get(localId);
    if (!subjectId) throw new Error(`UNRESOLVED_SUBJECT:${localId}`);
    return subjectId;
  }));
}

function identityFor(
  item: StructuredKnowledgeItem,
  subjectIds: readonly string[],
  dependencies: readonly string[],
  proceedingAnchorSemanticKey: string | null,
): string {
  switch (item.kind) {
    case "PARTY_ROLE": return [subjectIds[0], normalized(item.payload.role), normalized(item.payload.context ?? "")].join("|");
    case "PARTY_POSITION": return [subjectIds[0], item.payload.positionType, normalized(item.payload.normalizedStatement)].join("|");
    case "FACT": return [
      normalized(item.payload.normalizedStatement),
      ...subjectIds,
      ...(proceedingAnchorSemanticKey ? [
        normalized(item.payload.object ?? ""),
        normalized(item.payload.qualifier ?? ""),
        proceedingAnchorSemanticKey,
      ] : []),
    ].join("|");
    case "EVENT": return [
      normalized(item.payload.normalizedStatement),
      JSON.stringify(item.payload.date),
      ...subjectIds,
      ...(proceedingAnchorSemanticKey ? [
        normalized(item.payload.title),
        ...sorted(dependencies),
        proceedingAnchorSemanticKey,
      ] : []),
    ].join("|");
    case "LEGAL_ACT":
    case "MEASURE": return [item.payload.documentBasisRef, normalized(item.payload.actType), subjectIds[0] ?? "", normalized(item.payload.number ?? ""), JSON.stringify(item.payload.date)].join("|");
    case "CONTRADICTION": return sorted(dependencies).join("|");
    case "GAP": return [normalized(item.payload.gapType), normalized(item.payload.description)].join("|");
    case "DEADLINE_CANDIDATE": return [item.payload.deadlineType, JSON.stringify(item.payload.baseDate), JSON.stringify(item.payload.resultingDate), normalized(item.payload.ruleText ?? "")].join("|");
  }
}

function materialPayload(
  item: StructuredKnowledgeItem,
  subjectIds: readonly string[],
  dependencyKeys: readonly string[],
  proceedingAnchorSemanticKey: string | null,
  sourceQuotes: readonly { basisRef: string; quote: string }[],
) {
  const payload = { ...item.payload } as Record<string, unknown>;
  const proceedingIdentity = item.kind === "FACT" || item.kind === "EVENT"
    ? item.payload.proceedingIdentity
    : null;
  delete payload.subjectLocalId;
  delete payload.subjectLocalIds;
  delete payload.authoritySubjectLocalId;
  delete payload.relatedItemLocalIds;
  delete payload.conflictingItemLocalIds;
  delete payload.proceedingIdentity;
  return {
    ...payload,
    subjectIds: [...subjectIds],
    relatedSemanticKeys: [...sorted(dependencyKeys)],
    sourceQuotes: [...sourceQuotes],
    ...(proceedingIdentity && proceedingAnchorSemanticKey ? {
      proceedingIdentity: {
        ...(proceedingIdentity.declaredKey ? { declaredKey: proceedingIdentity.declaredKey } : {}),
        canonicalAnchorSemanticKey: proceedingAnchorSemanticKey,
        kind: proceedingIdentity.kind,
        evidenceBasisRefs: proceedingIdentity.evidenceBasisRefs,
      },
    } : {}),
    semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
  };
}

function projectedSourceQuotes(candidate: PreparedKnowledgeItemCandidate) {
  if (!candidate.structuredPayload || typeof candidate.structuredPayload !== "object"
    || Array.isArray(candidate.structuredPayload)) return [];
  const sourceQuotes = candidate.structuredPayload.sourceQuotes;
  if (!Array.isArray(sourceQuotes)) return [];
  return sourceQuotes.flatMap((sourceQuote) => (
    sourceQuote
    && typeof sourceQuote === "object"
    && !Array.isArray(sourceQuote)
    && typeof sourceQuote.basisRef === "string"
    && typeof sourceQuote.quote === "string"
      ? [{ basisRef: sourceQuote.basisRef, quote: sourceQuote.quote }]
      : []
  ));
}

function uniqueSourceQuotes(candidates: readonly PreparedKnowledgeItemCandidate[]) {
  return candidates.flatMap(projectedSourceQuotes).filter((sourceQuote, index, all) => (
    all.findIndex((candidate) => (
      candidate.basisRef === sourceQuote.basisRef && candidate.quote === sourceQuote.quote
    )) === index
  ));
}

function hasDocumentedProceedingIdentity(item: StructuredKnowledgeItem): boolean {
  if (item.kind !== "FACT" && item.kind !== "EVENT") return true;
  const identity = item.payload.proceedingIdentity;
  return identity == null || identity.evidenceBasisRefs.every((basisRef) => item.basisRefs.includes(basisRef));
}

function proceedingAnchorLocalId(item: StructuredKnowledgeItem): string | null {
  return item.kind === "FACT" || item.kind === "EVENT"
    ? item.payload.proceedingIdentity?.canonicalAnchorLocalId ?? null
    : null;
}

function isCanonicalProceedingAnchor(item: StructuredKnowledgeItem | undefined): boolean {
  return item?.kind === "LEGAL_ACT" || item?.kind === "MEASURE";
}

export function projectStructuredKnowledge(input: {
  knowledge: FascicoloStructuredKnowledge;
  subjectIdsByLocalId: ReadonlyMap<string, string>;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
}): StructuredKnowledgeProjection {
  const knowledge = fascicoloStructuredKnowledgeSchema.parse(input.knowledge);
  const warnings: string[] = [];
  const candidates: PreparedKnowledgeItemCandidate[] = [];
  const candidatesByLocalId = new Map<string, PreparedKnowledgeItemCandidate>();
  const semanticKeysByLocalId = new Map<string, string>();
  const itemsByLocalId = new Map(knowledge.items.map((item) => [item.localId, item]));
  const pending = [...knowledge.items];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const item = pending[index];
      const dependencyLocalIds = item.kind === "CONTRADICTION" ? item.payload.conflictingItemLocalIds
        : item.kind === "PARTY_POSITION" || item.kind === "EVENT" || item.kind === "GAP" ? item.payload.relatedItemLocalIds : [];
      const anchorLocalId = proceedingAnchorLocalId(item);
      const allDependencyLocalIds = [...new Set([
        ...dependencyLocalIds,
        ...(anchorLocalId ? [anchorLocalId] : []),
      ])];
      const dependencyKeys = allDependencyLocalIds.map((localId) => semanticKeysByLocalId.get(localId));
      if (dependencyKeys.some((key) => !key)) continue;
      const relatedDependencyKeys = dependencyLocalIds.map((localId) => semanticKeysByLocalId.get(localId));
      if (relatedDependencyKeys.some((key) => !key)) continue;
      const evidence = item.basisRefs.map((basisRef) => input.evidenceByBasisRef.get(basisRef));
      if (evidence.some((entry) => !entry) || !hasDocumentedProceedingIdentity(item)) {
        warnings.push(`INVALID_EVIDENCE:${item.localId}`);
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      try {
        if (anchorLocalId && !isCanonicalProceedingAnchor(itemsByLocalId.get(anchorLocalId))) {
          throw new Error(`INVALID_PROCEEDING_ANCHOR:${anchorLocalId}`);
        }
        const proceedingAnchorSemanticKey = anchorLocalId
          ? semanticKeysByLocalId.get(anchorLocalId) ?? null
          : null;
        const subjectIds = resolvedSubjectIds(item, input.subjectIdsByLocalId);
        const normalizedIdentity = identityFor(
          item,
          subjectIds,
          relatedDependencyKeys as string[],
          proceedingAnchorSemanticKey,
        );
        const candidate: KnowledgeItemCandidate = {
          kind: item.kind,
          normalizedIdentity,
          normalizedText: item.kind === "PARTY_ROLE" ? `${item.payload.role}${item.payload.context ? ` (${item.payload.context})` : ""}`
            : "normalizedStatement" in item.payload ? item.payload.normalizedStatement
              : "description" in item.payload ? item.payload.description
                : "title" in item.payload ? item.payload.title
                  : item.payload.ruleText ?? item.payload.calculationExplanation ?? item.payload.deadlineType,
          structuredPayload: materialPayload(
            item,
            subjectIds,
            dependencyKeys as string[],
            proceedingAnchorSemanticKey,
            knowledge.sourceQuotes
              .filter((sourceQuote) => sourceQuote.itemLocalId === item.localId)
              .map(({ basisRef, quote }) => ({ basisRef, quote })),
          ),
          confidence: item.confidence,
          evidence: evidence as KnowledgeEvidenceCandidate[],
        };
        const basePrepared = prepareKnowledgeItemCandidate(candidate);
        const semanticKey = buildKnowledgeSemanticKey({
          kind: item.kind,
          normalizedIdentity,
          semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
        });
        const prepared = {
          ...basePrepared,
          semanticKey,
          semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
        };
        candidates.push(prepared);
        candidatesByLocalId.set(item.localId, prepared);
        semanticKeysByLocalId.set(item.localId, semanticKey);
      } catch {
        warnings.push(`INVALID_SUBJECT:${item.localId}`);
      }
      pending.splice(index, 1);
      progressed = true;
    }
  }
  for (const item of pending) warnings.push(`UNRESOLVED_DEPENDENCY:${item.localId}`);
  const issueSemanticKeysByLocalId = new Map<string, string>();
  for (const issue of knowledge.legalIssues) {
    const origins = issue.originatingItemLocalIds.map((localId) => candidatesByLocalId.get(localId));
    if (origins.some((origin) => !origin)) {
      warnings.push(`INVALID_ISSUE_ORIGIN:${issue.localId}`);
      continue;
    }
    const originCandidates = origins as PreparedKnowledgeItemCandidate[];
    const targetIdentity = issue.targetProceedingIdentity;
    const targetAnchor = targetIdentity
      ? candidatesByLocalId.get(targetIdentity.canonicalAnchorLocalId)
      : null;
    if (targetIdentity && (
      !targetAnchor
      || !isCanonicalProceedingAnchor(itemsByLocalId.get(targetIdentity.canonicalAnchorLocalId))
      || !issue.originatingItemLocalIds.includes(targetIdentity.canonicalAnchorLocalId)
    )) {
      warnings.push(`INVALID_PROCEEDING_ANCHOR:${issue.localId}`);
      continue;
    }
    const originBasisRefs = new Set(originCandidates.flatMap((origin) => origin.evidence.map((entry) => entry.basisRef)));
    if (targetIdentity && !targetIdentity.evidenceBasisRefs.every((basisRef) => originBasisRefs.has(basisRef))) {
      warnings.push(`INVALID_PROCEEDING_IDENTITY_EVIDENCE:${issue.localId}`);
      continue;
    }
    const normalizedIdentity = [
      normalized(issue.normalizedIssue),
      ...(targetAnchor ? [
        ...sorted(originCandidates.map((origin) => origin.semanticKey)),
        targetAnchor.semanticKey,
      ] : []),
    ].join("|");
    const candidate = prepareKnowledgeItemCandidate({
      kind: "LEGAL_ISSUE",
      normalizedIdentity,
      normalizedText: issue.title,
      structuredPayload: {
        title: issue.title,
        normalizedIssue: issue.normalizedIssue,
        areaOfLaw: issue.areaOfLaw,
        priority: issue.priority,
        rationale: issue.rationale,
        originatingSemanticKeys: sorted(originCandidates.map((origin) => origin.semanticKey)),
        confidence: issue.confidence,
        referenceDateBasis: issue.referenceDateBasis,
        sourceQuotes: uniqueSourceQuotes(originCandidates),
        ...(issue.targetProceedingIdentity && targetAnchor
          ? {
              targetProceedingIdentity: {
                ...(issue.targetProceedingIdentity.declaredKey
                  ? { declaredKey: issue.targetProceedingIdentity.declaredKey }
                  : {}),
                canonicalAnchorSemanticKey: targetAnchor.semanticKey,
                kind: issue.targetProceedingIdentity.kind,
                evidenceBasisRefs: issue.targetProceedingIdentity.evidenceBasisRefs,
              },
            }
          : {}),
        semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
      },
      confidence: issue.confidence,
      evidence: originCandidates.flatMap((origin) => origin.evidence)
        .filter((entry, index, all) => all.findIndex((candidateEvidence) => JSON.stringify(candidateEvidence) === JSON.stringify(entry)) === index),
    });
    const prepared = {
      ...candidate,
      semanticKey: buildKnowledgeSemanticKey({
        kind: "LEGAL_ISSUE",
        normalizedIdentity,
        semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
      }),
      semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
    };
    candidates.push(prepared);
    candidatesByLocalId.set(issue.localId, prepared);
    issueSemanticKeysByLocalId.set(issue.localId, prepared.semanticKey);
  }
  for (const question of knowledge.researchQuestions) {
    const issue = candidatesByLocalId.get(question.legalIssueLocalId);
    if (!issue) {
      warnings.push(`INVALID_QUESTION_ISSUE:${question.localId}`);
      continue;
    }
    const basisItemSemanticKey = question.referenceDateBasis.itemLocalId
      ? candidatesByLocalId.get(question.referenceDateBasis.itemLocalId)?.semanticKey ?? null
      : null;
    if (question.referenceDateBasis.itemLocalId && !basisItemSemanticKey) {
      warnings.push(`INVALID_REFERENCE_DATE_BASIS:${question.localId}`);
      continue;
    }
    const normalizedIdentity = [issue.semanticKey, normalized(question.canonicalQuestion)].join("|");
    const candidate = prepareKnowledgeItemCandidate({
      kind: "RESEARCH_QUESTION",
      normalizedIdentity,
      normalizedText: question.canonicalQuestion,
      structuredPayload: {
        legalIssueSemanticKey: issue.semanticKey,
        canonicalQuestion: question.canonicalQuestion,
        priority: question.priority,
        referenceDate: question.referenceDate,
        referenceDateBasis: {
          type: question.referenceDateBasis.type,
          itemSemanticKey: basisItemSemanticKey,
          rationale: question.referenceDateBasis.rationale,
          userConfirmedDateSource: question.referenceDateBasis.userConfirmedDateSource,
        },
        requestedCapabilities: sorted(question.requestedCapabilities),
        mode: question.mode,
        sourceQuotes: projectedSourceQuotes(issue),
        semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
      },
      confidence: null,
      evidence: issue.evidence,
    });
    const prepared = {
      ...candidate,
      semanticKey: buildKnowledgeSemanticKey({
        kind: "RESEARCH_QUESTION",
        normalizedIdentity,
        semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
      }),
      semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
    };
    candidates.push(prepared);
    candidatesByLocalId.set(question.localId, prepared);
  }
  if ((knowledge.items.length > 0 || knowledge.legalIssues.length > 0 || knowledge.researchQuestions.length > 0)
    && candidates.length === 0) throw new Error("STRUCTURED_KNOWLEDGE_NO_VALID_ITEMS");
  const included = new Set(candidates.map((candidate) => candidate.semanticKey));
  const contradictionRelations = knowledge.items.flatMap((item) => {
    if (item.kind !== "CONTRADICTION") return [];
    const sourceSemanticKey = semanticKeysByLocalId.get(item.localId);
    if (!sourceSemanticKey || !included.has(sourceSemanticKey)) return [];
    return item.payload.conflictingItemLocalIds.flatMap((targetLocalId) => {
      const targetSemanticKey = semanticKeysByLocalId.get(targetLocalId);
      return targetSemanticKey && included.has(targetSemanticKey)
        ? [{ sourceSemanticKey, targetSemanticKey, relationType: "CONTRADICTS" as const }]
        : [];
    });
  });
  const issueRelations = knowledge.legalIssues.flatMap((issue) => {
    const sourceSemanticKey = issueSemanticKeysByLocalId.get(issue.localId);
    if (!sourceSemanticKey) return [];
    return issue.originatingItemLocalIds.flatMap((localId) => {
      const targetSemanticKey = semanticKeysByLocalId.get(localId);
      return targetSemanticKey ? [{ sourceSemanticKey, targetSemanticKey, relationType: "ISSUE_DERIVED_FROM" as const }] : [];
    });
  });
  const proceedingIdentityRelations = knowledge.items.flatMap((item) => {
    const anchorLocalId = proceedingAnchorLocalId(item);
    const sourceSemanticKey = semanticKeysByLocalId.get(item.localId);
    const targetSemanticKey = anchorLocalId ? semanticKeysByLocalId.get(anchorLocalId) : null;
    return sourceSemanticKey && targetSemanticKey
      ? [{ sourceSemanticKey, targetSemanticKey, relationType: "RELATED_TO" as const }]
      : [];
  });
  const questionRelations = knowledge.researchQuestions.flatMap((question) => {
    const sourceSemanticKey = candidatesByLocalId.get(question.localId)?.semanticKey;
    const targetSemanticKey = issueSemanticKeysByLocalId.get(question.legalIssueLocalId);
    return sourceSemanticKey && targetSemanticKey
      ? [{ sourceSemanticKey, targetSemanticKey, relationType: "QUESTION_FOR_ISSUE" as const }]
      : [];
  });
  const relations = [
    ...contradictionRelations,
    ...proceedingIdentityRelations,
    ...issueRelations,
    ...questionRelations,
  ];
  return { candidates, relations, warnings };
}
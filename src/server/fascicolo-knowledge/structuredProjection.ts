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
  const localIds = item.kind === "PARTY_ROLE" ? [item.payload.subjectLocalId]
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

function identityFor(item: StructuredKnowledgeItem, subjectIds: readonly string[], dependencies: readonly string[]): string {
  switch (item.kind) {
    case "PARTY_ROLE": return [subjectIds[0], normalized(item.payload.role), normalized(item.payload.context ?? "")].join("|");
    case "FACT": return [normalized(item.payload.normalizedStatement), ...subjectIds].join("|");
    case "EVENT": return [normalized(item.payload.normalizedStatement), JSON.stringify(item.payload.date), ...subjectIds].join("|");
    case "LEGAL_ACT":
    case "MEASURE": return [item.payload.documentBasisRef, normalized(item.payload.actType), subjectIds[0] ?? "", normalized(item.payload.number ?? ""), JSON.stringify(item.payload.date)].join("|");
    case "CONTRADICTION": return sorted(dependencies).join("|");
    case "GAP": return [normalized(item.payload.gapType), normalized(item.payload.description)].join("|");
    case "DEADLINE_CANDIDATE": return [item.payload.deadlineType, JSON.stringify(item.payload.baseDate), JSON.stringify(item.payload.resultingDate), normalized(item.payload.ruleText ?? "")].join("|");
  }
}

function materialPayload(item: StructuredKnowledgeItem, subjectIds: readonly string[], dependencyKeys: readonly string[]) {
  const payload = { ...item.payload } as Record<string, unknown>;
  delete payload.subjectLocalId;
  delete payload.subjectLocalIds;
  delete payload.authoritySubjectLocalId;
  delete payload.relatedItemLocalIds;
  delete payload.conflictingItemLocalIds;
  return {
    ...payload,
    subjectIds: [...subjectIds],
    relatedSemanticKeys: [...sorted(dependencyKeys)],
    semanticKeyVersion: FASCICOLO_STRUCTURED_SEMANTIC_KEY_VERSION,
  };
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
  const pending = [...knowledge.items];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const item = pending[index];
      const dependencyLocalIds = item.kind === "CONTRADICTION" ? item.payload.conflictingItemLocalIds
        : item.kind === "EVENT" || item.kind === "GAP" ? item.payload.relatedItemLocalIds : [];
      const dependencyKeys = dependencyLocalIds.map((localId) => semanticKeysByLocalId.get(localId));
      if (dependencyKeys.some((key) => !key)) continue;
      const evidence = item.basisRefs.map((basisRef) => input.evidenceByBasisRef.get(basisRef));
      if (evidence.some((entry) => !entry)) {
        warnings.push(`INVALID_EVIDENCE:${item.localId}`);
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      try {
        const subjectIds = resolvedSubjectIds(item, input.subjectIdsByLocalId);
        const normalizedIdentity = identityFor(item, subjectIds, dependencyKeys as string[]);
        const candidate: KnowledgeItemCandidate = {
          kind: item.kind,
          normalizedIdentity,
          normalizedText: item.kind === "PARTY_ROLE" ? `${item.payload.role}${item.payload.context ? ` (${item.payload.context})` : ""}`
            : "normalizedStatement" in item.payload ? item.payload.normalizedStatement
              : "description" in item.payload ? item.payload.description
                : "title" in item.payload ? item.payload.title
                  : item.payload.ruleText ?? item.payload.calculationExplanation ?? item.payload.deadlineType,
          structuredPayload: materialPayload(item, subjectIds, dependencyKeys as string[]),
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
    const normalizedIdentity = normalized(issue.normalizedIssue);
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
  const questionRelations = knowledge.researchQuestions.flatMap((question) => {
    const sourceSemanticKey = candidatesByLocalId.get(question.localId)?.semanticKey;
    const targetSemanticKey = issueSemanticKeysByLocalId.get(question.legalIssueLocalId);
    return sourceSemanticKey && targetSemanticKey
      ? [{ sourceSemanticKey, targetSemanticKey, relationType: "QUESTION_FOR_ISSUE" as const }]
      : [];
  });
  const relations = [...contradictionRelations, ...issueRelations, ...questionRelations];
  return { candidates, relations, warnings };
}
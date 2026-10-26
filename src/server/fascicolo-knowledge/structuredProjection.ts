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
  quality: StructuredKnowledgeQualityAssessment;
}

export interface StructuredKnowledgeEvidenceCorrection {
  itemLocalId: string;
  fromBasisRef: string;
  toBasisRef: string;
  quote: string;
}

export interface StructuredKnowledgeRejection {
  localId: string;
  kind: string;
  reason: string;
}

export interface StructuredKnowledgeQualityAssessment {
  proposedCount: number;
  acceptedCount: number;
  correctedCount: number;
  rejectedCount: number;
  proposedEvidenceRefCount: number;
  acceptedEvidenceRefCount: number;
  evidenceCoverage: number;
  proposedKinds: readonly string[];
  acceptedKinds: readonly string[];
  lostLegalIssueCount: number;
  lostRelationCount: number;
  exactCitationCount: number;
  recoveredCitationCount: number;
  ambiguousCitationCount: number;
  nonexistentCitationCount: number;
  optionalMissingRelationCount: number;
  unresolvedRequiredDependencyCount: number;
  corpusDocumentCount: number;
  reviewedDocumentCount: number;
  materialDocumentCount: number;
  nonMaterialDocumentCount: number;
  uncertainDocumentCount: number;
  uncoveredMaterialDocumentCount: number;
  missingInventoryBasisRefCount: number;
  validCitationCount: number;
  invalidCitationCount: number;
  corrections: readonly StructuredKnowledgeEvidenceCorrection[];
  rejections: readonly StructuredKnowledgeRejection[];
  blockingReasons: readonly string[];
}

export class StructuredKnowledgeQualityError extends Error {
  constructor(readonly assessment: StructuredKnowledgeQualityAssessment) {
    super("STRUCTURED_KNOWLEDGE_MATERIALLY_INCOMPLETE");
    this.name = "StructuredKnowledgeQualityError";
  }
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

function uniqueQuotePage(
  quote: string,
  sourceTextByBasisRef: ReadonlyMap<string, string>,
): string | null {
  const matches = [...sourceTextByBasisRef].filter(([, text]) => {
    const first = text.indexOf(quote);
    return quote.length > 0 && first >= 0 && first === text.lastIndexOf(quote);
  });
  return matches.length === 1 ? matches[0][0] : null;
}

function quoteOccurrences(
  quote: string,
  sourceTextByBasisRef: ReadonlyMap<string, string>,
): readonly string[] {
  if (quote.length === 0) return [];
  return [...sourceTextByBasisRef].flatMap(([basisRef, text]) => {
    let count = 0;
    let offset = 0;
    while (offset <= text.length) {
      const index = text.indexOf(quote, offset);
      if (index < 0) break;
      count += 1;
      offset = index + Math.max(quote.length, 1);
    }
    return Array.from({ length: count }, () => basisRef);
  });
}

function replaceBasisRef<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) {
    return value.map((entry) => replaceBasisRef(entry, from, to)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      replaceBasisRef(entry, from, to),
    ])) as T;
  }
  return value;
}

export function normalizeStructuredKnowledgeEvidenceRefs(input: {
  knowledge: FascicoloStructuredKnowledge;
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
}): {
  knowledge: FascicoloStructuredKnowledge;
  corrections: readonly StructuredKnowledgeEvidenceCorrection[];
} {
  if (!input.sourceTextByBasisRef) return { knowledge: input.knowledge, corrections: [] };
  let knowledge = structuredClone(input.knowledge);
  const corrections: StructuredKnowledgeEvidenceCorrection[] = [];
  for (const sourceQuote of knowledge.sourceQuotes) {
    const currentText = input.sourceTextByBasisRef.get(sourceQuote.basisRef);
    const currentStart = currentText?.indexOf(sourceQuote.quote) ?? -1;
    if (currentStart >= 0 && currentStart === currentText!.lastIndexOf(sourceQuote.quote)) continue;
    const recovered = uniqueQuotePage(sourceQuote.quote, input.sourceTextByBasisRef);
    if (!recovered || recovered === sourceQuote.basisRef) continue;
    const conflicting = corrections.find((correction) => (
      correction.itemLocalId === sourceQuote.itemLocalId
      && correction.fromBasisRef === sourceQuote.basisRef
      && correction.toBasisRef !== recovered
    ));
    if (conflicting) continue;
    const correction = {
      itemLocalId: sourceQuote.itemLocalId,
      fromBasisRef: sourceQuote.basisRef,
      toBasisRef: recovered,
      quote: sourceQuote.quote,
    };
    corrections.push(correction);
    knowledge = {
      ...knowledge,
      items: knowledge.items.map((item) => (
        item.localId === correction.itemLocalId
          ? replaceBasisRef(item, correction.fromBasisRef, correction.toBasisRef)
          : item
      )),
      sourceQuotes: knowledge.sourceQuotes.map((quote) => (
        quote.itemLocalId === correction.itemLocalId
          && quote.basisRef === correction.fromBasisRef
          ? { ...quote, basisRef: correction.toBasisRef }
          : quote
      )),
    };
  }
  return {
    knowledge: fascicoloStructuredKnowledgeSchema.parse(knowledge),
    corrections,
  };
}

export function assertStructuredKnowledgeQuality(
  assessment: StructuredKnowledgeQualityAssessment,
): void {
  if (assessment.blockingReasons.length > 0) {
    throw new StructuredKnowledgeQualityError(assessment);
  }
}

export function projectStructuredKnowledge(input: {
  knowledge: FascicoloStructuredKnowledge;
  subjectIdsByLocalId: ReadonlyMap<string, string>;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
}): StructuredKnowledgeProjection {
  const normalizedKnowledge = normalizeStructuredKnowledgeEvidenceRefs({
    knowledge: fascicoloStructuredKnowledgeSchema.parse(input.knowledge),
    sourceTextByBasisRef: input.sourceTextByBasisRef,
  });
  const knowledge = normalizedKnowledge.knowledge;
  const warnings: string[] = [];
  const rejections: StructuredKnowledgeRejection[] = [];
  let exactCitationCount = 0;
  let ambiguousCitationCount = 0;
  let nonexistentCitationCount = 0;
  let validCitationCount = 0;
  let invalidCitationCount = 0;
  const documentInventory = knowledge.documentInventory ?? [];
  for (const document of documentInventory) {
    warnings.push(
      `DOCUMENT_INVENTORY:${document.localId}:${document.classification}:${document.basisRefs.join(",")}:${document.rationale}`,
    );
  }
  if (input.sourceTextByBasisRef) {
    const recoveredQuotes = new Set(normalizedKnowledge.corrections.map((correction) => (
      `${correction.itemLocalId}:${correction.toBasisRef}:${correction.quote}`
    )));
    for (const sourceQuote of knowledge.sourceQuotes) {
      const occurrences = quoteOccurrences(sourceQuote.quote, input.sourceTextByBasisRef);
      if (occurrences.length === 0) {
        nonexistentCitationCount += 1;
      } else if (occurrences.length > 1) {
        ambiguousCitationCount += 1;
      } else if (
        occurrences[0] === sourceQuote.basisRef
        && !recoveredQuotes.has(`${sourceQuote.itemLocalId}:${sourceQuote.basisRef}:${sourceQuote.quote}`)
      ) {
        exactCitationCount += 1;
      }
    }
  }
  for (const correction of normalizedKnowledge.corrections) {
    warnings.push(
      `EVIDENCE_REF_CORRECTED:${correction.itemLocalId}:${correction.fromBasisRef}:${correction.toBasisRef}`,
    );
  }
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
      const dependencyLocalIds = item.kind === "CONTRADICTION"
        ? item.payload.conflictingItemLocalIds
        : [];
      const optionalDependencyLocalIds = item.kind === "PARTY_POSITION"
        || item.kind === "EVENT"
        || item.kind === "GAP"
        ? item.payload.relatedItemLocalIds
        : [];
      const existingOptionalDependencyLocalIds = optionalDependencyLocalIds.filter((localId) => (
        itemsByLocalId.has(localId)
      ));
      const anchorLocalId = proceedingAnchorLocalId(item);
      const allDependencyLocalIds = [...new Set([
        ...dependencyLocalIds,
        ...existingOptionalDependencyLocalIds,
        ...(anchorLocalId ? [anchorLocalId] : []),
      ])];
      const dependencyKeys = allDependencyLocalIds.map((localId) => semanticKeysByLocalId.get(localId));
      if (dependencyKeys.some((key) => !key)) continue;
      const relatedDependencyKeys = optionalDependencyLocalIds.flatMap((localId) => {
        const key = semanticKeysByLocalId.get(localId);
        if (key) return [key];
        if (!itemsByLocalId.has(localId)) {
          warnings.push(`UNRESOLVED_OPTIONAL_RELATION:${item.localId}:${localId}`);
        }
        return [];
      });
      const evidence = item.basisRefs.map((basisRef) => input.evidenceByBasisRef.get(basisRef));
      if (evidence.some((entry) => !entry) || !hasDocumentedProceedingIdentity(item)) {
        warnings.push(`INVALID_EVIDENCE:${item.localId}`);
        rejections.push({ localId: item.localId, kind: item.kind, reason: "INVALID_EVIDENCE" });
        pending.splice(index, 1);
        progressed = true;
        continue;
      }
      if (input.sourceTextByBasisRef) {
        const quotes = knowledge.sourceQuotes.filter((quote) => quote.itemLocalId === item.localId);
        const invalidBasisRefs = item.basisRefs.filter((basisRef) => !quotes.some((sourceQuote) => {
          if (sourceQuote.basisRef !== basisRef) return false;
          const sourceText = input.sourceTextByBasisRef!.get(basisRef);
          if (!sourceText) return false;
          const start = sourceText.indexOf(sourceQuote.quote);
          return start >= 0 && start === sourceText.lastIndexOf(sourceQuote.quote);
        }));
        if (invalidBasisRefs.length > 0) {
          invalidCitationCount += invalidBasisRefs.length;
          warnings.push(`INVALID_SOURCE_QUOTE:${item.localId}:${invalidBasisRefs.join(",")}`);
          rejections.push({ localId: item.localId, kind: item.kind, reason: "INVALID_SOURCE_QUOTE" });
          pending.splice(index, 1);
          progressed = true;
          continue;
        }
        validCitationCount += item.basisRefs.length;
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
          (item.kind === "CONTRADICTION"
            ? dependencyKeys
            : relatedDependencyKeys) as string[],
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
        rejections.push({ localId: item.localId, kind: item.kind, reason: "INVALID_SUBJECT" });
      }
      pending.splice(index, 1);
      progressed = true;
    }
  }
  for (const item of pending) {
    warnings.push(`UNRESOLVED_REQUIRED_DEPENDENCY:${item.localId}`);
    rejections.push({
      localId: item.localId,
      kind: item.kind,
      reason: "UNRESOLVED_REQUIRED_DEPENDENCY",
    });
  }
  for (const item of pending) {
    warnings.push(`UNRESOLVED_DEPENDENCY:${item.localId}`);
    rejections.push({ localId: item.localId, kind: item.kind, reason: "UNRESOLVED_DEPENDENCY" });
  }
  const issueSemanticKeysByLocalId = new Map<string, string>();
  for (const issue of knowledge.legalIssues) {
    const origins = issue.originatingItemLocalIds.map((localId) => candidatesByLocalId.get(localId));
    if (origins.some((origin) => !origin)) {
      warnings.push(`INVALID_ISSUE_ORIGIN:${issue.localId}`);
      rejections.push({ localId: issue.localId, kind: "LEGAL_ISSUE", reason: "INVALID_ISSUE_ORIGIN" });
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
      rejections.push({ localId: issue.localId, kind: "LEGAL_ISSUE", reason: "INVALID_PROCEEDING_ANCHOR" });
      continue;
    }
    const originBasisRefs = new Set(originCandidates.flatMap((origin) => origin.evidence.map((entry) => entry.basisRef)));
    if (targetIdentity && !targetIdentity.evidenceBasisRefs.every((basisRef) => originBasisRefs.has(basisRef))) {
      warnings.push(`INVALID_PROCEEDING_IDENTITY_EVIDENCE:${issue.localId}`);
      rejections.push({
        localId: issue.localId,
        kind: "LEGAL_ISSUE",
        reason: "INVALID_PROCEEDING_IDENTITY_EVIDENCE",
      });
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
      rejections.push({
        localId: question.localId,
        kind: "RESEARCH_QUESTION",
        reason: "INVALID_QUESTION_ISSUE",
      });
      continue;
    }
    const basisItemSemanticKey = question.referenceDateBasis.itemLocalId
      ? candidatesByLocalId.get(question.referenceDateBasis.itemLocalId)?.semanticKey ?? null
      : null;
    if (question.referenceDateBasis.itemLocalId && !basisItemSemanticKey) {
      warnings.push(`INVALID_REFERENCE_DATE_BASIS:${question.localId}`);
      rejections.push({
        localId: question.localId,
        kind: "RESEARCH_QUESTION",
        reason: "INVALID_REFERENCE_DATE_BASIS",
      });
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
    && candidates.length === 0
    && !input.sourceTextByBasisRef) throw new Error("STRUCTURED_KNOWLEDGE_NO_VALID_ITEMS");
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
  const proposedKinds = [
    ...knowledge.items.map((item) => item.kind),
    ...knowledge.legalIssues.map(() => "LEGAL_ISSUE"),
    ...knowledge.researchQuestions.map(() => "RESEARCH_QUESTION"),
  ];
  const proposedEvidenceRefs = new Set([
    ...knowledge.items.flatMap((item) => item.basisRefs),
    ...knowledge.legalIssues.flatMap((issue) => issue.originatingItemLocalIds.flatMap((localId) => (
      itemsByLocalId.get(localId)?.basisRefs ?? []
    ))),
  ]);
  const acceptedEvidenceRefs = new Set(candidates.flatMap((candidate) => (
    candidate.evidence.map((entry) => entry.basisRef)
  )));
  const expectedRelationCount = knowledge.items
    .filter((item) => item.kind === "CONTRADICTION")
    .reduce((count, item) => count + item.payload.conflictingItemLocalIds.length, 0)
    + knowledge.legalIssues.reduce((count, issue) => count + issue.originatingItemLocalIds.length, 0)
    + knowledge.researchQuestions.length;
  const materialKinds = new Set([
    "PARTY_ROLE",
    "PARTY_POSITION",
    "FACT",
    "EVENT",
    "LEGAL_ACT",
    "MEASURE",
    "CONTRADICTION",
    "GAP",
    "DEADLINE_CANDIDATE",
    "LEGAL_ISSUE",
    "RESEARCH_QUESTION",
  ]);
  const materialRejections = rejections.filter((rejection) => materialKinds.has(rejection.kind));
  const optionalMissingRelationCount = new Set(warnings.filter((warning) => (
    warning.startsWith("UNRESOLVED_OPTIONAL_RELATION:")
  ))).size;
  const unresolvedRequiredDependencyCount = rejections.filter((rejection) => (
    rejection.reason === "UNRESOLVED_REQUIRED_DEPENDENCY"
  )).length;
  const corpusBasisRefs = new Set(input.sourceTextByBasisRef?.keys() ?? []);
  const inventoriedBasisRefs = new Set(documentInventory.flatMap((document) => document.basisRefs));
  const missingInventoryBasisRefCount = [...corpusBasisRefs].filter((basisRef) => (
    !inventoriedBasisRefs.has(basisRef)
  )).length;
  const materialDocuments = documentInventory.filter((document) => document.classification === "MATERIAL");
  const itemsForInventory = new Map(knowledge.items.map((item) => [item.localId, item]));
  const uncoveredMaterialDocuments = materialDocuments.filter((document) => (
    document.relatedItemLocalIds.length === 0
    || document.basisRefs.some((basisRef) => !document.relatedItemLocalIds.some((localId) => (
      itemsForInventory.get(localId)?.basisRefs.includes(basisRef)
    )))
  ));
  const uncertainDocumentsWithoutGap = documentInventory.filter((document) => (
    document.classification === "UNCERTAIN"
    && !document.relatedItemLocalIds.some((localId) => itemsForInventory.get(localId)?.kind === "GAP")
  ));
  const inventoryRequired = corpusBasisRefs.size > 1;
  const blockingReasons = [
    ...(materialRejections.length > 0
      ? ["MATERIAL_ITEMS_LOST"]
      : []),
    ...(acceptedEvidenceRefs.size < proposedEvidenceRefs.size
      ? ["EVIDENCE_COVERAGE_LOST"]
      : []),
    ...(ambiguousCitationCount > 0 ? ["AMBIGUOUS_CITATIONS"] : []),
    ...(nonexistentCitationCount > 0 ? ["NONEXISTENT_CITATIONS"] : []),
    ...(unresolvedRequiredDependencyCount > 0
      ? ["REQUIRED_DEPENDENCIES_UNRESOLVED"]
      : []),
    ...(knowledge.legalIssues.length > issueSemanticKeysByLocalId.size
      ? ["LEGAL_ISSUES_LOST"]
      : []),
    ...(relations.length < expectedRelationCount
      ? ["REQUIRED_RELATIONS_LOST"]
      : []),
    ...(inventoryRequired && (documentInventory.length === 0 || missingInventoryBasisRefCount > 0)
      ? ["DOCUMENT_INVENTORY_INCOMPLETE"]
      : []),
    ...(uncoveredMaterialDocuments.length > 0
      ? ["MATERIAL_DOCUMENTS_UNCOVERED"]
      : []),
    ...(uncertainDocumentsWithoutGap.length > 0
      ? ["UNCERTAIN_DOCUMENTS_WITHOUT_ANOMALY"]
      : []),
  ];
  const quality: StructuredKnowledgeQualityAssessment = {
    proposedCount: proposedKinds.length,
    acceptedCount: candidates.length,
    correctedCount: normalizedKnowledge.corrections.length,
    rejectedCount: rejections.length,
    proposedEvidenceRefCount: proposedEvidenceRefs.size,
    acceptedEvidenceRefCount: acceptedEvidenceRefs.size,
    evidenceCoverage: proposedEvidenceRefs.size === 0
      ? 1
      : acceptedEvidenceRefs.size / proposedEvidenceRefs.size,
    proposedKinds: [...new Set(proposedKinds)].sort(),
    acceptedKinds: [...new Set(candidates.map((candidate) => candidate.kind))].sort(),
    lostLegalIssueCount: knowledge.legalIssues.length - issueSemanticKeysByLocalId.size,
    lostRelationCount: Math.max(0, expectedRelationCount - relations.length),
    exactCitationCount,
    recoveredCitationCount: normalizedKnowledge.corrections.length,
    ambiguousCitationCount,
    nonexistentCitationCount,
    optionalMissingRelationCount,
    unresolvedRequiredDependencyCount,
    corpusDocumentCount: documentInventory.length,
    reviewedDocumentCount: documentInventory.length,
    materialDocumentCount: materialDocuments.length,
    nonMaterialDocumentCount: documentInventory.filter((document) => document.classification === "NOT_MATERIAL").length,
    uncertainDocumentCount: documentInventory.filter((document) => document.classification === "UNCERTAIN").length,
    uncoveredMaterialDocumentCount: uncoveredMaterialDocuments.length,
    missingInventoryBasisRefCount,
    validCitationCount,
    invalidCitationCount,
    corrections: normalizedKnowledge.corrections,
    rejections,
    blockingReasons: [...new Set(blockingReasons)].sort(),
  };
  return { candidates, relations, warnings, quality };
}
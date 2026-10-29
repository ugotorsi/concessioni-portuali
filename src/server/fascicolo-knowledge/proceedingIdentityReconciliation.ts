import {
  fascicoloDocumentStructuredKnowledgeSchema,
  type FascicoloDocumentKnowledgeProposal,
  type FascicoloStructuredKnowledge,
  type DocumentInventoryEntry,
  type ProceedingIdentityHint,
  type ProceedingIdentityResolution,
  type StructuredKnowledgeProposalItem,
} from "./structuredContracts";
import type { FascicoloEvidenceSpan } from "./evidenceSpanCatalog";

export type KnowledgeCompilationDiagnosticAction =
  | "PRESERVED"
  | "REBUILT"
  | "MARKED_UNRESOLVED"
  | "BLOCKED";

export interface KnowledgeCompilationDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly action: KnowledgeCompilationDiagnosticAction;
}

export class DocumentKnowledgeCompilationError extends Error {
  constructor(
    readonly diagnostics: readonly KnowledgeCompilationDiagnostic[],
  ) {
    super("DOCUMENT_KNOWLEDGE_COMPILATION_FAILED");
    this.name = "DocumentKnowledgeCompilationError";
  }
}

export interface CompiledDocumentKnowledge {
  readonly knowledge: FascicoloStructuredKnowledge;
  readonly diagnostics: readonly KnowledgeCompilationDiagnostic[];
  readonly promotable: boolean;
  readonly quarantinedItemLocalIds: readonly string[];
}

function documentedBasisRefs(input: {
  sourceQuotes: readonly { itemLocalId: string; basisRef: string }[];
}): ReadonlyMap<string, ReadonlySet<string>> {
  const refs = new Map<string, Set<string>>();
  for (const sourceQuote of input.sourceQuotes) {
    const current = refs.get(sourceQuote.itemLocalId) ?? new Set<string>();
    current.add(sourceQuote.basisRef);
    refs.set(sourceQuote.itemLocalId, current);
  }
  return refs;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

type CandidateProposal = Extract<FascicoloDocumentKnowledgeProposal, {
  evidenceCandidates: readonly unknown[];
}>;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function adaptLegacyProposal(input: {
  proposal: FascicoloDocumentKnowledgeProposal;
  evidenceSpans?: readonly FascicoloEvidenceSpan[];
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
}): {
  proposal: CandidateProposal;
  evidenceSpans: readonly FascicoloEvidenceSpan[];
  diagnostics: readonly KnowledgeCompilationDiagnostic[];
} {
  if ("evidenceCandidates" in input.proposal) {
    return {
      proposal: input.proposal,
      evidenceSpans: input.evidenceSpans ?? [],
      diagnostics: [],
    };
  }
  if (!input.sourceTextByBasisRef) {
    throw new DocumentKnowledgeCompilationError([{
      code: "EVIDENCE_SPAN_CATALOG_REQUIRED",
      path: "evidenceCandidates",
      action: "BLOCKED",
    }]);
  }
  const diagnostics: KnowledgeCompilationDiagnostic[] = [];
  const evidenceSpans: FascicoloEvidenceSpan[] = [];
  const evidenceCandidates: { itemLocalId: string; evidenceSpanId: string }[] = [];
  for (const [index, sourceQuote] of input.proposal.sourceQuotes.entries()) {
    const matches = [...input.sourceTextByBasisRef].flatMap(([basisRef, text]) => {
      const offsets: { basisRef: string; startOffset: number; text: string }[] = [];
      let cursor = 0;
      while (cursor <= text.length) {
        const startOffset = text.indexOf(sourceQuote.quote, cursor);
        if (startOffset < 0) break;
        offsets.push({ basisRef, startOffset, text });
        cursor = startOffset + Math.max(sourceQuote.quote.length, 1);
      }
      return offsets;
    });
    if (matches.length !== 1) {
      diagnostics.push({
        code: matches.length === 0 ? "NONEXISTENT_SOURCE_QUOTE" : "AMBIGUOUS_SOURCE_QUOTE",
        path: `sourceQuotes.${index}.quote`,
        action: "BLOCKED",
      });
      continue;
    }
    const match = matches[0];
    if (match.basisRef !== sourceQuote.basisRef) {
      diagnostics.push({
        code: "BASIS_REF_CORRECTED",
        path: `sourceQuotes.${index}.basisRef`,
        action: "REBUILT",
      });
    }
    const endOffset = match.startOffset + sourceQuote.quote.length;
    const quoteSha256 = digest(sourceQuote.quote);
    const span: FascicoloEvidenceSpan = {
      id: `LEGACY_EVIDENCE_${digest(`${match.basisRef}\u001f${match.startOffset}\u001f${quoteSha256}`)}`,
      basisRef: match.basisRef,
      documentVersionId: "LEGACY_PROVIDER_PROPOSAL",
      pageNumber: Number(match.basisRef.match(/\.PAGE_(\d+)$/)?.[1] ?? "1"),
      startOffset: match.startOffset,
      endOffset,
      text: sourceQuote.quote,
      textSha256: digest(match.text),
      quoteSha256,
    };
    evidenceSpans.push(span);
    evidenceCandidates.push({
      itemLocalId: sourceQuote.itemLocalId,
      evidenceSpanId: span.id,
    });
  }
  if (diagnostics.some((diagnostic) => diagnostic.action === "BLOCKED")) {
    throw new DocumentKnowledgeCompilationError(diagnostics);
  }
  const { sourceQuotes: _sourceQuotes, ...proposal } = input.proposal;
  return {
    proposal: { ...proposal, evidenceCandidates },
    evidenceSpans,
    diagnostics,
  };
}

function rebuildItemEvidence(
  item: StructuredKnowledgeProposalItem,
  spans: readonly FascicoloEvidenceSpan[],
  retainedItemLocalIds: ReadonlySet<string>,
): StructuredKnowledgeProposalItem {
  const basisRefs = unique(spans.map((span) => span.basisRef));
  switch (item.kind) {
    case "PARTY_POSITION":
      return {
        ...item,
        basisRefs,
        payload: {
          ...item.payload,
          relatedItemLocalIds: item.payload.relatedItemLocalIds.filter((id) => retainedItemLocalIds.has(id)),
        },
      };
    case "EVENT":
      return {
        ...item,
        basisRefs,
        payload: {
          ...item.payload,
          relatedItemLocalIds: item.payload.relatedItemLocalIds.filter((id) => retainedItemLocalIds.has(id)),
        },
      };
    case "GAP":
      return {
        ...item,
        basisRefs,
        payload: {
          ...item.payload,
          relatedItemLocalIds: item.payload.relatedItemLocalIds.filter((id) => retainedItemLocalIds.has(id)),
        },
      };
    case "CONTRADICTION":
      return {
        ...item,
        basisRefs,
        payload: {
          ...item.payload,
          conflictingItemLocalIds: item.payload.conflictingItemLocalIds.filter((id) => retainedItemLocalIds.has(id)),
        },
      };
    case "LEGAL_ACT":
    case "MEASURE":
      return {
        ...item,
        basisRefs,
        payload: {
          ...item.payload,
          documentBasisRef: basisRefs[0],
        },
      };
    default:
      return { ...item, basisRefs };
  }
}

function compileEvidenceCandidates(input: {
  proposal: CandidateProposal;
  evidenceSpans: readonly FascicoloEvidenceSpan[];
}) {
  const spansById = new Map(input.evidenceSpans.map((span) => [span.id, span]));
  const proposedItemIds = new Set(input.proposal.items.map((item) => item.localId));
  const spansByItem = new Map<string, FascicoloEvidenceSpan[]>();
  const diagnostics: KnowledgeCompilationDiagnostic[] = [];
  for (const [index, candidate] of input.proposal.evidenceCandidates.entries()) {
    if (!proposedItemIds.has(candidate.itemLocalId)) {
      diagnostics.push({
        code: "UNKNOWN_EVIDENCE_ITEM",
        path: `evidenceCandidates.${index}.itemLocalId`,
        action: "MARKED_UNRESOLVED",
      });
      continue;
    }
    const span = spansById.get(candidate.evidenceSpanId);
    if (!span) {
      diagnostics.push({
        code: "UNKNOWN_EVIDENCE_SPAN",
        path: `evidenceCandidates.${index}.evidenceSpanId`,
        action: "MARKED_UNRESOLVED",
      });
      continue;
    }
    const current = spansByItem.get(candidate.itemLocalId) ?? [];
    if (!current.some((entry) => entry.id === span.id)) current.push(span);
    spansByItem.set(candidate.itemLocalId, current);
  }

  const retainedItemLocalIds = new Set(input.proposal.items
    .filter((item) => (spansByItem.get(item.localId)?.length ?? 0) > 0)
    .map((item) => item.localId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of input.proposal.items) {
      if (!retainedItemLocalIds.has(item.localId) || item.kind !== "CONTRADICTION") continue;
      const retainedConflicts = item.payload.conflictingItemLocalIds.filter((id) => retainedItemLocalIds.has(id));
      if (retainedConflicts.length < 2) {
        retainedItemLocalIds.delete(item.localId);
        changed = true;
      }
    }
  }
  const quarantinedItemLocalIds = input.proposal.items
    .filter((item) => !retainedItemLocalIds.has(item.localId))
    .map((item) => item.localId);
  for (const itemLocalId of quarantinedItemLocalIds) {
    diagnostics.push({
      code: "ITEM_EVIDENCE_NOT_VERIFIED",
      path: `items.${input.proposal.items.findIndex((item) => item.localId === itemLocalId)}`,
      action: "MARKED_UNRESOLVED",
    });
  }
  const items = input.proposal.items
    .filter((item) => retainedItemLocalIds.has(item.localId))
    .map((item) => rebuildItemEvidence(
      item,
      spansByItem.get(item.localId) ?? [],
      retainedItemLocalIds,
    ));
  const sourceQuotes = items.flatMap((item) => (
    (spansByItem.get(item.localId) ?? []).map((span) => ({
      itemLocalId: item.localId,
      basisRef: span.basisRef,
      quote: span.text,
      span: {
        id: span.id,
        documentVersionId: span.documentVersionId,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        textSha256: span.textSha256,
        quoteSha256: span.quoteSha256,
      },
    }))
  ));
  return {
    items,
    sourceQuotes,
    diagnostics,
    quarantinedItemLocalIds,
    retainedItemLocalIds,
  };
}

type DeterministicCoverageGap = Extract<
  FascicoloStructuredKnowledge["items"][number],
  { kind: "GAP" }
>;

function buildDeterministicDocumentCoverage<
  TItem extends { localId: string; kind: string; basisRefs: string[] },
>(input: {
  items: readonly TItem[];
  sourceQuotes: readonly FascicoloStructuredKnowledge["sourceQuotes"][number][];
  evidenceSpans: readonly FascicoloEvidenceSpan[];
}): {
  items: (TItem | DeterministicCoverageGap)[];
  sourceQuotes: FascicoloStructuredKnowledge["sourceQuotes"];
  documentInventory: DocumentInventoryEntry[];
  diagnostics: KnowledgeCompilationDiagnostic[];
} {
  const items: (TItem | DeterministicCoverageGap)[] = [...input.items];
  const sourceQuotes = [...input.sourceQuotes];
  const diagnostics: KnowledgeCompilationDiagnostic[] = [];
  const spansByBasisRef = new Map<string, FascicoloEvidenceSpan[]>();
  for (const span of input.evidenceSpans) {
    const current = spansByBasisRef.get(span.basisRef) ?? [];
    current.push(span);
    spansByBasisRef.set(span.basisRef, current);
  }
  const documentInventory: DocumentInventoryEntry[] = [...spansByBasisRef.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([basisRef, spans], index) => {
      let relatedItems: (TItem | DeterministicCoverageGap)[] = items.filter(
        (item) => item.basisRefs.includes(basisRef),
      );
      let classification: DocumentInventoryEntry["classification"] = "MATERIAL";
      if (relatedItems.length === 0) {
        const firstSpan = spans[0];
        const localId = `server-coverage-gap-${digest(basisRef).slice(0, 32)}`;
        const gap: DeterministicCoverageGap = {
          localId,
          kind: "GAP",
          confidence: 100,
          basisRefs: [basisRef],
          payload: {
            gapType: "UNREVIEWED_DOCUMENT_CONTENT",
            description: `Nessuna informazione interpretativa verificata e stata estratta da ${basisRef}.`,
            impact: "La pagina resta acquisita e localizzabile, ma richiede revisione umana prima di escluderne la rilevanza.",
            relatedItemLocalIds: [],
          },
        };
        items.push(gap);
        sourceQuotes.push({
          itemLocalId: localId,
          basisRef,
          quote: firstSpan.text,
          span: {
            id: firstSpan.id,
            documentVersionId: firstSpan.documentVersionId,
            startOffset: firstSpan.startOffset,
            endOffset: firstSpan.endOffset,
            textSha256: firstSpan.textSha256,
            quoteSha256: firstSpan.quoteSha256,
          },
        });
        relatedItems = [gap];
        classification = "UNCERTAIN";
        diagnostics.push({
          code: "DOCUMENT_COVERAGE_GAP_ADDED",
          path: `documentInventory.${index}`,
          action: "REBUILT",
        });
      }
      return {
        localId: `server-inventory-${digest(basisRef).slice(0, 32)}`,
        basisRefs: [basisRef],
        documentType: "pagina documentale autenticata",
        documentDate: null,
        issuer: null,
        recipients: [],
        proceduralPhase: null,
        subject: `Copertura documentale ${basisRef}`,
        summary: classification === "MATERIAL"
          ? `Pagina collegata a ${relatedItems.length} elemento/i interpretativo/i verificato/i.`
          : "Pagina acquisita senza elementi interpretativi verificati.",
        referencedActs: [],
        attachments: [],
        materialProfiles: ["EVIDENTIARY"],
        classification,
        rationale: classification === "MATERIAL"
          ? "Classificazione server-side basata sulla presenza di elementi con evidenza autenticata sulla pagina."
          : "Classificazione server-side prudenziale: la pagina non e esclusa come non materiale in assenza di analisi verificata.",
        relatedItemLocalIds: relatedItems.map((item) => item.localId),
      };
    });
  return { items, sourceQuotes, documentInventory, diagnostics };
}

function isDocumentedAnchor(
  item: StructuredKnowledgeProposalItem,
  documented: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (item.kind !== "LEGAL_ACT" && item.kind !== "MEASURE") return false;
  const itemRefs = documented.get(item.localId);
  return Boolean(item.basisRefs.length > 0
    && itemRefs
    && item.basisRefs.every((basisRef) => itemRefs.has(basisRef)));
}

function unresolvedResolution(input: {
  hint: ProceedingIdentityHint | null;
  status: Exclude<ProceedingIdentityResolution["status"], "VERIFIED">;
  reason: NonNullable<ProceedingIdentityResolution["reason"]>;
  candidateAnchorLocalIds: readonly string[];
}): ProceedingIdentityResolution {
  return {
    status: input.status,
    action: "MARKED_UNRESOLVED",
    reason: input.reason,
    providerClaim: input.hint,
    candidateAnchorLocalIds: [...input.candidateAnchorLocalIds],
  };
}

function verifiedResolution(input: {
  hint: ProceedingIdentityHint | null;
  selectedAnchorLocalId: string;
  candidateAnchorLocalIds: readonly string[];
  preserved: boolean;
}): ProceedingIdentityResolution {
  return {
    status: "VERIFIED",
    action: input.preserved ? "PRESERVED" : "REBUILT",
    reason: null,
    providerClaim: input.hint,
    candidateAnchorLocalIds: [...input.candidateAnchorLocalIds],
  };
}

function resolveIssueIdentity(input: {
  issueIndex: number;
  hint: ProceedingIdentityHint | null;
  originLocalIds: readonly string[];
  itemsByLocalId: ReadonlyMap<string, StructuredKnowledgeProposalItem>;
  documented: ReadonlyMap<string, ReadonlySet<string>>;
}): {
  readonly identity: {
    declaredKey: string | null;
    canonicalAnchorLocalId: string;
    kind: ProceedingIdentityHint["kind"];
    evidenceBasisRefs: string[];
  } | null;
  readonly resolution: ProceedingIdentityResolution;
  readonly diagnostic: KnowledgeCompilationDiagnostic;
} {
  const originItems = input.originLocalIds.flatMap((localId) => {
    const item = input.itemsByLocalId.get(localId);
    return item ? [item] : [];
  });
  const anchors = originItems.filter((item) => (
    isDocumentedAnchor(item, input.documented)
  ));
  const candidateIds = anchors.map((anchor) => anchor.localId);
  const claimed = input.hint?.candidateAnchorLocalId
    ? anchors.find((anchor) => anchor.localId === input.hint?.candidateAnchorLocalId)
    : undefined;
  const selected = claimed ?? (anchors.length === 1 ? anchors[0] : undefined);
  const path = `legalIssues.${input.issueIndex}.targetProceedingHint`;
  if (!selected) {
    const compatibleOrigins = originItems.filter((item) => (
      item.kind === "LEGAL_ACT" || item.kind === "MEASURE"
    ));
    const status = anchors.length > 1
      ? "AMBIGUOUS"
      : compatibleOrigins.length > 0
        ? "INSUFFICIENT_EVIDENCE"
        : input.hint
          ? "UNVERIFIED_CLAIM"
          : "NOT_DOCUMENTED";
    const reason = anchors.length > 1
      ? "MULTIPLE_DOCUMENTED_ANCHORS"
      : compatibleOrigins.length > 0
        ? "ANCHOR_EVIDENCE_NOT_AUTHENTIC"
        : input.hint
          ? "MODEL_CLAIM_NOT_VERIFIABLE"
          : "NO_DOCUMENTED_ANCHOR";
    return {
      identity: null,
      resolution: unresolvedResolution({
        hint: input.hint,
        status,
        reason,
        candidateAnchorLocalIds: candidateIds,
      }),
      diagnostic: {
        code: reason,
        path,
        action: "MARKED_UNRESOLVED",
      },
    };
  }
  const preserved = claimed !== undefined
    && input.hint!.evidenceBasisRefs.length > 0
    && input.hint!.evidenceBasisRefs.every((basisRef) => selected.basisRefs.includes(basisRef));
  return {
    identity: {
      declaredKey: preserved ? input.hint!.declaredKey : null,
      canonicalAnchorLocalId: selected.localId,
      kind: preserved ? input.hint!.kind : "UNKNOWN",
      evidenceBasisRefs: [...selected.basisRefs],
    },
    resolution: verifiedResolution({
      hint: input.hint,
      selectedAnchorLocalId: selected.localId,
      candidateAnchorLocalIds: candidateIds,
      preserved,
    }),
    diagnostic: {
      code: preserved ? "PROCEEDING_IDENTITY_PRESERVED" : "PROCEEDING_IDENTITY_REBUILT",
      path,
      action: preserved ? "PRESERVED" : "REBUILT",
    },
  };
}

function resolveItemIdentity(input: {
  item: Extract<StructuredKnowledgeProposalItem, { kind: "FACT" | "EVENT" }>;
  itemIndex: number;
  anchors: readonly StructuredKnowledgeProposalItem[];
  documented: ReadonlyMap<string, ReadonlySet<string>>;
}): {
  readonly identity: {
    declaredKey: string | null;
    canonicalAnchorLocalId: string;
    kind: ProceedingIdentityHint["kind"];
    evidenceBasisRefs: string[];
  } | null;
  readonly resolution: ProceedingIdentityResolution | null;
  readonly diagnostic: KnowledgeCompilationDiagnostic | null;
} {
  const hint = input.item.payload.proceedingIdentityHint;
  if (!hint) return { identity: null, resolution: null, diagnostic: null };
  const itemEvidence = input.documented.get(input.item.localId) ?? new Set<string>();
  const authenticItemEvidence = input.item.basisRefs.filter((basisRef) => itemEvidence.has(basisRef));
  const eligible = input.anchors.filter((anchor) => (
    isDocumentedAnchor(anchor, input.documented)
    && anchor.basisRefs.some((basisRef) => authenticItemEvidence.includes(basisRef))
  ));
  const claimed = hint.candidateAnchorLocalId
    ? eligible.find((anchor) => anchor.localId === hint.candidateAnchorLocalId)
    : undefined;
  const selected = claimed ?? (eligible.length === 1 ? eligible[0] : undefined);
  const path = `items.${input.itemIndex}.payload.proceedingIdentityHint`;
  if (!selected || authenticItemEvidence.length === 0) {
    const reason = eligible.length > 1
      ? "MULTIPLE_DOCUMENTED_ANCHORS"
      : authenticItemEvidence.length === 0
        ? "ANCHOR_EVIDENCE_NOT_AUTHENTIC"
        : "MODEL_CLAIM_NOT_VERIFIABLE";
    return {
      identity: null,
      resolution: unresolvedResolution({
        hint,
        status: eligible.length > 1
          ? "AMBIGUOUS"
          : authenticItemEvidence.length === 0
            ? "INSUFFICIENT_EVIDENCE"
            : "UNVERIFIED_CLAIM",
        reason,
        candidateAnchorLocalIds: eligible.map((anchor) => anchor.localId),
      }),
      diagnostic: { code: reason, path, action: "MARKED_UNRESOLVED" },
    };
  }
  const preserved = claimed !== undefined
    && hint.evidenceBasisRefs.length > 0
    && hint.evidenceBasisRefs.every((basisRef) => authenticItemEvidence.includes(basisRef));
  return {
    identity: {
      declaredKey: preserved ? hint.declaredKey : null,
      canonicalAnchorLocalId: selected.localId,
      kind: preserved ? hint.kind : "UNKNOWN",
      evidenceBasisRefs: preserved ? [...hint.evidenceBasisRefs] : [...authenticItemEvidence],
    },
    resolution: verifiedResolution({
      hint,
      selectedAnchorLocalId: selected.localId,
      candidateAnchorLocalIds: eligible.map((anchor) => anchor.localId),
      preserved,
    }),
    diagnostic: {
      code: preserved ? "PROCEEDING_IDENTITY_PRESERVED" : "PROCEEDING_IDENTITY_REBUILT",
      path,
      action: preserved ? "PRESERVED" : "REBUILT",
    },
  };
}

export function compileFascicoloDocumentKnowledgeProposal(input: {
  proposal: FascicoloDocumentKnowledgeProposal;
  evidenceSpans?: readonly FascicoloEvidenceSpan[];
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
}): CompiledDocumentKnowledge {
  const adapted = adaptLegacyProposal(input);
  const proposal = adapted.proposal;
  const evidence = compileEvidenceCandidates({
    proposal,
    evidenceSpans: adapted.evidenceSpans,
  });
  const documented = documentedBasisRefs(evidence);
  const itemsByLocalId = new Map(evidence.items.map((item) => [item.localId, item]));
  const anchors = evidence.items.filter((item) => (
    item.kind === "LEGAL_ACT" || item.kind === "MEASURE"
  ));
  const diagnostics = [...adapted.diagnostics, ...evidence.diagnostics];
  const interpretedItems = evidence.items.map((item, itemIndex) => {
    if (item.kind !== "FACT" && item.kind !== "EVENT") return item;
    const resolved = resolveItemIdentity({
      item,
      itemIndex,
      anchors,
      documented,
    });
    if (resolved.diagnostic) diagnostics.push(resolved.diagnostic);
    const { proceedingIdentityHint: _hint, ...payload } = item.payload;
    return {
      ...item,
      payload: {
        ...payload,
        proceedingIdentity: resolved.identity,
        proceedingIdentityResolution: resolved.resolution,
      },
    };
  });
  const coverage = buildDeterministicDocumentCoverage({
    items: interpretedItems,
    sourceQuotes: evidence.sourceQuotes,
    evidenceSpans: adapted.evidenceSpans,
  });
  const items = coverage.items;
  diagnostics.push(...coverage.diagnostics);
  const legalIssues = proposal.legalIssues.flatMap((issue, issueIndex) => {
    const originatingItemLocalIds = issue.originatingItemLocalIds.filter((localId) => (
      evidence.retainedItemLocalIds.has(localId)
    ));
    if (originatingItemLocalIds.length === 0) {
      diagnostics.push({
        code: "LEGAL_ISSUE_ORIGINS_NOT_VERIFIED",
        path: `legalIssues.${issueIndex}`,
        action: "MARKED_UNRESOLVED",
      });
      return [];
    }
    if (originatingItemLocalIds.length !== issue.originatingItemLocalIds.length) {
      diagnostics.push({
        code: "LEGAL_ISSUE_ORIGINS_PARTIALLY_VERIFIED",
        path: `legalIssues.${issueIndex}.originatingItemLocalIds`,
        action: "MARKED_UNRESOLVED",
      });
    }
    const resolved = resolveIssueIdentity({
      issueIndex,
      hint: issue.targetProceedingHint,
      originLocalIds: originatingItemLocalIds,
      itemsByLocalId,
      documented,
    });
    diagnostics.push(resolved.diagnostic);
    const { targetProceedingHint: _hint, ...candidate } = issue;
    return {
      ...candidate,
      originatingItemLocalIds,
      targetProceedingIdentity: resolved.identity,
      targetProceedingResolution: resolved.resolution,
    } as const;
  });
  const retainedIssueIds = new Set(legalIssues.map((issue) => issue.localId));
  const retainedItemsByLocalId = new Map(items.map((item) => [item.localId, item]));
  const researchQuestions = proposal.researchQuestions.flatMap((question, index) => {
    const basisItemLocalId = question.referenceDateBasis.itemLocalId;
    const retained = retainedIssueIds.has(question.legalIssueLocalId)
      && (basisItemLocalId === null || retainedItemsByLocalId.has(basisItemLocalId));
    if (!retained) {
      diagnostics.push({
        code: "RESEARCH_QUESTION_BASIS_NOT_VERIFIED",
        path: `researchQuestions.${index}`,
        action: "MARKED_UNRESOLVED",
      });
      return [];
    }
    if (question.referenceDateBasis.type === "UNKNOWN") {
      const issue = legalIssues.find((candidate) => (
        candidate.localId === question.legalIssueLocalId
      ));
      const candidates = (issue?.originatingItemLocalIds ?? []).flatMap((localId) => {
        const item = retainedItemsByLocalId.get(localId);
        if (!item || (item.kind !== "EVENT" && item.kind !== "MEASURE"
          && item.kind !== "LEGAL_ACT") || !("date" in item.payload)
          || item.payload.date.precision !== "EXACT"
          || !item.payload.date.from) return [];
        const type = item.kind === "EVENT"
          ? "EVENT_DATE" as const
          : item.payload.proceduralRole === "CHALLENGED_ACT"
            ? "CHALLENGED_ACT_DATE" as const
            : item.kind === "MEASURE"
              ? "MEASURE_DATE" as const
              : null;
        return type ? [{
          type,
          itemLocalId: item.localId,
          referenceDate: item.payload.date.from,
        }] : [];
      });
      const uniqueCandidates = candidates.filter((candidate, candidateIndex) => (
        candidates.findIndex((other) => (
          other.type === candidate.type
          && other.itemLocalId === candidate.itemLocalId
          && other.referenceDate === candidate.referenceDate
        )) === candidateIndex
      ));
      if (uniqueCandidates.length === 1) {
        const candidate = uniqueCandidates[0];
        diagnostics.push({
          code: "RESEARCH_QUESTION_REFERENCE_DATE_REBUILT",
          path: `researchQuestions.${index}.referenceDateBasis`,
          action: "REBUILT",
        });
        return [{
          ...question,
          referenceDate: candidate.referenceDate,
          referenceDateBasis: {
            type: candidate.type,
            itemLocalId: candidate.itemLocalId,
            rationale: "Determinata dal server da un'unica data esatta tra gli elementi originari verificati.",
            userConfirmedDateSource: null,
          },
        }];
      }
      return [question];
    }
    const basisItem = basisItemLocalId === null
      ? undefined
      : retainedItemsByLocalId.get(basisItemLocalId);
    const basisType = question.referenceDateBasis.type;
    const basisKindValid = (basisType === "EVENT_DATE" && basisItem?.kind === "EVENT")
      || (basisType === "MEASURE_DATE" && basisItem?.kind === "MEASURE")
      || (basisType === "CHALLENGED_ACT_DATE"
        && (basisItem?.kind === "LEGAL_ACT" || basisItem?.kind === "MEASURE")
        && basisItem.payload.proceduralRole === "CHALLENGED_ACT")
      || basisType === "USER_CONFIRMED";
    let dateMatches = true;
    if (basisItem && "date" in basisItem.payload) {
      dateMatches = basisItem.payload.date.precision === "EXACT"
        && basisItem.payload.date.from === question.referenceDate;
    }
    if (basisKindValid && dateMatches) return [question];
    diagnostics.push({
      code: "RESEARCH_QUESTION_REFERENCE_DATE_MARKED_UNKNOWN",
      path: `researchQuestions.${index}.referenceDateBasis`,
      action: "MARKED_UNRESOLVED",
    });
    return [{
      ...question,
      referenceDate: null,
      referenceDateBasis: {
        type: "UNKNOWN" as const,
        itemLocalId: null,
        rationale: question.referenceDateBasis.rationale,
        userConfirmedDateSource: null,
      },
    }];
  });
  const documentInventory = coverage.documentInventory;
  const { evidenceCandidates: _evidenceCandidates, ...proposalWithoutEvidenceCandidates } = proposal;
  const parsed = fascicoloDocumentStructuredKnowledgeSchema.safeParse({
    ...proposalWithoutEvidenceCandidates,
    items,
    sourceQuotes: coverage.sourceQuotes,
    documentInventory,
    legalIssues,
    researchQuestions,
  });
  if (!parsed.success) {
    throw new DocumentKnowledgeCompilationError([
      ...diagnostics,
      ...parsed.error.issues.slice(0, 20).map((issue) => ({
        code: issue.message,
        path: issue.path.map(String).join("."),
        action: "BLOCKED" as const,
      })),
    ]);
  }
  const isolatedQuarantineAcceptable = evidence.quarantinedItemLocalIds.length === 0
    || (evidence.quarantinedItemLocalIds.length === 1 && evidence.items.length > 0);
  const promotable = isolatedQuarantineAcceptable
    && legalIssues.length === proposal.legalIssues.length
    && researchQuestions.length === proposal.researchQuestions.length
    && !diagnostics.some((diagnostic) => (
      diagnostic.code === "LEGAL_ISSUE_ORIGINS_PARTIALLY_VERIFIED"
    ));
  return {
    knowledge: parsed.data,
    diagnostics,
    promotable,
    quarantinedItemLocalIds: evidence.quarantinedItemLocalIds,
  };
}
import { createHash } from "node:crypto";

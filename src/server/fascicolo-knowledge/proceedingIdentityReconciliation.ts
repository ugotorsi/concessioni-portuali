import {
  fascicoloDocumentStructuredKnowledgeSchema,
  type FascicoloDocumentKnowledgeProposal,
  type FascicoloStructuredKnowledge,
  type ProceedingIdentityHint,
  type ProceedingIdentityResolution,
  type StructuredKnowledgeProposalItem,
} from "./structuredContracts";

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
}

interface BasisRefCorrection {
  readonly itemLocalId: string;
  readonly fromBasisRef: string;
  readonly toBasisRef: string;
}

function quoteOccurrences(
  quote: string,
  sourceTextByBasisRef: ReadonlyMap<string, string>,
): readonly string[] {
  if (quote.length === 0) return [];
  return [...sourceTextByBasisRef].flatMap(([basisRef, text]) => {
    const occurrences: string[] = [];
    let offset = 0;
    while (offset <= text.length) {
      const index = text.indexOf(quote, offset);
      if (index < 0) break;
      occurrences.push(basisRef);
      offset = index + quote.length;
    }
    return occurrences;
  });
}

function correctionKey(itemLocalId: string, basisRef: string): string {
  return `${itemLocalId}\u001f${basisRef}`;
}

function authenticateSourceQuotes(
  proposal: FascicoloDocumentKnowledgeProposal,
  sourceTextByBasisRef: ReadonlyMap<string, string>,
): {
  readonly corrections: ReadonlyMap<string, BasisRefCorrection>;
  readonly diagnostics: readonly KnowledgeCompilationDiagnostic[];
} {
  const corrections = new Map<string, BasisRefCorrection>();
  const diagnostics: KnowledgeCompilationDiagnostic[] = [];
  for (const [index, sourceQuote] of proposal.sourceQuotes.entries()) {
    const occurrences = quoteOccurrences(sourceQuote.quote, sourceTextByBasisRef);
    const declaredOccurrences = occurrences.filter((basisRef) => basisRef === sourceQuote.basisRef);
    if (occurrences.length === 1 && declaredOccurrences.length === 1) continue;
    if (occurrences.length === 1) {
      const key = correctionKey(sourceQuote.itemLocalId, sourceQuote.basisRef);
      const correction = {
        itemLocalId: sourceQuote.itemLocalId,
        fromBasisRef: sourceQuote.basisRef,
        toBasisRef: occurrences[0],
      };
      const existing = corrections.get(key);
      if (existing && existing.toBasisRef !== correction.toBasisRef) {
        diagnostics.push({
          code: "CONFLICTING_BASIS_REF_CORRECTION",
          path: `sourceQuotes.${index}.basisRef`,
          action: "BLOCKED",
        });
      } else {
        corrections.set(key, correction);
        diagnostics.push({
          code: "BASIS_REF_CORRECTED",
          path: `sourceQuotes.${index}.basisRef`,
          action: "REBUILT",
        });
      }
      continue;
    }
    diagnostics.push({
      code: occurrences.length === 0
        ? "NONEXISTENT_SOURCE_QUOTE"
        : "AMBIGUOUS_SOURCE_QUOTE",
      path: `sourceQuotes.${index}.quote`,
      action: "BLOCKED",
    });
  }
  return { corrections, diagnostics };
}

function correctedBasisRef(
  itemLocalId: string,
  basisRef: string,
  corrections: ReadonlyMap<string, BasisRefCorrection>,
): string {
  return corrections.get(correctionKey(itemLocalId, basisRef))?.toBasisRef ?? basisRef;
}

function correctedHint(
  itemLocalId: string,
  hint: ProceedingIdentityHint | null,
  corrections: ReadonlyMap<string, BasisRefCorrection>,
): ProceedingIdentityHint | null {
  return hint
    ? {
        ...hint,
        evidenceBasisRefs: hint.evidenceBasisRefs.map((basisRef) => (
          correctedBasisRef(itemLocalId, basisRef, corrections)
        )),
      }
    : null;
}

function correctedDependentHint(
  originItemLocalIds: readonly string[],
  hint: ProceedingIdentityHint | null,
  corrections: ReadonlyMap<string, BasisRefCorrection>,
): ProceedingIdentityHint | null {
  if (!hint) return null;
  const correctionOwners = hint.candidateAnchorLocalId
    && originItemLocalIds.includes(hint.candidateAnchorLocalId)
    ? [hint.candidateAnchorLocalId]
    : originItemLocalIds;
  return {
    ...hint,
    evidenceBasisRefs: hint.evidenceBasisRefs.map((basisRef) => {
      const correctedRefs = new Set(correctionOwners.flatMap((itemLocalId) => {
        const corrected = corrections.get(correctionKey(itemLocalId, basisRef));
        return corrected ? [corrected.toBasisRef] : [];
      }));
      return correctedRefs.size === 1 ? [...correctedRefs][0] : basisRef;
    }),
  };
}

function correctProposalEvidence(
  proposal: FascicoloDocumentKnowledgeProposal,
  corrections: ReadonlyMap<string, BasisRefCorrection>,
): FascicoloDocumentKnowledgeProposal {
  return {
    ...proposal,
    items: proposal.items.map((item) => {
      const basisRefs = item.basisRefs.map((basisRef) => (
        correctedBasisRef(item.localId, basisRef, corrections)
      ));
      if (item.kind === "FACT") {
        return {
          ...item,
          basisRefs,
          payload: {
            ...item.payload,
            proceedingIdentityHint: correctedHint(
              item.localId,
              item.payload.proceedingIdentityHint,
              corrections,
            ),
          },
        };
      }
      if (item.kind === "EVENT") {
        return {
          ...item,
          basisRefs,
          payload: {
            ...item.payload,
            proceedingIdentityHint: correctedHint(
              item.localId,
              item.payload.proceedingIdentityHint,
              corrections,
            ),
          },
        };
      }
      if (item.kind === "LEGAL_ACT" || item.kind === "MEASURE") {
        return {
          ...item,
          basisRefs,
          payload: {
            ...item.payload,
            documentBasisRef: correctedBasisRef(
              item.localId,
              item.payload.documentBasisRef,
              corrections,
            ),
          },
        };
      }
      return { ...item, basisRefs };
    }),
    sourceQuotes: proposal.sourceQuotes.map((sourceQuote) => ({
      ...sourceQuote,
      basisRef: correctedBasisRef(
        sourceQuote.itemLocalId,
        sourceQuote.basisRef,
        corrections,
      ),
    })),
    legalIssues: proposal.legalIssues.map((issue) => ({
      ...issue,
      targetProceedingHint: correctedDependentHint(
        issue.originatingItemLocalIds,
        issue.targetProceedingHint,
        corrections,
      ),
    })),
  };
}

function documentedBasisRefs(
  proposal: FascicoloDocumentKnowledgeProposal,
): ReadonlyMap<string, ReadonlySet<string>> {
  const refs = new Map<string, Set<string>>();
  for (const sourceQuote of proposal.sourceQuotes) {
    const current = refs.get(sourceQuote.itemLocalId) ?? new Set<string>();
    current.add(sourceQuote.basisRef);
    refs.set(sourceQuote.itemLocalId, current);
  }
  return refs;
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
  sourceTextByBasisRef: ReadonlyMap<string, string>;
}): CompiledDocumentKnowledge {
  const authenticated = authenticateSourceQuotes(
    input.proposal,
    input.sourceTextByBasisRef,
  );
  if (authenticated.diagnostics.some((diagnostic) => diagnostic.action === "BLOCKED")) {
    throw new DocumentKnowledgeCompilationError(authenticated.diagnostics);
  }
  const proposal = correctProposalEvidence(input.proposal, authenticated.corrections);
  const documented = documentedBasisRefs(proposal);
  const itemsByLocalId = new Map(proposal.items.map((item) => [item.localId, item]));
  const anchors = proposal.items.filter((item) => (
    item.kind === "LEGAL_ACT" || item.kind === "MEASURE"
  ));
  const diagnostics = [...authenticated.diagnostics];
  const items = proposal.items.map((item, itemIndex) => {
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
  const legalIssues = proposal.legalIssues.map((issue, issueIndex) => {
    const resolved = resolveIssueIdentity({
      issueIndex,
      hint: issue.targetProceedingHint,
      originLocalIds: issue.originatingItemLocalIds,
      itemsByLocalId,
      documented,
    });
    diagnostics.push(resolved.diagnostic);
    const { targetProceedingHint: _hint, ...candidate } = issue;
    return {
      ...candidate,
      targetProceedingIdentity: resolved.identity,
      targetProceedingResolution: resolved.resolution,
    };
  });
  const parsed = fascicoloDocumentStructuredKnowledgeSchema.safeParse({
    ...proposal,
    items,
    legalIssues,
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
  return { knowledge: parsed.data, diagnostics };
}

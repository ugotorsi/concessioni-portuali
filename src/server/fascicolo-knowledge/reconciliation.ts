import {
  type KnowledgeItemCandidate,
  type PreparedKnowledgeItemCandidate,
  type KnowledgeReconciliationEntry,
  type PersistedKnowledgeItemIdentity,
} from "./contracts";
import { prepareKnowledgeItemCandidate } from "./canonicalization";

export class FascicoloKnowledgeReconciliationError extends Error {
  constructor(readonly code: "DUPLICATE_SEMANTIC_KEY") {
    super(code);
    this.name = "FascicoloKnowledgeReconciliationError";
  }
}

function identity(version: string, key: string): string {
  return `${version}:${key}`;
}

export function reconcileKnowledgeItems(
  previousItems: readonly PersistedKnowledgeItemIdentity[],
  candidates: readonly (KnowledgeItemCandidate | PreparedKnowledgeItemCandidate)[],
): readonly KnowledgeReconciliationEntry[] {
  const prepared = candidates.map((candidate) => "semanticKey" in candidate
    ? candidate
    : prepareKnowledgeItemCandidate(candidate));
  const candidateIdentities = prepared.map((item) => identity(item.semanticKeyVersion, item.semanticKey));
  if (new Set(candidateIdentities).size !== candidateIdentities.length) {
    throw new FascicoloKnowledgeReconciliationError("DUPLICATE_SEMANTIC_KEY");
  }
  const previous = new Map(previousItems.map((item) => [
    identity(item.semanticKeyVersion, item.semanticKey),
    item,
  ]));
  const result: KnowledgeReconciliationEntry[] = prepared.map((candidate) => {
    const prior = previous.get(identity(candidate.semanticKeyVersion, candidate.semanticKey)) ?? null;
    if (!prior) {
      return {
        classification: "ADDED",
        semanticKey: candidate.semanticKey,
        semanticKeyVersion: candidate.semanticKeyVersion,
        previousItemId: null,
        candidate,
        nextStatus: "AI_PROPOSED",
      };
    }
    const unchanged = prior.contentFingerprint === candidate.contentFingerprint;
    return {
      classification: unchanged ? "UNCHANGED" : "MODIFIED",
      semanticKey: candidate.semanticKey,
      semanticKeyVersion: candidate.semanticKeyVersion,
      previousItemId: prior.id,
      candidate,
      nextStatus: unchanged ? prior.status : "AI_PROPOSED",
    };
  });
  const nextIdentities = new Set(candidateIdentities);
  for (const prior of previousItems) {
    if (!nextIdentities.has(identity(prior.semanticKeyVersion, prior.semanticKey))) {
      result.push({
        classification: "NO_LONGER_SUPPORTED",
        semanticKey: prior.semanticKey,
        semanticKeyVersion: prior.semanticKeyVersion,
        previousItemId: prior.id,
        candidate: null,
        nextStatus: null,
      });
    }
  }
  return result;
}
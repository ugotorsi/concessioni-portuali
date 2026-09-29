import { describe, expect, it } from "vitest";

import {
  buildKnowledgeContentFingerprint,
  buildKnowledgeSemanticKey,
  prepareKnowledgeItemCandidate,
  reconcileKnowledgeItems,
  type KnowledgeItemCandidate,
} from "@/server/fascicolo-knowledge";

const hash = "a".repeat(64);

function candidate(overrides: Partial<KnowledgeItemCandidate> = {}): KnowledgeItemCandidate {
  return {
    kind: "GENERIC",
    normalizedIdentity: "identita stabile",
    normalizedText: "Contenuto normalizzato",
    structuredPayload: { alpha: 1, nested: { beta: true } },
    confidence: 80,
    evidence: [{
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: "document-1",
      documentFileVersionId: "version-1",
      extractionAttemptId: "attempt-1",
      pageNumber: 1,
      textSha256: hash,
      quoteSha256: null,
      basisRef: "DOCUMENT_1.PAGE_1",
    }],
    ...overrides,
  };
}

describe("fascicolo knowledge canonicalization and reconciliation", () => {
  it("keeps semantic identity stable across revisions and normalizes equivalent identity text", () => {
    expect(buildKnowledgeSemanticKey({ kind: "GENERIC", normalizedIdentity: "  Identita   stabile " }))
      .toBe(buildKnowledgeSemanticKey({ kind: "GENERIC", normalizedIdentity: "identita stabile" }));
    expect(prepareKnowledgeItemCandidate(candidate()).semanticKeyVersion).toBe("SEMANTIC_KEY_V1");
  });

  it("canonicalizes object property order without changing the content fingerprint", () => {
    const left = candidate({ structuredPayload: { alpha: 1, nested: { beta: true, gamma: "x" } } });
    const right = candidate({ structuredPayload: { nested: { gamma: "x", beta: true }, alpha: 1 } });
    expect(buildKnowledgeContentFingerprint(left)).toBe(buildKnowledgeContentFingerprint(right));
  });

  it("changes the content fingerprint for material content or evidence changes", () => {
    const original = buildKnowledgeContentFingerprint(candidate());
    expect(buildKnowledgeContentFingerprint(candidate({ normalizedText: "Contenuto materialmente diverso" })))
      .not.toBe(original);
    expect(buildKnowledgeContentFingerprint(candidate({
      evidence: [{ ...candidate().evidence[0], pageNumber: 2 }],
    }))).not.toBe(original);
    expect(buildKnowledgeContentFingerprint(candidate({
      evidence: [{ ...candidate().evidence[0], pageNumber: 2, basisRef: "DOCUMENT_1.PAGE_2" }],
    }))).not.toBe(original);
  });

  it("classifies added, unchanged, modified, and no-longer-supported items", () => {
    const unchanged = prepareKnowledgeItemCandidate(candidate({ normalizedIdentity: "unchanged" }));
    const modifiedBefore = prepareKnowledgeItemCandidate(candidate({ normalizedIdentity: "modified" }));
    const removed = prepareKnowledgeItemCandidate(candidate({ normalizedIdentity: "removed" }));
    const result = reconcileKnowledgeItems([
      { id: "old-u", ...unchanged, status: "HUMAN_CONFIRMED" },
      { id: "old-m", ...modifiedBefore, status: "REJECTED" },
      { id: "old-r", ...removed, status: "AI_PROPOSED" },
    ], [
      candidate({ normalizedIdentity: "unchanged" }),
      candidate({ normalizedIdentity: "modified", normalizedText: "Nuovo contenuto" }),
      candidate({ normalizedIdentity: "added" }),
    ]);
    expect(result.map((item) => item.classification).sort()).toEqual([
      "ADDED", "MODIFIED", "NO_LONGER_SUPPORTED", "UNCHANGED",
    ]);
    expect(result.find((item) => item.classification === "UNCHANGED")?.nextStatus).toBe("HUMAN_CONFIRMED");
    expect(result.find((item) => item.classification === "MODIFIED")?.nextStatus).toBe("AI_PROPOSED");
  });
});
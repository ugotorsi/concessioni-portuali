import { createHash } from "node:crypto";

import {
  FASCICOLO_KNOWLEDGE_SEMANTIC_KEY_VERSION,
  knowledgeItemCandidateSchema,
  type JsonValue,
  type KnowledgeEvidenceCandidate,
  type KnowledgeItemCandidate,
  type PreparedKnowledgeItemCandidate,
} from "./contracts";

function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalizeJson(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function materialEvidence(evidence: readonly KnowledgeEvidenceCandidate[]) {
  return evidence.map((item) => ({
    provenanceType: item.provenanceType,
    documentoId: item.documentoId,
    documentFileVersionId: item.documentFileVersionId,
    extractionAttemptId: item.provenanceType === "DOCUMENT_EXTRACTION"
      ? item.extractionAttemptId ?? null
      : item.documentExtractionAttemptId ?? null,
    pageNumber: item.pageNumber,
    textSha256: item.textSha256,
    quoteSha256: item.quoteSha256,
    basisRef: item.basisRef,
  })).sort((left, right) => {
    const leftJson = canonicalJson(left);
    const rightJson = canonicalJson(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

export function buildKnowledgeSemanticKey(input: {
  kind: string;
  normalizedIdentity: string;
  semanticKeyVersion?: string;
}): string {
  return digest(canonicalJson({
    version: input.semanticKeyVersion ?? FASCICOLO_KNOWLEDGE_SEMANTIC_KEY_VERSION,
    kind: input.kind,
    normalizedIdentity: normalizeIdentity(input.normalizedIdentity),
  }));
}

export function buildKnowledgeContentFingerprint(input: KnowledgeItemCandidate): string {
  const parsed = knowledgeItemCandidateSchema.parse(input);
  return digest(canonicalJson({
    kind: parsed.kind,
    normalizedText: parsed.normalizedText.normalize("NFKC"),
    structuredPayload: parsed.structuredPayload,
    confidence: parsed.confidence,
    evidence: materialEvidence(parsed.evidence),
  }));
}

export function prepareKnowledgeItemCandidate(input: KnowledgeItemCandidate): PreparedKnowledgeItemCandidate {
  const parsed = knowledgeItemCandidateSchema.parse(input);
  return Object.freeze({
    ...parsed,
    semanticKey: buildKnowledgeSemanticKey(parsed),
    semanticKeyVersion: FASCICOLO_KNOWLEDGE_SEMANTIC_KEY_VERSION,
    contentFingerprint: buildKnowledgeContentFingerprint(parsed),
  });
}
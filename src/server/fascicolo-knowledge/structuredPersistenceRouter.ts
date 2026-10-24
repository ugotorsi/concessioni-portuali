import type { KnowledgeEvidenceCandidate, KnowledgeScope } from "./contracts";
import { isCanonicalIdentityV3Enabled } from "./canonicalIntegrationGate";
import { persistCanonicalStructuredKnowledgeRevision } from "./canonicalStructuredPersistence";
import { persistStructuredKnowledgeRevision } from "./structuredPersistence";

export interface RoutedStructuredKnowledgePersistenceInput extends KnowledgeScope {
  corpusFingerprint: string;
  knowledge: unknown;
  evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  sourceTextByBasisRef?: ReadonlyMap<string, string>;
}

interface StructuredPersistenceRouterDependencies {
  environment: Readonly<Record<string, string | undefined>>;
  legacy: typeof persistStructuredKnowledgeRevision;
  canonical: typeof persistCanonicalStructuredKnowledgeRevision;
}

const defaultDependencies: StructuredPersistenceRouterDependencies = {
  environment: process.env,
  legacy: persistStructuredKnowledgeRevision,
  canonical: persistCanonicalStructuredKnowledgeRevision,
};

export async function persistStructuredKnowledgeForConfiguredEngine(
  input: RoutedStructuredKnowledgePersistenceInput,
  dependencies: Partial<StructuredPersistenceRouterDependencies> = {},
) {
  const resolved = { ...defaultDependencies, ...dependencies };
  if (!isCanonicalIdentityV3Enabled(resolved.environment)) {
    return resolved.legacy(input);
  }
  if (!input.sourceTextByBasisRef) {
    throw new Error("CANONICAL_SOURCE_TEXT_REQUIRED");
  }
  return resolved.canonical({
    ...input,
    sourceTextByBasisRef: input.sourceTextByBasisRef,
  });
}

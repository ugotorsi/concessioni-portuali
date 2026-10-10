import type { ProviderAnalysisPayloadV1 } from "@/server/ai/fascicoloAnalysis";
import {
  createFascicoloDocumentAnalysisService,
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
} from "@/server/ai/fascicoloDocumentAnalysis";
import {
  getCurrentKnowledgeRevision,
  persistStructuredKnowledgeRevision,
} from "@/server/fascicolo-knowledge";
import {
  buildFascicoloDocumentKnowledgeEvidence,
  getFascicoloDocumentCorpus,
  toFascicoloDocumentAnalysisCorpus,
  type FascicoloDocumentCorpus,
} from "@/server/queries/fascicolo-document-corpus";
import {
  loadCurrentStructuredKnowledge,
  type StructuredKnowledgeReadModel,
} from "@/server/queries/fascicolo-knowledge";

type FascicoloDocumentAnalysisService = ReturnType<typeof createFascicoloDocumentAnalysisService>;

export interface FascicoloDocumentStructuredKnowledgeDependencies {
  getCorpus: typeof getFascicoloDocumentCorpus;
  getCurrentRevision: typeof getCurrentKnowledgeRevision;
  persistKnowledge: typeof persistStructuredKnowledgeRevision;
  loadReadModel: typeof loadCurrentStructuredKnowledge;
}

export type FascicoloDocumentStructuredKnowledgeResult =
  | {
      outcome: "NOT_FOUND";
      corpus: null;
      analysis: null;
      knowledge: null;
    }
  | {
      outcome: "NOT_READY";
      corpus: FascicoloDocumentCorpus;
      analysis: null;
      knowledge: null;
    }
  | {
      outcome: "REUSED";
      corpus: FascicoloDocumentCorpus;
      analysis: null;
      knowledge: StructuredKnowledgeReadModel;
    }
  | {
      outcome: "NO_STRUCTURED_KNOWLEDGE";
      corpus: FascicoloDocumentCorpus;
      analysis: ProviderAnalysisPayloadV1;
      knowledge: null;
    }
  | {
      outcome: "PERSISTED";
      corpus: FascicoloDocumentCorpus;
      analysis: ProviderAnalysisPayloadV1;
      knowledge: StructuredKnowledgeReadModel;
    };

export class FascicoloDocumentStructuredKnowledgeError extends Error {
  constructor(readonly code: "CORPUS_GROUNDING_INVALID" | "READ_MODEL_NOT_AVAILABLE") {
    super(code);
    this.name = "FascicoloDocumentStructuredKnowledgeError";
  }
}

const defaultDependencies: FascicoloDocumentStructuredKnowledgeDependencies = {
  getCorpus: getFascicoloDocumentCorpus,
  getCurrentRevision: getCurrentKnowledgeRevision,
  persistKnowledge: persistStructuredKnowledgeRevision,
  loadReadModel: loadCurrentStructuredKnowledge,
};

export function createFascicoloDocumentStructuredKnowledgeService(config: {
  analysisService: FascicoloDocumentAnalysisService;
  dependencies?: Partial<FascicoloDocumentStructuredKnowledgeDependencies>;
}): Readonly<{
  analyzeAndPersist(input: {
    tenantId: string;
    procedimentoId: string;
  }): Promise<FascicoloDocumentStructuredKnowledgeResult>;
}> {
  const dependencies = { ...defaultDependencies, ...config.dependencies };
  return {
    async analyzeAndPersist(input) {
      const corpus = await dependencies.getCorpus(input);
      if (!corpus) {
        return { outcome: "NOT_FOUND", corpus: null, analysis: null, knowledge: null };
      }
      const analysisCorpus = toFascicoloDocumentAnalysisCorpus(corpus);
      const primaryDocument = analysisCorpus.documents[0];
      if (!primaryDocument || analysisCorpus.excerpts.length === 0) {
        return { outcome: "NOT_READY", corpus, analysis: null, knowledge: null };
      }

      const current = await dependencies.getCurrentRevision(input);
      if (current?.corpusFingerprint === corpus.corpusFingerprint) {
        const knowledge = await dependencies.loadReadModel(input.tenantId, input.procedimentoId);
        if (!knowledge || knowledge.revision.id !== current.id) {
          throw new FascicoloDocumentStructuredKnowledgeError("READ_MODEL_NOT_AVAILABLE");
        }
        return { outcome: "REUSED", corpus, analysis: null, knowledge };
      }

      const analysis = await config.analysisService.analyze({
        contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        documentVersionId: primaryDocument.documentVersionId,
        artifactSha256: primaryDocument.artifactSha256,
        corpusFingerprint: analysisCorpus.corpusFingerprint,
        documents: analysisCorpus.documents,
        documentsAreUntrustedData: true,
        externalToolsAllowed: false,
        excerpts: analysisCorpus.excerpts,
      });
      if (!analysis.structuredKnowledge) {
        return { outcome: "NO_STRUCTURED_KNOWLEDGE", corpus, analysis, knowledge: null };
      }

      const evidenceByBasisRef = buildFascicoloDocumentKnowledgeEvidence(corpus);
      if (evidenceByBasisRef.size !== analysisCorpus.excerpts.length) {
        throw new FascicoloDocumentStructuredKnowledgeError("CORPUS_GROUNDING_INVALID");
      }
      const persisted = await dependencies.persistKnowledge({
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        corpusFingerprint: corpus.corpusFingerprint,
        knowledge: analysis.structuredKnowledge,
        evidenceByBasisRef,
      });
      const knowledge = await dependencies.loadReadModel(input.tenantId, input.procedimentoId);
      if (!knowledge || knowledge.revision.id !== persisted.revision.id) {
        throw new FascicoloDocumentStructuredKnowledgeError("READ_MODEL_NOT_AVAILABLE");
      }
      return { outcome: "PERSISTED", corpus, analysis, knowledge };
    },
  };
}

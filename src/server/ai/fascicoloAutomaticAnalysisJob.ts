import { createHash } from "node:crypto";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { AsyncJobAdmissionInput } from "@/server/async-jobs/domain";
import { admitAsyncJob } from "@/server/async-jobs/persistence";
import type { AsyncJobHandler, AsyncJobHandlerContext } from "@/server/async-jobs/registry";
import { AsyncJobExecutionError } from "@/server/async-jobs/worker";
import {
  providerAnalysisPayloadV1Schema,
  type ProviderAnalysisPayloadV1,
} from "@/server/ai/fascicoloAnalysis";
import {
  createResearchMission,
  RESEARCH_BRIDGE_VERSION,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import { createResearchMissionRecord } from "@/server/legal-research/persistence";
import {
  ensureAutomaticResearchExecution,
  type AutomaticResearchAdmissionResult,
} from "@/server/legal-research/automatic-research-job";
import { FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloAutomaticContracts";
import {
  FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
  FascicoloDocumentAnalysisError,
  type FascicoloDocumentAnalysisInput,
  type FascicoloDocumentExcerpt,
} from "@/server/ai/fascicoloDocumentAnalysis";
import { createOpenAiFascicoloDocumentRuntimeFromEnv } from "@/server/ai/openaiRuntime";
import { AiRealDataActivationError } from "@/server/ai/realDataActivation";
import { OpenAiRuntimeConfigurationError } from "@/server/ai/openaiRuntime";
import { withRuntimeCostGate } from "@/server/runtime/cost";
import { runtimeCostEstimate } from "@/server/runtime/costConfig";
import {
  AutomaticFascicoloReportRepositoryError,
  findAutomaticFascicoloReportByVersion,
  persistAutomaticFascicoloReport,
  type AutomaticFascicoloReportReference,
} from "@/server/ai/fascicoloAutomaticReportRepository";
import {
  admitDeferredKnowledgeResearchMissionWave,
  buildKnowledgeResearchMissionPlans,
  DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
  persistStructuredKnowledgeRevision,
  reconcileKnowledgeResearchMissions,
  type KnowledgeEvidenceCandidate,
  type KnowledgeMissionLifecycleResult,
  type KnowledgeReconciliationResult,
} from "@/server/fascicolo-knowledge";

export { FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION } from "@/server/ai/fascicoloAutomaticContracts";

export const FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION = "FASCICOLO.AUTOMATIC_ANALYSIS_V1" as const;
export const FASCICOLO_AUTOMATIC_ANALYSIS_PURPOSE = "FASCICOLO_AUTOMATIC_ANALYSIS" as const;
const MAX_DOCUMENT_EXCERPT_CHARACTERS = 24_000;

const automaticReferenceSchema = z.object({
  referenceType: z.literal("FASCICOLO_DOCUMENT_VERSION"),
  referenceId: z.string().trim().min(1).max(256),
  referenceVersion: z.literal("V1"),
  metadata: z.object({
    procedimentoId: z.string().trim().min(1).max(256),
    neutralIntakeId: z.string().trim().min(1).max(256),
    extractionAttemptId: z.string().trim().min(1).max(256),
  }).strict(),
}).strict();

type AutomaticReference = z.output<typeof automaticReferenceSchema>;

export type AutomaticDocumentExcerpt = FascicoloDocumentExcerpt;
export type AutomaticFascicoloAnalysisInput = FascicoloDocumentAnalysisInput & {
  readonly attempt: number;
};

export interface AutomaticFascicoloReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly documentVersionId: string;
  readonly artifactSha256: string;
  readonly corpusFingerprint: string;
  readonly documents: readonly {
    documentVersionId: string;
    artifactSha256: string;
  }[];
  readonly neutralIntakeId: string;
  readonly actorId: string;
  readonly analysis: ProviderAnalysisPayloadV1;
  readonly provenance: readonly Omit<AutomaticDocumentExcerpt, "text">[];
  readonly missions: readonly ResearchMission[];
  readonly supersedesReportIds: readonly string[];
}

interface AutomaticAuthority {
  readonly tenantId: string;
  readonly procedimentoId: string;
  readonly neutralIntakeId: string;
  readonly extractionAttemptId: string;
  readonly artifactSha256: string;
  readonly corpusFingerprint: string;
  readonly actorId: string;
  readonly documents: readonly {
    neutralIntakeId: string;
    documentVersionId: string;
    artifactSha256: string;
    documentoId?: string;
    documentFileVersionId?: string;
    pages: readonly {
      pageNumber: number;
      normalizedText: string;
      textSha256: string;
      extractionMethod: string;
      ocrConfidence: number | null;
    }[];
  }[];
}

export interface FascicoloAutomaticAnalysisDependencies {
  loadAuthority(input: { jobId: string; reference: AutomaticReference }): Promise<AutomaticAuthority | null>;
  findExistingReport(input: {
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
  }): Promise<AutomaticFascicoloReportReference | null>;
  analyze(input: AutomaticFascicoloAnalysisInput): Promise<unknown>;
  persistKnowledge?(input: {
    tenantId: string;
    procedimentoId: string;
    corpusFingerprint: string;
    knowledge: unknown;
    evidenceByBasisRef: ReadonlyMap<string, KnowledgeEvidenceCandidate>;
  }): Promise<unknown>;
  reconcileKnowledgeMissions?(input: {
    tenantId: string;
    procedimentoId: string;
    knowledgeRevisionId: string;
    plans: ReturnType<typeof buildKnowledgeResearchMissionPlans>;
  }): Promise<readonly KnowledgeMissionLifecycleResult[]>;
  researchExecutionWaveLimit?: number;
  persistReport(input: AutomaticFascicoloReport): Promise<{ outcome: "CREATED" | "REUSED"; reportId: string }>;
  persistMission(input: { mission: ResearchMission; actorId: string; tenantId: string }): Promise<unknown>;
  scheduleMission(input: {
    mission: ResearchMission;
    actorId: string;
    tenantId: string;
    correlationId: string;
  }): Promise<AutomaticResearchAdmissionResult>;
  listPriorReportIds(input: { tenantId: string; procedimentoId: string; exceptVersionId: string }): Promise<readonly string[]>;
}

function stableIdentity(prefix: string, value: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function boundedExcerpts(authority: AutomaticAuthority): readonly AutomaticDocumentExcerpt[] {
  let remaining = MAX_DOCUMENT_EXCERPT_CHARACTERS;
  const excerpts: AutomaticDocumentExcerpt[] = [];
  const perDocumentLimit = Math.max(1, Math.floor(MAX_DOCUMENT_EXCERPT_CHARACTERS / authority.documents.length));
  for (const [documentIndex, document] of authority.documents.entries()) {
    let documentRemaining = Math.min(perDocumentLimit, remaining);
    for (const page of [...document.pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
      if (documentRemaining <= 0 || remaining <= 0) break;
      const text = page.normalizedText.slice(0, documentRemaining);
      if (!text.trim()) continue;
      excerpts.push({
        reference: `DOCUMENT_${documentIndex + 1}.PAGE_${page.pageNumber}`,
        documentVersionId: document.documentVersionId,
        artifactSha256: document.artifactSha256,
        pageNumber: page.pageNumber,
        text,
        textSha256: page.textSha256,
        extractionMethod: page.extractionMethod,
        ocrConfidence: page.ocrConfidence,
      });
      documentRemaining -= text.length;
      remaining -= text.length;
    }
  }
  return excerpts;
}

function validateGrounding(analysis: ProviderAnalysisPayloadV1, excerpts: readonly AutomaticDocumentExcerpt[]): void {
  const allowed = new Set(excerpts.map((excerpt) => excerpt.reference));
  const grounded = [
    analysis.summary,
    ...analysis.timeline,
    ...analysis.recordedState,
    ...analysis.signals,
  ];
  const all = [
    ...grounded,
    ...analysis.investigativeQuestions,
    ...analysis.suggestedActivities,
    ...analysis.legalResearchQuestions,
  ];
  const missingGrounding = grounded.filter((statement) => statement.basisRefs.length === 0).length;
  const invalidReferences = [...new Set(
    all.flatMap((statement) => statement.basisRefs.filter((reference) => !allowed.has(reference))),
  )];
  if (missingGrounding > 0 || invalidReferences.length > 0) {
    console.error({
      event: "fascicolo_document_analysis_invalid_grounding",
      missingGrounding,
      invalidReferences,
      allowedReferences: [...allowed],
    });
    throw new AsyncJobExecutionError("ANALYSIS", "DOCUMENT_GROUNDING_INVALID", false);
  }
}

function resolveKnowledgeEvidence(
  authority: AutomaticAuthority,
  excerpts: readonly AutomaticDocumentExcerpt[],
): ReadonlyMap<string, KnowledgeEvidenceCandidate> {
  return new Map(excerpts.flatMap((excerpt) => {
    const document = authority.documents.find((candidate) => candidate.documentVersionId === excerpt.documentVersionId);
    if (!document?.documentoId || !document.documentFileVersionId) return [];
    return [[excerpt.reference, {
      provenanceType: "DOCUMENT_EXTRACTION",
      documentoId: document.documentoId,
      documentFileVersionId: document.documentFileVersionId,
      extractionAttemptId: document.documentVersionId,
      pageNumber: excerpt.pageNumber,
      textSha256: excerpt.textSha256,
      quoteSha256: null,
      basisRef: excerpt.reference,
    } satisfies KnowledgeEvidenceCandidate] as const];
  }));
}

function missionsFromAnalysis(input: {
  authority: AutomaticAuthority;
  analysis: ProviderAnalysisPayloadV1;
}): readonly ResearchMission[] {
  const referenceDate = input.analysis.timeline.find((item) => item.recordedAt !== null)?.recordedAt ?? null;
  if (!referenceDate) return [];
  return input.analysis.legalResearchQuestions.slice(0, DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT).map((question, index) => {
    const issueId = stableIdentity("legal-issue", {
      documentVersionId: input.authority.extractionAttemptId,
      corpusFingerprint: input.authority.corpusFingerprint,
      index,
      text: question.text,
    });
    return createResearchMission({
      kind: "RESEARCH_MISSION",
      version: RESEARCH_BRIDGE_VERSION,
      caseReference: {
        caseId: input.authority.procedimentoId,
        fascicoloReference: input.authority.procedimentoId,
      },
      legalIssueIds: [issueId],
      legalPropositionIds: [],
      referenceDate,
      mode: "DISCOVER_AUTHORITIES",
      researchQuestion: question.text,
      knownAuthorities: [],
      excludedAuthorities: [],
      preferredSourceFamilies: ["ITALIAN_LEGISLATION", "GIUSTIZIA_AMMINISTRATIVA"],
      missingSourceFamilies: [],
      knownCounterArguments: input.analysis.signals
        .filter((signal) => signal.type === "VERIFY")
        .map((signal) => signal.text),
      knownEvidenceGaps: input.analysis.investigativeQuestions.map((gap, gapIndex) => ({
        gapId: stableIdentity("research-gap", {
          documentVersionId: input.authority.extractionAttemptId,
          corpusFingerprint: input.authority.corpusFingerprint,
          gapIndex,
          text: gap.text,
        }),
        kind: "MISSING_FACT_EVIDENCE" as const,
      })),
      requiredOutput: {
        authorityCandidates: true,
        citationObservations: false,
        legalResearchSuggestions: false,
        evidenceGaps: true,
        fullTextRequired: false,
      },
      budget: {
        maxTotalResearchCalls: 6,
        maxMoonlitCalls: 2,
        maxSimpliciterCalls: 2,
        maxLegalDataHunterCalls: 2,
      },
      status: "PENDING",
      executionPlan: {
        requiredCapabilities: ["SEMANTIC_DISCOVERY"],
      },
    });
  });
}

export interface DeferredKnowledgeResearchWaveDependencies {
  admit(input: { tenantId: string; procedimentoId: string; limit: number }): Promise<readonly { mission: ResearchMission }[]>;
  schedule(input: { mission: ResearchMission; actorId: string; tenantId: string; correlationId: string }): Promise<AutomaticResearchAdmissionResult>;
}

export async function executeDeferredKnowledgeResearchWave(input: {
  tenantId: string;
  procedimentoId: string;
  actorId: string;
  correlationId: string;
  limit?: number;
}, overrides: Partial<DeferredKnowledgeResearchWaveDependencies> = {}): Promise<readonly AutomaticResearchAdmissionResult[]> {
  const dependencies: DeferredKnowledgeResearchWaveDependencies = {
    admit: (value) => admitDeferredKnowledgeResearchMissionWave(value),
    schedule: ensureAutomaticResearchExecution,
    ...overrides,
  };
  const admitted = await dependencies.admit({
    tenantId: input.tenantId,
    procedimentoId: input.procedimentoId,
    limit: input.limit ?? DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
  });
  return Promise.all(admitted.map(({ mission }) => dependencies.schedule({
    mission,
    actorId: input.actorId,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
  })));
}

const defaultHandlerDependencies: FascicoloAutomaticAnalysisDependencies = {
  async loadAuthority(input) {
    const [job, attempt] = await Promise.all([
      prisma.asyncJob.findUnique({
        where: { id: input.jobId },
        select: { operation: true, tenantId: true, actorId: true },
      }),
      prisma.neutralIntakeExtractionAttempt.findUnique({
        where: { id: input.reference.metadata.extractionAttemptId },
        select: {
          id: true,
          neutralIntakeId: true,
          artifactSha256: true,
          outcome: true,
          neutralIntake: {
            select: {
              id: true,
              enteId: true,
              destination: { select: { procedimentoId: true } },
            },
          },
          pages: {
            orderBy: { pageNumber: "asc" },
            select: {
              pageNumber: true,
              normalizedText: true,
              textSha256: true,
              extractionMethod: true,
              ocrConfidence: true,
            },
          },
        },
      }),
    ]);
    const destination = attempt?.neutralIntake.destination;
    if (!job || !attempt || !destination
      || job.operation !== FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION
      || job.tenantId === null || job.tenantId !== attempt.neutralIntake.enteId
      || attempt.id !== input.reference.referenceId
      || attempt.id !== input.reference.metadata.extractionAttemptId
      || attempt.neutralIntakeId !== input.reference.metadata.neutralIntakeId
      || destination.procedimentoId !== input.reference.metadata.procedimentoId
      || attempt.outcome !== "SUCCEEDED") {
      return null;
    }
    const intakes = await prisma.neutralIntake.findMany({
      where: {
        enteId: job.tenantId,
        destination: { is: { procedimentoId: destination.procedimentoId } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        extractionAttempts: {
          where: { outcome: "SUCCEEDED" },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            artifactSha256: true,
            pages: {
              orderBy: { pageNumber: "asc" },
              select: {
                pageNumber: true,
                normalizedText: true,
                textSha256: true,
                extractionMethod: true,
                ocrConfidence: true,
              },
            },
          },
        },
      },
    });
    const extractedDocuments = intakes.flatMap((intake) => intake.extractionAttempts.map((version) => ({
      neutralIntakeId: intake.id,
      documentVersionId: version.id,
      artifactSha256: version.artifactSha256,
      pages: version.pages,
    })));
    const routedDocuments = await prisma.documento.findMany({
      where: {
        enteId: job.tenantId,
        procedimentoId: destination.procedimentoId,
        sha256: { in: extractedDocuments.map((document) => document.artifactSha256) },
        currentFileVersionId: { not: null },
      },
      select: { id: true, sha256: true, currentFileVersionId: true },
    });
    const documents = extractedDocuments.map((document) => {
      const matches = routedDocuments.filter((candidate) => candidate.sha256 === document.artifactSha256);
      return {
        ...document,
        documentoId: matches.length === 1 ? matches[0].id : undefined,
        documentFileVersionId: matches.length === 1 ? matches[0].currentFileVersionId ?? undefined : undefined,
      };
    });
    if (!documents.some((document) => document.documentVersionId === attempt.id)) return null;
    const corpusFingerprint = createHash("sha256").update(JSON.stringify(documents.map((document) => ({
      neutralIntakeId: document.neutralIntakeId,
      documentVersionId: document.documentVersionId,
      artifactSha256: document.artifactSha256,
    }))), "utf8").digest("hex");
    return {
      tenantId: job.tenantId,
      procedimentoId: destination.procedimentoId,
      neutralIntakeId: attempt.neutralIntake.id,
      extractionAttemptId: attempt.id,
      artifactSha256: attempt.artifactSha256,
      corpusFingerprint,
      actorId: job.actorId,
      documents,
    };
  },
  findExistingReport: findAutomaticFascicoloReportByVersion,
  async analyze(input) {
    try {
      const estimatedAmount = runtimeCostEstimate("ASYNC_COST_OPENAI_ANALYSIS_ESTIMATE_EUR");
      return await withRuntimeCostGate({
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        jobId: null,
        provider: "OPENAI",
        operationType: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
        estimatedAmount,
        idempotencyKey:
          `${FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION}:${input.corpusFingerprint}:${input.attempt}`,
      }, async () => ({
        value: await createOpenAiFascicoloDocumentRuntimeFromEnv().analyze(input),
        actualAmount: estimatedAmount,
      }));
    } catch (error) {
      if (error instanceof OpenAiRuntimeConfigurationError) {
        throw new AsyncJobExecutionError("CONFIGURATION", "AI_CONFIGURATION_ERROR", false);
      }
      if (error instanceof AiRealDataActivationError) {
        throw new AsyncJobExecutionError("CONFIGURATION", "AI_REAL_DATA_DISABLED", false);
      }
      if (error instanceof FascicoloDocumentAnalysisError) {
        const retryable = [
          "AI_PROVIDER_UNAVAILABLE",
          "AI_PROVIDER_TIMEOUT",
          "AI_PROVIDER_RATE_LIMITED",
        ].includes(error.code);
        throw new AsyncJobExecutionError("ANALYSIS", error.code, retryable);
      }
      throw error;
    }
  },
  async persistReport(report) {
    try {
      const persisted = await persistAutomaticFascicoloReport(report);
      return { outcome: persisted.outcome, reportId: persisted.report.reportId };
    } catch (error) {
      if (error instanceof AutomaticFascicoloReportRepositoryError) {
        throw new AsyncJobExecutionError("PERSISTENCE", `AUTOMATIC_REPORT_${error.code}`, false);
      }
      throw error;
    }
  },
  persistKnowledge: (input) => persistStructuredKnowledgeRevision(input),
  reconcileKnowledgeMissions: (input) => reconcileKnowledgeResearchMissions(input),
  persistMission: ({ mission, actorId, tenantId }) => createResearchMissionRecord({
    mission,
    actor: { actorId, tenantId },
  }),
  scheduleMission: ensureAutomaticResearchExecution,
  async listPriorReportIds() {
    return [];
  },
};

export function createDefaultFascicoloAutomaticAnalysisDependencies(): FascicoloAutomaticAnalysisDependencies {
  return { ...defaultHandlerDependencies };
}

export function createFascicoloAutomaticAnalysisHandler(
  dependencies: FascicoloAutomaticAnalysisDependencies = defaultHandlerDependencies,
): AsyncJobHandler<AutomaticReference> {
  return {
    operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    parseInput: (input) => automaticReferenceSchema.parse(input),
    async execute(reference, context: AsyncJobHandlerContext) {
      const authority = await dependencies.loadAuthority({ jobId: context.jobId, reference });
      if (!authority) {
        throw new AsyncJobExecutionError("AUTHORIZATION", "FASCICOLO_ANALYSIS_AUTHORITY_MISMATCH", false);
      }
      if (await context.isCancellationRequested()) {
        throw new AsyncJobExecutionError("CANCELLATION", "CANCELLATION_REQUESTED", false);
      }
      const existingReport = await dependencies.findExistingReport({
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        corpusFingerprint: authority.corpusFingerprint,
      });
      if (existingReport) {
        return {
          referenceType: "FASCICOLO_AUTOMATIC_REPORT",
          referenceId: existingReport.reportId,
          referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
          metadata: {
            procedimentoId: authority.procedimentoId,
            documentVersionId: authority.extractionAttemptId,
            missionCount: existingReport.missionCount,
            supersededCount: existingReport.supersededCount,
            persistenceCode: "REUSED",
          },
        };
      }
      const excerpts = boundedExcerpts(authority);
      if (excerpts.length === 0) {
        throw new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_UNREADABLE", false);
      }
      await context.heartbeat();
      const output = await dependencies.analyze({
        attempt: context.attempt,
        contractVersion: FASCICOLO_DOCUMENT_ANALYSIS_CONTRACT_VERSION,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        neutralIntakeId: authority.neutralIntakeId,
        documentVersionId: authority.extractionAttemptId,
        artifactSha256: authority.artifactSha256,
        corpusFingerprint: authority.corpusFingerprint,
        documents: authority.documents.map((document) => ({
          documentVersionId: document.documentVersionId,
          artifactSha256: document.artifactSha256,
        })),
        documentsAreUntrustedData: true,
        externalToolsAllowed: false,
        excerpts,
      });
      const parsed = providerAnalysisPayloadV1Schema.safeParse(output);
      if (!parsed.success) {
        throw new AsyncJobExecutionError("ANALYSIS", "INVALID_PROVIDER_OUTPUT", false);
      }
      validateGrounding(parsed.data, excerpts);
      let structuredMissions: readonly ResearchMission[] | null = null;
      let structuredMissionsToSchedule: readonly ResearchMission[] | null = null;
      if (parsed.data.structuredKnowledge) {
        const evidenceByBasisRef = resolveKnowledgeEvidence(authority, excerpts);
        if (evidenceByBasisRef.size !== excerpts.length || !dependencies.persistKnowledge) {
          throw new AsyncJobExecutionError("DOCUMENT", "DOCUMENT_GROUNDING_INVALID", false);
        }
        try {
          const persisted = await dependencies.persistKnowledge({
            tenantId: authority.tenantId,
            procedimentoId: authority.procedimentoId,
            corpusFingerprint: authority.corpusFingerprint,
            knowledge: parsed.data.structuredKnowledge,
            evidenceByBasisRef,
          });
          const reconciliation = persisted as KnowledgeReconciliationResult;
          if (!reconciliation?.revision || reconciliation.revision.status !== "CURRENT"
            || !dependencies.reconcileKnowledgeMissions) {
            throw new Error("STRUCTURED_KNOWLEDGE_NOT_CURRENT");
          }
          {
            const plans = buildKnowledgeResearchMissionPlans(reconciliation.revision, {
              maxQuestionsPerWave: dependencies.researchExecutionWaveLimit ?? DEFAULT_RESEARCH_EXECUTION_WAVE_LIMIT,
            });
            const lifecycle = await dependencies.reconcileKnowledgeMissions({
              tenantId: authority.tenantId,
              procedimentoId: authority.procedimentoId,
              knowledgeRevisionId: reconciliation.revision.id,
              plans,
            });
            structuredMissions = plans
              .filter((plan) => plan.mission !== null)
              .map((plan) => plan.mission!);
            const schedulableQuestionKeys = new Set(lifecycle
              .filter((result) => result.operationalStatus === "PENDING")
              .map((result) => result.questionSemanticKey));
            structuredMissionsToSchedule = plans
              .filter((plan) => plan.execution === "ADMITTED" && plan.mission !== null
                && schedulableQuestionKeys.has(plan.questionSemanticKey))
              .map((plan) => plan.mission!);
          }
        } catch (error) {
          console.error({
            event: "fascicolo_structured_knowledge_persistence_failed",
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message.slice(0, 512) : "NON_ERROR_THROWN",
          });
          throw new AsyncJobExecutionError("PERSISTENCE", "STRUCTURED_KNOWLEDGE_PERSISTENCE_FAILED", false);
        }
      }
      const missions = structuredMissions ?? missionsFromAnalysis({ authority, analysis: parsed.data });
      const supersedesReportIds = await dependencies.listPriorReportIds({
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        exceptVersionId: authority.extractionAttemptId,
      });
      const reportId = stableIdentity("fascicolo-report", {
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        corpusFingerprint: authority.corpusFingerprint,
      });
      if (structuredMissions === null) {
        for (const mission of missions) {
          await dependencies.persistMission({
            mission,
            actorId: authority.actorId,
            tenantId: authority.tenantId,
          });
        }
      }
      const report = await dependencies.persistReport({
        reportId,
        tenantId: authority.tenantId,
        procedimentoId: authority.procedimentoId,
        neutralIntakeId: authority.neutralIntakeId,
        documentVersionId: authority.extractionAttemptId,
        artifactSha256: authority.artifactSha256,
        corpusFingerprint: authority.corpusFingerprint,
        documents: authority.documents.map((document) => ({
          documentVersionId: document.documentVersionId,
          artifactSha256: document.artifactSha256,
        })),
        actorId: authority.actorId,
        analysis: parsed.data,
        provenance: excerpts.map(({ text: _text, ...provenance }) => provenance),
        missions,
        supersedesReportIds,
      });
      const scheduling = [];
      for (const mission of structuredMissionsToSchedule ?? missions) {
        scheduling.push(await dependencies.scheduleMission({
          mission,
          actorId: authority.actorId,
          tenantId: authority.tenantId,
          correlationId: context.correlationId,
        }));
      }
      await context.heartbeat();
      return {
        referenceType: "FASCICOLO_AUTOMATIC_REPORT",
        referenceId: report.reportId,
        referenceVersion: FASCICOLO_AUTOMATIC_ANALYSIS_CONTRACT_VERSION,
        metadata: {
          procedimentoId: authority.procedimentoId,
          documentVersionId: authority.extractionAttemptId,
          missionCount: missions.length,
          supersededCount: supersedesReportIds.length,
          persistenceCode: report.outcome,
          researchJobCount: scheduling.filter((item) => item.outcome === "ADMITTED").length,
          researchRequirementCode: scheduling.find((item) => item.requirementCode)?.requirementCode ?? null,
        },
      };
    },
  };
}

export interface FascicoloAutomaticAnalysisSource {
  readonly sourceJobId: string;
  readonly neutralIntakeId: string;
  readonly extractionAttemptId?: string;
}

function logicalOperationId(input: {
  tenantId: string;
  procedimentoId: string;
  extractionAttemptId: string;
}): string {
  return createHash("sha256").update([
    FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    input.tenantId,
    input.procedimentoId,
    input.extractionAttemptId,
  ].join("\n"), "utf8").digest("hex");
}

export function buildFascicoloAutomaticAnalysisAdmission(input: {
  tenantId: string;
  procedimentoId: string;
  neutralIntakeId: string;
  extractionAttemptId: string;
  correlationId: string;
  policyDecisionRef: string | null;
  admissionType: "AUTHENTICATED_USER" | "AUTHORIZED_SYSTEM";
  initiatingUserId: string | null;
  actorId: string;
  actorEmail: string | null;
  actorRole: string;
}): AsyncJobAdmissionInput {
  const admission = input.admissionType === "AUTHENTICATED_USER"
    ? {
        admissionType: "AUTHENTICATED_USER" as const,
        tenantId: input.tenantId,
        initiatingUserId: input.initiatingUserId!,
        actor: {
          actorId: input.initiatingUserId!,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      }
    : {
        admissionType: "AUTHORIZED_SYSTEM" as const,
        tenantId: input.tenantId,
        initiatingUserId: null,
        actor: {
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          actorRole: input.actorRole,
        },
      };
  return {
    operation: FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
    logicalOperationId: logicalOperationId(input),
    purpose: FASCICOLO_AUTOMATIC_ANALYSIS_PURPOSE,
    correlationId: input.correlationId,
    procedimentoId: input.procedimentoId,
    priority: "NORMAL",
    policyDecisionRef: input.policyDecisionRef,
    inputReference: {
      referenceType: "FASCICOLO_DOCUMENT_VERSION",
      referenceId: input.extractionAttemptId,
      referenceVersion: "V1",
      metadata: {
        procedimentoId: input.procedimentoId,
        neutralIntakeId: input.neutralIntakeId,
        extractionAttemptId: input.extractionAttemptId,
      },
    },
    maxAttempts: 3,
    availableAt: new Date(0),
    admission,
  };
}

export async function ensureFascicoloAutomaticAnalysisJob(input: FascicoloAutomaticAnalysisSource) {
  const [sourceJob, intake] = await Promise.all([
    prisma.asyncJob.findUnique({
      where: { id: input.sourceJobId },
      select: {
        tenantId: true,
        correlationId: true,
        policyDecisionRef: true,
        admissionType: true,
        initiatingUserId: true,
        actorId: true,
        actorEmail: true,
        actorRole: true,
      },
    }),
    prisma.neutralIntake.findUnique({
      where: { id: input.neutralIntakeId },
      select: {
        id: true,
        enteId: true,
        destination: { select: { procedimentoId: true } },
        extractionAttempts: {
          where: input.extractionAttemptId ? { id: input.extractionAttemptId } : undefined,
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true },
        },
      },
    }),
  ]);
  const destination = intake?.destination;
  const attempt = intake?.extractionAttempts[0];
  if (
    !sourceJob
    || !intake
    || sourceJob.tenantId === null
    || sourceJob.tenantId !== intake.enteId
    || !destination
    || !attempt
    || (sourceJob.admissionType === "AUTHENTICATED_USER" && !sourceJob.initiatingUserId)
    || (sourceJob.admissionType === "AUTHORIZED_SYSTEM" && !sourceJob.policyDecisionRef)
  ) {
    throw new Error("FASCICOLO_AUTOMATIC_ANALYSIS_AUTHORITY_MISMATCH");
  }
  return admitAsyncJob(buildFascicoloAutomaticAnalysisAdmission({
    tenantId: sourceJob.tenantId,
    procedimentoId: destination.procedimentoId,
    neutralIntakeId: intake.id,
    extractionAttemptId: attempt.id,
    correlationId: sourceJob.correlationId,
    policyDecisionRef: sourceJob.policyDecisionRef,
    admissionType: sourceJob.admissionType,
    initiatingUserId: sourceJob.initiatingUserId,
    actorId: sourceJob.actorId,
    actorEmail: sourceJob.actorEmail,
    actorRole: sourceJob.actorRole,
  }));
}
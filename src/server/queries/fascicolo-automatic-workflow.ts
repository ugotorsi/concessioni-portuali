import type { AsyncJobStatus, ResearchMissionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION } from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { providerAnalysisPayloadV1Schema } from "@/server/ai/fascicoloAnalysis";
import { buildStructuredFascicoloReport, type BuiltStructuredFascicoloReport } from "@/server/fascicolo-report";
import { listOperationalProposals, type OperationalProposalRecord } from "@/server/fascicolo-operational-proposals";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";
import { evaluateAutomaticResearchPolicy } from "@/server/legal-research/automatic-research-policy";
import type { AuthorityCandidate, ResearchMission } from "@/server/legal-research/bridge";
import {
  deriveResearchQuestionCoverage,
  deriveResearchResultSourceState,
  type ResearchCoverageGap,
  type ResearchQuestionCoverageStatus,
  type ResearchQuestionExecutionState,
  type ResearchResultClassificationSource,
  type ResearchResultReviewStatus,
  type ResearchResultSourceState,
  type ResearchResultSupportDirection,
} from "@/server/legal-research/question-results";
import { deriveSourceCoverage } from "@/server/legal-research/source-chain";
import {
  loadCurrentStructuredKnowledge,
  type StructuredKnowledgeReadModel,
} from "@/server/queries/fascicolo-knowledge";

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeHttpUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function records(value: unknown): readonly JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => item !== null) : [];
}

export interface FascicoloAutomaticWorkflowReadModel {
  knowledge: StructuredKnowledgeReadModel | null;
  structuredReport: BuiltStructuredFascicoloReport | null;
  structuredReportSnapshots: readonly {
    snapshotId: string;
    reportFingerprint: string;
    effectiveStatus: "CURRENT" | "STALE" | "SUPERSEDED";
    staleReasons: readonly string[];
    generatedAt: Date;
  }[];
  operationalProposals: readonly (OperationalProposalRecord & { reviewEvents: readonly Record<string, unknown>[] })[];
  automaticResearch: {
    authorized: boolean;
    requirementCode: string | null;
  };
  reports: readonly {
    reportId: string;
    documentVersionId: string;
    status: string;
    verificationStatus: string;
    createdAt: Date;
    summary: { text: string; basisRefs: readonly string[] };
    documentedFacts: readonly { text: string; basisRefs: readonly string[]; recordedAt: string | null }[];
    signals: readonly { type: "INFO" | "VERIFY"; text: string; basisRefs: readonly string[] }[];
    gaps: readonly { text: string; basisRefs: readonly string[] }[];
    questions: readonly { text: string; basisRefs: readonly string[] }[];
    preliminaryDiscoveryStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE";
    professionalConclusionStatus: "NOT_FORMULATED";
    openVerificationRequirements: readonly string[];
  }[];
  jobs: readonly {
    jobId: string;
    documentVersionId: string;
    status: AsyncJobStatus;
    createdAt: Date;
    completedAt: Date | null;
    failureCode: string | null;
    superseded: boolean;
  }[];
  missions: readonly {
    missionId: string;
    question: string;
    referenceDate: Date;
    referenceDateBasis: JsonRecord | null;
    missionFingerprint: string | null;
    legalIssueSemanticKey: string | null;
    researchQuestionSemanticKey: string | null;
    knowledgeRevisionId: string | null;
    lifecycleOutcome: "NEW" | "REUSED" | "LEGACY";
    lifecycleStatus: "CURRENT";
    status: ResearchMissionStatus;
    researchState: ResearchQuestionExecutionState;
    coverageStatus: ResearchQuestionCoverageStatus;
    coverageGaps: readonly ResearchCoverageGap[];
    coveredElementKeys: readonly string[];
    conflicting: boolean;
    resultCount: number;
    historicalResultCount: number;
    discoveryCoverageStatus: "NO_RESULTS" | "DISCOVERED";
    usableCoverageStatus: "NO_USABLE_SOURCE" | "USABLE" | "CONFLICTING";
    usableSupportsCount: number;
    usableOpposesCount: number;
    conflictingUsableAuthorities: boolean;
    sourceGaps: readonly string[];
    adverseMission: {
      missionId: string;
      status: ResearchMissionStatus;
      lifecycleStatus: "CURRENT";
    } | null;
    results: readonly {
      resultId: string;
      candidateId: string;
      missionId: string;
      bundleId: string;
      title: string;
      sourceUrl: string | null;
      provider: string | null;
      supportDirection: ResearchResultSupportDirection;
      classificationSource: ResearchResultClassificationSource;
      classificationConfidence: number | null;
      classificationRationale: string | null;
      classificationReviewStatus: ResearchResultReviewStatus;
      sourceVerificationState: ResearchResultSourceState;
      retrievalState: string;
      acquisitionState: string;
      identityVerification: string;
      contentVerification: string;
      temporalStatus: string;
      adverseStatus: string;
      officiality: string;
      usable: boolean;
      blockingReasons: readonly string[];
      citationAnchors: readonly JsonRecord[];
      manualReviewRequired: boolean;
      manualReviewReason: string | null;
      legacySource: boolean;
      sourceAssessment: {
        assessmentId: string;
        chainFingerprint: string;
        isCurrent: boolean;
        usable: boolean;
        citationAnchors: readonly JsonRecord[];
        blockingReasons: readonly string[];
        manualReviewRequired: boolean;
        manualReviewReason: string | null;
      } | null;
    }[];
    sources: readonly {
      title: string;
      sourceUrl: string | null;
      documentDate: string | null;
      supportDirection: string;
      verificationState: string;
    }[];
    gaps: readonly string[];
    conflicts: readonly string[];
    completionState: string | null;
    execution: {
      status: AsyncJobStatus | null;
      failureCode: string | null;
      attemptCount: number;
      callCount: number | null;
    };
    automationRequirementCode: string | null;
  }[];
  historicalMissionCount: number;
}

export async function getFascicoloAutomaticWorkflowReadModel(
  procedimentoId: string,
): Promise<FascicoloAutomaticWorkflowReadModel | null> {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) return null;
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { enteId: true },
  });
  const tenantId = procedimento?.enteId ?? null;
  if (!tenantId) return null;
  try {
    requireTenantAccess(tenantContext, tenantId, { mode: "read", allowWhenEnteMissing: false });
  } catch {
    return null;
  }

  const [reports, structuredReportSnapshots, candidateJobs, missions, historicalMissionCount, historicalResults, knowledge, operationalProposals] = await Promise.all([
    prisma.automaticFascicoloReport.findMany({
      where: { tenantId, procedimentoId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        documentVersionId: true,
        status: true,
        verificationStatus: true,
        analysisPayload: true,
        createdAt: true,
        missionLinks: { select: { mission: { select: { status: true } } } },
      },
    }),
    prisma.structuredFascicoloReportSnapshot.findMany({
      where: { tenantId, procedimentoId },
      orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        reportFingerprint: true,
        knowledgeRevisionId: true,
        researchStateFingerprint: true,
        sourceStateFingerprint: true,
        status: true,
        staleReasons: true,
        generatedAt: true,
      },
    }),
    prisma.asyncJob.findMany({
      where: {
        tenantId,
        operation: { in: [FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION, RESEARCH_MISSION_EXECUTION_OPERATION] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        operation: true,
        inputReference: true,
        status: true,
        createdAt: true,
        completedAt: true,
        failureCode: true,
        attemptCount: true,
        resultReference: true,
      },
    }),
    prisma.researchMissionRecord.findMany({
      where: { tenantId, caseId: procedimentoId, lifecycleStatus: "CURRENT" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        payload: true,
        referenceDate: true,
        referenceDateBasis: true,
        missionFingerprint: true,
        legalIssueSemanticKey: true,
        researchQuestionSemanticKey: true,
        knowledgeRevisionId: true,
        firstKnowledgeRevisionId: true,
        mode: true,
        status: true,
        primaryAdverseRequirements: {
          where: { status: { not: "HISTORICAL" } },
          take: 1,
          select: {
            adverseMission: { select: { id: true, status: true, lifecycleStatus: true } },
          },
        },
        questionResults: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            bundleId: true,
            candidateId: true,
            candidateSnapshot: true,
            supportDirection: true,
            classificationSource: true,
            classificationConfidence: true,
            classificationRationale: true,
            classificationReviewStatus: true,
            coverageElementKeys: true,
            unresolvedAspectKeys: true,
            sourceAssessments: {
              where: { isCurrent: true },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                chainFingerprint: true,
                isCurrent: true,
                retrievalState: true,
                textState: true,
                identityState: true,
                contentState: true,
                temporalState: true,
                adverseState: true,
                officiality: true,
                citationAnchors: true,
                blockingReasons: true,
                manualReviewRequired: true,
                manualReviewReason: true,
                usable: true,
              },
            },
          },
        },
        executionAttempts: {
          where: { evidenceBundles: { some: {} } },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            evidenceBundles: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { payload: true, completionState: true },
            },
          },
        },
      },
    }),
    prisma.researchMissionRecord.count({
      where: { tenantId, caseId: procedimentoId, lifecycleStatus: "HISTORICAL" },
    }),
    prisma.researchQuestionResultRecord.findMany({
      where: { tenantId, caseId: procedimentoId, mission: { lifecycleStatus: "HISTORICAL" } },
      select: { researchQuestionSemanticKey: true },
    }),
    loadCurrentStructuredKnowledge(tenantId, procedimentoId),
    listOperationalProposals({ tenantId, procedimentoId }),
  ]);

  const analysisJobs = candidateJobs.filter((job) => job.operation === FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION);
  const researchJobs = candidateJobs.filter((job) => job.operation === RESEARCH_MISSION_EXECUTION_OPERATION);
  const matchingJobs = analysisJobs.flatMap((job) => {
    const metadata = record(record(job.inputReference)?.metadata);
    return text(metadata?.procedimentoId) === procedimentoId
      ? [{ ...job, documentVersionId: text(metadata?.extractionAttemptId) ?? "UNKNOWN" }]
      : [];
  });
  const currentVersionId = matchingJobs[0]?.documentVersionId ?? null;
  const researchPolicy = evaluateAutomaticResearchPolicy({ tenantId });

  const readModel: Omit<FascicoloAutomaticWorkflowReadModel, "structuredReport" | "structuredReportSnapshots"> = {
    knowledge,
    operationalProposals: operationalProposals as FascicoloAutomaticWorkflowReadModel["operationalProposals"],
    historicalMissionCount,
    automaticResearch: {
      authorized: researchPolicy.authorized,
      requirementCode: researchPolicy.requirementCode,
    },
    reports: reports.flatMap((report) => {
      const parsed = providerAnalysisPayloadV1Schema.safeParse(report.analysisPayload);
      if (!parsed.success) return [];
      const missionStatuses = report.missionLinks.map((link) => link.mission.status);
      const preliminaryDiscoveryStatus = missionStatuses.length === 0
        ? "NOT_STARTED" as const
        : missionStatuses.every((status) => status === "COMPLETED")
          ? "COMPLETED" as const
          : missionStatuses.some((status) => status === "IN_PROGRESS")
            ? "IN_PROGRESS" as const
            : missionStatuses.some((status) => ["DEFERRED", "REJECTED", "BUDGET_EXHAUSTED"].includes(status))
              ? "INCOMPLETE" as const
              : "NOT_STARTED" as const;
      return [{
        reportId: report.id,
        documentVersionId: report.documentVersionId,
        status: report.status,
        verificationStatus: report.verificationStatus,
        createdAt: report.createdAt,
        summary: parsed.data.summary,
        documentedFacts: [
          ...parsed.data.timeline.map((item) => ({
            text: item.text,
            basisRefs: item.basisRefs,
            recordedAt: item.recordedAt,
          })),
          ...parsed.data.recordedState.map((item) => ({
            text: item.text,
            basisRefs: item.basisRefs,
            recordedAt: null,
          })),
        ],
        signals: parsed.data.signals,
        gaps: parsed.data.investigativeQuestions,
        questions: parsed.data.legalResearchQuestions,
        preliminaryDiscoveryStatus,
        professionalConclusionStatus: "NOT_FORMULATED" as const,
        openVerificationRequirements: [
          "Acquisizione e verifica del testo integrale delle fonti",
          "Verifica delle citazioni e dei passaggi pertinenti",
          "Ricerca di decisioni e orientamenti contrari",
          "Valutazione e conclusione professionale",
        ],
      }];
    }),
    jobs: matchingJobs.map((job) => ({
      jobId: job.id,
      documentVersionId: job.documentVersionId,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      failureCode: job.failureCode,
      superseded: currentVersionId !== null && job.documentVersionId !== currentVersionId,
    })),
    missions: missions.filter((mission) => mission.mode !== "ADVERSE_SEARCH").map((mission) => {
      const payload = record(mission.payload);
      const researchJob = researchJobs.find((job) => record(job.inputReference)?.referenceId === mission.id) ?? null;
      const resultMetadata = record(record(researchJob?.resultReference)?.metadata);
      const missionPolicy = evaluateAutomaticResearchPolicy({
        tenantId,
        mission: mission.payload as unknown as ResearchMission,
      });
      const bundleRecord = mission.executionAttempts[0]?.evidenceBundles[0] ?? null;
      const bundle = record(bundleRecord?.payload);
      const structuredResults = mission.questionResults.map((result) => ({
        ...result,
        candidateSnapshot: result.candidateSnapshot as unknown as AuthorityCandidate,
      }));
      const coverage = deriveResearchQuestionCoverage({
        missionStatus: mission.status,
        results: structuredResults,
        evidenceGapKeys: records(bundle?.evidenceGaps).map((gap) => text(gap.kind) ?? "GAP_NON_SPECIFICATO"),
      });
      const sourceCoverage = deriveSourceCoverage(structuredResults.map((result) => {
        const assessment = result.sourceAssessments?.[0];
        return {
          direction: result.supportDirection,
          usable: assessment?.usable ?? false,
          blockingReasons: (assessment?.blockingReasons ?? ["LEGACY_UNVERIFIED"]) as never,
        };
      }));
      const adverse = mission.primaryAdverseRequirements?.[0]?.adverseMission;
      return {
        missionId: mission.id,
        question: text(payload?.researchQuestion) ?? "Quesito non disponibile",
        referenceDate: mission.referenceDate,
        referenceDateBasis: record(mission.referenceDateBasis),
        missionFingerprint: mission.missionFingerprint,
        legalIssueSemanticKey: mission.legalIssueSemanticKey,
        researchQuestionSemanticKey: mission.researchQuestionSemanticKey,
        knowledgeRevisionId: mission.knowledgeRevisionId,
        lifecycleOutcome: mission.firstKnowledgeRevisionId === null || mission.knowledgeRevisionId === null
          ? "LEGACY" as const
          : mission.firstKnowledgeRevisionId === mission.knowledgeRevisionId ? "NEW" as const : "REUSED" as const,
        lifecycleStatus: "CURRENT" as const,
        status: mission.status,
        researchState: coverage.executionState,
        coverageStatus: coverage.status,
        coverageGaps: coverage.gaps,
        coveredElementKeys: coverage.coveredElementKeys,
        conflicting: coverage.conflicting,
        resultCount: structuredResults.length,
        historicalResultCount: historicalResults.filter((result) => (
          result.researchQuestionSemanticKey === mission.researchQuestionSemanticKey
        )).length,
        discoveryCoverageStatus: sourceCoverage.discoveryCoverage,
        usableCoverageStatus: sourceCoverage.usableCoverage,
        usableSupportsCount: sourceCoverage.usableSupportsCount,
        usableOpposesCount: sourceCoverage.usableOpposesCount,
        conflictingUsableAuthorities: sourceCoverage.conflictingUsableAuthorities,
        sourceGaps: sourceCoverage.gaps,
        adverseMission: adverse?.lifecycleStatus === "CURRENT" ? {
          missionId: adverse.id,
          status: adverse.status,
          lifecycleStatus: "CURRENT" as const,
        } : null,
        results: structuredResults.map((result) => ({
          ...(() => {
            const assessment = result.sourceAssessments?.[0];
            return {
              retrievalState: assessment?.retrievalState ?? "LEGACY_UNVERIFIED",
              acquisitionState: assessment?.textState ?? "LEGACY_UNVERIFIED",
              identityVerification: assessment?.identityState ?? "LEGACY_UNVERIFIED",
              contentVerification: assessment?.contentState ?? "LEGACY_UNVERIFIED",
              temporalStatus: assessment?.temporalState ?? "NOT_ASSESSED",
              adverseStatus: assessment?.adverseState ?? "NOT_REQUIRED",
              officiality: assessment?.officiality ?? "UNKNOWN",
              usable: assessment?.usable ?? false,
              blockingReasons: assessment?.blockingReasons ?? ["LEGACY_UNVERIFIED"],
              citationAnchors: records(assessment?.citationAnchors),
              manualReviewRequired: assessment?.manualReviewRequired ?? true,
              manualReviewReason: assessment ? assessment.manualReviewReason : "LEGACY_SOURCE_VERIFICATION_REQUIRED",
              legacySource: assessment === undefined,
              sourceAssessment: assessment ? {
                assessmentId: assessment.id,
                chainFingerprint: assessment.chainFingerprint,
                isCurrent: assessment.isCurrent,
                usable: assessment.usable,
                citationAnchors: records(assessment.citationAnchors),
                blockingReasons: assessment.blockingReasons,
                manualReviewRequired: assessment.manualReviewRequired,
                manualReviewReason: assessment.manualReviewReason,
              } : null,
            };
          })(),
          resultId: result.id,
          candidateId: result.candidateId,
          missionId: mission.id,
          bundleId: result.bundleId,
          title: result.candidateSnapshot.title ?? result.candidateSnapshot.officialIdentifier ?? "Risultato di ricerca",
          sourceUrl: safeHttpUrl(result.candidateSnapshot.sourceUrl),
          provider: result.candidateSnapshot.providerId ?? result.candidateSnapshot.toolId ?? null,
          supportDirection: result.supportDirection,
          classificationSource: result.classificationSource,
          classificationConfidence: result.classificationConfidence,
          classificationRationale: result.classificationRationale,
          classificationReviewStatus: result.classificationReviewStatus,
          sourceVerificationState: deriveResearchResultSourceState(result.candidateSnapshot),
        })),
        sources: records(bundle?.authorityCandidates).map((source) => ({
          title: text(source.title) ?? text(source.officialIdentifier) ?? "Fonte candidata",
          sourceUrl: safeHttpUrl(source.sourceUrl),
          documentDate: text(source.documentDate),
          supportDirection: text(source.supportDirection) ?? "UNKNOWN",
          verificationState: text(source.verificationState) ?? "OFFICIAL_VERIFICATION_REQUIRED",
        })),
        gaps: records(bundle?.evidenceGaps).map((gap) => text(gap.kind) ?? "GAP_NON_SPECIFICATO"),
        conflicts: records(bundle?.conflicts).map((conflict) => (
          text(conflict.description) ?? text(conflict.kind) ?? "CONFLITTO_DA_VERIFICARE"
        )),
        completionState: bundleRecord?.completionState ?? null,
        execution: {
          status: researchJob?.status ?? null,
          failureCode: researchJob?.failureCode ?? null,
          attemptCount: researchJob?.attemptCount ?? 0,
          callCount: typeof resultMetadata?.callCount === "number" ? resultMetadata.callCount : null,
        },
        automationRequirementCode: researchJob?.failureCode ?? missionPolicy.requirementCode,
      };
    }),
  };
  const structuredReport = knowledge ? buildStructuredFascicoloReport({
    tenantId,
    procedimentoId,
    knowledge,
    missions: [
      ...readModel.missions,
      ...missions.filter((mission) => mission.mode === "ADVERSE_SEARCH").map((mission) => {
        const payload = record(mission.payload);
        return {
          missionId: mission.id,
          mode: mission.mode,
          question: text(payload?.researchQuestion) ?? "Quesito non disponibile",
          missionFingerprint: mission.missionFingerprint,
          knowledgeRevisionId: mission.knowledgeRevisionId,
          researchQuestionSemanticKey: mission.researchQuestionSemanticKey,
          lifecycleStatus: "CURRENT" as const,
          status: mission.status,
          coverageStatus: mission.status === "COMPLETED" ? "COMPLETE" : "PARTIAL",
          sourceGaps: mission.questionResults.flatMap((result) => result.sourceAssessments[0]?.blockingReasons ?? ["MISSING_CURRENT_SOURCE_ASSESSMENT"]),
          results: mission.questionResults.map((result) => {
            const candidate = result.candidateSnapshot as unknown as AuthorityCandidate;
            const assessment = result.sourceAssessments[0];
            return {
              resultId: result.id,
              title: candidate.title ?? candidate.officialIdentifier ?? "Risultato di ricerca contraria",
              sourceUrl: safeHttpUrl(candidate.sourceUrl),
              provider: candidate.providerId ?? candidate.toolId ?? null,
              supportDirection: result.supportDirection,
              classificationReviewStatus: result.classificationReviewStatus,
              classificationRationale: result.classificationRationale,
              sourceAssessment: assessment ? {
                assessmentId: assessment.id,
                chainFingerprint: assessment.chainFingerprint,
                isCurrent: assessment.isCurrent,
                usable: assessment.usable,
                citationAnchors: records(assessment.citationAnchors),
                blockingReasons: assessment.blockingReasons,
                manualReviewRequired: assessment.manualReviewRequired,
                manualReviewReason: assessment.manualReviewReason,
              } : null,
            };
          }),
        };
      }),
    ],
  }) : null;
  return {
    ...readModel,
    structuredReport,
    structuredReportSnapshots: structuredReportSnapshots.map((snapshot) => {
      const staleReasons = structuredReport && snapshot.status === "CURRENT" ? [
        ...(snapshot.knowledgeRevisionId === structuredReport.payload.knowledgeRevisionId ? [] : ["KNOWLEDGE_REVISION_CHANGED"]),
        ...(snapshot.researchStateFingerprint === structuredReport.payload.researchStateFingerprint ? [] : ["RESEARCH_STATE_CHANGED"]),
        ...(snapshot.sourceStateFingerprint === structuredReport.payload.sourceStateFingerprint ? [] : ["SOURCE_STATE_CHANGED"]),
      ] : snapshot.staleReasons;
      return {
        snapshotId: snapshot.id,
        reportFingerprint: snapshot.reportFingerprint,
        effectiveStatus: snapshot.status === "CURRENT" && staleReasons.length > 0 ? "STALE" as const : snapshot.status,
        staleReasons,
        generatedAt: snapshot.generatedAt,
      };
    }),
  };
}
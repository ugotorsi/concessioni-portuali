import { createHash } from "node:crypto";

import type { AsyncJobStatus, ResearchMissionStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { stableStringify } from "@/server/audit/hash";
import { FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION } from "@/server/ai/fascicoloAutomaticAnalysisJob";
import { createRealDataActivationPolicy } from "@/server/ai/realDataActivation";
import { providerAnalysisPayloadV1Schema } from "@/server/ai/fascicoloAnalysis";
import { DOCUMENT_EXTRACTION_OPERATION } from "@/server/documents/documentExtractionAdmission";
import {
  buildStructuredFascicoloReport,
  STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
  type BuiltStructuredFascicoloReport,
  type StructuredReportResearchResultInput,
  type StructuredReportTechnicalSourceInput,
} from "@/server/fascicolo-report";
import { listOperationalProposals, type OperationalProposalRecord } from "@/server/fascicolo-operational-proposals";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";
import { evaluateAutomaticResearchPolicy } from "@/server/legal-research/automatic-research-policy";
import type { AuthorityCandidate, ResearchMission } from "@/server/legal-research/bridge";
import {
  legalAnalysisContributionSchema,
  type LegalAnalysisContribution,
} from "@/server/legal-research/legal-synthesis";
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
import type { SourceChainSnapshot } from "@/server/legal-research/source-chain";
import {
  assistedVerificationSnapshotSchema,
  type LegalApplicabilityReview,
} from "@/server/legal-research/assisted-verification";
import type { TemporalAssessmentResult } from "@/server/legal-sources/temporal";
import {
  OrchestrationInputError,
  resolveApplicableLegalRules,
} from "@/server/legal-rules/orchestrator";
import { verifyRuleResolutionFingerprint } from "@/server/legal-research/legal-applicability-producer";
import {
  loadCurrentStructuredKnowledge,
  loadStructuredKnowledgeRevision,
  type StructuredKnowledgeReadModel,
} from "@/server/queries/fascicolo-knowledge";
import { getFascicoloDocumentCorpusForTenant } from "@/server/queries/fascicolo-document-corpus";

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

function texts(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : [];
}

const MISSION_READ_LIMIT = 50;

const researchMissionReadSelect = {
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
  createdAt: true,
  updatedAt: true,
  primaryAdverseRequirements: {
    where: { status: { not: "HISTORICAL" as const } },
    take: 1,
    select: {
      adverseMission: { select: { id: true, status: true, lifecycleStatus: true } },
    },
  },
  questionResults: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
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
      researchQuestionSemanticKey: true,
      sourceAssessments: {
        where: { isCurrent: true },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: {
          id: true,
          tenantId: true,
          caseId: true,
          missionId: true,
          researchQuestionSemanticKey: true,
          missionFingerprint: true,
          referenceDate: true,
          referenceDateBasis: true,
          verificationVersion: true,
          sourceFamilyId: true,
          sourceVersionId: true,
          acquisitionId: true,
          temporalAssessmentId: true,
          chainFingerprint: true,
          sourceIdentityKey: true,
          contentSha256: true,
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
          temporalAssessment: {
            select: {
              assessmentVersion: true,
              referenceDate: true,
              validityState: true,
              temporalWindowState: true,
              applicabilityState: true,
              reasonCodes: true,
              effectiveFromSnapshot: true,
              effectiveToSnapshot: true,
              humanReviewRequired: true,
              confidence: true,
            },
          },
        },
      },
    },
  },
  assistedVerifications: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    select: { payload: true, recordedByActorId: true },
  },
  executionAttempts: {
    where: { evidenceBundles: { some: {} } },
    orderBy: [{ completedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      evidenceBundles: {
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        take: 1,
        select: { payload: true, completionState: true },
      },
    },
  },
} satisfies Prisma.ResearchMissionRecordSelect;

type ResearchMissionReadRow = Prisma.ResearchMissionRecordGetPayload<{
  select: typeof researchMissionReadSelect;
}>;
type ResearchSourceAssessmentReadRow = ResearchMissionReadRow["questionResults"][number]["sourceAssessments"][number];

function projectSourceAssessment(
  assessment: ResearchSourceAssessmentReadRow | undefined,
): StructuredReportResearchResultInput["sourceAssessment"] {
  if (!assessment) return null;
  const base = {
    assessmentId: assessment.id,
    chainFingerprint: assessment.chainFingerprint,
    isCurrent: assessment.isCurrent,
    usable: assessment.usable,
    citationAnchors: records(assessment.citationAnchors),
    blockingReasons: assessment.blockingReasons,
    manualReviewRequired: assessment.manualReviewRequired,
    manualReviewReason: assessment.manualReviewReason,
    sourceFamilyId: assessment.sourceFamilyId,
    sourceVersionId: assessment.sourceVersionId,
    acquisitionId: assessment.acquisitionId,
    temporalAssessmentId: assessment.temporalAssessmentId,
  };
  if (!(assessment.referenceDate instanceof Date)
    || !assessment.tenantId
    || !assessment.caseId
    || !assessment.missionId
    || !assessment.researchQuestionSemanticKey
    || !assessment.missionFingerprint
    || !assessment.verificationVersion) return base;
  const temporal = assessment.temporalAssessment;
  const sourceChain: SourceChainSnapshot = {
    resultId: assessment.id,
    tenantId: assessment.tenantId,
    caseId: assessment.caseId,
    missionId: assessment.missionId,
    researchQuestionSemanticKey: assessment.researchQuestionSemanticKey,
    missionFingerprint: assessment.missionFingerprint,
    referenceDate: assessment.referenceDate.toISOString(),
    referenceDateBasis: record(assessment.referenceDateBasis) ?? {},
    verificationVersion: assessment.verificationVersion,
    sourceIdentityKey: assessment.sourceIdentityKey,
    contentSha256: assessment.contentSha256,
    retrievalState: assessment.retrievalState,
    textState: assessment.textState,
    identityState: assessment.identityState,
    contentState: assessment.contentState,
    temporalState: assessment.temporalState,
    adverseState: assessment.adverseState,
    officiality: assessment.officiality,
    citationAnchors: records(assessment.citationAnchors),
    manualReviewRequired: assessment.manualReviewRequired,
    manualReviewReason: assessment.manualReviewReason,
    currentMission: assessment.isCurrent,
  };
  const temporalAssessment = temporal ? {
    assessmentVersion: temporal.assessmentVersion,
    validityState: temporal.validityState,
    temporalWindowState: temporal.temporalWindowState,
    applicabilityState: temporal.applicabilityState,
    reasonCodes: texts(temporal.reasonCodes),
    referenceDate: temporal.referenceDate.toISOString(),
    effectiveInterval: {
      from: temporal.effectiveFromSnapshot?.toISOString() ?? null,
      to: temporal.effectiveToSnapshot?.toISOString() ?? null,
    },
    humanReviewRequired: temporal.humanReviewRequired,
    confidence: temporal.confidence,
  } as TemporalAssessmentResult : undefined;
  return {
    ...base,
    sourceChain,
    temporalAssessment,
  };
}

export function projectApplicabilityReviewHistory(
  storedHistory: readonly Readonly<{ payload: unknown; recordedByActorId: string }>[],
): Readonly<{
  reviews: readonly Readonly<{
    review: LegalApplicabilityReview;
    recordedByActorId: string | null;
  }>[];
  issues: readonly string[];
}> {
  const parsedHistory = storedHistory.map((stored) => {
    const payload = record(stored.payload);
    const parsed = assistedVerificationSnapshotSchema.safeParse(payload?.snapshot ?? stored.payload);
    return parsed.success ? { stored, snapshot: parsed.data } : null;
  });
  const current = parsedHistory[0];
  if (!current) return storedHistory.length === 0 ? { reviews: [], issues: [] } : {
    reviews: [],
    issues: ["PERSISTED_APPLICABILITY_REVIEW_INVALID"],
  };
  return {
    reviews: (current.snapshot.legalApplicabilityReviews ?? []).map((review) => {
      const serializedReview = JSON.stringify(review);
      const origin = [...parsedHistory].reverse().find((entry) => entry?.snapshot.legalApplicabilityReviews?.some(
        (historicalReview) => JSON.stringify(historicalReview) === serializedReview,
      ));
      return {
        review,
        recordedByActorId: origin?.stored.recordedByActorId === review.reviewerAttestation.reviewedByActorId
          ? origin.stored.recordedByActorId
          : null,
      };
    }),
    issues: [],
  };
}

function projectApplicabilityReviews(mission: ResearchMissionReadRow) {
  return projectApplicabilityReviewHistory(mission.assistedVerifications ?? []);
}
export interface FascicoloResearchResultReadModel {
  resultId: string;
  candidateId: string;
  missionId: string;
  bundleId: string;
  title: string;
  authority: string | null;
  sourceFamily: string | null;
  officialIdentifier: string | null;
  documentDate: string | null;
  sourceUrl: string | null;
  provider: string | null;
  relevantPassage: string | null;
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
  sourceAssessment: StructuredReportResearchResultInput["sourceAssessment"];
}

export interface FascicoloResearchMissionReadModel {
  missionId: string;
  question: string;
  referenceDate: Date;
  createdAt: Date;
  updatedAt: Date;
  referenceDateBasis: JsonRecord | null;
  missionFingerprint: string | null;
  legalIssueSemanticKey: string | null;
  researchQuestionSemanticKey: string | null;
  knowledgeRevisionId: string | null;
  lifecycleOutcome: "NEW" | "REUSED" | "LEGACY";
  lifecycleStatus: "CURRENT" | "HISTORICAL";
  status: ResearchMissionStatus;
  researchState: ResearchQuestionExecutionState;
  coverageStatus: ResearchQuestionCoverageStatus;
  coverageGaps: readonly ResearchCoverageGap[];
  coveredElementKeys: readonly string[];
  conflicting: boolean;
  resultCount: number;
  displayedHistoricalResultCount: number;
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
  results: readonly FascicoloResearchResultReadModel[];
  sources: readonly {
    title: string;
    sourceUrl: string | null;
    documentDate: string | null;
    supportDirection: string;
    verificationState: string;
  }[];
  gaps: readonly string[];
  conflicts: readonly string[];
  suggestions: readonly {
    suggestionId: string;
    kind: string;
    description: string;
    targetId: string | null;
  }[];
  completionState: string | null;
  execution: {
    status: AsyncJobStatus | null;
    failureCode: string | null;
    attemptCount: number;
    callCount: number | null;
  };
  automationRequirementCode: string | null;
  legalAnalysisContributions: readonly LegalAnalysisContribution[];
  legalApplicabilityReviews: readonly Readonly<{
    review: LegalApplicabilityReview;
    recordedByActorId: string | null;
  }>[];
  legalApplicabilityReviewIssues: readonly string[];
}

export interface FascicoloAutomaticWorkflowReadModel {
  analysisUpdate: {
    status: "CURRENT" | "UPDATING" | "STALE" | "WAITING_AUTHORIZATION" | "ERROR";
    corpusFingerprint: string;
    currentRevisionFingerprint: string | null;
  };
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
  missions: readonly (FascicoloResearchMissionReadModel & { lifecycleStatus: "CURRENT" })[];
  historicalMissions: readonly (FascicoloResearchMissionReadModel & { lifecycleStatus: "HISTORICAL" })[];
  missionReadTruncation: {
    limitPerLifecycle: number;
    current: boolean;
    historical: boolean;
    adverse: boolean;
  };
  historicalMissionCount: number;
}

const TECHNICAL_SOURCE_REPORT_LIMIT = 200;

/**
 * MCP acquisitions for the report. A missing table (database not yet migrated) degrades to
 * "no technical sources" instead of breaking the whole fascicolo page; other errors propagate.
 */
async function loadTechnicalSourceReportRows(
  tenantId: string,
  procedimentoId: string,
): Promise<readonly StructuredReportTechnicalSourceInput[]> {
  try {
    const rows = await prisma.technicalSourceResearchRecord.findMany({
      where: { tenantId, procedimentoId },
      orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
      take: TECHNICAL_SOURCE_REPORT_LIMIT,
      select: {
        id: true,
        missionId: true,
        toolName: true,
        questionSnapshot: true,
        verificationStatus: true,
        serviceVersion: true,
        responsePayload: true,
        retrievedAt: true,
      },
    });
    return rows.map((row) => ({
      recordId: row.id,
      missionId: row.missionId,
      toolName: row.toolName,
      questionSnapshot: row.questionSnapshot,
      verificationStatus: row.verificationStatus,
      serviceVersion: row.serviceVersion,
      responseDigest: createHash("sha256").update(stableStringify(row.responsePayload), "utf8").digest("hex"),
      retrievedAt: row.retrievedAt,
    }));
  } catch (error) {
    if (record(error)?.code === "P2021") return [];
    throw error;
  }
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
  return getFascicoloAutomaticWorkflowReadModelForTenant({ tenantId, procedimentoId });
}

/** Trusted backend projection. The procedure's owning tenant is independently verified. */
export async function getFascicoloAutomaticWorkflowReadModelForTenant(input: {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId?: string;
}): Promise<FascicoloAutomaticWorkflowReadModel | null> {
  const { tenantId, procedimentoId } = input;
  const owner = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { enteId: true },
  });
  if (owner?.enteId !== tenantId) return null;

  const [
    reports,
    structuredReportSnapshots,
    candidateJobs,
    currentMissionRows,
    currentAdverseMissionRows,
    historicalMissionRows,
    historicalMissionCount,
    knowledge,
    operationalProposals,
    documentCorpus,
    technicalSourceRows,
  ] = await Promise.all([
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
        operation: {
          in: [
            FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION,
            RESEARCH_MISSION_EXECUTION_OPERATION,
            DOCUMENT_EXTRACTION_OPERATION,
          ],
        },
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
      where: {
        tenantId,
        caseId: procedimentoId,
        lifecycleStatus: "CURRENT",
        mode: { not: "ADVERSE_SEARCH" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MISSION_READ_LIMIT + 1,
      select: researchMissionReadSelect,
    }),
    prisma.researchMissionRecord.findMany({
      where: {
        tenantId,
        caseId: procedimentoId,
        lifecycleStatus: "CURRENT",
        mode: "ADVERSE_SEARCH",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MISSION_READ_LIMIT + 1,
      select: researchMissionReadSelect,
    }),
    prisma.researchMissionRecord.findMany({
      where: {
        tenantId,
        caseId: procedimentoId,
        lifecycleStatus: "HISTORICAL",
        mode: { not: "ADVERSE_SEARCH" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MISSION_READ_LIMIT + 1,
      select: researchMissionReadSelect,
    }),
    prisma.researchMissionRecord.count({
      where: {
        tenantId,
        caseId: procedimentoId,
        lifecycleStatus: "HISTORICAL",
        mode: { not: "ADVERSE_SEARCH" },
      },
    }),
    input.knowledgeRevisionId
      ? loadStructuredKnowledgeRevision(
          tenantId,
          procedimentoId,
          input.knowledgeRevisionId,
        )
      : loadCurrentStructuredKnowledge(tenantId, procedimentoId),
    listOperationalProposals({ tenantId, procedimentoId }),
    getFascicoloDocumentCorpusForTenant({ tenantId, procedimentoId }),
    loadTechnicalSourceReportRows(tenantId, procedimentoId),
  ]);
  if (!documentCorpus) return null;

  const missions = currentMissionRows.slice(0, MISSION_READ_LIMIT);
  const adverseMissions = currentAdverseMissionRows.slice(0, MISSION_READ_LIMIT);
  const historicalMissions = historicalMissionRows.slice(0, MISSION_READ_LIMIT);
  const displayedHistoricalResults = historicalMissions.flatMap((mission) => mission.questionResults);
  const analysisJobs = candidateJobs.filter((job) => job.operation === FASCICOLO_AUTOMATIC_ANALYSIS_OPERATION);
  const researchJobs = candidateJobs.filter((job) => job.operation === RESEARCH_MISSION_EXECUTION_OPERATION);
  const extractionJobs = candidateJobs.filter((job) => job.operation === DOCUMENT_EXTRACTION_OPERATION);
  const matchingJobs = analysisJobs.flatMap((job) => {
    const metadata = record(record(job.inputReference)?.metadata);
    return text(metadata?.procedimentoId) === procedimentoId
      ? [{
          ...job,
          documentVersionId:
            text(metadata?.extractionAttemptId)
            ?? "CORPUS",
          corpusFingerprint: text(metadata?.corpusHash),
        }]
      : [];
  });
  const currentCorpusJob = matchingJobs.find(
    (job) => job.corpusFingerprint === documentCorpus.corpusFingerprint,
  ) ?? null;
  const providerAuthorized = process.env.ASYNC_PROVIDER_EXECUTION_ENABLED === "true"
    && createRealDataActivationPolicy({
      AI_REAL_DATA_ENABLED: process.env.AI_REAL_DATA_ENABLED,
      AI_REAL_DATA_APPROVAL_ID: process.env.AI_REAL_DATA_APPROVAL_ID,
      AI_PROVIDER_PROJECT_CLASS: process.env.AI_PROVIDER_PROJECT_CLASS,
    }).enabled;
  const extractionInProgress = extractionJobs.some((job) => {
    const metadata = record(record(job.inputReference)?.metadata);
    return text(metadata?.procedimentoId) === procedimentoId
      && ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(job.status);
  });
  const extractionFailed = documentCorpus.documents.some(
    (document) => document.status === "EXTRACTION_FAILED" || document.status === "OCR_REQUIRED",
  );
  const analysisUpdateStatus =
    knowledge?.revision.corpusFingerprint === documentCorpus.corpusFingerprint
      ? "CURRENT" as const
      : currentCorpusJob?.status === "TERMINAL_FAILED" || currentCorpusJob?.status === "CANCELLED"
        ? "ERROR" as const
        : currentCorpusJob && ["QUEUED", "RUNNING", "RETRY_WAIT"].includes(currentCorpusJob.status)
          ? currentCorpusJob.status === "QUEUED" && !providerAuthorized
            ? "WAITING_AUTHORIZATION" as const
            : "UPDATING" as const
          : extractionInProgress
            ? "UPDATING" as const
            : extractionFailed
              ? "ERROR" as const
              : "STALE" as const;
  const researchPolicy = evaluateAutomaticResearchPolicy({ tenantId });
  let projectedHistoricalMissions: (FascicoloResearchMissionReadModel & { lifecycleStatus: "HISTORICAL" })[] = [];

  const readModel: Omit<FascicoloAutomaticWorkflowReadModel, "structuredReport" | "structuredReportSnapshots"> = {
    analysisUpdate: {
      status: analysisUpdateStatus,
      corpusFingerprint: documentCorpus.corpusFingerprint,
      currentRevisionFingerprint: knowledge?.revision.corpusFingerprint ?? null,
    },
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
      superseded: job.corpusFingerprint !== null
        && job.corpusFingerprint !== documentCorpus.corpusFingerprint,
    })),
    missions: (() => {
      const projectMission = <L extends "CURRENT" | "HISTORICAL">(
        mission: ResearchMissionReadRow,
        lifecycleStatus: L,
      ): FascicoloResearchMissionReadModel & { lifecycleStatus: L } => {
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
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        referenceDateBasis: record(mission.referenceDateBasis),
        missionFingerprint: mission.missionFingerprint,
        legalIssueSemanticKey: mission.legalIssueSemanticKey,
        researchQuestionSemanticKey: mission.researchQuestionSemanticKey,
        knowledgeRevisionId: mission.knowledgeRevisionId,
        lifecycleOutcome: mission.firstKnowledgeRevisionId === null || mission.knowledgeRevisionId === null
          ? "LEGACY" as const
          : mission.firstKnowledgeRevisionId === mission.knowledgeRevisionId ? "NEW" as const : "REUSED" as const,
        lifecycleStatus,
        status: mission.status,
        researchState: coverage.executionState,
        coverageStatus: coverage.status,
        coverageGaps: coverage.gaps,
        coveredElementKeys: coverage.coveredElementKeys,
        conflicting: coverage.conflicting,
        resultCount: structuredResults.length,
        displayedHistoricalResultCount: displayedHistoricalResults.filter((result) => (
          result.researchQuestionSemanticKey === mission.researchQuestionSemanticKey
        )).length,
        discoveryCoverageStatus: sourceCoverage.discoveryCoverage,
        usableCoverageStatus: sourceCoverage.usableCoverage,
        usableSupportsCount: sourceCoverage.usableSupportsCount,
        usableOpposesCount: sourceCoverage.usableOpposesCount,
        conflictingUsableAuthorities: sourceCoverage.conflictingUsableAuthorities,
        sourceGaps: sourceCoverage.gaps,
        adverseMission: lifecycleStatus === "CURRENT" && adverse?.lifecycleStatus === "CURRENT" ? {
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
              sourceAssessment: projectSourceAssessment(assessment),
            };
          })(),
          resultId: result.id,
          candidateId: result.candidateId,
          missionId: mission.id,
          bundleId: result.bundleId,
          title: result.candidateSnapshot.title ?? result.candidateSnapshot.officialIdentifier ?? "Risultato di ricerca",
          authority: result.candidateSnapshot.courtOrBody ?? null,
          sourceFamily: result.candidateSnapshot.sourceFamily ?? null,
          officialIdentifier:
            result.candidateSnapshot.officialIdentifier
            ?? result.candidateSnapshot.ecli
            ?? result.candidateSnapshot.celex
            ?? null,
          documentDate: result.candidateSnapshot.documentDate ?? null,
          sourceUrl: safeHttpUrl(result.candidateSnapshot.sourceUrl),
          provider: result.candidateSnapshot.providerId ?? result.candidateSnapshot.toolId ?? null,
          relevantPassage: text(result.candidateSnapshot.relevantPassage),
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
        conflicts: texts(bundle?.conflicts),
        suggestions: records(bundle?.legalResearchSuggestions).flatMap((suggestion) => {
          const suggestionId = text(suggestion.suggestionId);
          const kind = text(suggestion.kind);
          const description = text(suggestion.description);
          if (!suggestionId || !kind || !description) return [];
          return [{
            suggestionId,
            kind,
            description,
            targetId: text(suggestion.targetId),
          }];
        }),
        completionState: bundleRecord?.completionState ?? null,
        execution: {
          status: researchJob?.status ?? null,
          failureCode: researchJob?.failureCode ?? null,
          attemptCount: researchJob?.attemptCount ?? 0,
          callCount: typeof resultMetadata?.callCount === "number" ? resultMetadata.callCount : null,
        },
        automationRequirementCode: lifecycleStatus === "CURRENT"
          ? researchJob?.failureCode ?? missionPolicy.requirementCode
          : null,
        legalAnalysisContributions: records(bundle?.legalAnalysisContributions).flatMap((contribution) => {
          const parsed = legalAnalysisContributionSchema.safeParse(contribution);
          return parsed.success ? [parsed.data] : [];
        }),
        legalApplicabilityReviews: projectApplicabilityReviews(mission).reviews,
        legalApplicabilityReviewIssues: projectApplicabilityReviews(mission).issues,
      };
      };
      projectedHistoricalMissions = historicalMissions
        .filter((mission) => mission.mode !== "ADVERSE_SEARCH")
        .map((mission) => projectMission(mission, "HISTORICAL"));
      return missions
        .filter((mission) => mission.mode !== "ADVERSE_SEARCH")
        .map((mission) => projectMission(mission, "CURRENT"));
    })(),
    historicalMissions: projectedHistoricalMissions,
    missionReadTruncation: {
      limitPerLifecycle: MISSION_READ_LIMIT,
      current: currentMissionRows.length > MISSION_READ_LIMIT,
      historical: historicalMissionRows.length > MISSION_READ_LIMIT,
      adverse: currentAdverseMissionRows.length > MISSION_READ_LIMIT,
    },
  };
  const verifiedReportMissions = await Promise.all(readModel.missions.map(async (mission) => ({
    ...mission,
    legalApplicabilityReviews: await Promise.all(mission.legalApplicabilityReviews.map(async (envelope) => {
      try {
        const resolution = await resolveApplicableLegalRules(envelope.review.ruleOrchestrator.input);
        const verification = verifyRuleResolutionFingerprint({
            review: envelope.review,
            resolution,
          });
        return {
          ...envelope,
          orchestratorVerification: {
            ...verification,
            resolvedSources: [
              ...resolution.applicableSources,
              ...resolution.excludedByTerritory,
              ...resolution.excludedByDate,
              ...resolution.historicalSources,
              ...resolution.supersededSources,
              ...resolution.partiallySupersededSources,
              ...resolution.pendingValiditySources,
              ...resolution.draftOrOngoingSources,
              ...resolution.caseSpecificSources,
            ],
            matchedSourceIds: resolution.applicableRules.map((rule) => rule.source.id),
          },
        };
      } catch (error) {
        if (!(error instanceof OrchestrationInputError)) throw error;
        return {
          ...envelope,
          orchestratorVerification: {
            valid: false,
            source: null,
            ruleMatched: false,
          },
        };
      }
    })),
  })));
  const structuredReport = knowledge ? buildStructuredFascicoloReport({
    tenantId,
    procedimentoId,
    knowledge,
    contractVersion: STRUCTURED_FASCICOLO_REPORT_V2_CONTRACT_VERSION,
    technicalSources: technicalSourceRows,
    missions: [
      ...verifiedReportMissions,
      ...adverseMissions.map((mission) => {
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
              candidateId: result.candidateId,
              title: candidate.title ?? candidate.officialIdentifier ?? "Risultato di ricerca contraria",
              sourceUrl: safeHttpUrl(candidate.sourceUrl),
              provider: candidate.providerId ?? candidate.toolId ?? null,
              relevantPassage: text(candidate.relevantPassage),
              supportDirection: result.supportDirection,
              classificationReviewStatus: result.classificationReviewStatus,
              classificationRationale: result.classificationRationale,
              sourceAssessment: projectSourceAssessment(assessment),
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

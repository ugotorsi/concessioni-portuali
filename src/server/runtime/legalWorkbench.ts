import { prisma } from "@/lib/prisma";
import type { JsonValue } from "@/server/fascicolo-knowledge/contracts";
import { getCurrentKnowledgeRevision } from "@/server/fascicolo-knowledge/repository";
import {
  listReferenceDateReviewQuestions,
  loadReferenceDateConfirmations,
  type ReferenceDateReviewQuestion,
} from "@/server/fascicolo-knowledge/referenceDateConfirmation";
import { evaluateManualResearchPolicy } from "@/server/legal-research/manual-research-policy";
import {
  isLegalDataHunterApiKeyConfigured,
  readProviderOAuthCredentialStatuses,
  type ProviderOAuthCredentialStatus,
} from "@/server/legal-research/provider-oauth-credential-store";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";

const ANALYSIS_OPERATION = "FASCICOLO.AUTOMATIC_ANALYSIS_V1";

function autonomousChannelStatus(tenantId: string, procedimentoId: string) {
  const decision = evaluateManualResearchPolicy({ tenantId });
  if (!decision.authorized) return { authorized: false, requirementCode: decision.requirementCode };
  const procedimenti = process.env.MANUAL_RESEARCH_PROCEDIMENTO_ALLOWLIST
    ?.split(",").map((value) => value.trim()) ?? [];
  return procedimenti.includes(procedimentoId)
    ? { authorized: true, requirementCode: null }
    : { authorized: false, requirementCode: "MANUAL_RESEARCH_PROCEDIMENTO_NOT_ALLOWED" };
}

export interface LegalWorkbenchSource {
  title: string;
  providerId: string | null;
  identifier: string | null;
  courtOrBody: string | null;
  documentDate: string | null;
  sourceUrl: string | null;
}

export interface LegalWorkbenchMission {
  id: string;
  status: string;
  lifecycleStatus: string;
  executionChannel: string;
  referenceDate: string;
  referenceDateBasis: string | null;
  question: string;
  assignedActorEmail: string | null;
  createdAt: Date;
  completedAt: Date | null;
  attempts: { id: string; executorKind: string; completionState: string | null; totalCalls: number; errorCode: string | null; startedAt: Date }[];
  bundles: { id: string; completionState: string; totalCalls: number; createdAt: Date; sources: LegalWorkbenchSource[]; evidenceGapCount: number }[];
  /** Missing facts in the fascicolo documents: a documentary gap, not a technical failure. */
  documentaryGaps: { gapId: string; description: string | null; resolvedInCurrentRevision: boolean }[];
}

export interface LegalWorkbenchSnapshot {
  procedimentoId: string;
  tenantId: string;
  currentRevision: { id: string; completedAt: Date | null; itemCount: number } | null;
  revisions: { id: string; status: string; createdAt: Date; completedAt: Date | null; supersededAt: Date | null }[];
  reports: { id: string; status: string; generatedAt: Date; knowledgeRevisionId: string; supersededBySnapshotId: string | null }[];
  analysisJobs: { id: string; status: string; purpose: string; createdAt: Date; completedAt: Date | null; failureCode: string | null }[];
  referenceDateReviews: readonly ReferenceDateReviewQuestion[];
  referenceDateConfirmations: { questionSemanticKey: string; confirmedDate: string; sourceId: string }[];
  missions: LegalWorkbenchMission[];
  research: {
    autonomousChannel: { authorized: boolean; requirementCode: string | null };
    providerCredentials: readonly ProviderOAuthCredentialStatus[];
    legalDataHunterConfigured: boolean;
    jobs: { id: string; status: string; missionId: string | null; createdAt: Date; completedAt: Date | null; failureCode: string | null }[];
  };
}

function object(value: unknown): Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bundleSources(payload: unknown): { sources: LegalWorkbenchSource[]; evidenceGapCount: number } {
  const record = object(payload);
  const candidates = Array.isArray(record.authorityCandidates) ? record.authorityCandidates : [];
  const gaps = Array.isArray(record.evidenceGaps) ? record.evidenceGaps : [];
  return {
    evidenceGapCount: gaps.length,
    sources: candidates.map((candidate) => {
      const value = object(candidate);
      return {
        title: text(value.title) ?? "Fonte senza titolo",
        providerId: text(value.providerId),
        identifier: text(value.ecli) ?? text(value.celex) ?? text(value.officialIdentifier),
        courtOrBody: text(value.courtOrBody),
        documentDate: text(value.documentDate),
        sourceUrl: text(value.sourceUrl),
      };
    }),
  };
}

export async function getLegalWorkbenchSnapshot(procedimentoId: string): Promise<LegalWorkbenchSnapshot | null> {
  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { id: true, enteId: true },
  });
  if (!procedimento?.enteId) return null;
  const tenantId = procedimento.enteId;
  const scope = { tenantId, procedimentoId };

  const [currentRevision, revisions, reports, analysisJobs, confirmations, missionRecords, providerCredentials, legalDataHunterConfigured, researchJobs] = await Promise.all([
    getCurrentKnowledgeRevision(scope),
    prisma.fascicoloKnowledgeRevision.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, createdAt: true, completedAt: true, supersededAt: true },
    }),
    prisma.structuredFascicoloReportSnapshot.findMany({
      where: scope,
      orderBy: { generatedAt: "desc" },
      take: 10,
      select: { id: true, status: true, generatedAt: true, knowledgeRevisionId: true, supersededBySnapshotId: true },
    }),
    prisma.asyncJob.findMany({
      where: { ...scope, operation: ANALYSIS_OPERATION },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, purpose: true, createdAt: true, completedAt: true, failureCode: true },
    }),
    loadReferenceDateConfirmations(scope),
    prisma.researchMissionRecord.findMany({
      where: { tenantId, caseId: procedimentoId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        payload: true,
        referenceDate: true,
        referenceDateBasis: true,
        createdAt: true,
        completedAt: true,
        assignedActor: { select: { email: true } },
        executionAttempts: {
          orderBy: { startedAt: "desc" },
          take: 5,
          select: {
            id: true,
            executorKind: true,
            completionState: true,
            totalCalls: true,
            errorCode: true,
            startedAt: true,
            evidenceBundles: {
              orderBy: { createdAt: "desc" },
              select: { id: true, completionState: true, totalCalls: true, createdAt: true, payload: true },
            },
          },
        },
      },
    }),
    readProviderOAuthCredentialStatuses().catch(() => []),
    isLegalDataHunterApiKeyConfigured().catch(() => false),
    prisma.asyncJob.findMany({
      where: { ...scope, operation: RESEARCH_MISSION_EXECUTION_OPERATION },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, logicalOperationId: true, createdAt: true, completedAt: true, failureCode: true },
    }),
  ]);

  return {
    procedimentoId,
    tenantId,
    currentRevision: currentRevision
      ? { id: currentRevision.id, completedAt: currentRevision.completedAt ?? null, itemCount: currentRevision.items.length }
      : null,
    revisions: revisions.map((revision) => ({ ...revision, status: String(revision.status) })),
    reports: reports.map((report) => ({ ...report, status: String(report.status) })),
    analysisJobs: analysisJobs.map((job) => ({ ...job, status: String(job.status) })),
    referenceDateReviews: currentRevision?.status === "CURRENT"
      ? listReferenceDateReviewQuestions(currentRevision)
      : [],
    referenceDateConfirmations: confirmations.map(({ questionSemanticKey, confirmedDate, sourceId }) => ({
      questionSemanticKey,
      confirmedDate,
      sourceId,
    })),
    missions: missionRecords.map((mission) => {
      const payload = object(mission.payload);
      const gapItems = new Map(
        (currentRevision?.items ?? [])
          .filter((item) => item.kind === "GAP")
          .map((item) => [item.semanticKey, item.normalizedText] as const),
      );
      const knownGaps = Array.isArray(payload.knownEvidenceGaps) ? payload.knownEvidenceGaps : [];
      const documentaryGaps = knownGaps
        .map((gap) => object(gap))
        .filter((gap) => text(gap.kind) === "MISSING_FACT_EVIDENCE" && text(gap.gapId))
        .map((gap) => {
          const gapId = text(gap.gapId)!;
          return {
            gapId,
            description: gapItems.get(gapId) ?? null,
            resolvedInCurrentRevision: currentRevision ? !gapItems.has(gapId) : false,
          };
        });
      return {
        documentaryGaps,
        id: mission.id,
        status: String(mission.status),
        lifecycleStatus: String(mission.lifecycleStatus),
        executionChannel: text(payload.executionChannel) ?? "CHATGPT_CONNECTOR",
        referenceDate: mission.referenceDate.toISOString().slice(0, 10),
        referenceDateBasis: text(object(mission.referenceDateBasis).type),
        question: text(payload.researchQuestion) ?? "",
        assignedActorEmail: mission.assignedActor?.email ?? null,
        createdAt: mission.createdAt,
        completedAt: mission.completedAt,
        attempts: mission.executionAttempts.map((attempt) => ({
          id: attempt.id,
          executorKind: attempt.executorKind,
          completionState: attempt.completionState ? String(attempt.completionState) : null,
          totalCalls: attempt.totalCalls,
          errorCode: attempt.errorCode,
          startedAt: attempt.startedAt,
        })),
        bundles: mission.executionAttempts.flatMap((attempt) => attempt.evidenceBundles.map((bundle) => ({
          id: bundle.id,
          completionState: String(bundle.completionState),
          totalCalls: bundle.totalCalls,
          createdAt: bundle.createdAt,
          ...bundleSources(bundle.payload),
        }))),
      };
    }),
    research: {
      autonomousChannel: autonomousChannelStatus(tenantId, procedimentoId),
      providerCredentials,
      legalDataHunterConfigured,
      jobs: researchJobs.map((job) => ({
        id: job.id,
        status: String(job.status),
        missionId: job.logicalOperationId.replace(/:execution:\d+$/, ""),
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        failureCode: job.failureCode,
      })),
    },
  };
}

export function buildSelvaraMissionInstructions(missionId: string): string {
  return [
    "Usa il connettore NOETRA per eseguire la missione di ricerca giuridica indicata.",
    `1. Chiama research_get_mission con missionId "${missionId}" e leggi domanda, data di riferimento, budget e guida al bundle.`,
    "2. Chiama research_claim_mission sulla stessa missione.",
    "3. Esegui la ricerca solo con le fonti autorizzate (Moonlit, Simpliciter, LegalDataHunter), rispettando il budget di chiamate.",
    "4. Chiama research_submit_evidence_bundle con le fonti trovate (titolo, identificativo ECLI/CELEX/ufficiale, autorità, data, URL) e le eventuali lacune.",
    "5. Chiama research_complete_mission e riporta l'esito.",
    "Non inventare fonti: se una fonte non è verificabile, registrala come lacuna.",
  ].join("\n");
}

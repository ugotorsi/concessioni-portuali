import type { ResearchEvidenceBundle } from "./bridge";
import {
  claimResearchMission,
  completeResearchMission,
  getResearchFascicoloContext,
  getResearchMission,
  releaseOrDeferResearchMission,
  submitResearchEvidenceBundle,
  type ResearchServiceActor,
} from "./persistence";
import type { TrustedResearchHttpClient } from "./trusted-research-http-client";

export function createLocalTrustedResearchClient(input: Readonly<{
  actor: ResearchServiceActor;
  claimantId: string;
}>): TrustedResearchHttpClient {
  return {
    async readMission(missionId) {
      const stored = await getResearchMission(missionId, input.actor);
      if (!stored) throw new Error("MISSION_NOT_FOUND");
      return {
        mission: stored.mission,
        operational: {
          status: stored.operational.status,
          stateVersion: stored.operational.stateVersion,
          claimExpiresAt: stored.operational.claimExpiresAt?.toISOString() ?? null,
          activeExecutionId: stored.operational.activeExecutionId,
          completedAt: stored.operational.completedAt?.toISOString() ?? null,
          deferredAt: stored.operational.deferredAt?.toISOString() ?? null,
        },
        fascicoloContext: await getResearchFascicoloContext(missionId, input.actor),
        assistedVerification: null,
      };
    },
    async claimMission(request) {
      const claimed = await claimResearchMission({
        missionId: request.missionId,
        executionId: request.executionId,
        leaseDurationMs: request.leaseDurationMs,
        executor: { kind: "AUTHORIZED_WORKER", claimantId: input.claimantId },
        actor: input.actor,
      });
      return {
        outcome: claimed.outcome,
        missionId: request.missionId,
        fascicoloScopeId: claimed.claim.mission.mission.caseReference.caseId,
        executionId: claimed.claim.execution.id,
        leaseExpiresAt: claimed.claim.execution.leaseExpiresAt.toISOString(),
        claimToken: claimed.claim.claimToken,
      };
    },
    async submitEvidenceBundle(request) {
      const submitted = await submitResearchEvidenceBundle({
        bundle: request.bundle as ResearchEvidenceBundle,
        claimantId: input.claimantId,
        claimToken: request.claimToken,
        actor: input.actor,
      });
      return {
        outcome: submitted.outcome === "REUSED" ? "DUPLICATE_OR_IDEMPOTENT_SUCCESS" : "CREATED",
        bundleId: submitted.bundle.id,
        missionId: submitted.bundle.missionId,
        fascicoloScopeId: request.bundle.missionId === submitted.bundle.missionId
          ? (await getResearchMission(request.missionId, input.actor))!.mission.caseReference.caseId
          : "",
        executionId: submitted.bundle.executionId,
        completionState: submitted.bundle.completionState,
      };
    },
    async completeMission(request) {
      const completed = await completeResearchMission({
        missionId: request.missionId,
        executionId: request.executionId,
        bundleId: request.bundleId,
        claimantId: input.claimantId,
        claimToken: request.claimToken,
        actor: input.actor,
      });
      return {
        outcome: completed.outcome,
        missionId: completed.mission.mission.missionId,
        fascicoloScopeId: completed.mission.mission.caseReference.caseId,
        status: completed.mission.operational.status as "COMPLETED" | "BUDGET_EXHAUSTED",
        stateVersion: completed.mission.operational.stateVersion,
      };
    },
    async deferMission(request) {
      const stored = await releaseOrDeferResearchMission({
        missionId: request.missionId,
        executionId: request.executionId,
        claimantId: input.claimantId,
        claimToken: request.claimToken,
        actor: input.actor,
        disposition: request.disposition,
        reasonCode: request.reasonCode,
      });
      return {
        missionId: stored.mission.missionId,
        fascicoloScopeId: stored.mission.caseReference.caseId,
        status: stored.operational.status as "PENDING" | "DEFERRED",
        stateVersion: stored.operational.stateVersion,
      };
    },
  };
}

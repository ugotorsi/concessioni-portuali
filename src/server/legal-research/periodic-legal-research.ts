import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  buildKnowledgeResearchMissionPlans,
  getCurrentKnowledgeRevision,
  reconcileKnowledgeResearchMissions,
  type KnowledgeResearchMissionPlan,
} from "@/server/fascicolo-knowledge";
import { createResearchMission } from "@/server/legal-research/bridge";

export const PERIODIC_LEGAL_RESEARCH_DEFAULT_INTERVAL_DAYS = 30;
export const PERIODIC_LEGAL_RESEARCH_RECONCILE_INTERVAL_MS = 60 * 60 * 1_000;

export interface PeriodicLegalResearchTarget {
  tenantId: string;
  procedimentoId: string;
  knowledgeRevisionId: string;
  assignedActorId: string;
  plans: readonly KnowledgeResearchMissionPlan[];
}

export interface PeriodicLegalResearchDependencies {
  listDueTargets(input: {
    dueBefore: Date;
    limit: number;
  }): Promise<readonly PeriodicLegalResearchTarget[]>;
  reconcile(input: {
    tenantId: string;
    procedimentoId: string;
    knowledgeRevisionId: string;
    assignedActorId: string;
    plans: readonly KnowledgeResearchMissionPlan[];
  }): Promise<unknown>;
}

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

function periodKey(now: Date, intervalDays: number): string {
  return String(Math.floor(now.getTime() / (intervalDays * 24 * 60 * 60 * 1_000)));
}

export function buildPeriodicLegalResearchPlans(input: {
  plans: readonly KnowledgeResearchMissionPlan[];
  now: Date;
  intervalDays: number;
}): readonly KnowledgeResearchMissionPlan[] {
  const cycle = periodKey(input.now, input.intervalDays);
  return input.plans.map((plan) => {
    if (!plan.mission) return plan;
    const { missionId: _missionId, ...mission } = plan.mission;
    const periodicFingerprint = fingerprint([
      "PERIODIC_LEGAL_RESEARCH_V1",
      plan.missionFingerprint,
      cycle,
    ]);
    return {
      ...plan,
      missionFingerprint: periodicFingerprint,
      mission: createResearchMission({
        ...mission,
        mode: "SUBSEQUENT_TREATMENT_SEARCH",
        assumptionsFingerprint: periodicFingerprint,
        researchQuestion: `${mission.researchQuestion} Verificare novità normative e giurisprudenziali successive.`,
        requiredOutput: {
          ...mission.requiredOutput,
          authorityCandidates: true,
          citationObservations: true,
          legalResearchSuggestions: true,
          evidenceGaps: true,
        },
        status: plan.execution === "DEFERRED_BY_POLICY" ? "DEFERRED" : "PENDING",
      }),
    };
  });
}

function configuredIntervalDays(environment: NodeJS.ProcessEnv): number {
  const value = environment.PERIODIC_LEGAL_RESEARCH_INTERVAL_DAYS;
  if (value === undefined) return PERIODIC_LEGAL_RESEARCH_DEFAULT_INTERVAL_DAYS;
  if (!/^\d+$/.test(value)) throw new Error("INVALID_PERIODIC_LEGAL_RESEARCH_INTERVAL");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error("INVALID_PERIODIC_LEGAL_RESEARCH_INTERVAL");
  }
  return parsed;
}

const defaultDependencies: PeriodicLegalResearchDependencies = {
  async listDueTargets({ dueBefore, limit }) {
    const revisions = await prisma.fascicoloKnowledgeRevision.findMany({
      where: {
        status: "CURRENT",
        items: { some: { kind: "RESEARCH_QUESTION", status: { not: "REJECTED" } } },
        researchMissions: {
          some: {
            lifecycleStatus: "CURRENT",
            createdAt: { lte: dueBefore },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        tenantId: true,
        procedimentoId: true,
        researchMissions: {
          where: {
            lifecycleStatus: "CURRENT",
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { assignedActorId: true, createdAt: true },
        },
        procedimento: {
          select: {
            automaticFascicoloReports: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { createdByActorId: true },
            },
          },
        },
      },
    });
    const targets: PeriodicLegalResearchTarget[] = [];
    for (const revision of revisions) {
      const latestMission = revision.researchMissions[0];
      if (!latestMission || latestMission.createdAt > dueBefore) continue;
      const assignedActorId = latestMission.assignedActorId
        ?? revision.procedimento.automaticFascicoloReports[0]?.createdByActorId
        ?? null;
      if (!assignedActorId) continue;
      const assignedActor = await prisma.user.findFirst({
        where: {
          id: assignedActorId,
          attivo: true,
          tenantMemberships: { some: { enteId: revision.tenantId } },
        },
        select: { id: true },
      });
      if (!assignedActor) continue;
      const current = await getCurrentKnowledgeRevision({
        tenantId: revision.tenantId,
        procedimentoId: revision.procedimentoId,
      });
      if (!current || current.id !== revision.id) continue;
      targets.push({
        tenantId: revision.tenantId,
        procedimentoId: revision.procedimentoId,
        knowledgeRevisionId: revision.id,
        assignedActorId: assignedActor.id,
        plans: buildKnowledgeResearchMissionPlans(current),
      });
    }
    return targets;
  },
  reconcile: reconcileKnowledgeResearchMissions,
};

export async function reconcilePeriodicLegalResearchMissions(input: {
  now?: Date;
  limit?: number;
  environment?: NodeJS.ProcessEnv;
}, overrides: Partial<PeriodicLegalResearchDependencies> = {}): Promise<{
  targetCount: number;
  missionCount: number;
}> {
  const environment = input.environment ?? process.env;
  if (environment.PERIODIC_LEGAL_RESEARCH_ENABLED !== "true") {
    return { targetCount: 0, missionCount: 0 };
  }
  const now = input.now ?? new Date();
  const intervalDays = configuredIntervalDays(environment);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("INVALID_PERIODIC_LEGAL_RESEARCH_LIMIT");
  }
  const dependencies = { ...defaultDependencies, ...overrides };
  const dueBefore = new Date(now.getTime() - intervalDays * 24 * 60 * 60 * 1_000);
  const targets = await dependencies.listDueTargets({ dueBefore, limit });
  let missionCount = 0;
  for (const target of targets) {
    const plans = buildPeriodicLegalResearchPlans({
      plans: target.plans,
      now,
      intervalDays,
    });
    await dependencies.reconcile({ ...target, plans });
    missionCount += plans.filter((plan) => plan.mission !== null).length;
  }
  return { targetCount: targets.length, missionCount };
}

export function createPeriodicLegalResearchScheduler(input: {
  now?: () => Date;
  reconcile?: typeof reconcilePeriodicLegalResearchMissions;
  environment?: NodeJS.ProcessEnv;
} = {}) {
  const now = input.now ?? (() => new Date());
  const reconcile = input.reconcile ?? reconcilePeriodicLegalResearchMissions;
  const environment = input.environment ?? process.env;
  let nextRunAt = 0;
  return async () => {
    const current = now();
    if (current.getTime() < nextRunAt) return null;
    nextRunAt = current.getTime() + PERIODIC_LEGAL_RESEARCH_RECONCILE_INTERVAL_MS;
    return reconcile({ now: current, environment });
  };
}

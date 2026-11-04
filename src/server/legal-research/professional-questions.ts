import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { canonicalJson } from "@/server/fascicolo-knowledge/canonicalization";
import type { JsonValue } from "@/server/fascicolo-knowledge/contracts";
import {
  createResearchMission,
  RESEARCH_BRIDGE_VERSION,
  type ResearchMission,
} from "@/server/legal-research/bridge";
import { RESEARCH_MISSION_EXECUTION_OPERATION } from "@/server/legal-research/persistence";
import {
  researchMissionDisplayState,
  type ResearchMissionExecutionJobView,
} from "@/server/legal-research/research-mission-display-state";

export const PROFESSIONAL_RESEARCH_BUDGET = Object.freeze({
  maxTotalResearchCalls: 6,
  maxMoonlitCalls: 2,
  maxSimpliciterCalls: 2,
  maxLegalDataHunterCalls: 2,
});

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedQuestionText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function professionalQuestionVersionIdentity(input: {
  questionText: string;
  theme: string | null;
  rationale: string | null;
  referenceDate: Date;
}) {
  const questionText = normalizedQuestionText(input.questionText);
  const payload = {
    questionText,
    theme: input.theme?.trim() || null,
    rationale: input.rationale?.trim() || null,
    referenceDate: input.referenceDate.toISOString().slice(0, 10),
  };
  return {
    ...payload,
    semanticKey: hash(`professional-legal-question:${questionText.toLocaleLowerCase("it-IT")}`),
    contentFingerprint: hash(canonicalJson(payload)),
  };
}

export async function listProfessionalLegalQuestions(input: {
  tenantId: string;
  procedimentoId: string;
  now?: Date;
}) {
  const [questions, jobs] = await Promise.all([prisma.professionalLegalQuestion.findMany({
    where: { tenantId: input.tenantId, procedimentoId: input.procedimentoId },
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
    include: {
      versions: {
        orderBy: { version: "desc" },
        include: {
          researchMission: {
            select: {
              id: true,
              status: true,
              lifecycleStatus: true,
              createdAt: true,
              updatedAt: true,
              claimExpiresAt: true,
              questionResults: { select: { id: true, classificationReviewStatus: true } },
            },
          },
        },
      },
    },
  }), prisma.asyncJob.findMany({
    where: {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      operation: RESEARCH_MISSION_EXECUTION_OPERATION,
    },
    orderBy: { createdAt: "desc" },
    select: {
      inputReference: true,
      status: true,
      failureCode: true,
      availableAt: true,
      leaseExpiresAt: true,
      createdAt: true,
    },
  })]);
  // Jobs are newest first, so the first job seen for a mission is its latest execution attempt.
  const latestJobByMission = new Map<string, ResearchMissionExecutionJobView>();
  for (const job of jobs) {
    const reference = job.inputReference as { referenceId?: unknown } | null;
    const missionId = typeof reference?.referenceId === "string" ? reference.referenceId : null;
    if (missionId && !latestJobByMission.has(missionId)) {
      latestJobByMission.set(missionId, {
        status: job.status,
        failureCode: job.failureCode,
        availableAt: job.availableAt,
        leaseExpiresAt: job.leaseExpiresAt,
        createdAt: job.createdAt,
      });
    }
  }
  const now = input.now ?? new Date();
  return questions.map((question) => ({
    ...question,
    versions: question.versions.map((version) => ({
      ...version,
      researchMission: version.researchMission
        ? {
          ...version.researchMission,
          display: researchMissionDisplayState({
            status: version.researchMission.status,
            lifecycleStatus: version.researchMission.lifecycleStatus,
            claimExpiresAt: version.researchMission.claimExpiresAt,
            results: version.researchMission.questionResults,
            job: latestJobByMission.get(version.researchMission.id) ?? null,
            now,
          }),
        }
        : null,
    })),
  }));
}

export async function createProfessionalLegalQuestion(input: {
  tenantId: string;
  procedimentoId: string;
  actorUserId: string;
  questionText: string;
  theme?: string | null;
  rationale?: string | null;
  referenceDate: Date;
}) {
  const identity = professionalQuestionVersionIdentity({
    questionText: input.questionText,
    theme: input.theme ?? null,
    rationale: input.rationale ?? null,
    referenceDate: input.referenceDate,
  });
  return prisma.professionalLegalQuestion.create({
    data: {
      tenantId: input.tenantId,
      procedimentoId: input.procedimentoId,
      createdByUserId: input.actorUserId,
      versions: {
        create: {
          version: 1,
          ...identity,
          referenceDate: input.referenceDate,
          createdByUserId: input.actorUserId,
        },
      },
    },
    include: { versions: true },
  });
}

export async function reviseProfessionalLegalQuestion(input: {
  tenantId: string;
  procedimentoId: string;
  questionId: string;
  actorUserId: string;
  questionText: string;
  theme?: string | null;
  rationale?: string | null;
  referenceDate: Date;
}) {
  const identity = professionalQuestionVersionIdentity({
    questionText: input.questionText,
    theme: input.theme ?? null,
    rationale: input.rationale ?? null,
    referenceDate: input.referenceDate,
  });
  return prisma.$transaction(async (tx) => {
    const question = await tx.professionalLegalQuestion.findFirst({
      where: {
        id: input.questionId,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        archivedAt: null,
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!question?.versions[0]) throw new Error("PROFESSIONAL_QUESTION_NOT_FOUND");
    if (question.versions[0].contentFingerprint === identity.contentFingerprint) {
      throw new Error("PROFESSIONAL_QUESTION_UNCHANGED");
    }
    await tx.professionalLegalQuestionVersion.updateMany({
      where: { questionId: question.id, status: "DRAFT" },
      data: { status: "SUPERSEDED" },
    });
    return tx.professionalLegalQuestionVersion.create({
      data: {
        questionId: question.id,
        version: question.versions[0].version + 1,
        ...identity,
        referenceDate: input.referenceDate,
        createdByUserId: input.actorUserId,
      },
    });
  });
}

export async function approveProfessionalLegalQuestionVersion(input: {
  tenantId: string;
  procedimentoId: string;
  versionId: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const version = await tx.professionalLegalQuestionVersion.findFirst({
      where: {
        id: input.versionId,
        question: {
          tenantId: input.tenantId,
          procedimentoId: input.procedimentoId,
          archivedAt: null,
        },
      },
    });
    if (!version) throw new Error("PROFESSIONAL_QUESTION_VERSION_NOT_FOUND");
    if (version.status !== "DRAFT") throw new Error("PROFESSIONAL_QUESTION_VERSION_NOT_DRAFT");
    await tx.professionalLegalQuestionVersion.updateMany({
      where: {
        questionId: version.questionId,
        id: { not: version.id },
        status: { in: ["DRAFT", "APPROVED"] },
      },
      data: { status: "SUPERSEDED" },
    });
    return tx.professionalLegalQuestionVersion.update({
      where: { id: version.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByUserId: input.actorUserId,
      },
    });
  });
}

export async function archiveProfessionalLegalQuestion(input: {
  tenantId: string;
  procedimentoId: string;
  questionId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const question = await tx.professionalLegalQuestion.findFirst({
      where: {
        id: input.questionId,
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        archivedAt: null,
      },
    });
    if (!question) throw new Error("PROFESSIONAL_QUESTION_NOT_FOUND");
    const archivedAt = new Date();
    await tx.professionalLegalQuestionVersion.updateMany({
      where: { questionId: question.id, status: { in: ["DRAFT", "APPROVED"] } },
      data: { status: "ARCHIVED" },
    });
    return tx.professionalLegalQuestion.update({
      where: { id: question.id },
      data: { archivedAt },
    });
  });
}

export async function ensureProfessionalQuestionResearchMission(input: {
  tenantId: string;
  procedimentoId: string;
  versionId: string;
  actorUserId: string;
}): Promise<ResearchMission> {
  const version = await prisma.professionalLegalQuestionVersion.findFirst({
    where: {
      id: input.versionId,
      status: "APPROVED",
      question: {
        tenantId: input.tenantId,
        procedimentoId: input.procedimentoId,
        archivedAt: null,
      },
    },
    include: {
      question: true,
      researchMission: { select: { payload: true } },
    },
  });
  if (!version) throw new Error("PROFESSIONAL_QUESTION_VERSION_NOT_APPROVED");
  if (version.researchMission) return version.researchMission.payload as unknown as ResearchMission;

  const mission = createResearchMission({
    kind: "RESEARCH_MISSION",
    version: RESEARCH_BRIDGE_VERSION,
    executionChannel: "SERVER_AUTONOMOUS",
    caseReference: {
      caseId: input.procedimentoId,
      fascicoloReference: input.procedimentoId,
    },
    legalIssueIds: [`professional-question:${version.questionId}`],
    legalPropositionIds: [],
    referenceDate: version.referenceDate.toISOString().slice(0, 10),
    mode: "DISCOVER_AUTHORITIES",
    researchQuestion: version.questionText,
    assumptionsFingerprint: version.contentFingerprint,
    knownAuthorities: [],
    excludedAuthorities: [],
    preferredSourceFamilies: [
      "ITALIAN_LEGISLATION",
      "EU_LEGISLATION",
      "CASSAZIONE",
      "GIUSTIZIA_AMMINISTRATIVA",
      "CJEU",
    ],
    missingSourceFamilies: [],
    knownCounterArguments: [],
    knownEvidenceGaps: [],
    requiredOutput: {
      authorityCandidates: true,
      citationObservations: true,
      legalResearchSuggestions: false,
      evidenceGaps: true,
      fullTextRequired: false,
    },
    budget: PROFESSIONAL_RESEARCH_BUDGET,
    status: "PENDING",
    executionPlan: {
      requiredCapabilities: ["SEMANTIC_DISCOVERY", "KEYWORD_DISCOVERY", "EXACT_RETRIEVAL"],
    },
  });
  const payloadFingerprint = hash(canonicalJson(mission as unknown as JsonValue));
  const missionFingerprint = hash(`professional-mission:${version.id}:${version.contentFingerprint}`);
  await prisma.researchMissionRecord.create({
    data: {
      id: mission.missionId,
      tenantId: input.tenantId,
      assignedActorId: input.actorUserId,
      contractVersion: mission.version,
      caseId: input.procedimentoId,
      fascicoloReference: mission.caseReference.fascicoloReference,
      referenceDate: version.referenceDate,
      mode: mission.mode,
      payload: mission,
      payloadFingerprint,
      missionFingerprint,
      legalIssueSemanticKey: hash(`professional-issue:${version.questionId}`),
      researchQuestionSemanticKey: version.semanticKey,
      referenceDateBasis: {
        kind: "PROFESSIONAL_SELECTION",
        questionVersionId: version.id,
        version: version.version,
      },
      lifecycleStatus: "CURRENT",
      status: "PENDING",
      professionalQuestionVersionId: version.id,
    },
  });
  return mission;
}

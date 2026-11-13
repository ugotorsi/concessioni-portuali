"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUserWithMfa } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { requestDocumentWorkerActivation } from "@/server/async-jobs/documentWorkerActivation";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { ensureAutomaticResearchExecution } from "@/server/legal-research/automatic-research-job";
import {
  approveProfessionalLegalQuestionVersion,
  archiveProfessionalLegalQuestion,
  createProfessionalLegalQuestion,
  ensureProfessionalQuestionResearchMission,
  PROFESSIONAL_RESEARCH_BUDGET,
  reviseProfessionalLegalQuestion,
} from "@/server/legal-research/professional-questions";

const questionInputSchema = z.object({
  procedimentoId: z.string().trim().min(1).max(256),
  questionText: z.string().trim().min(12).max(4000),
  theme: z.string().trim().max(256).optional(),
  rationale: z.string().trim().max(4000).optional(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const idSchema = z.string().trim().min(1).max(256);
const PAID_RESEARCH_CONFIRMATION = "AUTORIZZO_RICERCA_ENTRO_IL_BUDGET_CONFIGURATO";

async function requireProfessionalQuestionAccess(procedimentoId: string) {
  const [user, tenantContext, procedimento] = await Promise.all([
    requireUserWithMfa(["ADMIN", "GIURIDICO"]),
    getCurrentTenantContext(),
    prisma.procedimento.findUnique({
      where: { id: procedimentoId },
      select: { id: true, enteId: true },
    }),
  ]);
  if (!tenantContext || !procedimento) throw new Error("PROCEDIMENTO_NOT_FOUND");
  requireTenantAccess(tenantContext, procedimento.enteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });
  return { user, tenantId: procedimento.enteId };
}

function parsedDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function refreshProcedimento(procedimentoId: string) {
  revalidatePath(`/procedimenti/${procedimentoId}`);
}

export async function createProfessionalLegalQuestionAction(formData: FormData) {
  const parsed = questionInputSchema.parse({
    procedimentoId: formData.get("procedimentoId"),
    questionText: formData.get("questionText"),
    theme: formData.get("theme") || undefined,
    rationale: formData.get("rationale") || undefined,
    referenceDate: formData.get("referenceDate"),
  });
  const access = await requireProfessionalQuestionAccess(parsed.procedimentoId);
  const question = await createProfessionalLegalQuestion({
    tenantId: access.tenantId,
    procedimentoId: parsed.procedimentoId,
    actorUserId: access.user.id,
    questionText: parsed.questionText,
    theme: parsed.theme,
    rationale: parsed.rationale,
    referenceDate: parsedDate(parsed.referenceDate),
  });
  await auditSuccess({
    azione: "PROFESSIONAL_LEGAL_QUESTION_CREATED",
    entita: "ProfessionalLegalQuestion",
    entitaId: question.id,
    enteId: access.tenantId,
    actor: {
      userId: access.user.id,
      userEmail: access.user.email,
      userRole: access.user.role,
    },
    metadata: { procedimentoId: parsed.procedimentoId, version: 1 },
  });
  refreshProcedimento(parsed.procedimentoId);
}

export async function reviseProfessionalLegalQuestionAction(formData: FormData) {
  const parsed = questionInputSchema.extend({ questionId: idSchema }).parse({
    procedimentoId: formData.get("procedimentoId"),
    questionId: formData.get("questionId"),
    questionText: formData.get("questionText"),
    theme: formData.get("theme") || undefined,
    rationale: formData.get("rationale") || undefined,
    referenceDate: formData.get("referenceDate"),
  });
  const access = await requireProfessionalQuestionAccess(parsed.procedimentoId);
  const version = await reviseProfessionalLegalQuestion({
    tenantId: access.tenantId,
    procedimentoId: parsed.procedimentoId,
    questionId: parsed.questionId,
    actorUserId: access.user.id,
    questionText: parsed.questionText,
    theme: parsed.theme,
    rationale: parsed.rationale,
    referenceDate: parsedDate(parsed.referenceDate),
  });
  await auditSuccess({
    azione: "PROFESSIONAL_LEGAL_QUESTION_REVISED",
    entita: "ProfessionalLegalQuestionVersion",
    entitaId: version.id,
    enteId: access.tenantId,
    actor: {
      userId: access.user.id,
      userEmail: access.user.email,
      userRole: access.user.role,
    },
    metadata: {
      procedimentoId: parsed.procedimentoId,
      questionId: parsed.questionId,
      version: version.version,
    },
  });
  refreshProcedimento(parsed.procedimentoId);
}

export async function approveProfessionalLegalQuestionVersionAction(formData: FormData) {
  const procedimentoId = idSchema.parse(formData.get("procedimentoId"));
  const versionId = idSchema.parse(formData.get("versionId"));
  const access = await requireProfessionalQuestionAccess(procedimentoId);
  const version = await approveProfessionalLegalQuestionVersion({
    tenantId: access.tenantId,
    procedimentoId,
    versionId,
    actorUserId: access.user.id,
  });
  await auditSuccess({
    azione: "PROFESSIONAL_LEGAL_QUESTION_APPROVED",
    entita: "ProfessionalLegalQuestionVersion",
    entitaId: version.id,
    enteId: access.tenantId,
    actor: {
      userId: access.user.id,
      userEmail: access.user.email,
      userRole: access.user.role,
    },
    metadata: { procedimentoId, questionId: version.questionId, version: version.version },
  });
  refreshProcedimento(procedimentoId);
}

export async function archiveProfessionalLegalQuestionAction(formData: FormData) {
  const procedimentoId = idSchema.parse(formData.get("procedimentoId"));
  const questionId = idSchema.parse(formData.get("questionId"));
  const access = await requireProfessionalQuestionAccess(procedimentoId);
  await archiveProfessionalLegalQuestion({
    tenantId: access.tenantId,
    procedimentoId,
    questionId,
  });
  await auditSuccess({
    azione: "PROFESSIONAL_LEGAL_QUESTION_ARCHIVED",
    entita: "ProfessionalLegalQuestion",
    entitaId: questionId,
    enteId: access.tenantId,
    actor: {
      userId: access.user.id,
      userEmail: access.user.email,
      userRole: access.user.role,
    },
    metadata: { procedimentoId },
  });
  refreshProcedimento(procedimentoId);
}

export async function startProfessionalLegalResearchAction(formData: FormData) {
  const procedimentoId = idSchema.parse(formData.get("procedimentoId"));
  const versionId = idSchema.parse(formData.get("versionId"));
  if (formData.get("paidResearchConfirmation") !== PAID_RESEARCH_CONFIRMATION) {
    throw new Error("PAID_RESEARCH_CONFIRMATION_REQUIRED");
  }
  const access = await requireProfessionalQuestionAccess(procedimentoId);
  const mission = await ensureProfessionalQuestionResearchMission({
    tenantId: access.tenantId,
    procedimentoId,
    versionId,
    actorUserId: access.user.id,
  });
  await prisma.researchMissionRecord.update({
    where: { id: mission.missionId },
    data: {
      assignedActorId: access.user.id,
      status: "PENDING",
      deferredAt: null,
    },
  });
  const admission = await ensureAutomaticResearchExecution({
    mission,
    tenantId: access.tenantId,
    actorId: access.user.id,
    correlationId: `professional-research:${randomUUID()}`,
  });
  if (admission.outcome !== "ADMITTED") {
    await prisma.researchMissionRecord.update({
      where: { id: mission.missionId },
      data: { status: "DEFERRED", deferredAt: new Date() },
    });
    await auditFailure({
      azione: "PROFESSIONAL_LEGAL_RESEARCH_AUTHORIZED",
      entita: "ResearchMissionRecord",
      entitaId: mission.missionId,
      enteId: access.tenantId,
      actor: {
        userId: access.user.id,
        userEmail: access.user.email,
        userRole: access.user.role,
      },
      metadata: {
        procedimentoId,
        versionId,
        requirementCode: admission.requirementCode,
      },
    });
    // The denial is audited above; inform the operator in-page instead of
    // failing the whole view through the error boundary.
    redirect(`/procedimenti/${encodeURIComponent(procedimentoId)}?section=research&researchNotice=${encodeURIComponent(admission.requirementCode ?? "PROFESSIONAL_RESEARCH_NOT_AUTHORIZED")}`);
  }
  const activation = await requestDocumentWorkerActivation({
    kind: "LEGAL_RESEARCH",
    procedimentoId,
  });
  await auditSuccess({
    azione: "PROFESSIONAL_LEGAL_RESEARCH_AUTHORIZED",
    entita: "ResearchMissionRecord",
    entitaId: mission.missionId,
    enteId: access.tenantId,
    actor: {
      userId: access.user.id,
      userEmail: access.user.email,
      userRole: access.user.role,
    },
    metadata: {
      procedimentoId,
      versionId,
      jobId: admission.jobId,
      activation: activation.outcome,
      budget: PROFESSIONAL_RESEARCH_BUDGET,
    },
  });
  refreshProcedimento(procedimentoId);
}

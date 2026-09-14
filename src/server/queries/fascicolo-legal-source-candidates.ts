import type { NeutralIntakeClassificationOutcome } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export interface FascicoloLegalSourceCandidate {
  id: string;
  originalName: string | null;
  mimeType: string;
  admittedAt: Date;
  classificationOutcome: NeutralIntakeClassificationOutcome;
  reviewRequired: boolean;
}

export async function getFascicoloLegalSourceCandidates(
  procedimentoId: string,
): Promise<FascicoloLegalSourceCandidate[]> {
  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    return [];
  }

  const procedimento = await prisma.procedimento.findUnique({
    where: { id: procedimentoId },
    select: { concessione: { select: { enteId: true } } },
  });
  const enteId = procedimento?.concessione.enteId ?? null;
  if (!enteId) {
    return [];
  }

  try {
    requireTenantAccess(tenantContext, enteId, {
      mode: "read",
      allowWhenEnteMissing: false,
    });
  } catch {
    return [];
  }

  const admissions = await prisma.legalSourceCandidateAdmission.findMany({
    where: {
      enteId,
      classificationOutcome: "LEGAL_SOURCE_CANDIDATE",
      neutralIntake: {
        enteId,
        status: "ROUTED",
        destination: { is: { procedimentoId } },
      },
    },
    orderBy: [{ admittedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      admittedAt: true,
      classificationOutcome: true,
      neutralIntake: {
        select: {
          originalName: true,
          mimeType: true,
        },
      },
      classificationAttempt: {
        select: {
          reviewRequired: true,
        },
      },
    },
  });

  return admissions.map((admission) => ({
    id: admission.id,
    originalName: admission.neutralIntake.originalName,
    mimeType: admission.neutralIntake.mimeType,
    admittedAt: admission.admittedAt,
    classificationOutcome: admission.classificationOutcome,
    reviewRequired: admission.classificationAttempt.reviewRequired,
  }));
}
import type {
  LegalSourceCandidateResolutionOutcome,
  NeutralIntakeClassificationOutcome,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export interface FascicoloLegalSourceCandidate {
  id: string;
  originalName: string | null;
  mimeType: string;
  admittedAt: Date;
  classificationOutcome: NeutralIntakeClassificationOutcome;
  reviewRequired: boolean;
  resolution: {
    outcome: LegalSourceCandidateResolutionOutcome;
    resolvedAt: Date;
    reviewNote: string | null;
    reviewedByEmail: string;
    reviewedByRole: string;
    legalSource: {
      id: string;
      stableKey: string;
      title: string;
      issuingBody: string | null;
      sourceNumber: string | null;
    } | null;
  } | null;
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
      resolution: {
        select: {
          outcome: true,
          resolvedAt: true,
          reviewNote: true,
          reviewedByEmail: true,
          reviewedByRole: true,
          legalSource: {
            select: {
              id: true,
              enteId: true,
              sourceKey: true,
              title: true,
              issuingBody: true,
              sourceNumber: true,
            },
          },
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
    resolution: admission.resolution
      ? {
          ...admission.resolution,
          legalSource: admission.resolution.legalSource
            && (admission.resolution.legalSource.enteId === null
              || admission.resolution.legalSource.enteId === enteId)
            ? {
                id: admission.resolution.legalSource.id,
                stableKey: admission.resolution.legalSource.sourceKey,
                title: admission.resolution.legalSource.title,
                issuingBody: admission.resolution.legalSource.issuingBody,
                sourceNumber: admission.resolution.legalSource.sourceNumber,
              }
            : null,
        }
      : null,
  }));
}
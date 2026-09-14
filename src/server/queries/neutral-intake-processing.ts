import type {
  NeutralIntakeClassificationConfidence,
  NeutralIntakeClassificationOutcome,
  NeutralIntakeStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";

export interface FascicoloProcessingItem {
  id: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  receivedAt: Date;
  status: Exclude<NeutralIntakeStatus, "ROUTED">;
  classification: {
    outcome: NeutralIntakeClassificationOutcome;
    confidence: NeutralIntakeClassificationConfidence;
    reviewRequired: boolean;
    classifiedAt: Date;
  } | null;
}

export async function getFascicoloProcessingItems(
  procedimentoId: string,
): Promise<FascicoloProcessingItem[]> {
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

  const destinations = await prisma.neutralIntakeDestination.findMany({
    where: {
      procedimentoId,
      neutralIntake: {
        enteId,
        status: { not: "ROUTED" },
      },
    },
    select: {
      neutralIntake: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          receivedAt: true,
          status: true,
          classificationAttempts: {
            orderBy: [{ classifiedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              outcome: true,
              confidence: true,
              reviewRequired: true,
              classifiedAt: true,
            },
          },
        },
      },
    },
  });

  return destinations
    .map(({ neutralIntake }) => ({
      id: neutralIntake.id,
      originalName: neutralIntake.originalName,
      mimeType: neutralIntake.mimeType,
      sizeBytes: neutralIntake.sizeBytes,
      receivedAt: neutralIntake.receivedAt,
      status: neutralIntake.status as FascicoloProcessingItem["status"],
      classification: neutralIntake.classificationAttempts[0] ?? null,
    }))
    .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime());
}
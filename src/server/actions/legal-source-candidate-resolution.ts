"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { canManageProcedimenti, getCurrentUser, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const inputSchema = z.object({
  admissionId: z.string().trim().min(1),
  procedimentoId: z.string().trim().min(1),
  outcome: z.enum(["LINKED", "NO_MATCH"]),
  legalSourceId: z.string().trim().min(1).optional(),
  reviewNote: z.string().trim().max(2000).optional(),
}).strict().superRefine((input, context) => {
  if (input.outcome === "LINKED" && !input.legalSourceId) {
    context.addIssue({ code: "custom", path: ["legalSourceId"], message: "Selezionare una fonte giuridica." });
  }
  if (input.outcome === "NO_MATCH" && input.legalSourceId) {
    context.addIssue({ code: "custom", path: ["legalSourceId"], message: "NO_MATCH non puo indicare una fonte." });
  }
});

const admissionContextSelect = {
  id: true,
  enteId: true,
  classificationOutcome: true,
  resolution: true,
  neutralIntake: {
    select: {
      enteId: true,
      status: true,
      destination: {
        select: {
          procedimentoId: true,
          procedimento: {
            select: {
              concessioneId: true,
              concessione: { select: { enteId: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.LegalSourceCandidateAdmissionSelect;

type AdmissionContext = Prisma.LegalSourceCandidateAdmissionGetPayload<{
  select: typeof admissionContextSelect;
}>;
type Resolution = NonNullable<AdmissionContext["resolution"]>;

export type ResolveLegalSourceCandidateResult =
  | { status: "CREATED" | "UNCHANGED"; resolution: Resolution }
  | { status: "CONFLICT"; message: string };

function getCanonicalContext(admission: AdmissionContext | null, procedimentoId: string) {
  const destination = admission?.neutralIntake.destination;
  const canonicalEnteId = destination?.procedimento.concessione.enteId ?? null;
  if (
    !admission
    || admission.classificationOutcome !== "LEGAL_SOURCE_CANDIDATE"
    || admission.neutralIntake.status !== "ROUTED"
    || !destination
    || destination.procedimentoId !== procedimentoId
    || !canonicalEnteId
    || admission.enteId !== canonicalEnteId
    || admission.neutralIntake.enteId !== canonicalEnteId
  ) {
    throw new Error("Candidato non disponibile o non coerente con il Fascicolo.");
  }

  return {
    canonicalEnteId,
    concessioneId: destination.procedimento.concessioneId,
  };
}

function isSameDecision(
  resolution: Pick<Resolution, "outcome" | "legalSourceId">,
  outcome: "LINKED" | "NO_MATCH",
  legalSourceId: string | null,
) {
  return resolution.outcome === outcome && resolution.legalSourceId === legalSourceId;
}

function conflictResult(): ResolveLegalSourceCandidateResult {
  return {
    status: "CONFLICT",
    message: "La verifica e gia stata registrata con un esito diverso.",
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function lockAdmission(tx: Prisma.TransactionClient, admissionId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "LegalSourceCandidateAdmission"
    WHERE "id" = ${admissionId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Candidato non disponibile o non coerente con il Fascicolo.");
  }
}

async function lockLegalSource(tx: Prisma.TransactionClient, legalSourceId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "LegalSource"
    WHERE "id" = ${legalSourceId}
    FOR SHARE
  `;
  if (rows.length !== 1) {
    throw new Error("Fonte giuridica non disponibile per questo tenant.");
  }
}

export async function resolveLegalSourceCandidate(
  input: z.input<typeof inputSchema>,
): Promise<ResolveLegalSourceCandidateResult> {
  const parsed = inputSchema.parse(input);
  const role = await requireRole();
  if (!canManageProcedimenti(role)) {
    throw new Error("Profilo non autorizzato alla verifica delle fonti candidate.");
  }

  const currentUser = await getCurrentUser();
  const tenantContext = await getCurrentTenantContext();
  if (!currentUser || !tenantContext) {
    throw new Error("Utente non autenticato.");
  }

  const admission = await prisma.legalSourceCandidateAdmission.findUnique({
    where: { id: parsed.admissionId },
    select: admissionContextSelect,
  });
  const { canonicalEnteId, concessioneId } = getCanonicalContext(admission, parsed.procedimentoId);
  requireTenantAccess(tenantContext, canonicalEnteId, {
    mode: "write",
    allowWhenEnteMissing: false,
  });

  const legalSourceId = parsed.outcome === "LINKED" ? parsed.legalSourceId ?? null : null;
  if (legalSourceId) {
    const legalSource = await prisma.legalSource.findUnique({
      where: { id: legalSourceId },
      select: { id: true, enteId: true },
    });
    if (!legalSource || (legalSource.enteId !== null && legalSource.enteId !== canonicalEnteId)) {
      throw new Error("Fonte giuridica non disponibile per questo tenant.");
    }
  }

  const reviewedByUserId = currentUser.id === STAGING_PREVIEW_ADMIN_ID ? null : currentUser.id;
  const reviewNote = parsed.reviewNote || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockAdmission(tx, parsed.admissionId);
      const lockedAdmission = await tx.legalSourceCandidateAdmission.findUnique({
        where: { id: parsed.admissionId },
        select: admissionContextSelect,
      });
      if (!lockedAdmission) {
        throw new Error("Candidato non disponibile o non coerente con il Fascicolo.");
      }
      const lockedContext = getCanonicalContext(lockedAdmission, parsed.procedimentoId);
      if (
        lockedContext.canonicalEnteId !== canonicalEnteId
        || lockedContext.concessioneId !== concessioneId
      ) {
        throw new Error("Candidato non disponibile o non coerente con il Fascicolo.");
      }

      if (legalSourceId) {
        await lockLegalSource(tx, legalSourceId);
        const lockedLegalSource = await tx.legalSource.findUnique({
          where: { id: legalSourceId },
          select: { id: true, enteId: true },
        });
        if (
          !lockedLegalSource
          || (lockedLegalSource.enteId !== null && lockedLegalSource.enteId !== canonicalEnteId)
        ) {
          throw new Error("Fonte giuridica non disponibile per questo tenant.");
        }
      }

      if (lockedAdmission.resolution) {
        return isSameDecision(lockedAdmission.resolution, parsed.outcome, legalSourceId)
          ? { status: "UNCHANGED" as const, resolution: lockedAdmission.resolution }
          : conflictResult();
      }

      const resolution = await tx.legalSourceCandidateResolution.create({
        data: {
          admissionId: parsed.admissionId,
          outcome: parsed.outcome,
          legalSourceId,
          reviewedByUserId,
          reviewedByActorId: currentUser.id,
          reviewedByEmail: currentUser.email,
          reviewedByRole: role,
          reviewNote,
        },
      });
      await createAuditLogInTransaction(tx, {
        azione: "LEGAL_SOURCE_CANDIDATE_RESOLUTION_CREATE",
        entita: "LegalSourceCandidateResolution",
        entitaId: resolution.id,
        enteId: canonicalEnteId,
        concessioneId,
        esito: "SUCCESS",
        actor: {
          userId: reviewedByUserId,
          userEmail: currentUser.email,
          userRole: role,
        },
        metadata: {
          admissionId: parsed.admissionId,
          procedimentoId: parsed.procedimentoId,
          outcome: parsed.outcome,
          legalSourceId,
          reviewNotePresent: reviewNote !== null,
          semanticMarker: "HUMAN_SOURCE_IDENTITY_VERIFICATION_NO_LEGAL_CONCLUSION",
        },
      });

      return { status: "CREATED" as const, resolution };
    });

    if (result.status !== "CONFLICT") {
      revalidatePath(`/procedimenti/${parsed.procedimentoId}`);
    }
    return result;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const concurrentResolution = await prisma.legalSourceCandidateResolution.findUnique({
      where: { admissionId: parsed.admissionId },
    });
    if (!concurrentResolution) {
      throw error;
    }
    if (!isSameDecision(concurrentResolution, parsed.outcome, legalSourceId)) {
      return conflictResult();
    }

    revalidatePath(`/procedimenti/${parsed.procedimentoId}`);
    return { status: "UNCHANGED", resolution: concurrentResolution };
  }
}
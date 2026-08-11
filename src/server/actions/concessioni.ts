"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  canManageConcessioneLegalClassification,
  getCurrentUser,
  requireRole,
} from "@/lib/auth";
import { PORT_ACTIVITY_LEGAL_TYPE_VALUES } from "@/lib/port-activity-legal-type";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess } from "@/lib/tenant-auth";
import { createAuditLogInTransaction } from "@/server/audit/auditLog";

const STAGING_PREVIEW_ADMIN_ID = "staging-preview-admin";

const updatePortActivityLegalTypeSchema = z.object({
  concessioneId: z.string().min(1),
  portActivityLegalType: z.union([z.enum(PORT_ACTIVITY_LEGAL_TYPE_VALUES), z.literal("")])
    .transform((value) => value || null),
});

export async function updateConcessionePortActivityLegalType(formData: FormData) {
  const role = await requireRole();
  if (!canManageConcessioneLegalClassification(role)) {
    throw new Error("Profilo non autorizzato alla classificazione giuridica dell attività portuale.");
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error("Utente non autenticato.");
  }

  const parsed = updatePortActivityLegalTypeSchema.parse({
    concessioneId: formData.get("concessioneId"),
    portActivityLegalType: formData.get("portActivityLegalType"),
  });

  const tenantContext = await getCurrentTenantContext();
  if (!tenantContext) {
    throw new Error("Contesto tenant non disponibile.");
  }

  const authorizedConcessione = await requireConcessioneTenantAccess(
    tenantContext,
    parsed.concessioneId,
    { mode: "write", allowWhenEnteMissing: false },
  );
  if (!authorizedConcessione.enteId) {
    throw new Error("Tenant concessione non disponibile.");
  }

  const actorUserId = currentUser.id === STAGING_PREVIEW_ADMIN_ID ? null : currentUser.id;
  const changed = await prisma.$transaction(async (tx) => {
    const current = await tx.concessione.findUnique({
      where: { id: authorizedConcessione.id },
      select: { portActivityLegalType: true, enteId: true },
    });
    if (!current || current.enteId !== authorizedConcessione.enteId) {
      throw new Error("Concessione non disponibile per il tenant autorizzato.");
    }

    const previousValue = current.portActivityLegalType;
    if (previousValue === parsed.portActivityLegalType) {
      return false;
    }

    const result = await tx.concessione.updateMany({
      where: {
        id: authorizedConcessione.id,
        enteId: authorizedConcessione.enteId,
        portActivityLegalType: previousValue,
      },
      data: { portActivityLegalType: parsed.portActivityLegalType },
    });
    if (result.count !== 1) {
      throw new Error("Classificazione modificata da un altro operatore. Ricaricare e riprovare.");
    }

    await createAuditLogInTransaction(tx, {
      azione: "CONCESSIONE_PORT_ACTIVITY_LEGAL_TYPE_UPDATE",
      entita: "Concessione",
      entitaId: authorizedConcessione.id,
      enteId: authorizedConcessione.enteId,
      concessioneId: authorizedConcessione.id,
      esito: "SUCCESS",
      actor: { userId: actorUserId, userEmail: currentUser.email, userRole: role },
      metadata: {
        previousValue,
        newValue: parsed.portActivityLegalType,
        meaning: "classificazione istruttoria umana",
      },
    });
    return true;
  });

  if (!changed) return;
  revalidatePath(`/concessioni/${authorizedConcessione.id}`);
}
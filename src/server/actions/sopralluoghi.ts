"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageSopralluoghi, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireConcessioneTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { SOPRALLUOGO_ESITO_VALUES } from "@/server/queries/sopralluoghi";

const createSopralluogoSchema = z.object({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  data: z.string().min(1, "Inserisci la data del sopralluogo."),
  operatori: z.string().trim().min(2, "Inserisci almeno un operatore."),
  esito: z.enum(SOPRALLUOGO_ESITO_VALUES, { message: "Esito non valido." }),
  conformitaPlanimetrica: z.enum(["SI", "NO"], { message: "Valore conformità non valido." }),
  statoManutentivo: z.string().trim().optional(),
  sicurezza: z.string().trim().optional(),
  occupazione: z.string().trim().optional(),
  interferenze: z.string().trim().optional(),
  descrizione: z.string().trim().optional(),
});

function toDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data sopralluogo non valida.");
  }
  return parsed;
}

function toNullable(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createSopralluogoAction(formData: FormData) {
  const role = await requireRole();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Sopralluogo",
      actor: { userRole: role },
      metadata: {
        actionType: "SOPRALLUOGO_CREATE",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManageSopralluoghi(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Sopralluogo",
      actor: { userRole: role },
      metadata: {
        actionType: "SOPRALLUOGO_CREATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato alla gestione dei sopralluoghi.");
  }

  const parsed = createSopralluogoSchema.safeParse({
    concessioneId: formData.get("concessioneId"),
    data: formData.get("data"),
    operatori: formData.get("operatori"),
    esito: formData.get("esito"),
    conformitaPlanimetrica: formData.get("conformitaPlanimetrica"),
    statoManutentivo: formData.get("statoManutentivo")?.toString(),
    sicurezza: formData.get("sicurezza")?.toString(),
    occupazione: formData.get("occupazione")?.toString(),
    interferenze: formData.get("interferenze")?.toString(),
    descrizione: formData.get("descrizione")?.toString(),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "SOPRALLUOGO_CREATE",
      entita: "Sopralluogo",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    try {
      await requireConcessioneTenantAccess(tenantContext, parsed.data.concessioneId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Sopralluogo",
        concessioneId: parsed.data.concessioneId,
        actor: { userRole: role },
        metadata: {
          actionType: "SOPRALLUOGO_CREATE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  const created = await prisma.sopralluogo.create({
    data: {
      concessioneId: parsed.data.concessioneId,
      data: toDate(parsed.data.data),
      operatori: parsed.data.operatori,
      esito: parsed.data.esito,
      conformitaPlanimetrica: parsed.data.conformitaPlanimetrica === "SI",
      statoManutentivo: toNullable(parsed.data.statoManutentivo),
      sicurezza: toNullable(parsed.data.sicurezza),
      occupazione: toNullable(parsed.data.occupazione),
      interferenze: toNullable(parsed.data.interferenze),
      descrizione: toNullable(parsed.data.descrizione),
    },
    select: {
      id: true,
      concessioneId: true,
    },
  });

  await auditSuccess({
    azione: "SOPRALLUOGO_CREATE",
    entita: "Sopralluogo",
    entitaId: created.id,
    concessioneId: created.concessioneId,
    actor: { userRole: role },
    metadata: {
      esito: parsed.data.esito,
      conformitaPlanimetrica: parsed.data.conformitaPlanimetrica,
      changedFields: [
        "data",
        "operatori",
        "esito",
        "conformitaPlanimetrica",
        "statoManutentivo",
        "sicurezza",
        "occupazione",
        "interferenze",
      ],
    },
  });

  revalidatePath("/sopralluoghi");
  revalidatePath(`/sopralluoghi/${created.id}`);
  revalidatePath(`/concessioni/${created.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/sopralluoghi/${created.id}`);
}

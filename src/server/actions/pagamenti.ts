"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManagePagamenti, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantContext, requireTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import { PAGAMENTO_STATO_VALUES } from "@/server/queries/pagamenti";

const updatePagamentoSchema = z.object({
  id: z.string().min(1),
  importoVersato: z.coerce.number().nonnegative("L'importo versato non può essere negativo."),
  dataVersamento: z.string().optional(),
  stato: z.enum(PAGAMENTO_STATO_VALUES, { message: "Stato pagamento non valido." }),
  interessiMora: z.string().optional(),
  note: z.string().trim().optional(),
});

function toNullableDate(value: string | undefined): Date | null {
  if (!value || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data versamento non valida.");
  }
  return parsed;
}

function toNullableNumber(value: string | undefined): number | null {
  if (!value || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Interessi mora non validi.");
  }

  return parsed;
}

function toOptional(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function updatePagamentoAction(formData: FormData) {
  const role = await requireRole();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Pagamento",
      actor: { userRole: role },
      metadata: {
        actionType: "PAGAMENTO_UPDATE",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManagePagamenti(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Pagamento",
      actor: { userRole: role },
      metadata: {
        actionType: "PAGAMENTO_UPDATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato alla gestione dei pagamenti.");
  }

  const parsed = updatePagamentoSchema.safeParse({
    id: formData.get("id"),
    importoVersato: formData.get("importoVersato"),
    dataVersamento: formData.get("dataVersamento")?.toString(),
    stato: formData.get("stato"),
    interessiMora: formData.get("interessiMora")?.toString(),
    note: formData.get("note")?.toString(),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "PAGAMENTO_UPDATE",
      entita: "Pagamento",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.pagamento.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      concessioneId: true,
      concessione: {
        select: {
          enteId: true,
        },
      },
    },
  });

  if (!existing) {
    await auditFailure({
      azione: "PAGAMENTO_UPDATE",
      entita: "Pagamento",
      entitaId: parsed.data.id,
      actor: { userRole: role },
      metadata: {
        reason: "NOT_FOUND",
      },
    });
    throw new Error("Pagamento non trovato.");
  }

  const tenantContext = await getCurrentTenantContext();
  if (tenantContext) {
    try {
      requireTenantAccess(tenantContext, existing.concessione.enteId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Pagamento",
        entitaId: existing.id,
        concessioneId: existing.concessioneId,
        enteId: existing.concessione.enteId,
        actor: { userRole: role },
        metadata: {
          actionType: "PAGAMENTO_UPDATE",
          reason: "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  await prisma.pagamento.update({
    where: { id: existing.id },
    data: {
      importoVersato: parsed.data.importoVersato,
      dataVersamento: toNullableDate(parsed.data.dataVersamento),
      stato: parsed.data.stato,
      interessiMora: toNullableNumber(parsed.data.interessiMora),
      note: toOptional(parsed.data.note),
    },
  });

  await auditSuccess({
    azione: "PAGAMENTO_UPDATE",
    entita: "Pagamento",
    entitaId: existing.id,
    concessioneId: existing.concessioneId,
    actor: { userRole: role },
    metadata: {
      stato: parsed.data.stato,
      importoVersato: parsed.data.importoVersato,
      changedFields: ["importoVersato", "dataVersamento", "stato", "interessiMora", "note"],
    },
  });

  revalidatePath("/pagamenti");
  revalidatePath(`/pagamenti/${existing.id}`);
  revalidatePath(`/concessioni/${existing.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/pagamenti/${existing.id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManagePagamenti, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    redirect("/adsp");
  }

  if (!canManagePagamenti(role)) {
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
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.pagamento.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, concessioneId: true },
  });

  if (!existing) {
    throw new Error("Pagamento non trovato.");
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

  await prisma.activityLog.create({
    data: {
      concessioneId: existing.concessioneId,
      azione: "AGGIORNAMENTO_PAGAMENTO",
      entita: "Pagamento",
      entitaId: existing.id,
      descrizione: "Aggiornata posizione pagamento in workflow demo.",
    },
  });

  revalidatePath("/pagamenti");
  revalidatePath(`/pagamenti/${existing.id}`);
  revalidatePath(`/concessioni/${existing.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/pagamenti/${existing.id}`);
}

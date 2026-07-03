"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canValidateReport, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const toggleReportValidationSchema = z.object({
  id: z.string().min(1),
  validato: z.enum(["SI", "NO"], { message: "Valore validazione non valido." }),
});

export async function toggleReportValidationAction(formData: FormData) {
  const role = await requireRole();

  if (role === "VIEWER_ADSP") {
    redirect("/adsp");
  }

  if (!canValidateReport(role)) {
    throw new Error("Profilo non autorizzato alla validazione dei report.");
  }

  const parsed = toggleReportValidationSchema.safeParse({
    id: formData.get("id"),
    validato: formData.get("validato"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.report.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, concessioneId: true },
  });

  if (!existing) {
    throw new Error("Report non trovato.");
  }

  await prisma.report.update({
    where: { id: existing.id },
    data: {
      validato: parsed.data.validato === "SI",
    },
  });

  await prisma.activityLog.create({
    data: {
      concessioneId: existing.concessioneId,
      azione: parsed.data.validato === "SI" ? "VALIDAZIONE_REPORT" : "RIMOZIONE_VALIDAZIONE_REPORT",
      entita: "Report",
      entitaId: existing.id,
      descrizione:
        parsed.data.validato === "SI"
          ? "Report validato in workflow demo."
          : "Validazione report rimossa in workflow demo.",
    },
  });

  revalidatePath("/report");
  revalidatePath(`/report/${existing.id}`);
  if (existing.concessioneId) {
    revalidatePath(`/concessioni/${existing.concessioneId}`);
  }
  revalidatePath("/dashboard");
  redirect(`/report/${existing.id}`);
}

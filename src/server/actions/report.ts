"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canValidateReport, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";

const toggleReportValidationSchema = z.object({
  id: z.string().min(1),
  validato: z.enum(["SI", "NO"], { message: "Valore validazione non valido." }),
});

export async function toggleReportValidationAction(formData: FormData) {
  const role = await requireRole();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Report",
      actor: { userRole: role },
      metadata: {
        actionType: "REPORT_TOGGLE_VALIDATION",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canValidateReport(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Report",
      actor: { userRole: role },
      metadata: {
        actionType: "REPORT_TOGGLE_VALIDATION",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato alla validazione dei report.");
  }

  const parsed = toggleReportValidationSchema.safeParse({
    id: formData.get("id"),
    validato: formData.get("validato"),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "REPORT_TOGGLE_VALIDATION",
      entita: "Report",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.report.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, concessioneId: true },
  });

  if (!existing) {
    await auditFailure({
      azione: "REPORT_TOGGLE_VALIDATION",
      entita: "Report",
      entitaId: parsed.data.id,
      actor: { userRole: role },
      metadata: {
        reason: "NOT_FOUND",
      },
    });
    throw new Error("Report non trovato.");
  }

  await prisma.report.update({
    where: { id: existing.id },
    data: {
      validato: parsed.data.validato === "SI",
    },
  });

  await auditSuccess({
    azione: parsed.data.validato === "SI" ? "REPORT_VALIDATE" : "REPORT_UNVALIDATE",
    entita: "Report",
    entitaId: existing.id,
    concessioneId: existing.concessioneId,
    actor: { userRole: role },
    metadata: {
      validato: parsed.data.validato === "SI",
      changedFields: ["validato"],
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

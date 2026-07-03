"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { canManageProcedimenti, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  PROCEDIMENTO_STATO_VALUES,
  PROCEDIMENTO_TIPOLOGIA_VALUES,
} from "@/server/queries/procedimenti";

const createProcedimentoSchema = z.object({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  criticitaId: z.string().optional(),
  tipologia: z.enum(PROCEDIMENTO_TIPOLOGIA_VALUES, { message: "Tipologia procedimento non valida." }),
  stato: z.enum(PROCEDIMENTO_STATO_VALUES, { message: "Stato procedimento non valido." }),
  riferimentoNormativo: z.string().trim().optional(),
  dataAvvio: z.string().optional(),
  dataScadenzaContraddittorio: z.string().optional(),
  noteIstruttorie: z.string().trim().optional(),
});

function toDate(value: string | undefined): Date | null {
  if (!value || value.trim() === "") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data non valida nel procedimento.");
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

export async function createProcedimentoAction(formData: FormData) {
  const role = await requireRole();

  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CREATE",
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManageProcedimenti(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        actionType: "PROCEDIMENTO_CREATE",
        reason: "ROLE_NOT_ALLOWED",
      },
    });
    throw new Error("Profilo non autorizzato alla gestione dei procedimenti.");
  }

  const parsed = createProcedimentoSchema.safeParse({
    concessioneId: formData.get("concessioneId"),
    criticitaId: formData.get("criticitaId")?.toString(),
    tipologia: formData.get("tipologia"),
    stato: formData.get("stato"),
    riferimentoNormativo: formData.get("riferimentoNormativo")?.toString(),
    dataAvvio: formData.get("dataAvvio")?.toString(),
    dataScadenzaContraddittorio: formData.get("dataScadenzaContraddittorio")?.toString(),
    noteIstruttorie: formData.get("noteIstruttorie")?.toString(),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "PROCEDIMENTO_CREATE",
      entita: "Procedimento",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const criticitaId = parsed.data.criticitaId?.trim() ? parsed.data.criticitaId : null;

  if (criticitaId) {
    const linked = await prisma.criticita.findUnique({
      where: { id: criticitaId },
      select: { concessioneId: true },
    });

    if (!linked || linked.concessioneId !== parsed.data.concessioneId) {
      await auditFailure({
        azione: "PROCEDIMENTO_CREATE",
        entita: "Procedimento",
        concessioneId: parsed.data.concessioneId,
        actor: { userRole: role },
        metadata: {
          reason: "CRITICITA_CONCESSIONE_MISMATCH",
          criticitaId,
        },
      });
      throw new Error("La criticità selezionata non appartiene alla concessione indicata.");
    }
  }

  const created = await prisma.procedimento.create({
    data: {
      concessioneId: parsed.data.concessioneId,
      criticitaId,
      tipologia: parsed.data.tipologia,
      stato: parsed.data.stato,
      riferimentoNormativo: toNullable(parsed.data.riferimentoNormativo),
      dataAvvio: toDate(parsed.data.dataAvvio),
      dataScadenzaContraddittorio: toDate(parsed.data.dataScadenzaContraddittorio),
      noteIstruttorie: toNullable(parsed.data.noteIstruttorie),
    },
    select: {
      id: true,
      concessioneId: true,
    },
  });

  await auditSuccess({
    azione: "PROCEDIMENTO_CREATE",
    entita: "Procedimento",
    entitaId: created.id,
    concessioneId: created.concessioneId,
    actor: { userRole: role },
    metadata: {
      tipologia: parsed.data.tipologia,
      stato: parsed.data.stato,
      criticitaId,
      hasContraddittorioDate: Boolean(parsed.data.dataScadenzaContraddittorio),
    },
  });

  revalidatePath("/procedimenti");
  revalidatePath(`/procedimenti/${created.id}`);
  revalidatePath(`/concessioni/${created.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/procedimenti/${created.id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  canManageCriticita,
  requireRole,
  type DemoRole,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CRITICITA_FONTE_VALUES,
  CRITICITA_GRAVITA_VALUES,
  CRITICITA_STATO_VALUES,
  CRITICITA_TIPOLOGIA_VALUES,
} from "@/server/queries/criticita";

const createCriticitaSchema = z.object({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  tipologia: z.enum(CRITICITA_TIPOLOGIA_VALUES, { message: "Tipologia non valida." }),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
  fonte: z.enum(CRITICITA_FONTE_VALUES, { message: "Fonte non valida." }),
  descrizione: z.string().trim().min(10, "Inserisci una descrizione più dettagliata."),
  noteIstruttorie: z.string().trim().optional(),
});

const updateCriticitaSchema = z.object({
  id: z.string().min(1),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
  stato: z.enum(CRITICITA_STATO_VALUES, { message: "Stato non valido." }),
  descrizione: z.string().trim().min(10, "Inserisci una descrizione più dettagliata."),
  noteIstruttorie: z.string().trim().optional(),
});

const tecnicoTipologie = new Set([
  "TECNICA",
  "MANUTENTIVA",
  "SICUREZZA",
  "OCCUPAZIONE_DIFFORME",
  "USO_NON_CONFORME",
]);

const economicoTipologie = new Set(["ECONOMICA", "MOROSITA"]);

function toOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function ensureCanWriteCriticita(role: DemoRole) {
  if (role === "VIEWER_ADSP") {
    redirect("/adsp");
  }

  if (!canManageCriticita(role)) {
    throw new Error("Profilo non autorizzato alla gestione delle criticità.");
  }
}

function ensureTipologiaByRole(role: DemoRole, tipologia: string) {
  if (role === "TECNICO" && !tecnicoTipologie.has(tipologia)) {
    throw new Error("Il profilo Tecnico può gestire solo criticità tecniche.");
  }

  if (role === "ECONOMICO" && !economicoTipologie.has(tipologia)) {
    throw new Error("Il profilo Economico può gestire solo criticità economiche o morosità.");
  }
}

export async function createCriticitaAction(formData: FormData) {
  const role = await requireRole();
  ensureCanWriteCriticita(role);

  const parsed = createCriticitaSchema.safeParse({
    concessioneId: formData.get("concessioneId"),
    tipologia: formData.get("tipologia"),
    gravita: formData.get("gravita"),
    fonte: formData.get("fonte"),
    descrizione: formData.get("descrizione"),
    noteIstruttorie: toOptional(formData.get("noteIstruttorie")?.toString()),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  ensureTipologiaByRole(role, parsed.data.tipologia);

  const created = await prisma.criticita.create({
    data: {
      concessioneId: parsed.data.concessioneId,
      tipologia: parsed.data.tipologia,
      gravita: parsed.data.gravita,
      fonte: parsed.data.fonte,
      descrizione: parsed.data.descrizione,
      azioneConsigliata: parsed.data.noteIstruttorie,
      stato: "APERTA",
      dataUltimoAggiornamento: new Date(),
    },
    select: {
      id: true,
      concessioneId: true,
    },
  });

  await prisma.activityLog.create({
    data: {
      concessioneId: created.concessioneId,
      azione: "CREAZIONE_CRITICITA",
      entita: "Criticita",
      entitaId: created.id,
      descrizione: "Creata nuova criticità in workflow demo.",
    },
  });

  revalidatePath("/criticita");
  revalidatePath(`/criticita/${created.id}`);
  revalidatePath(`/concessioni/${created.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/criticita/${created.id}`);
}

export async function updateCriticitaAction(formData: FormData) {
  const role = await requireRole();
  ensureCanWriteCriticita(role);

  const parsed = updateCriticitaSchema.safeParse({
    id: formData.get("id"),
    gravita: formData.get("gravita"),
    stato: formData.get("stato"),
    descrizione: formData.get("descrizione"),
    noteIstruttorie: toOptional(formData.get("noteIstruttorie")?.toString()),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.criticita.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, concessioneId: true, tipologia: true },
  });

  if (!existing) {
    throw new Error("Criticità non trovata.");
  }

  ensureTipologiaByRole(role, existing.tipologia);

  await prisma.criticita.update({
    where: { id: parsed.data.id },
    data: {
      gravita: parsed.data.gravita,
      stato: parsed.data.stato,
      descrizione: parsed.data.descrizione,
      azioneConsigliata: parsed.data.noteIstruttorie,
      dataUltimoAggiornamento: new Date(),
    },
  });

  await prisma.activityLog.create({
    data: {
      concessioneId: existing.concessioneId,
      azione: "AGGIORNAMENTO_CRITICITA",
      entita: "Criticita",
      entitaId: existing.id,
      descrizione: "Aggiornata criticità in workflow demo.",
    },
  });

  revalidatePath("/criticita");
  revalidatePath(`/criticita/${existing.id}`);
  revalidatePath(`/concessioni/${existing.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/criticita/${existing.id}`);
}

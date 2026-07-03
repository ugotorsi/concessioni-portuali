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
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  CRITICITA_ART47_LETTERA_VALUES,
  CRITICITA_FONTE_VALUES,
  CRITICITA_GRAVITA_VALUES,
  CRITICITA_RISCHIO_DECADENZA_VALUES,
  CRITICITA_STATO_VALUES,
  CRITICITA_TIPOLOGIA_VALUES,
} from "@/server/queries/criticita";

const baseCriticitaSchema = z
  .object({
    descrizione: z.string().trim().min(10, "Inserisci una descrizione più dettagliata."),
    noteIstruttorie: z.string().trim().optional(),
    rilevanzaArt47: z.enum(["true", "false"]).transform((value) => value === "true"),
    letteraArt47: z.enum(CRITICITA_ART47_LETTERA_VALUES).optional(),
    rischioDecadenza: z.enum(CRITICITA_RISCHIO_DECADENZA_VALUES).optional(),
    motivazioneArt47: z.string().trim().optional(),
    azioneIstruttoriaArt47: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.rilevanzaArt47) {
      return;
    }

    if (!value.letteraArt47) {
      ctx.addIssue({
        code: "custom",
        message: "Se art. 47 e rilevante seleziona la lettera applicabile.",
        path: ["letteraArt47"],
      });
    }

    if (!value.rischioDecadenza) {
      ctx.addIssue({
        code: "custom",
        message: "Se art. 47 e rilevante seleziona il livello di rischio.",
        path: ["rischioDecadenza"],
      });
    }

    if (!value.motivazioneArt47 || value.motivazioneArt47.length < 10) {
      ctx.addIssue({
        code: "custom",
        message: "Inserisci una motivazione art. 47 di almeno 10 caratteri.",
        path: ["motivazioneArt47"],
      });
    }
  });

const createCriticitaSchema = baseCriticitaSchema.extend({
  concessioneId: z.string().min(1, "Seleziona una concessione."),
  tipologia: z.enum(CRITICITA_TIPOLOGIA_VALUES, { message: "Tipologia non valida." }),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
  fonte: z.enum(CRITICITA_FONTE_VALUES, { message: "Fonte non valida." }),
});

const updateCriticitaSchema = baseCriticitaSchema.extend({
  id: z.string().min(1),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravità non valida." }),
  stato: z.enum(CRITICITA_STATO_VALUES, { message: "Stato non valido." }),
});

const tecnicoTipologie = new Set([
  "TECNICA",
  "MANUTENTIVA",
  "SICUREZZA",
  "OCCUPAZIONE_DIFFORME",
  "USO_NON_CONFORME",
]);

const economicoTipologie = new Set(["ECONOMICA", "MOROSITA"]);

type Art47LetteraValue = (typeof CRITICITA_ART47_LETTERA_VALUES)[number];
type RischioDecadenzaValue = (typeof CRITICITA_RISCHIO_DECADENZA_VALUES)[number];

function toOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizeArt47Fields(input: {
  rilevanzaArt47: boolean;
  letteraArt47?: Art47LetteraValue;
  rischioDecadenza?: RischioDecadenzaValue;
  motivazioneArt47?: string;
  azioneIstruttoriaArt47?: string;
}) {
  if (!input.rilevanzaArt47) {
    return {
      rilevanzaArt47: false,
      letteraArt47: null,
      rischioDecadenza: null,
      motivazioneArt47: null,
      azioneIstruttoriaArt47: null,
    };
  }

  return {
    rilevanzaArt47: true,
    letteraArt47: input.letteraArt47 ?? null,
    rischioDecadenza: input.rischioDecadenza ?? null,
    motivazioneArt47: input.motivazioneArt47 ?? null,
    azioneIstruttoriaArt47: input.azioneIstruttoriaArt47 ?? null,
  };
}

async function ensureCanWriteCriticita(role: DemoRole, actionType: string) {
  if (role === "VIEWER_ADSP") {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Criticita",
      actor: { userRole: role },
      metadata: {
        actionType,
        reason: "VIEWER_ADSP_BLOCKED",
      },
    });
    redirect("/adsp");
  }

  if (!canManageCriticita(role)) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Criticita",
      actor: { userRole: role },
      metadata: {
        actionType,
        reason: "ROLE_NOT_ALLOWED",
      },
    });
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
  await ensureCanWriteCriticita(role, "CRITICITA_CREATE");

  const parsed = createCriticitaSchema.safeParse({
    concessioneId: formData.get("concessioneId"),
    tipologia: formData.get("tipologia"),
    gravita: formData.get("gravita"),
    fonte: formData.get("fonte"),
    descrizione: formData.get("descrizione"),
    noteIstruttorie: toOptional(formData.get("noteIstruttorie")?.toString()),
    rilevanzaArt47: formData.get("rilevanzaArt47") ?? "false",
    letteraArt47: toOptional(formData.get("letteraArt47")?.toString()),
    rischioDecadenza: toOptional(formData.get("rischioDecadenza")?.toString()),
    motivazioneArt47: toOptional(formData.get("motivazioneArt47")?.toString()),
    azioneIstruttoriaArt47: toOptional(formData.get("azioneIstruttoriaArt47")?.toString()),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "CRITICITA_CREATE",
      entita: "Criticita",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  try {
    ensureTipologiaByRole(role, parsed.data.tipologia);
  } catch (error) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Criticita",
      concessioneId: parsed.data.concessioneId,
      actor: { userRole: role },
      metadata: {
        actionType: "CRITICITA_CREATE",
        reason: error instanceof Error ? error.message : "TIPOLOGIA_NOT_ALLOWED",
        tipologia: parsed.data.tipologia,
      },
    });
    throw error;
  }

  const created = await prisma.criticita.create({
    data: {
      concessioneId: parsed.data.concessioneId,
      tipologia: parsed.data.tipologia,
      gravita: parsed.data.gravita,
      fonte: parsed.data.fonte,
      descrizione: parsed.data.descrizione,
      azioneConsigliata: parsed.data.noteIstruttorie,
      ...normalizeArt47Fields(parsed.data),
      stato: "APERTA",
      dataUltimoAggiornamento: new Date(),
    },
    select: {
      id: true,
      concessioneId: true,
    },
  });

  await auditSuccess({
    azione: "CRITICITA_CREATE",
    entita: "Criticita",
    entitaId: created.id,
    concessioneId: created.concessioneId,
    actor: { userRole: role },
    metadata: {
      tipologia: parsed.data.tipologia,
      gravita: parsed.data.gravita,
      fonte: parsed.data.fonte,
      stato: "APERTA",
      rilevanzaArt47: parsed.data.rilevanzaArt47,
      letteraArt47: parsed.data.letteraArt47 ?? null,
      rischioDecadenza: parsed.data.rischioDecadenza ?? null,
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
  await ensureCanWriteCriticita(role, "CRITICITA_UPDATE");

  const parsed = updateCriticitaSchema.safeParse({
    id: formData.get("id"),
    gravita: formData.get("gravita"),
    stato: formData.get("stato"),
    descrizione: formData.get("descrizione"),
    noteIstruttorie: toOptional(formData.get("noteIstruttorie")?.toString()),
    rilevanzaArt47: formData.get("rilevanzaArt47") ?? "false",
    letteraArt47: toOptional(formData.get("letteraArt47")?.toString()),
    rischioDecadenza: toOptional(formData.get("rischioDecadenza")?.toString()),
    motivazioneArt47: toOptional(formData.get("motivazioneArt47")?.toString()),
    azioneIstruttoriaArt47: toOptional(formData.get("azioneIstruttoriaArt47")?.toString()),
  });

  if (!parsed.success) {
    await auditFailure({
      azione: "CRITICITA_UPDATE",
      entita: "Criticita",
      actor: { userRole: role },
      metadata: {
        reason: "VALIDATION_ERROR",
        issue: parsed.error.issues[0]?.message ?? "Dati non validi.",
      },
    });
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi.");
  }

  const existing = await prisma.criticita.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, concessioneId: true, tipologia: true },
  });

  if (!existing) {
    await auditFailure({
      azione: "CRITICITA_UPDATE",
      entita: "Criticita",
      entitaId: parsed.data.id,
      actor: { userRole: role },
      metadata: {
        reason: "NOT_FOUND",
      },
    });
    throw new Error("Criticità non trovata.");
  }

  try {
    ensureTipologiaByRole(role, existing.tipologia);
  } catch (error) {
    await auditFailure({
      azione: "AUTHZ_DENIED",
      entita: "Criticita",
      entitaId: existing.id,
      concessioneId: existing.concessioneId,
      actor: { userRole: role },
      metadata: {
        actionType: "CRITICITA_UPDATE",
        reason: error instanceof Error ? error.message : "TIPOLOGIA_NOT_ALLOWED",
        tipologia: existing.tipologia,
      },
    });
    throw error;
  }

  await prisma.criticita.update({
    where: { id: parsed.data.id },
    data: {
      gravita: parsed.data.gravita,
      stato: parsed.data.stato,
      descrizione: parsed.data.descrizione,
      azioneConsigliata: parsed.data.noteIstruttorie,
      ...normalizeArt47Fields(parsed.data),
      dataUltimoAggiornamento: new Date(),
    },
  });

  await auditSuccess({
    azione: "CRITICITA_UPDATE",
    entita: "Criticita",
    entitaId: existing.id,
    concessioneId: existing.concessioneId,
    actor: { userRole: role },
    metadata: {
      gravita: parsed.data.gravita,
      stato: parsed.data.stato,
      rilevanzaArt47: parsed.data.rilevanzaArt47,
      letteraArt47: parsed.data.letteraArt47 ?? null,
      rischioDecadenza: parsed.data.rischioDecadenza ?? null,
      changedFields: [
        "gravita",
        "stato",
        "descrizione",
        "azioneConsigliata",
        "rilevanzaArt47",
        "letteraArt47",
        "rischioDecadenza",
        "motivazioneArt47",
        "azioneIstruttoriaArt47",
      ],
    },
  });

  revalidatePath("/criticita");
  revalidatePath(`/criticita/${existing.id}`);
  revalidatePath(`/concessioni/${existing.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/criticita/${existing.id}`);
}

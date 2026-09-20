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
import { getCurrentTenantContext, requireConcessioneTenantAccess } from "@/lib/tenant-auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  buildCriticitaCreateData,
  buildCriticitaInstructionData,
  createCriticitaSchema,
  criticitaInstructionSchema,
  ensureTipologiaByRole,
  toOptional,
} from "@/server/criticita/criticitaDomain";
import {
  CRITICITA_GRAVITA_VALUES,
  CRITICITA_STATO_VALUES,
} from "@/server/queries/criticita";

const updateCriticitaSchema = criticitaInstructionSchema.extend({
  id: z.string().min(1),
  gravita: z.enum(CRITICITA_GRAVITA_VALUES, { message: "Gravit… non valida." }),
  stato: z.enum(CRITICITA_STATO_VALUES, { message: "Stato non valido." }),
});
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
    throw new Error("Profilo non autorizzato alla gestione delle criticit….");
  }
}

export async function createCriticitaAction(formData: FormData) {
  const role = await requireRole();
  const tenantContext = await getCurrentTenantContext();
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
    regolarizzata: formData.get("regolarizzata") ?? "false",
    dataRegolarizzazione: toOptional(formData.get("dataRegolarizzazione")?.toString()),
    descrizioneRegolarizzazione: toOptional(formData.get("descrizioneRegolarizzazione")?.toString()),
    esitoRegolarizzazione: toOptional(formData.get("esitoRegolarizzazione")?.toString()),
    verificataRegolarizzazione: formData.get("verificataRegolarizzazione") ?? "false",
    dataVerificaRegolarizzazione: toOptional(formData.get("dataVerificaRegolarizzazione")?.toString()),
    noteVerificaRegolarizzazione: toOptional(formData.get("noteVerificaRegolarizzazione")?.toString()),
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

  if (tenantContext) {
    try {
      await requireConcessioneTenantAccess(tenantContext, parsed.data.concessioneId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Criticita",
        concessioneId: parsed.data.concessioneId,
        actor: { userRole: role },
        metadata: {
          actionType: "CRITICITA_CREATE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  const created = await prisma.criticita.create({
    data: buildCriticitaCreateData(parsed.data, {
      concessioneId: parsed.data.concessioneId,
      fonte: parsed.data.fonte,
    }),
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
      regolarizzata: parsed.data.regolarizzata,
      esitoRegolarizzazione: parsed.data.esitoRegolarizzazione ?? null,
      verificataRegolarizzazione: parsed.data.verificataRegolarizzazione,
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
  const tenantContext = await getCurrentTenantContext();
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
    regolarizzata: formData.get("regolarizzata") ?? "false",
    dataRegolarizzazione: toOptional(formData.get("dataRegolarizzazione")?.toString()),
    descrizioneRegolarizzazione: toOptional(formData.get("descrizioneRegolarizzazione")?.toString()),
    esitoRegolarizzazione: toOptional(formData.get("esitoRegolarizzazione")?.toString()),
    verificataRegolarizzazione: formData.get("verificataRegolarizzazione") ?? "false",
    dataVerificaRegolarizzazione: toOptional(formData.get("dataVerificaRegolarizzazione")?.toString()),
    noteVerificaRegolarizzazione: toOptional(formData.get("noteVerificaRegolarizzazione")?.toString()),
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
    throw new Error("Criticit… non trovata.");
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

  if (tenantContext) {
    try {
      await requireConcessioneTenantAccess(tenantContext, existing.concessioneId, {
        mode: "write",
        allowWhenEnteMissing: false,
      });
    } catch (error) {
      await auditFailure({
        azione: "AUTHZ_DENIED",
        entita: "Criticita",
        entitaId: existing.id,
        concessioneId: existing.concessioneId,
        actor: { userRole: role },
        metadata: {
          actionType: "CRITICITA_UPDATE",
          reason: error instanceof Error ? error.message : "TENANT_WRITE_DENIED",
        },
      });
      throw new Error("Operazione non autorizzata per il tenant corrente.");
    }
  }

  await prisma.criticita.update({
    where: { id: parsed.data.id },
    data: {
      gravita: parsed.data.gravita,
      stato: parsed.data.stato,
      ...buildCriticitaInstructionData(parsed.data),
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
      regolarizzata: parsed.data.regolarizzata,
      esitoRegolarizzazione: parsed.data.esitoRegolarizzazione ?? null,
      verificataRegolarizzazione: parsed.data.verificataRegolarizzazione,
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
        "regolarizzata",
        "dataRegolarizzazione",
        "descrizioneRegolarizzazione",
        "esitoRegolarizzazione",
        "verificataRegolarizzazione",
        "dataVerificaRegolarizzazione",
        "noteVerificaRegolarizzazione",
      ],
    },
  });

  revalidatePath("/criticita");
  revalidatePath(`/criticita/${existing.id}`);
  revalidatePath(`/concessioni/${existing.concessioneId}`);
  revalidatePath("/dashboard");
  redirect(`/criticita/${existing.id}`);
}
